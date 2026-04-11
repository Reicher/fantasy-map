import { getBiomeRoadTravelCostById } from "../../biomes/index.js";
import { MinHeap } from "./minHeap.js";
import { buildSeaRoutes } from "./roadSeaRoutes.js";
import {
  clamp,
  coordsOf,
  forEachNeighbor,
  indexOf,
} from "../../utils.js";

// ---------------------------------------------------------------------------
// Terrain travel cost per biome.
// Easy terrain (plains) is cheap; difficult terrain (mountains, jungle) is
// expensive. Ocean and lakes are impassable for land roads.
// ---------------------------------------------------------------------------

// When both adjacent cells already carry a road, applying this multiplier
// makes later roads prefer to follow existing paths — producing natural T/+
// intersections instead of parallel corridors.
// Values close to 1.0 mean little discount; the pathfinder will only merge
// onto existing roads when the terrain genuinely makes them the shortest route.
// Values close to 0 mean nearly-free travel on roads; the pathfinder will go
// far out of its way to ride an existing road, producing parallel doubles.
const ON_ROAD_COST_FACTOR = 0.5;
const TOUCHING_ROAD_COST_FACTOR = 0.68;

// Penalty applied when a destination cell is NOT on a road but directly
// neighbours one.  This discourages new roads from running alongside an
// existing road, pushing them to either merge onto it (ON_ROAD_COST_FACTOR
// takes over) or detour far enough that the eventual junction forms a clean
// T/+ shape rather than a narrow fork.
const PARALLEL_ROAD_PENALTY = 4.2;
const NEAR_PARALLEL_ROAD_PENALTY = 1.6;

// Penalty applied to cells within SETTLEMENT_APPROACH_RADIUS of a settlement that
// already has at least one road connection.  Prevents new roads from
// sneaking up alongside an existing connection and forming a narrow Y fork.
// The settlement cell itself carries no penalty (roads must be able to reach it).
const SETTLEMENT_APPROACH_RADIUS = 6;
const SETTLEMENT_APPROACH_PEAK_PENALTY = 10.5;

const LOOP_MIN_NEW_CELL_COUNT = 6;
const LOOP_MIN_NEW_CELL_SHARE = 0.26;
const BASE_LOOP_THIRD_PARTY_SETTLEMENT_CLEARANCE = 5.6;
const LOOP_PARALLEL_PROXIMITY_MIN_COUNT = 5;
const LOOP_PARALLEL_PROXIMITY_MAX_SHARE = 0.52;
const LOOP_PARALLEL_PROXIMITY_ENDPOINT_TRIM = 2;
const BASE_JUNCTION_COLLAPSE_RADIUS = 2.2;
const JUNCTION_COLLAPSE_MAX_PASSES = 3;
const SETTLEMENT_JUNCTION_MAGNET_RADIUS = 4.2;
const BASE_SETTLEMENT_NEAR_JUNCTION_COLLAPSE_RADIUS = 3.8;
const BASE_SETTLEMENT_NEAR_JUNCTION_FORCE_RADIUS = 4.9;
const BASE_SETTLEMENT_NEAR_JUNCTION_LINK_DISTANCE = 4.9;
const DEFAULT_NODE_MIN_DISTANCE = 5;

const RIVER_COST_THRESHOLD = 0.06;
const RIVER_BASE_PENALTY = 3.2;
const RIVER_STRENGTH_SCALE = 4.2;
const MAX_ROAD_USAGE = 65535;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full road network for a world.
 *
 * Algorithm overview:
 *   1. Build a per-cell terrain travel-cost field from biome, elevation, and
 *      mountain data.
 *   2. Identify contiguous landmasses via flood-fill.
 *   3. Per landmass: run Dijkstra once per settlement to get all-pairs travel
 *      costs, compute a Minimum Spanning Tree (Kruskal's), then materialise
 *      each MST edge as a road. Roads are laid cheapest-first so that later
 *      roads naturally merge with earlier ones (creating T/+ intersections).
 *   4. Add a small set of shortcut edges controlled by roadLoopiness to
 *      break up horseshoe-shaped networks.
 *   5. Connect isolated landmasses with the minimum number of sea routes.
 *
 * Signposts and abandoned nodes are NOT placed here. They are derived
 * post-hoc by features.js from the completed network topology.
 */
export function generateRoads(world) {
  const { params, terrain, climate, hydrology, settlements } = world;
  const { width, height, size, isLand, elevation, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength } = hydrology;
  const loopiness01 = clamp(Number(params.roadLoopiness ?? 50), 0, 100) / 100;
  const nodeMinDistance = clamp(
    Number(params.nodeMinDistance ?? DEFAULT_NODE_MIN_DISTANCE),
    2,
    14,
  );
  const settlementNearJunctionCollapseRadius = Math.max(
    BASE_SETTLEMENT_NEAR_JUNCTION_COLLAPSE_RADIUS,
    nodeMinDistance + 0.4,
  );
  const settlementNearJunctionForceRadius = Math.max(
    BASE_SETTLEMENT_NEAR_JUNCTION_FORCE_RADIUS,
    nodeMinDistance + 0.8,
  );
  const settlementNearJunctionLinkDistance = Math.max(
    BASE_SETTLEMENT_NEAR_JUNCTION_LINK_DISTANCE,
    nodeMinDistance + 0.6,
  );
  const junctionCollapseRadius = Math.max(
    BASE_JUNCTION_COLLAPSE_RADIUS,
    nodeMinDistance + 0.35,
  );
  const loopThirdPartySettlementClearance = Math.max(
    BASE_LOOP_THIRD_PARTY_SETTLEMENT_CLEARANCE,
    nodeMinDistance + 0.8,
  );

  if (settlements.length < 2) {
    return {
      roads: [],
      roadUsage: new Uint16Array(size),
      componentCount: settlements.length > 0 ? 1 : 0,
    };
  }

  // Per-cell terrain traversal cost. Impassable cells (ocean, lake) get +Inf.
  const baseCost = buildBaseCost(
    size,
    isLand,
    lakeIdByCell,
    biome,
    elevation,
    mountainField,
  );

  // Label each land cell with its connected landmass ID.
  const landComponentByCell = buildLandComponents(width, height, size, isLand);

  // Group settlements by landmass so we only route within each island.
  const settlementsByComponent = new Map();
  for (const settlement of settlements) {
    const comp = landComponentByCell[settlement.cell];
    if (!settlementsByComponent.has(comp)) {
      settlementsByComponent.set(comp, []);
    }
    settlementsByComponent.get(comp).push(settlement);
  }

  const roads = [];
  const roadSignatures = new Set();
  const roadUsage = new Uint16Array(size);
  const settlementProximityPenalty = new Float32Array(size);
  let componentCount = 0;

  // Fast lookup: land cell → settlement (used to trim paths at intermediate settlements).
  const settlementByCell = new Map(settlements.map((settlement) => [settlement.cell, settlement]));

  // Pairwise A* travel costs collected during the MST phase and reused by
  // the loop-augmentation phase to avoid recomputing them.
  const pairwiseCosts = new Map();

  // =========================================================================
  // Phase 1 — Sparse connected base network (MST)
  //
  // For each landmass with >= 2 settlements:
  //   a. Run Dijkstra from each settlement (no reuse bonus yet).
  //   b. Build pairwise cost matrix.
  //   c. Compute MST with Kruskal's algorithm.
  //   d. Materialise MST edges as roads, cheapest first, with road-reuse
  //      discount active. This causes later roads to overlap earlier ones,
  //      naturally forming T and + intersections.
  // =========================================================================
  for (const [, componentSettlements] of settlementsByComponent) {
    componentCount += 1;
    if (componentSettlements.length < 2) {
      continue;
    }

    // Run Dijkstra from each settlement on this landmass.
    // No road-reuse bonus here — we want the unbiased terrain cost for MST
    // edge weights.
    const distBySettlement = new Map();
    for (const settlement of componentSettlements) {
      distBySettlement.set(
        settlement.id,
        runDijkstra({
          width,
          height,
          size,
          baseCost,
          riverStrength,
          source: settlement.cell,
        }),
      );
    }

    // Build symmetric pairwise cost matrix.
    const n = componentSettlements.length;
    const edgeCost = new Float64Array(n * n);
    for (let i = 0; i < n; i += 1) {
      const row = distBySettlement.get(componentSettlements[i].id);
      for (let j = i + 1; j < n; j += 1) {
        const raw = row[componentSettlements[j].cell];
        const cost = Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
        edgeCost[i * n + j] = cost;
        edgeCost[j * n + i] = cost;
        // Store for loop-augmentation phase below.
        pairwiseCosts.set(
          pairKey(componentSettlements[i].id, componentSettlements[j].id),
          cost,
        );
      }
    }

    // Kruskal's MST — ensures every settlement on this landmass is reachable
    // while keeping the network as sparse as possible.
    const mstEdges = buildMST(n, edgeCost);

    // Cheapest edges first: easy roads are laid before difficult ones.
    // Difficult roads then naturally piggyback on existing easy segments.
    mstEdges.sort((a, b) => a.cost - b.cost);

    for (const edge of mstEdges) {
      const fromSettlement = componentSettlements[edge.i];
      const toSettlement = componentSettlements[edge.j];
      const actualFromSettlement = materializeRoad({
        roads,
        roadSignatures,
        roadUsage,
        settlementByCell,
        fromSettlement,
        toSettlement,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        settlementProximityPenalty,
        cost: edge.cost,
      });
      if (!actualFromSettlement) {
        continue;
      }

      // Stamp a proximity penalty around each connected settlement so future roads
      // approach from a different angle rather than forking close to the node.
      stampSettlementProximity(
        actualFromSettlement,
        settlementProximityPenalty,
        width,
        height,
      );
      stampSettlementProximity(toSettlement, settlementProximityPenalty, width, height);
    }
  }

  // =========================================================================
  // Phase 2 — Loop augmentation
  //
  // Add shortcut edges only where they provide a meaningful improvement.
  // A pair (A, B) is a candidate when the current network path is
  // significantly longer than the direct A* travel cost. Only the best
  // candidates are added, up to a budget controlled by roadLoopiness.
  // =========================================================================
  if (loopiness01 > 0 && settlements.length >= 3) {
    addLoopEdges({
      settlements,
      roads,
      roadSignatures,
      roadUsage,
      settlementProximityPenalty,
      loopiness01,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      landComponentByCell,
      pairwiseCosts,
      settlementByCell,
      loopThirdPartySettlementClearance,
    });
  }

  // =========================================================================
  // Phase 3 — Sea routes: connect isolated landmasses with minimal sea links.
  // =========================================================================
  const seaRoutes = buildSeaRoutes({
    settlements,
    roads,
    roadSignatures,
    terrain,
    climate,
    landComponentByCell,
  });
  roads.push(...seaRoutes);

  let collapsedNearSettlementJunctions = false;
  let collapsedNearbyJunctions = false;
  for (let pass = 0; pass < JUNCTION_COLLAPSE_MAX_PASSES; pass += 1) {
    const nearSettlementChanged = collapseNearSettlementJunctions(
      roads,
      settlements,
      width,
      {
        collapseRadius: settlementNearJunctionCollapseRadius,
        forceRadius: settlementNearJunctionForceRadius,
        linkDistance: settlementNearJunctionLinkDistance,
      },
    );
    const nearbyJunctionChanged = collapseNearbyJunctionClusters(roads, width, {
      collapseRadius: junctionCollapseRadius,
    });
    if (!nearSettlementChanged && !nearbyJunctionChanged) {
      break;
    }
    if (nearSettlementChanged) {
      collapsedNearSettlementJunctions = true;
    }
    if (nearbyJunctionChanged) {
      collapsedNearbyJunctions = true;
    }
  }

  if (collapsedNearSettlementJunctions || collapsedNearbyJunctions) {
    removeDegenerateRoadsInPlace(roads);
    rebuildLandRoadUsage(roadUsage, roads);
  }

  return { roads, roadUsage, componentCount };
}

// ---------------------------------------------------------------------------
// Terrain cost field
// ---------------------------------------------------------------------------

function buildBaseCost(
  size,
  isLand,
  lakeIdByCell,
  biome,
  elevation,
  mountainField,
) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = getBiomeRoadTravelCostById(biome[index]) ?? 1.2;
    const slopePenalty = elevation[index] * 1.05;
    const mountainPenalty =
      mountainField[index] * 4.9 +
      Math.max(0, mountainField[index] - 0.62) * 8.1;
    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

// ---------------------------------------------------------------------------
// Landmass flood-fill
// ---------------------------------------------------------------------------

function buildLandComponents(width, height, size, isLand) {
  const components = new Int32Array(size);
  components.fill(-1);
  let nextId = 0;

  for (let start = 0; start < size; start += 1) {
    if (!isLand[start] || components[start] >= 0) {
      continue;
    }

    const queue = [start];
    components[start] = nextId;

    while (queue.length > 0) {
      const current = queue.pop();
      const [x, y] = coordsOf(current, width);
      forEachNeighbor(width, height, x, y, true, (nx, ny) => {
        const neighbor = indexOf(nx, ny, width);
        if (!isLand[neighbor] || components[neighbor] >= 0) {
          return;
        }
        components[neighbor] = nextId;
        queue.push(neighbor);
      });
    }

    nextId += 1;
  }

  return components;
}

// ---------------------------------------------------------------------------
// Dijkstra on the grid — returns Float32Array of distances from source.
// No road-reuse discount is applied; this gives the unbiased terrain cost
// used as MST edge weights.
// ---------------------------------------------------------------------------

function runDijkstra({ width, height, size, baseCost, riverStrength, source }) {
  const dist = new Float32Array(size);
  dist.fill(Number.POSITIVE_INFINITY);
  const heap = new MinHeap();

  if (Number.isFinite(baseCost[source])) {
    dist[source] = 0;
    heap.push(source, 0);
  }

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    if (priority > dist[current] + 1e-4) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
      const neighbor = indexOf(nx, ny, width);
      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const cost = computeStepCost(
        current,
        neighbor,
        diagonal,
        baseCost,
        riverStrength,
        null,
      );
      if (!Number.isFinite(cost)) {
        return;
      }
      const newCost = priority + cost;
      if (newCost < dist[neighbor]) {
        dist[neighbor] = newCost;
        heap.push(neighbor, newCost);
      }
    });
  }

  return dist;
}

// ---------------------------------------------------------------------------
// Kruskal's Minimum Spanning Tree
// ---------------------------------------------------------------------------

function buildMST(n, edgeCost) {
  // Enumerate all finite-weight edges (upper triangle only).
  const edges = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const cost = edgeCost[i * n + j];
      if (Number.isFinite(cost)) {
        edges.push({ i, j, cost });
      }
    }
  }
  edges.sort((a, b) => a.cost - b.cost);

  // Union-Find with path halving.
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Uint8Array(n);

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(x, y) {
    const px = find(x);
    const py = find(y);
    if (px === py) {
      return false;
    }
    if (rank[px] < rank[py]) {
      parent[px] = py;
    } else if (rank[px] > rank[py]) {
      parent[py] = px;
    } else {
      parent[py] = px;
      rank[px] += 1;
    }
    return true;
  }

  const mstEdges = [];
  for (const edge of edges) {
    if (union(edge.i, edge.j)) {
      mstEdges.push(edge);
      if (mstEdges.length === n - 1) {
        break;
      }
    }
  }

  return mstEdges;
}

// ---------------------------------------------------------------------------
// Path-finding from one cell to another with optional road-reuse discount.
// Returns the cell path (from → to) or null if unreachable.
// ---------------------------------------------------------------------------

function findPath({
  from,
  to,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  roadUsage,
  settlementProximityPenalty = null,
}) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return null;
  }

  const dist = new Float32Array(size);
  dist.fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(size);
  prev.fill(-1);
  const heap = new MinHeap();

  dist[from] = 0;
  heap.push(from, 0);

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    if (priority > dist[current] + 1e-4) {
      continue;
    }
    if (current === to) {
      break;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
      const neighbor = indexOf(nx, ny, width);
      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const cost = computeStepCost(
        current,
        neighbor,
        diagonal,
        baseCost,
        riverStrength,
        roadUsage,
        width,
        height,
        settlementProximityPenalty,
      );
      if (!Number.isFinite(cost)) {
        return;
      }
      const newCost = priority + cost;
      if (newCost < dist[neighbor]) {
        dist[neighbor] = newCost;
        prev[neighbor] = current;
        heap.push(neighbor, newCost);
      }
    });
  }

  if (!Number.isFinite(dist[to])) {
    return null;
  }

  const path = [to];
  let current = to;
  while (prev[current] >= 0) {
    current = prev[current];
    if (path[path.length - 1] !== current) {
      path.push(current);
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// Per-step traversal cost (used by both Dijkstra and findPath)
// ---------------------------------------------------------------------------

// Returns proximity band for a destination cell relative to existing roads:
//   0 = no nearby road, 1 = directly adjacent (8-neighbour), 2 = very close
//       (within two-cell Chebyshev radius).
function getRoadProximityBand(cell, roadUsage, width, height) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  let nearBandHit = false;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const chebyshevDistance = Math.max(Math.abs(ox), Math.abs(oy));
      if (chebyshevDistance > 2) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (roadUsage[ny * width + nx] > 0) {
        if (chebyshevDistance <= 1) {
          return 1;
        }
        nearBandHit = true;
      }
    }
  }
  return nearBandHit ? 2 : 0;
}

function computeStepCost(
  from,
  to,
  diagonal,
  baseCost,
  riverStrength,
  roadUsage,
  width = 0,
  height = 0,
  settlementProximityPenalty = null,
) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return Number.POSITIVE_INFINITY;
  }

  const stepLength = diagonal ? 1.4142 : 1.0;
  let cost = (baseCost[from] + baseCost[to]) * 0.5 * stepLength;

  // River crossings are expensive — roads prefer to follow river banks.
  const river = Math.max(riverStrength[from], riverStrength[to]);
  if (river > RIVER_COST_THRESHOLD) {
    cost += RIVER_BASE_PENALTY + clamp(river, 0, 4) * RIVER_STRENGTH_SCALE;
  }

  // Road-reuse discount encourages later roads to merge with existing ones,
  // creating natural intersections rather than parallel corridors.
  if (roadUsage !== null) {
    if (roadUsage[to] > 0) {
      // Destination is on an existing road — full merge discount.
      if (roadUsage[from] > 0) {
        cost *= ON_ROAD_COST_FACTOR;
      } else {
        cost *= TOUCHING_ROAD_COST_FACTOR;
      }
    } else {
      // Destination is off-road.  Apply merge discount if origin is on a road.
      if (roadUsage[from] > 0) {
        cost *= TOUCHING_ROAD_COST_FACTOR;
      }

      // Parallel-road penalty: if the destination cell directly neighbours an
      // existing road it would run alongside it — a fork.  Make this
      // noticeably more expensive so the path either merges onto the road or
      // swings wide enough for a clean T/+ intersection.
      if (width > 0) {
        const proximityBand = getRoadProximityBand(to, roadUsage, width, height);
        if (proximityBand === 1) {
          cost += PARALLEL_ROAD_PENALTY;
        } else if (proximityBand === 2) {
          cost += NEAR_PARALLEL_ROAD_PENALTY;
        }
      }
    }
  }

  // Settlement proximity penalty: discourage approaching an already-connected settlement
  // node from a shallow angle.  The settlement cell itself has penalty 0 so roads
  // can always reach their destination; only the surrounding cells are
  // penalised, pushing new roads to arrive at a perpendicular angle.
  if (settlementProximityPenalty !== null) {
    cost += settlementProximityPenalty[to];
  }

  return cost;
}

// ---------------------------------------------------------------------------
// Loop augmentation — add shortcut edges to break horseshoe networks
// ---------------------------------------------------------------------------

function addLoopEdges({
  settlements,
  roads,
  roadSignatures,
  roadUsage,
  settlementProximityPenalty,
  loopiness01,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  landComponentByCell,
  pairwiseCosts,
  settlementByCell,
  loopThirdPartySettlementClearance,
}) {
  // Only add extra edges when the current network path is a strong detour.
  const detourThreshold = 3.5 + (1.45 - 3.5) * loopiness01;
  const maxExtraEdges = Math.max(
    1,
    Math.round(settlements.length * loopiness01 * 0.55),
  );

  // Build settlement-to-settlement adjacency from the materialised roads.
  const settlementAdj = new Map();
  for (const settlement of settlements) {
    settlementAdj.set(settlement.id, []);
  }

  // Track which settlement pairs already have a direct road so we don't duplicate.
  const directlyConnected = new Set();

  for (const road of roads) {
    if (
      road?.type !== "road" ||
      road.settlementId == null ||
      road.fromSettlementId == null
    ) {
      continue;
    }
    const { settlementId, fromSettlementId, cost } = road;
    settlementAdj.get(fromSettlementId)?.push({ neighborId: settlementId, cost });
    settlementAdj.get(settlementId)?.push({ neighborId: fromSettlementId, cost });
    directlyConnected.add(pairKey(settlementId, fromSettlementId));
  }

  // All-pairs shortest network path via Dijkstra on the settlement graph.
  const networkDistBySettlement = new Map();
  for (const settlement of settlements) {
    networkDistBySettlement.set(settlement.id, dijkstraOnSettlementGraph(settlement.id, settlementAdj));
  }

  // Collect shortcut candidates.
  const candidates = [];
  for (let i = 0; i < settlements.length; i += 1) {
    const settlementA = settlements[i];
    for (let j = i + 1; j < settlements.length; j += 1) {
      const settlementB = settlements[j];

      // Only consider pairs on the same landmass.
      if (landComponentByCell[settlementA.cell] !== landComponentByCell[settlementB.cell]) {
        continue;
      }

      const key = pairKey(settlementA.id, settlementB.id);
      if (directlyConnected.has(key)) {
        continue;
      }

      const directCost = pairwiseCosts.get(key);
      if (!Number.isFinite(directCost) || directCost <= 0) {
        continue;
      }

      const networkCost =
        networkDistBySettlement.get(settlementA.id)?.get(settlementB.id) ??
        Number.POSITIVE_INFINITY;
      if (!Number.isFinite(networkCost)) {
        continue;
      }

      const detourRatio = networkCost / directCost;
      if (detourRatio < detourThreshold) {
        continue;
      }

      candidates.push({ settlementA, settlementB, directCost, detourRatio, key });
    }
  }

  // Add best shortcuts first (largest detour reduction).
  candidates.sort((a, b) => b.detourRatio - a.detourRatio);

  let added = 0;
  for (const { settlementA, settlementB, directCost, key } of candidates) {
    if (added >= maxExtraEdges) {
      break;
    }
    if (
      !materializeRoad({
        roads,
        roadSignatures,
        roadUsage,
        settlementByCell,
        fromSettlement: settlementA,
        toSettlement: settlementB,
        settlements,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        settlementProximityPenalty,
        cost: directCost,
        requireDirectFrom: true,
        minNovelCellCount: LOOP_MIN_NEW_CELL_COUNT,
        minNovelCellShare: LOOP_MIN_NEW_CELL_SHARE,
        thirdPartySettlementClearance: loopThirdPartySettlementClearance,
      })
    ) {
      continue;
    }

    directlyConnected.add(key);
    added += 1;
  }
}

// Dijkstra on the (small) settlement graph — returns Map<settlementId, cost>.
function dijkstraOnSettlementGraph(sourceId, adjacency) {
  const dist = new Map();
  dist.set(sourceId, 0);
  const heap = new MinHeap();
  heap.push(sourceId, 0);

  while (heap.size > 0) {
    const { index: settlementId, priority } = heap.pop();
    if (priority > (dist.get(settlementId) ?? Number.POSITIVE_INFINITY) + 1e-6) {
      continue;
    }
    for (const { neighborId, cost } of adjacency.get(settlementId) ?? []) {
      const newCost = priority + cost;
      if (newCost < (dist.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
        dist.set(neighborId, newCost);
        heap.push(neighborId, newCost);
      }
    }
  }

  return dist;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Stamp a quadratic proximity penalty around `settlement` into `field`.  The settlement
 * cell itself is left at zero so roads can always reach their destination;
 * surrounding cells within SETTLEMENT_APPROACH_RADIUS get a penalty that peaks at
 * the nearest ring and fades to zero at the boundary.  Uses max so repeated
 * stamps from multiple settlements accumulate correctly.
 */
function stampSettlementProximity(settlement, field, width, height) {
  const cx = Math.round(settlement.x);
  const cy = Math.round(settlement.y);
  const r = SETTLEMENT_APPROACH_RADIUS;

  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue; // Settlement cell itself: no penalty — roads must reach it.
      }
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const d = Math.hypot(dx, dy);
      if (d > r) {
        continue;
      }
      const t = 1 - d / r;
      const penalty = SETTLEMENT_APPROACH_PEAK_PENALTY * t * t;
      const cell = ny * width + nx;
      if (penalty > field[cell]) {
        field[cell] = penalty;
      }
    }
  }
}

function countNovelCells(cells, roadUsage) {
  let count = 0;
  for (const cell of cells) {
    if (roadUsage[cell] === 0) {
      count += 1;
    }
  }
  return count;
}

function hasExcessiveParallelProximity(
  cells,
  roadUsage,
  width,
  height,
  endpointTrim = LOOP_PARALLEL_PROXIMITY_ENDPOINT_TRIM,
) {
  if (!cells?.length || !roadUsage || width <= 0 || height <= 0) {
    return false;
  }

  const start = Math.max(1, endpointTrim);
  const end = Math.max(start, cells.length - 1 - endpointTrim);
  let novelInteriorCount = 0;
  let closeParallelCount = 0;

  for (let i = start; i < end; i += 1) {
    const cell = cells[i];
    if (roadUsage[cell] > 0) {
      continue;
    }
    novelInteriorCount += 1;
    if (getRoadProximityBand(cell, roadUsage, width, height) === 1) {
      closeParallelCount += 1;
    }
  }

  if (
    novelInteriorCount < LOOP_PARALLEL_PROXIMITY_MIN_COUNT ||
    closeParallelCount < LOOP_PARALLEL_PROXIMITY_MIN_COUNT
  ) {
    return false;
  }
  return (
    closeParallelCount / Math.max(1, novelInteriorCount) >
    LOOP_PARALLEL_PROXIMITY_MAX_SHARE
  );
}

function hasThirdPartySettlementNearPath(
  cells,
  settlements,
  fromSettlementId,
  toSettlementId,
  width,
  clearance,
) {
  if (!settlements?.length || clearance <= 0) {
    return false;
  }
  const clearanceSquared = clearance * clearance;

  for (let i = 1; i < cells.length - 1; i += 1) {
    const [x, y] = coordsOf(cells[i], width);
    for (const settlement of settlements) {
      if (
        settlement.id === fromSettlementId ||
        settlement.id === toSettlementId
      ) {
        continue;
      }
      const dx = x - settlement.x;
      const dy = y - settlement.y;
      if (dx * dx + dy * dy <= clearanceSquared) {
        return true;
      }
    }
  }

  return false;
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
}

function buildRoadSignature(type, cells) {
  const forward = cells.join(",");
  const reverse = [...cells].reverse().join(",");
  const canonical = forward < reverse ? forward : reverse;
  return `${type}|${canonical}`;
}

function pushRoadRecord(
  roads,
  roadSignatures,
  { settlementId, fromSettlementId, cells, cost, type = "road" },
) {
  const signature = buildRoadSignature(type, cells);
  if (roadSignatures.has(signature)) {
    return false;
  }

  roads.push({
    id: roads.length,
    type,
    settlementId,
    fromSettlementId,
    cells,
    length: cells.length,
    cost,
  });
  roadSignatures.add(signature);
  return true;
}

function incrementRoadUsage(roadUsage, cells) {
  for (const cell of cells) {
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, MAX_ROAD_USAGE);
  }
}

function rebuildLandRoadUsage(roadUsage, roads) {
  roadUsage.fill(0);
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    incrementRoadUsage(roadUsage, road.cells ?? []);
  }
}

function removeDegenerateRoadsInPlace(roads) {
  let writeIndex = 0;
  for (const road of roads) {
    if (!road || !Array.isArray(road.cells) || road.cells.length < 2) {
      continue;
    }
    road.id = writeIndex;
    roads[writeIndex] = road;
    writeIndex += 1;
  }
  roads.length = writeIndex;
}

function collapseNearSettlementJunctions(
  roads,
  settlements,
  width,
  { collapseRadius, forceRadius, linkDistance } = {},
) {
  if (!roads?.length || !settlements?.length || width <= 0) {
    return false;
  }

  const settlementCells = new Set(
    settlements
      .map((settlement) => settlement?.cell)
      .filter((cell) => Number.isFinite(cell)),
  );
  if (!settlementCells.size) {
    return false;
  }

  const adjacencyByCell = new Map();
  const connect = (fromCell, toCell) => {
    let neighbors = adjacencyByCell.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacencyByCell.set(fromCell, neighbors);
    }
    neighbors.add(toCell);
  };

  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      const fromCell = cells[i - 1];
      const toCell = cells[i];
      if (fromCell === toCell) {
        continue;
      }
      connect(fromCell, toCell);
      connect(toCell, fromCell);
    }
  }

  const settlementDegreeByCell = new Map();
  for (const settlement of settlements) {
    if (!settlement || !Number.isFinite(settlement.cell)) {
      continue;
    }
    settlementDegreeByCell.set(
      settlement.cell,
      adjacencyByCell.get(settlement.cell)?.size ?? 0,
    );
  }

  const effectiveCollapseRadius = Math.max(
    1.5,
    Number(collapseRadius) || BASE_SETTLEMENT_NEAR_JUNCTION_COLLAPSE_RADIUS,
  );
  const effectiveForceRadius = Math.max(
    effectiveCollapseRadius,
    Number(forceRadius) || BASE_SETTLEMENT_NEAR_JUNCTION_FORCE_RADIUS,
  );
  const effectiveLinkDistance = Math.max(
    1.5,
    Number(linkDistance) || BASE_SETTLEMENT_NEAR_JUNCTION_LINK_DISTANCE,
  );
  const collapseRadiusSquared = effectiveCollapseRadius * effectiveCollapseRadius;
  const forceRadiusSquared = effectiveForceRadius * effectiveForceRadius;

  const replacementByCell = new Map();
  for (const [cell, neighbors] of adjacencyByCell.entries()) {
    if (neighbors.size < 3 || settlementCells.has(cell)) {
      continue;
    }
    const [x, y] = coordsOf(cell, width);
    let nearestForcedSettlement = null;
    let nearestForcedDistanceSquared = Number.POSITIVE_INFINITY;
    for (const settlement of settlements) {
      if (!settlement || !Number.isFinite(settlement.cell)) {
        continue;
      }
      const dx = x - settlement.x;
      const dy = y - settlement.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > forceRadiusSquared) {
        continue;
      }
      if (distanceSquared < nearestForcedDistanceSquared) {
        nearestForcedSettlement = settlement;
        nearestForcedDistanceSquared = distanceSquared;
      }
    }
    if (nearestForcedSettlement) {
      replacementByCell.set(cell, nearestForcedSettlement.cell);
      continue;
    }
    let nearbySettlement = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const settlement of settlements) {
      if (!settlement || !Number.isFinite(settlement.cell)) {
        continue;
      }
      const dx = x - settlement.x;
      const dy = y - settlement.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > collapseRadiusSquared) {
        continue;
      }
      const settlementDegree =
        settlementDegreeByCell.get(settlement.cell) ?? 0;
      if (settlementDegree > 2) {
        continue;
      }
      const score = distanceSquared;
      if (score < bestScore) {
        nearbySettlement = settlement;
        bestScore = score;
      }
    }
    if (!nearbySettlement) {
      continue;
    }
    replacementByCell.set(cell, nearbySettlement.cell);
  }

  if (!replacementByCell.size) {
    return false;
  }

  let changed = false;
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    let roadChanged = false;
    for (let i = 0; i < cells.length; i += 1) {
      const replacementCell = replacementByCell.get(cells[i]);
      if (replacementCell == null) {
        continue;
      }
      const prev = i > 0 ? cells[i - 1] : -1;
      const next = i < cells.length - 1 ? cells[i + 1] : -1;
      const hasNearSegment =
        isCellWithinDistance(
          prev,
          replacementCell,
          width,
          effectiveLinkDistance,
        ) ||
        isCellWithinDistance(
          next,
          replacementCell,
          width,
          effectiveLinkDistance,
        );
      if (prev !== replacementCell && next !== replacementCell && !hasNearSegment) {
        continue;
      }
      cells[i] = replacementCell;
      roadChanged = true;
    }
    if (!roadChanged) {
      continue;
    }
    dedupeConsecutiveCellsInPlace(cells);
    road.length = cells.length;
    changed = true;
  }

  return changed;
}

function isCellWithinDistance(cellA, cellB, width, maxDistance) {
  if (
    !Number.isFinite(cellA) ||
    !Number.isFinite(cellB) ||
    cellA < 0 ||
    cellB < 0 ||
    width <= 0 ||
    maxDistance <= 0
  ) {
    return false;
  }
  const [ax, ay] = coordsOf(cellA, width);
  const [bx, by] = coordsOf(cellB, width);
  return Math.hypot(ax - bx, ay - by) <= maxDistance;
}

function collapseNearbyJunctionClusters(
  roads,
  width,
  { collapseRadius } = {},
) {
  if (!roads?.length || width <= 0) {
    return false;
  }

  const adjacencyByCell = new Map();
  const connect = (fromCell, toCell) => {
    let neighbors = adjacencyByCell.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacencyByCell.set(fromCell, neighbors);
    }
    neighbors.add(toCell);
  };

  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      const fromCell = cells[i - 1];
      const toCell = cells[i];
      if (fromCell === toCell) {
        continue;
      }
      connect(fromCell, toCell);
      connect(toCell, fromCell);
    }
  }

  const junctionCells = [...adjacencyByCell.entries()]
    .filter(([, neighbors]) => neighbors.size >= 3)
    .map(([cell]) => cell);
  if (junctionCells.length < 2) {
    return false;
  }

  const clusters = [];
  const cellCoords = new Map();
  const effectiveCollapseRadius = Math.max(
    0.8,
    Number(collapseRadius) || BASE_JUNCTION_COLLAPSE_RADIUS,
  );
  const maxDistanceSq = effectiveCollapseRadius * effectiveCollapseRadius;
  const linkDistance = Math.max(1.5, effectiveCollapseRadius + 0.85);

  for (const cell of junctionCells.sort((a, b) => a - b)) {
    const [x, y] = coordsOf(cell, width);
    cellCoords.set(cell, { x, y });
    let bestCluster = null;
    let bestDistanceSq = maxDistanceSq;
    for (const cluster of clusters) {
      const dx = x - cluster.centerX;
      const dy = y - cluster.centerY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > bestDistanceSq) {
        continue;
      }
      bestDistanceSq = distanceSq;
      bestCluster = cluster;
    }
    if (!bestCluster) {
      clusters.push({
        cells: [cell],
        sumX: x,
        sumY: y,
        centerX: x,
        centerY: y,
      });
      continue;
    }
    bestCluster.cells.push(cell);
    bestCluster.sumX += x;
    bestCluster.sumY += y;
    const count = bestCluster.cells.length;
    bestCluster.centerX = bestCluster.sumX / count;
    bestCluster.centerY = bestCluster.sumY / count;
  }

  const replacementByCell = new Map();
  for (const cluster of clusters) {
    if (cluster.cells.length < 2) {
      continue;
    }
    let representativeCell = cluster.cells[0];
    let bestDegree = adjacencyByCell.get(representativeCell)?.size ?? 0;
    let bestCenterDistanceSq = Number.POSITIVE_INFINITY;
    for (const cell of cluster.cells) {
      const degree = adjacencyByCell.get(cell)?.size ?? 0;
      const point = cellCoords.get(cell);
      const dx = point.x - cluster.centerX;
      const dy = point.y - cluster.centerY;
      const centerDistanceSq = dx * dx + dy * dy;
      if (
        degree > bestDegree ||
        (degree === bestDegree && centerDistanceSq < bestCenterDistanceSq) ||
        (degree === bestDegree &&
          Math.abs(centerDistanceSq - bestCenterDistanceSq) < 1e-9 &&
          cell < representativeCell)
      ) {
        representativeCell = cell;
        bestDegree = degree;
        bestCenterDistanceSq = centerDistanceSq;
      }
    }
    for (const cell of cluster.cells) {
      if (cell !== representativeCell) {
        replacementByCell.set(cell, representativeCell);
      }
    }
  }

  if (!replacementByCell.size) {
    return false;
  }

  let changed = false;
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    let roadChanged = false;
    for (let i = 0; i < cells.length; i += 1) {
      const replacementCell = replacementByCell.get(cells[i]);
      if (replacementCell == null) {
        continue;
      }
      const prev = i > 0 ? cells[i - 1] : -1;
      const next = i < cells.length - 1 ? cells[i + 1] : -1;
      const hasNearSegment =
        isCellWithinDistance(prev, replacementCell, width, linkDistance) ||
        isCellWithinDistance(next, replacementCell, width, linkDistance);
      if (prev !== replacementCell && next !== replacementCell && !hasNearSegment) {
        continue;
      }
      cells[i] = replacementCell;
      roadChanged = true;
    }
    if (!roadChanged) {
      continue;
    }
    dedupeConsecutiveCellsInPlace(cells);
    road.length = cells.length;
    changed = true;
  }

  return changed;
}

function materializeRoad({
  roads,
  roadSignatures,
  roadUsage,
  settlementByCell,
  fromSettlement,
  toSettlement,
  settlements = null,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementProximityPenalty,
  cost,
  requireDirectFrom = false,
  minNovelCellCount = 0,
  minNovelCellShare = 0,
  thirdPartySettlementClearance = 0,
}) {
  const rawPath = findPath({
    from: fromSettlement.cell,
    to: toSettlement.cell,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    roadUsage,
    settlementProximityPenalty,
  });
  if (!rawPath || rawPath.length < 2) {
    return null;
  }

  const settlementAnchors = uniqueSettlementsFromMap(settlementByCell);
  // If a path crosses an already-known settlement, keep only the novel head.
  let anchorSettlement = null;
  let anchorIndex = -1;
  let anchorByMagnet = false;
  for (let i = 1; i <= rawPath.length - 2; i += 1) {
    const settlement =
      settlementByCell.get(rawPath[i]) ??
      findSettlementNearCell(rawPath[i], width, settlementAnchors, {
        radius: SETTLEMENT_JUNCTION_MAGNET_RADIUS,
        excludeSettlementIds: [fromSettlement.id, toSettlement.id],
      });
    if (settlement != null) {
      anchorSettlement = settlement;
      anchorIndex = i;
      anchorByMagnet = settlementByCell.get(rawPath[i]) == null;
      break;
    }
  }
  const trimmed = anchorIndex >= 0 ? rawPath.slice(0, anchorIndex + 1) : [...rawPath];
  if (anchorByMagnet && anchorSettlement && trimmed.length >= 1) {
    const nearCell = trimmed[trimmed.length - 1];
    if (nearCell !== anchorSettlement.cell) {
      const connector = findPath({
        from: nearCell,
        to: anchorSettlement.cell,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        roadUsage,
        settlementProximityPenalty,
      });
      if (connector && connector.length >= 2) {
        const forward = [...connector].reverse();
        trimmed.push(...forward.slice(1));
      } else {
        trimmed.push(anchorSettlement.cell);
      }
    }
  }
  dedupeConsecutiveCellsInPlace(trimmed);
  if (trimmed.length < 2) {
    return null;
  }

  const actualFromSettlement = anchorSettlement ?? fromSettlement;
  if (requireDirectFrom && actualFromSettlement.id !== fromSettlement.id) {
    return null;
  }
  const novelCellCount = countNovelCells(trimmed, roadUsage);
  if (novelCellCount < minNovelCellCount) {
    return null;
  }
  if (
    minNovelCellShare > 0 &&
    novelCellCount / Math.max(1, trimmed.length) < minNovelCellShare
  ) {
    return null;
  }
  if (
    requireDirectFrom &&
    hasExcessiveParallelProximity(trimmed, roadUsage, width, height)
  ) {
    return null;
  }
  if (
    hasThirdPartySettlementNearPath(
      trimmed,
      settlements,
      fromSettlement.id,
      toSettlement.id,
      width,
      thirdPartySettlementClearance,
    )
  ) {
    return null;
  }

  const inserted = pushRoadRecord(roads, roadSignatures, {
    settlementId: toSettlement.id,
    fromSettlementId: actualFromSettlement.id,
    cells: trimmed,
    cost,
  });
  if (!inserted) {
    return null;
  }
  incrementRoadUsage(roadUsage, trimmed);
  return actualFromSettlement;
}

function uniqueSettlementsFromMap(settlementByCell) {
  if (!settlementByCell?.size) {
    return [];
  }
  const uniqueById = new Map();
  for (const settlement of settlementByCell.values()) {
    if (!settlement || settlement.id == null) {
      continue;
    }
    if (!uniqueById.has(settlement.id)) {
      uniqueById.set(settlement.id, settlement);
    }
  }
  return [...uniqueById.values()];
}

function findSettlementNearCell(
  cell,
  width,
  settlements,
  { radius = 0, excludeSettlementIds = [] } = {},
) {
  if (!Number.isFinite(cell) || width <= 0 || !settlements?.length || radius <= 0) {
    return null;
  }
  const excluded = new Set(excludeSettlementIds ?? []);
  const [x, y] = coordsOf(cell, width);
  const radiusSquared = radius * radius;
  let bestSettlement = null;
  let bestDistanceSquared = radiusSquared;

  for (const settlement of settlements) {
    if (!settlement || excluded.has(settlement.id)) {
      continue;
    }
    const dx = x - settlement.x;
    const dy = y - settlement.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > bestDistanceSquared) {
      continue;
    }
    if (!bestSettlement || distanceSquared < bestDistanceSquared) {
      bestSettlement = settlement;
      bestDistanceSquared = distanceSquared;
    }
  }

  return bestSettlement;
}

function dedupeConsecutiveCellsInPlace(cells) {
  if (!cells?.length) {
    return;
  }
  let writeIndex = 1;
  for (let readIndex = 1; readIndex < cells.length; readIndex += 1) {
    if (cells[readIndex] === cells[writeIndex - 1]) {
      continue;
    }
    cells[writeIndex] = cells[readIndex];
    writeIndex += 1;
  }
  cells.length = writeIndex;
}
