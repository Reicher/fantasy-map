import { BIOME_KEYS } from "../config.js";
import { buildRoadNetwork } from "./network.js?v=20260401i";
import {
  clamp,
  coordsOf,
  distance,
  forEachNeighbor,
  indexOf,
} from "../utils.js";

// ---------------------------------------------------------------------------
// Terrain travel cost per biome.
// Easy terrain (plains) is cheap; difficult terrain (mountains, jungle) is
// expensive. Ocean and lakes are impassable for land roads.
// ---------------------------------------------------------------------------

const BIOME_TRAVEL_COST = {
  [BIOME_KEYS.OCEAN]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.LAKE]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.PLAINS]: 0.9,
  [BIOME_KEYS.FOREST]: 1.45,
  [BIOME_KEYS.RAINFOREST]: 1.8,
  [BIOME_KEYS.DESERT]: 1.28,
  [BIOME_KEYS.TUNDRA]: 1.52,
  [BIOME_KEYS.HIGHLANDS]: 2.25,
  [BIOME_KEYS.MOUNTAIN]: 4.8,
};

// When both adjacent cells already carry a road, applying this multiplier
// makes later roads prefer to follow existing paths — producing natural T/+
// intersections instead of parallel corridors.
// Values close to 1.0 mean little discount; the pathfinder will only merge
// onto existing roads when the terrain genuinely makes them the shortest route.
// Values close to 0 mean nearly-free travel on roads; the pathfinder will go
// far out of its way to ride an existing road, producing parallel doubles.
const ON_ROAD_COST_FACTOR = 0.54;
const TOUCHING_ROAD_COST_FACTOR = 0.74;

// Penalty applied when a destination cell is NOT on a road but directly
// neighbours one.  This discourages new roads from running alongside an
// existing road, pushing them to either merge onto it (ON_ROAD_COST_FACTOR
// takes over) or detour far enough that the eventual junction forms a clean
// T/+ shape rather than a narrow fork.
const PARALLEL_ROAD_PENALTY = 2.8;

// Penalty applied to cells within SETTLEMENT_APPROACH_RADIUS of a settlement that
// already has at least one road connection.  Prevents new roads from
// sneaking up alongside an existing connection and forming a narrow Y fork.
// The settlement cell itself carries no penalty (roads must be able to reach it).
const SETTLEMENT_APPROACH_RADIUS = 5;
const SETTLEMENT_APPROACH_PEAK_PENALTY = 6.0;

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
      const placedRoad = materializeRoad({
        roads,
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
      if (!placedRoad) {
        continue;
      }

      // Stamp a proximity penalty around each connected settlement so future roads
      // approach from a different angle rather than forking close to the node.
      stampSettlementProximity(
        placedRoad.fromSettlement,
        settlementProximityPenalty,
        width,
        height,
      );
      stampSettlementProximity(
        placedRoad.toSettlement,
        settlementProximityPenalty,
        width,
        height,
      );
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
    });
  }

  // =========================================================================
  // Phase 3 — Sea routes
  //
  // Connect isolated landmasses with the minimum number of sea links.
  // Each link joins the nearest meaningful coastal settlements of two
  // separate network components.
  // =========================================================================
  const seaRoutes = buildSeaRoutes({
    settlements,
    roads,
    terrain,
    climate,
    landComponentByCell,
  });
  roads.push(...seaRoutes);

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

    const biomeCost = BIOME_TRAVEL_COST[biome[index]] ?? 1.2;
    const slopePenalty = elevation[index] * 0.8;
    const mountainPenalty =
      mountainField[index] * 2.9 +
      Math.max(0, mountainField[index] - 0.68) * 4.2;
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

  return reconstructPath(to, prev);
}

// ---------------------------------------------------------------------------
// Per-step traversal cost (used by both Dijkstra and findPath)
// ---------------------------------------------------------------------------

// Returns true when any of `cell`'s 8 neighbours carries a road.
// Used to detect when a path would run parallel/adjacent to an existing road.
function hasRoadNeighbour(cell, roadUsage, width, height) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (roadUsage[ny * width + nx] > 0) {
        return true;
      }
    }
  }
  return false;
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
      if (width > 0 && hasRoadNeighbour(to, roadUsage, width, height)) {
        cost += PARALLEL_ROAD_PENALTY;
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
}) {
  // Detour ratio threshold: only add an edge when the current network path
  // is this many times longer than the direct travel cost.
  // At low loopiness the threshold is high (very few extras).
  // At high loopiness the threshold is lower (more extras added).
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
    if (!isMaterializedRoad(road)) {
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
    const placedRoad = materializeRoad({
      roads,
      roadUsage,
      settlementByCell,
      fromSettlement: settlementA,
      toSettlement: settlementB,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      settlementProximityPenalty,
      cost: directCost,
    });
    if (!placedRoad) {
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
// Sea routes — connect isolated landmasses with minimal sea links
// ---------------------------------------------------------------------------

function buildSeaRoutes({
  settlements,
  roads,
  terrain,
  climate,
  landComponentByCell,
}) {
  const { width, height, isLand } = terrain;
  const { biome } = climate;
  const harborBySettlementId = buildHarborMap(settlements, width, height, isLand, biome);
  const seaRoutes = [];

  for (
    let iteration = 0;
    iteration < Math.max(0, settlements.length * 2);
    iteration += 1
  ) {
    const network = buildRoadNetwork({
      settlements,
      roads: [...roads, ...seaRoutes],
      width,
    });

    const activeComponents = network.components.filter(
      (comp) => comp.settlementIds.length > 0,
    );
    if (activeComponents.length <= 1) {
      break;
    }

    const best = findBestSeaRoute({
      components: activeComponents,
      settlements,
      harborBySettlementId,
      landComponentByCell,
      width,
      height,
      isLand,
      biome,
    });
    if (!best) {
      break;
    }

    const cells = dedupePath([
      best.fromSettlement.cell,
      ...best.waterPath,
      best.toSettlement.cell,
    ]);
    if (cells.length < 2) {
      break;
    }

    seaRoutes.push({
      id: roads.length + seaRoutes.length,
      type: "sea-route",
      settlementId: best.toSettlement.id,
      fromSettlementId: best.fromSettlement.id,
      cells,
      length: cells.length,
      cost: best.waterPath.length,
    });
  }

  return seaRoutes;
}

function findBestSeaRoute({
  components,
  settlements,
  harborBySettlementId,
  landComponentByCell,
  width,
  height,
  isLand,
  biome,
}) {
  let best = null;

  for (let aIndex = 0; aIndex < components.length; aIndex += 1) {
    const portSettlementsA = getPortSettlements(
      components[aIndex],
      settlements,
      harborBySettlementId,
    );
    if (portSettlementsA.length === 0) {
      continue;
    }

    for (let bIndex = aIndex + 1; bIndex < components.length; bIndex += 1) {
      const portSettlementsB = getPortSettlements(
        components[bIndex],
        settlements,
        harborBySettlementId,
      );
      if (portSettlementsB.length === 0) {
        continue;
      }

      for (const fromSettlement of portSettlementsA) {
        const sourceHarbor = harborBySettlementId.get(fromSettlement.id);
        if (sourceHarbor == null) {
          continue;
        }

        for (const toSettlement of portSettlementsB) {
          const targetHarbor = harborBySettlementId.get(toSettlement.id);
          if (targetHarbor == null) {
            continue;
          }

          // Skip pairs that share a land component — they can meet overland.
          if (
            landComponentByCell[fromSettlement.cell] ===
            landComponentByCell[toSettlement.cell]
          ) {
            continue;
          }

          const settlementDist = distance(fromSettlement.x, fromSettlement.y, toSettlement.x, toSettlement.y);
          if (settlementDist > 220) {
            continue;
          }

          const waterPath =
            buildDirectSeaLane(
              sourceHarbor,
              targetHarbor,
              width,
              height,
              isLand,
              biome,
            ) ||
            buildSeaLane(
              sourceHarbor,
              targetHarbor,
              width,
              height,
              isLand,
              biome,
            );
          if (!waterPath) {
            continue;
          }

          const score =
            waterPath.length - (fromSettlement.score + toSettlement.score) * 0.04;
          if (!best || score < best.score) {
            best = { fromSettlement, toSettlement, waterPath, score };
          }
        }
      }
    }
  }

  return best;
}

function getPortSettlements(component, settlements, harborBySettlementId) {
  const candidates = component.settlementIds
    .map((id) => settlements[id])
    .filter((settlement) => settlement != null);
  const coastal = candidates.filter(
    (settlement) => settlement.coastal && harborBySettlementId.has(settlement.id),
  );
  if (coastal.length > 0) {
    return coastal;
  }
  return candidates.filter((settlement) =>
    harborBySettlementId.has(settlement.id),
  );
}

function buildHarborMap(settlements, width, height, isLand, biome) {
  const harborBySettlementId = new Map();
  for (const settlement of settlements) {
    const harbor = findNearestOceanCell(
      settlement.cell,
      width,
      height,
      isLand,
      biome,
      settlement.coastal ? 4 : 8,
    );
    if (harbor != null) {
      harborBySettlementId.set(settlement.id, harbor);
    }
  }
  return harborBySettlementId;
}

function findNearestOceanCell(
  startCell,
  width,
  height,
  isLand,
  biome,
  maxRadius,
) {
  const [startX, startY] = coordsOf(startCell, width);
  let best = null;

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (
      let y = Math.max(0, startY - radius);
      y <= Math.min(height - 1, startY + radius);
      y += 1
    ) {
      for (
        let x = Math.max(0, startX - radius);
        x <= Math.min(width - 1, startX + radius);
        x += 1
      ) {
        const cell = indexOf(x, y, width);
        if (isLand[cell] || biome[cell] !== BIOME_KEYS.OCEAN) {
          continue;
        }
        const d = distance(startX, startY, x, y);
        if (!best || d < best.dist) {
          best = { cell, dist: d };
        }
      }
    }
    if (best) {
      return best.cell;
    }
  }

  return null;
}

function buildDirectSeaLane(startCell, endCell, width, height, isLand, biome) {
  const [startX, startY] = coordsOf(startCell, width);
  const [endX, endY] = coordsOf(endCell, width);
  const cells = [];
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));

  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = clamp(Math.round(startX + (endX - startX) * t), 0, width - 1);
    const y = clamp(Math.round(startY + (endY - startY) * t), 0, height - 1);
    const cell = indexOf(x, y, width);
    if (cells[cells.length - 1] !== cell) {
      if (isLand[cell] || biome[cell] !== BIOME_KEYS.OCEAN) {
        return null;
      }
      cells.push(cell);
    }
  }

  return cells.length >= 2 ? cells : null;
}

function buildSeaLane(startCell, endCell, width, height, isLand, biome) {
  const visited = new Uint8Array(isLand.length);
  const previous = new Int32Array(isLand.length);
  previous.fill(-1);
  const queue = [startCell];
  let head = 0;
  visited[startCell] = 1;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;

    if (current === endCell) {
      return reconstructPath(endCell, previous).reverse();
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (
        visited[neighbor] ||
        isLand[neighbor] ||
        biome[neighbor] !== BIOME_KEYS.OCEAN
      ) {
        return;
      }
      visited[neighbor] = 1;
      previous[neighbor] = current;
      queue.push(neighbor);
    });
  }

  return null;
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

// `path` comes from reconstructPath() as [toSettlement, ..., fromSettlement].
// If it passes through an intermediate settlement, keep only the leading
// segment up to that settlement and skip the already-connected tail.
function trimPathAtFirstAnchor(path, settlementByCell) {
  for (let i = 1; i <= path.length - 2; i += 1) {
    const settlement = settlementByCell.get(path[i]);
    if (settlement != null) {
      return { path: path.slice(0, i + 1), anchorSettlement: settlement };
    }
  }
  return { path, anchorSettlement: null };
}

function reconstructPath(end, prev) {
  const path = [end];
  let current = end;
  while (prev[current] >= 0) {
    current = prev[current];
    if (path[path.length - 1] !== current) {
      path.push(current);
    }
  }
  return path;
}

function dedupePath(path) {
  const result = [];
  for (const cell of path) {
    if (result[result.length - 1] !== cell) {
      result.push(cell);
    }
  }
  return result;
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
}

function isMaterializedRoad(road) {
  return (
    road?.type === "road" &&
    road.settlementId != null &&
    road.fromSettlementId != null
  );
}

function pushRoadRecord(
  roads,
  { settlementId, fromSettlementId, cells, cost, type = "road" },
) {
  roads.push({
    id: roads.length,
    type,
    settlementId,
    fromSettlementId,
    cells,
    length: cells.length,
    cost,
  });
}

function incrementRoadUsage(roadUsage, cells) {
  for (const cell of cells) {
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, MAX_ROAD_USAGE);
  }
}

function materializeRoad({
  roads,
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
  cost,
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

  const { path: trimmed, anchorSettlement } = trimPathAtFirstAnchor(
    rawPath,
    settlementByCell,
  );
  if (trimmed.length < 2) {
    return null;
  }

  const actualFromSettlement = anchorSettlement ?? fromSettlement;
  pushRoadRecord(roads, {
    settlementId: toSettlement.id,
    fromSettlementId: actualFromSettlement.id,
    cells: trimmed,
    cost,
  });
  incrementRoadUsage(roadUsage, trimmed);
  return { fromSettlement: actualFromSettlement, toSettlement };
}

// ---------------------------------------------------------------------------
// Min-heap priority queue
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(index, priority) {
    this.items.push({ index, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) {
        break;
      }
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  bubbleDown(i) {
    const n = this.items.length;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      if (
        left < n &&
        this.items[left].priority < this.items[smallest].priority
      ) {
        smallest = left;
      }
      if (
        right < n &&
        this.items[right].priority < this.items[smallest].priority
      ) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      [this.items[i], this.items[smallest]] = [
        this.items[smallest],
        this.items[i],
      ];
      i = smallest;
    }
  }
}
