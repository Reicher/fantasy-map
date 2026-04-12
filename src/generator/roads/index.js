import { getBiomeRoadTravelCostById } from "../../biomes/index.js";
import { clamp, coordsOf, distance, forEachNeighbor } from "../../utils.js";

const ON_ROAD_COST_FACTOR = 0.66;
const TOUCHING_ROAD_COST_FACTOR = 0.8;
const MAX_ROAD_USAGE = 65535;

const BASE_PARALLEL_PENALTY = 4.2;
const BASE_SETTLEMENT_CLEARANCE_PENALTY = 6.2;
const BASE_INTERSECTION_CLUSTER_PENALTY = 8.2;

const RIVER_COST_THRESHOLD = 0.06;
const RIVER_BASE_PENALTY = 2.6;
const RIVER_STRENGTH_SCALE = 3.2;

const MIN_SIGNPOST_DEGREE = 3;
const DEFAULT_SIGNPOST_CLUSTER_DISTANCE = 1.6;
const MIN_SETTLEMENT_JUNCTION_MERGE_DISTANCE = 4.2;
const MAX_SETTLEMENT_JUNCTION_MERGE_DISTANCE = 9;

export function generateRoads(world) {
  const { terrain, climate, hydrology, settlements, params } = world;
  const { width, height, size, isLand, elevation, mountainField, coastMask } =
    terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength, waterDistance } = hydrology;

  const roadUsage = new Uint16Array(size);
  const roads = [];
  const signpostCells = [];

  if (!settlements?.length) {
    return {
      roads,
      roadUsage,
      componentCount: 0,
      signpostCells,
    };
  }

  if (settlements.length === 1) {
    return {
      roads,
      roadUsage,
      componentCount: 1,
      signpostCells,
    };
  }

  const baseCost = buildBaseCost({
    size,
    isLand,
    lakeIdByCell,
    biome,
    elevation,
    mountainField,
  });

  const nodeSpacing = getRoadNodeSpacing(params);
  const settlementCells = settlements.map((settlement) => settlement.cell);
  const settlementClearanceRadius = clamp(Math.round(nodeSpacing * 0.5), 2, 4);
  const settlementClearanceMask = buildNeighborhoodMask({
    width,
    height,
    size,
    sourceCells: settlementCells,
    radius: settlementClearanceRadius,
  });

  const pairEdges = collectLandPairEdges({
    settlements,
    width,
    height,
    size,
    baseCost,
    riverStrength,
  });

  if (!pairEdges.length) {
    return {
      roads,
      roadUsage,
      componentCount: settlements.length,
      signpostCells,
    };
  }

  const forestEdges = buildMinimumForest(settlements.length, pairEdges);
  const selectedForestEdgeKeys = new Set(
    forestEdges.map((edge) => settlementPairKey(edge.i, edge.j)),
  );
  const degreeBySettlementId = new Uint8Array(settlements.length);

  const roadAdjacency = new Map();
  const roadEdgeSet = new Set();
  const density01 = clamp(Number(params?.settlementDensity ?? 50) / 100, 0, 1);
  const intersectionMask = new Uint8Array(size);

  for (const edge of forestEdges) {
    const inserted = materializeLandRoadEdge({
      edge,
      required: true,
      settlements,
      roads,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      roadUsage,
      roadAdjacency,
      roadEdgeSet,
      settlementClearanceMask,
      intersectionMask,
    });
    if (inserted) {
      degreeBySettlementId[edge.i] = Math.min(255, degreeBySettlementId[edge.i] + 1);
      degreeBySettlementId[edge.j] = Math.min(255, degreeBySettlementId[edge.j] + 1);
      rebuildIntersectionMask({
        width,
        height,
        size,
        roadAdjacency,
        target: intersectionMask,
      });
    }
  }

  const supplementalBudget = clamp(
    Math.round(settlements.length * (0.28 + density01 * 0.76)),
    0,
    settlements.length * 3,
  );
  const supplementalEdges = selectSupplementalEdges({
    pairEdges,
    selectedForestEdgeKeys,
    degreeBySettlementId,
    supplementalBudget,
  });

  for (const edge of supplementalEdges) {
    const inserted = materializeLandRoadEdge({
      edge,
      required: false,
      settlements,
      roads,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      roadUsage,
      roadAdjacency,
      roadEdgeSet,
      settlementClearanceMask,
      intersectionMask,
    });
    if (inserted) {
      degreeBySettlementId[edge.i] = Math.min(255, degreeBySettlementId[edge.i] + 1);
      degreeBySettlementId[edge.j] = Math.min(255, degreeBySettlementId[edge.j] + 1);
      rebuildIntersectionMask({
        width,
        height,
        size,
        roadAdjacency,
        target: intersectionMask,
      });
    }
  }

  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  mergeSettlementsIntoNearbyJunctions({
    settlements,
    roads,
    width,
    params,
    coastMask,
    riverStrength,
    waterDistance,
  });
  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  connectSettlementComponentsByLandRoutes({
    settlements,
    roads,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    params,
  });
  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  const signpostClusterDistance = clamp(
    2.2 + nodeSpacing * 0.26,
    Math.max(DEFAULT_SIGNPOST_CLUSTER_DISTANCE, 2.8),
    5.8,
  );
  const updatedSettlementCells = settlements.map((settlement) => settlement.cell);

  signpostCells.push(
    ...collectSignpostCells({
      roads,
      width,
      settlementCellSet: new Set(updatedSettlementCells),
      clusterDistance: signpostClusterDistance,
    }),
  );

  connectCoastalComponentsBySeaRoutes({
    settlements,
    roads,
    terrain,
  });

  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  return {
    roads,
    roadUsage,
    componentCount: countSettlementComponents(settlements.length, roads),
    signpostCells,
  };
}

function buildBaseCost({
  size,
  isLand,
  lakeIdByCell,
  biome,
  elevation,
  mountainField,
}) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = getBiomeRoadTravelCostById(biome[index]) ?? 1.2;
    const slopePenalty = elevation[index] * 1.15;
    const mountainPenalty =
      mountainField[index] * 4.6 + Math.max(0, mountainField[index] - 0.56) * 7.8;
    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

function collectLandPairEdges({
  settlements,
  width,
  height,
  size,
  baseCost,
  riverStrength,
}) {
  const edges = [];

  for (let i = 0; i < settlements.length; i += 1) {
    const from = settlements[i];
    const distances = runGridDijkstra({
      source: from.cell,
      width,
      height,
      size,
      baseCost,
      riverStrength,
    });

    for (let j = i + 1; j < settlements.length; j += 1) {
      const to = settlements[j];
      const cost = distances[to.cell];
      if (!Number.isFinite(cost)) {
        continue;
      }
      edges.push({
        i,
        j,
        cost,
        distance: distance(from.x, from.y, to.x, to.y),
      });
    }
  }

  return edges;
}

function runGridDijkstra({ source, width, height, size, baseCost, riverStrength }) {
  const distances = new Float64Array(size);
  distances.fill(Number.POSITIVE_INFINITY);
  const heap = new MinHeap();

  if (!Number.isFinite(baseCost[source])) {
    return distances;
  }

  distances[source] = 0;
  heap.push(source, 0);

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    if (priority > distances[current] + 1e-6) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const next = ny * width + nx;
      const stepCost = computeBaseLandStepCost({
        from: current,
        to: next,
        baseCost,
        riverStrength,
      });
      if (!Number.isFinite(stepCost)) {
        return;
      }
      const nextDistance = priority + stepCost;
      if (nextDistance < distances[next]) {
        distances[next] = nextDistance;
        heap.push(next, nextDistance);
      }
    });
  }

  return distances;
}

function buildMinimumForest(nodeCount, edges) {
  const sorted = [...edges].sort((a, b) => a.cost - b.cost);
  const uf = new UnionFind(nodeCount);
  const forest = [];

  for (const edge of sorted) {
    if (!uf.union(edge.i, edge.j)) {
      continue;
    }
    forest.push(edge);
  }

  return forest;
}

function selectSupplementalEdges({
  pairEdges,
  selectedForestEdgeKeys,
  degreeBySettlementId,
  supplementalBudget,
}) {
  if (supplementalBudget <= 0) {
    return [];
  }

  const candidates = pairEdges
    .filter((edge) => !selectedForestEdgeKeys.has(settlementPairKey(edge.i, edge.j)))
    .map((edge) => {
      const degreePenalty =
        (degreeBySettlementId[edge.i] + degreeBySettlementId[edge.j]) * 0.22;
      const longEdgePenalty = edge.distance * 0.19;
      return {
        ...edge,
        score: edge.cost + degreePenalty + longEdgePenalty,
      };
    })
    .sort((a, b) => a.score - b.score);

  return candidates.slice(0, supplementalBudget);
}

function materializeLandRoadEdge({
  edge,
  required,
  settlements,
  roads,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  roadUsage,
  roadAdjacency,
  roadEdgeSet,
  settlementClearanceMask,
  intersectionMask,
}) {
  const fromSettlement = settlements[edge.i];
  const toSettlement = settlements[edge.j];
  if (!fromSettlement || !toSettlement) {
    return false;
  }

  const profiles = required
    ? [
        { strictness: 1.45, allowCrossingsNearNodes: false },
        { strictness: 1.15, allowCrossingsNearNodes: false },
        { strictness: 0.9, allowCrossingsNearNodes: true },
      ]
    : [
        { strictness: 1.55, allowCrossingsNearNodes: false },
        { strictness: 1.25, allowCrossingsNearNodes: false },
      ];

  let selectedPath = null;
  for (const profile of profiles) {
    const path = findPathAStar({
      from: fromSettlement.cell,
      to: toSettlement.cell,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      roadUsage,
      roadEdgeSet,
      settlementClearanceMask,
      intersectionMask,
      profile,
    });
    if (!path || path.length < 2) {
      continue;
    }

    if (
      !validateLandPath({
        path,
        required,
        width,
        roadUsage,
        roadAdjacency,
        fromCell: fromSettlement.cell,
        toCell: toSettlement.cell,
        settlements,
        allowCrossingsNearNodes: profile.allowCrossingsNearNodes,
      })
    ) {
      continue;
    }

    selectedPath = path;
    break;
  }

  if (!selectedPath || selectedPath.length < 2) {
    return false;
  }

  const newEdgeCount = countNewEdges(selectedPath, roadEdgeSet);
  if (newEdgeCount <= 0) {
    return false;
  }

  const inserted = pushRoadRecord(roads, {
    type: "road",
    settlementId: toSettlement.id,
    fromSettlementId: fromSettlement.id,
    cells: selectedPath,
    cost: edge.cost,
  });
  if (!inserted) {
    return false;
  }

  incrementRoadUsage(roadUsage, selectedPath);
  registerRoadCellsToAdjacency(selectedPath, roadAdjacency, roadEdgeSet);
  return true;
}

function findPathAStar({
  from,
  to,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  roadUsage,
  roadEdgeSet,
  settlementClearanceMask,
  intersectionMask,
  profile,
}) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return null;
  }

  const strictness = clamp(Number(profile?.strictness ?? 1), 0.8, 1.8);
  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const open = new MinHeap();
  gScore[from] = 0;
  open.push(from, heuristic(from, to, width));

  while (open.size > 0) {
    const { index: current } = open.pop();
    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const next = ny * width + nx;
      const stepCost = computeAStarLandStepCost({
        from: current,
        to: next,
        target: to,
        width,
        baseCost,
        riverStrength,
        roadUsage,
        roadEdgeSet,
        settlementClearanceMask,
        intersectionMask,
        strictness,
      });
      if (!Number.isFinite(stepCost)) {
        return;
      }

      const tentative = gScore[current] + stepCost;
      if (tentative >= gScore[next] - 1e-9) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      const fScore = tentative + heuristic(next, to, width);
      open.push(next, fScore);
    });
  }

  return null;
}

function computeAStarLandStepCost({
  from,
  to,
  target,
  width,
  baseCost,
  riverStrength,
  roadUsage,
  roadEdgeSet,
  settlementClearanceMask,
  intersectionMask,
  strictness,
}) {
  let cost = computeBaseLandStepCost({
    from,
    to,
    baseCost,
    riverStrength,
  });
  if (!Number.isFinite(cost)) {
    return cost;
  }

  const edgeIsExisting = roadEdgeSet.has(edgeKey(from, to));
  const fromOnRoad = roadUsage[from] > 0;
  const toOnRoad = roadUsage[to] > 0;

  if (edgeIsExisting) {
    cost *= ON_ROAD_COST_FACTOR;
  } else if (fromOnRoad || toOnRoad) {
    cost *= TOUCHING_ROAD_COST_FACTOR;
  }

  if (!toOnRoad && isNearRoadCell(to, roadUsage, width)) {
    cost += BASE_PARALLEL_PENALTY * strictness;
  }

  if (to !== target && settlementClearanceMask[to]) {
    cost += BASE_SETTLEMENT_CLEARANCE_PENALTY * strictness;
  }

  if (to !== target && !toOnRoad && intersectionMask[to]) {
    cost += BASE_INTERSECTION_CLUSTER_PENALTY * strictness;
  }

  return cost;
}

function computeBaseLandStepCost({ from, to, baseCost, riverStrength }) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return Number.POSITIVE_INFINITY;
  }

  let cost = (baseCost[from] + baseCost[to]) * 0.5;
  const river = Math.max(riverStrength[from] ?? 0, riverStrength[to] ?? 0);
  if (river > RIVER_COST_THRESHOLD) {
    cost += RIVER_BASE_PENALTY + clamp(river, 0, 4) * RIVER_STRENGTH_SCALE;
  }

  return cost;
}

function validateLandPath({
  path,
  required,
  width,
  roadUsage,
  roadAdjacency,
  fromCell,
  toCell,
  settlements,
  allowCrossingsNearNodes,
}) {
  if (!path || path.length < 2) {
    return false;
  }

  const parallelExposure = measureParallelExposure(path, roadUsage, width);
  const maxParallelShare = required ? 0.64 : 0.54;
  if (parallelExposure / Math.max(1, path.length) > maxParallelShare) {
    return false;
  }

  const crossingCells = collectCrossingCells(path, roadUsage, fromCell, toCell);
  if (!crossingCells.length) {
    return true;
  }

  const existingIntersections = collectIntersectionCellsFromAdjacency(roadAdjacency);
  const existingIntersectionSet = new Set(existingIntersections);

  for (const cell of crossingCells) {
    if (!allowCrossingsNearNodes) {
      const [cx, cy] = coordsOf(cell, width);
      for (const settlement of settlements) {
        if (!settlement) {
          continue;
        }
        if (settlement.cell === fromCell || settlement.cell === toCell) {
          continue;
        }
        if (distance(cx, cy, settlement.x, settlement.y) < 2.8) {
          return false;
        }
      }
    }

    if (existingIntersectionSet.has(cell)) {
      continue;
    }

    const [cx, cy] = coordsOf(cell, width);
    for (const other of existingIntersections) {
      const [ox, oy] = coordsOf(other, width);
      if (distance(cx, cy, ox, oy) < 3.8) {
        return false;
      }
    }
  }

  return true;
}

function measureParallelExposure(path, roadUsage, width) {
  let exposed = 0;
  for (let index = 1; index < path.length - 1; index += 1) {
    const cell = path[index];
    if (roadUsage[cell] > 0) {
      continue;
    }
    if (isNearRoadCell(cell, roadUsage, width)) {
      exposed += 1;
    }
  }
  return exposed;
}

function collectCrossingCells(path, roadUsage, fromCell, toCell) {
  const crossings = [];
  for (let index = 1; index < path.length - 1; index += 1) {
    const cell = path[index];
    if (cell === fromCell || cell === toCell) {
      continue;
    }
    if (roadUsage[cell] > 0) {
      crossings.push(cell);
    }
  }
  return dedupeConsecutive(crossings);
}

function rebuildIntersectionMask({
  width,
  height,
  size,
  roadAdjacency,
  target,
}) {
  target.fill(0);
  const intersections = collectIntersectionCellsFromAdjacency(roadAdjacency);
  if (!intersections.length) {
    return;
  }
  const mask = buildNeighborhoodMask({
    width,
    height,
    size,
    sourceCells: intersections,
    radius: 3,
  });
  target.set(mask);
}

function mergeSettlementsIntoNearbyJunctions({
  settlements,
  roads,
  width,
  params,
  coastMask,
  riverStrength,
  waterDistance,
}) {
  if (!settlements?.length || !roads?.length || width <= 0) {
    return;
  }

  const landRoads = roads.filter((road) => (road?.type ?? "road") === "road");
  if (!landRoads.length) {
    return;
  }

  const roadAdjacency = buildRoadCellAdjacency(landRoads);
  const intersections = collectIntersectionCellsFromAdjacency(roadAdjacency);
  if (!intersections.length) {
    return;
  }

  const nodeSpacing = getRoadNodeSpacing(params);
  const junctionClusterDistance = clamp(
    1.35 + nodeSpacing * 0.22,
    1.8,
    3.4,
  );
  const mergeDistance = clamp(
    3 + nodeSpacing * 0.5,
    MIN_SETTLEMENT_JUNCTION_MERGE_DISTANCE,
    MAX_SETTLEMENT_JUNCTION_MERGE_DISTANCE,
  );
  const representativeCells = clusterNearbyCells(
    intersections,
    width,
    junctionClusterDistance,
  );
  if (!representativeCells.length) {
    return;
  }

  const occupiedCells = new Set(
    settlements
      .map((settlement) => settlement?.cell)
      .filter((cell) => Number.isFinite(cell)),
  );

  const settlementsByPriority = settlements
    .map((settlement) => ({
      settlement,
      targetCell: findBestSettlementMergeTarget({
        settlement,
        roads,
        candidateIntersectionCells: representativeCells,
        width,
        mergeDistance,
      }),
    }))
    .filter(
      ({ settlement, targetCell }) =>
        settlement &&
        Number.isFinite(targetCell) &&
        targetCell !== settlement.cell &&
        !occupiedCells.has(targetCell),
    )
    .sort((a, b) => {
      const [ax, ay] = coordsOf(a.settlement.cell, width);
      const [atx, aty] = coordsOf(a.targetCell, width);
      const [bx, by] = coordsOf(b.settlement.cell, width);
      const [btx, bty] = coordsOf(b.targetCell, width);
      const da = distance(ax, ay, atx, aty);
      const db = distance(bx, by, btx, bty);
      if (Math.abs(da - db) > 1e-6) {
        return da - db;
      }
      return a.settlement.id - b.settlement.id;
    });

  for (const { settlement, targetCell } of settlementsByPriority) {
    if (!settlement || occupiedCells.has(targetCell) || targetCell === settlement.cell) {
      continue;
    }

    const rewrites = planSettlementEndpointRewrites(roads, settlement.id, targetCell);
    if (!rewrites) {
      continue;
    }

    const hasViableRoad = rewrites.some((rewrite) => rewrite.cells.length >= 2);
    if (!hasViableRoad) {
      continue;
    }

    for (const rewrite of rewrites) {
      rewrite.road.cells = rewrite.cells;
      rewrite.road.length = rewrite.cells.length;
    }

    occupiedCells.delete(settlement.cell);
    occupiedCells.add(targetCell);

    const [x, y] = coordsOf(targetCell, width);
    settlement.cell = targetCell;
    settlement.x = x;
    settlement.y = y;
    if (coastMask?.length) {
      settlement.coastal = coastMask[targetCell] === 1;
    }
    if (riverStrength?.length) {
      settlement.river = (riverStrength[targetCell] ?? 0) > 0.85;
    }
    if (waterDistance?.length) {
      settlement.lake =
        !settlement.coastal &&
        (waterDistance[targetCell] ?? Number.POSITIVE_INFINITY) <= 2 &&
        !settlement.river;
    }
  }
}

function planSettlementEndpointRewrites(roads, settlementId, targetCell) {
  const rewrites = [];
  let keptRoadCount = 0;
  for (const road of roads) {
    if (!road || (road?.type ?? "road") !== "road") {
      continue;
    }

    const isFromEndpoint = road.fromSettlementId === settlementId;
    const isToEndpoint = road.settlementId === settlementId;
    if (!isFromEndpoint && !isToEndpoint) {
      continue;
    }

    const side = isFromEndpoint ? "start" : "end";
    const rewrittenCells = trimRoadEndpointToCell(road.cells, side, targetCell);
    rewrites.push({
      road,
      cells: rewrittenCells ?? [],
    });
    if (rewrittenCells && rewrittenCells.length >= 2) {
      keptRoadCount += 1;
    }
  }

  if (!rewrites.length) {
    return null;
  }

  if (keptRoadCount <= 0) {
    return null;
  }

  return rewrites;
}

function trimRoadEndpointToCell(cells, side, targetCell) {
  if (!Array.isArray(cells) || cells.length < 2 || !Number.isFinite(targetCell)) {
    return null;
  }

  const canonical = dedupeConsecutive(cells);
  if (side === "start") {
    const index = canonical.indexOf(targetCell);
    if (index < 0) {
      return null;
    }
    return dedupeConsecutive(canonical.slice(index));
  }

  if (side === "end") {
    const index = canonical.lastIndexOf(targetCell);
    if (index < 0) {
      return null;
    }
    return dedupeConsecutive(canonical.slice(0, index + 1));
  }

  return null;
}

function clusterNearbyCells(cells, width, maxDistance) {
  const uniqueCells = [...new Set(cells)].sort((a, b) => a - b);
  if (uniqueCells.length <= 1 || maxDistance <= 0 || width <= 0) {
    return uniqueCells;
  }

  const maxDistanceSq = maxDistance * maxDistance;
  const clusters = [];
  const cellCoords = new Map();

  for (const cell of uniqueCells) {
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

  const representativeCells = [];
  for (const cluster of clusters) {
    let representativeCell = cluster.cells[0];
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const cell of cluster.cells) {
      const point = cellCoords.get(cell);
      const dx = point.x - cluster.centerX;
      const dy = point.y - cluster.centerY;
      const distanceSq = dx * dx + dy * dy;
      if (
        distanceSq < bestDistanceSq ||
        (Math.abs(distanceSq - bestDistanceSq) < 1e-9 && cell < representativeCell)
      ) {
        representativeCell = cell;
        bestDistanceSq = distanceSq;
      }
    }
    representativeCells.push(representativeCell);
  }

  return representativeCells.sort((a, b) => a - b);
}

function findBestSettlementMergeTarget({
  settlement,
  roads,
  candidateIntersectionCells,
  width,
  mergeDistance,
}) {
  if (
    !settlement ||
    !roads?.length ||
    !candidateIntersectionCells?.length ||
    width <= 0 ||
    mergeDistance <= 0
  ) {
    return null;
  }

  const incidentRoads = roads.filter(
    (road) =>
      (road?.type ?? "road") === "road" &&
      (road.fromSettlementId === settlement.id || road.settlementId === settlement.id),
  );
  if (!incidentRoads.length) {
    return null;
  }

  const candidateSet = new Set(candidateIntersectionCells);
  const occurrences = new Map();

  for (const road of incidentRoads) {
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      return null;
    }

    const side = road.fromSettlementId === settlement.id ? "start" : "end";
    const seenOnRoad = new Set();
    if (side === "start") {
      for (let index = 1; index < cells.length - 1; index += 1) {
        const cell = cells[index];
        if (!candidateSet.has(cell) || seenOnRoad.has(cell)) {
          continue;
        }
        seenOnRoad.add(cell);
      }
    } else {
      for (let index = cells.length - 2; index >= 1; index -= 1) {
        const cell = cells[index];
        if (!candidateSet.has(cell) || seenOnRoad.has(cell)) {
          continue;
        }
        seenOnRoad.add(cell);
      }
    }

    for (const cell of seenOnRoad) {
      occurrences.set(cell, (occurrences.get(cell) ?? 0) + 1);
    }
  }

  if (!occurrences.size) {
    return null;
  }

  const [sx, sy] = coordsOf(settlement.cell, width);
  const maxDistanceSq = mergeDistance * mergeDistance;
  let bestCell = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestCount = 0;

  for (const [cell, count] of occurrences.entries()) {
    const [cx, cy] = coordsOf(cell, width);
    const dx = sx - cx;
    const dy = sy - cy;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxDistanceSq) {
      continue;
    }
    if (
      bestCell == null ||
      count > bestCount ||
      (count === bestCount && distanceSq < bestDistanceSq)
    ) {
      bestCell = cell;
      bestDistanceSq = distanceSq;
      bestCount = count;
    }
  }

  return bestCell;
}

function collectSignpostCells({ roads, width, settlementCellSet, clusterDistance }) {
  const landRoads = roads.filter((road) => (road?.type ?? "road") === "road");
  if (!landRoads.length) {
    return [];
  }

  const adjacency = buildRoadCellAdjacency(landRoads);
  const candidates = [];
  for (const [cell, neighbors] of adjacency.entries()) {
    if (neighbors.size < MIN_SIGNPOST_DEGREE || settlementCellSet.has(cell)) {
      continue;
    }
    candidates.push({
      cell,
      degree: neighbors.size,
    });
  }

  candidates.sort((a, b) => {
    if (b.degree !== a.degree) {
      return b.degree - a.degree;
    }
    return a.cell - b.cell;
  });

  const selected = [];
  for (const candidate of candidates) {
    const [cx, cy] = coordsOf(candidate.cell, width);
    if (
      selected.some((otherCell) => {
        const [ox, oy] = coordsOf(otherCell, width);
        return (
          distance(cx, cy, ox, oy) <
          (clusterDistance ?? DEFAULT_SIGNPOST_CLUSTER_DISTANCE)
        );
      })
    ) {
      continue;
    }
    selected.push(candidate.cell);
  }

  return selected.sort((a, b) => a - b);
}

function connectSettlementComponentsByLandRoutes({
  settlements,
  roads,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  params,
}) {
  if (!settlements?.length || settlements.length < 2) {
    return;
  }

  const pairEdges = collectLandPairEdges({
    settlements,
    width,
    height,
    size,
    baseCost,
    riverStrength,
  });
  if (!pairEdges.length) {
    return;
  }

  const sortedEdges = [...pairEdges].sort((a, b) => {
    if (Math.abs(a.cost - b.cost) > 1e-6) {
      return a.cost - b.cost;
    }
    return a.distance - b.distance;
  });

  const uf = new UnionFind(settlements.length);
  for (const road of roads) {
    if (road.fromSettlementId == null || road.settlementId == null) {
      continue;
    }
    uf.union(road.fromSettlementId, road.settlementId);
  }
  if (countDistinctRoots(uf, settlements.length) <= 1) {
    return;
  }

  const roadUsage = new Uint16Array(size);
  rebuildLandRoadUsage(roadUsage, roads);

  const nodeSpacing = getRoadNodeSpacing(params);
  const settlementCells = settlements.map((settlement) => settlement.cell);
  const settlementClearanceMask = buildNeighborhoodMask({
    width,
    height,
    size,
    sourceCells: settlementCells,
    radius: clamp(Math.round(nodeSpacing * 0.5), 2, 4),
  });

  const landRoads = roads.filter((road) => (road?.type ?? "road") === "road");
  const roadAdjacency = buildRoadCellAdjacency(landRoads);
  const roadEdgeSet = buildRoadEdgeSet(landRoads);
  const intersectionMask = new Uint8Array(size);
  rebuildIntersectionMask({
    width,
    height,
    size,
    roadAdjacency,
    target: intersectionMask,
  });

  const maxPasses = 3;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (countDistinctRoots(uf, settlements.length) <= 1) {
      return;
    }

    let insertedAny = false;
    for (const edge of sortedEdges) {
      if (uf.find(edge.i) === uf.find(edge.j)) {
        continue;
      }

      const inserted = materializeLandRoadEdge({
        edge,
        required: true,
        settlements,
        roads,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        roadUsage,
        roadAdjacency,
        roadEdgeSet,
        settlementClearanceMask,
        intersectionMask,
      });
      if (!inserted) {
        continue;
      }

      uf.union(edge.i, edge.j);
      insertedAny = true;
      rebuildIntersectionMask({
        width,
        height,
        size,
        roadAdjacency,
        target: intersectionMask,
      });
    }

    if (!insertedAny) {
      return;
    }
  }
}

function connectCoastalComponentsBySeaRoutes({ settlements, roads, terrain }) {
  if (!settlements.length) {
    return;
  }

  const uf = new UnionFind(settlements.length);
  for (const road of roads) {
    if (
      (road?.type ?? "road") !== "road" &&
      (road?.type ?? "road") !== "sea-route"
    ) {
      continue;
    }
    if (road.fromSettlementId == null || road.settlementId == null) {
      continue;
    }
    uf.union(road.fromSettlementId, road.settlementId);
  }

  const blockedPairs = new Set();
  while (countDistinctRoots(uf, settlements.length) > 1) {
    const best = findNearestCoastalComponentPair(settlements, uf, blockedPairs);
    if (!best) {
      break;
    }

    const from = settlements[best.i];
    const to = settlements[best.j];
    const routeCells = findSeaRoutePath(terrain, from.cell, to.cell);
    if (!routeCells || routeCells.length < 2) {
      blockedPairs.add(settlementPairKey(best.i, best.j));
      continue;
    }

    const inserted = pushRoadRecord(roads, {
      type: "sea-route",
      settlementId: to.id,
      fromSettlementId: from.id,
      cells: routeCells,
      cost: best.distance,
    });
    if (!inserted) {
      blockedPairs.add(settlementPairKey(best.i, best.j));
      continue;
    }

    uf.union(best.i, best.j);
  }
}

function findNearestCoastalComponentPair(settlements, uf, blockedPairs) {
  let best = null;

  for (let i = 0; i < settlements.length; i += 1) {
    const from = settlements[i];
    if (!from) {
      continue;
    }
    for (let j = i + 1; j < settlements.length; j += 1) {
      const to = settlements[j];
      if (!to) {
        continue;
      }
      if (uf.find(i) === uf.find(j)) {
        continue;
      }
      const key = settlementPairKey(i, j);
      if (blockedPairs.has(key)) {
        continue;
      }
      const pairDistance = distance(from.x, from.y, to.x, to.y);
      const suitabilityPenalty =
        maritimeEndpointPenalty(from) + maritimeEndpointPenalty(to);
      const score = pairDistance + suitabilityPenalty * 12;
      if (!best || score < best.score) {
        best = {
          i,
          j,
          distance: pairDistance,
          score,
        };
      }
    }
  }

  return best;
}

function maritimeEndpointPenalty(settlement) {
  if (!settlement) {
    return 3.2;
  }
  if (settlement.coastal) {
    return 0;
  }
  if (settlement.lake) {
    return 0.8;
  }
  if (settlement.river) {
    return 1.2;
  }
  return 2.6;
}

function findSeaRoutePath(terrain, from, to) {
  const { width, height, size, isLand } = terrain;

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const open = new MinHeap();
  gScore[from] = 0;
  open.push(from, heuristic(from, to, width));

  while (open.size > 0) {
    const { index: current } = open.pop();
    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const next = ny * width + nx;
      // Prefer water strongly, but allow expensive land stretches as fallback
      // so disconnected components can still be connected.
      const stepCost = 1 + (isLand[next] ? 26 : 0);
      const tentative = gScore[current] + stepCost;
      if (tentative >= gScore[next] - 1e-9) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      open.push(next, tentative + heuristic(next, to, width));
    });
  }

  return null;
}

function buildNeighborhoodMask({
  width,
  height,
  size,
  sourceCells,
  radius,
}) {
  const mask = new Uint8Array(size);
  if (!sourceCells?.length || radius <= 0) {
    return mask;
  }

  const radiusSq = radius * radius;
  for (const source of sourceCells) {
    const [sx, sy] = coordsOf(source, width);
    for (let y = Math.max(0, sy - radius); y <= Math.min(height - 1, sy + radius); y += 1) {
      for (let x = Math.max(0, sx - radius); x <= Math.min(width - 1, sx + radius); x += 1) {
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy > radiusSq) {
          continue;
        }
        mask[y * width + x] = 1;
      }
    }
  }

  return mask;
}

function registerRoadCellsToAdjacency(cells, adjacency, roadEdgeSet) {
  const connect = (a, b) => {
    let neighbors = adjacency.get(a);
    if (!neighbors) {
      neighbors = new Set();
      adjacency.set(a, neighbors);
    }
    neighbors.add(b);
  };

  for (let index = 1; index < cells.length; index += 1) {
    const from = cells[index - 1];
    const to = cells[index];
    if (from === to) {
      continue;
    }
    roadEdgeSet.add(edgeKey(from, to));
    connect(from, to);
    connect(to, from);
  }
}

function buildRoadCellAdjacency(roads) {
  const adjacency = new Map();
  const edgeSet = new Set();
  for (const road of roads) {
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      continue;
    }
    registerRoadCellsToAdjacency(cells, adjacency, edgeSet);
  }

  return adjacency;
}

function buildRoadEdgeSet(roads) {
  const edgeSet = new Set();
  for (const road of roads) {
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      continue;
    }
    for (let index = 1; index < cells.length; index += 1) {
      const from = cells[index - 1];
      const to = cells[index];
      if (from === to) {
        continue;
      }
      edgeSet.add(edgeKey(from, to));
    }
  }
  return edgeSet;
}

function collectIntersectionCellsFromAdjacency(adjacency) {
  const intersections = [];
  for (const [cell, neighbors] of adjacency.entries()) {
    if ((neighbors?.size ?? 0) >= MIN_SIGNPOST_DEGREE) {
      intersections.push(cell);
    }
  }
  return intersections.sort((a, b) => a - b);
}

function heuristic(cell, goal, width) {
  const [x0, y0] = coordsOf(cell, width);
  const [x1, y1] = coordsOf(goal, width);
  return Math.hypot(x1 - x0, y1 - y0) * 0.86;
}

function reconstructPath(cameFrom, end) {
  const path = [end];
  let current = end;

  while (cameFrom[current] >= 0) {
    current = cameFrom[current];
    if (path[path.length - 1] !== current) {
      path.push(current);
    }
  }

  path.reverse();
  return path;
}

function countNewEdges(cells, roadEdgeSet) {
  let count = 0;
  for (let index = 1; index < cells.length; index += 1) {
    if (!roadEdgeSet.has(edgeKey(cells[index - 1], cells[index]))) {
      count += 1;
    }
  }
  return count;
}

function pushRoadRecord(roads, { type = "road", settlementId, fromSettlementId, cells, cost }) {
  const canonicalCells = dedupeConsecutive(cells);
  if (!canonicalCells || canonicalCells.length < 2) {
    return false;
  }

  roads.push({
    id: roads.length,
    type,
    settlementId,
    fromSettlementId,
    cells: canonicalCells,
    length: canonicalCells.length,
    cost,
  });
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
  let write = 0;
  for (const road of roads) {
    if (!road || !Array.isArray(road.cells) || road.cells.length < 2) {
      continue;
    }
    road.id = write;
    road.length = road.cells.length;
    roads[write] = road;
    write += 1;
  }
  roads.length = write;
}

function dedupeConsecutive(cells) {
  if (!cells?.length) {
    return [];
  }
  const deduped = [cells[0]];
  for (let i = 1; i < cells.length; i += 1) {
    if (cells[i] !== deduped[deduped.length - 1]) {
      deduped.push(cells[i]);
    }
  }
  return deduped;
}

function settlementPairKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function isNearRoadCell(cell, roadUsage, width = 0) {
  const inferredWidth = width > 0 ? width : undefined;
  if (!inferredWidth) {
    // Fallback for callers without width; strict false avoids accidental penalties.
    return false;
  }
  const x = cell % inferredWidth;
  const y = Math.floor(cell / inferredWidth);
  const height = Math.ceil(roadUsage.length / inferredWidth);

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= inferredWidth || ny >= height) {
        continue;
      }
      if (roadUsage[ny * inferredWidth + nx] > 0) {
        return true;
      }
    }
  }

  return false;
}

function getRoadNodeSpacing(params) {
  return clamp(Number(params?.nodeMinDistance ?? 5), 2, 14);
}

function countSettlementComponents(settlementCount, roads) {
  if (settlementCount <= 0) {
    return 0;
  }

  const uf = new UnionFind(settlementCount);
  for (const road of roads) {
    if (road.fromSettlementId == null || road.settlementId == null) {
      continue;
    }
    uf.union(road.fromSettlementId, road.settlementId);
  }

  return countDistinctRoots(uf, settlementCount);
}

function countDistinctRoots(uf, count) {
  const roots = new Set();
  for (let i = 0; i < count; i += 1) {
    roots.add(uf.find(i));
  }
  return roots.size;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = new Uint8Array(size);
  }

  find(x) {
    let node = x;
    while (this.parent[node] !== node) {
      this.parent[node] = this.parent[this.parent[node]];
      node = this.parent[node];
    }
    return node;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }

    return true;
  }
}

class MinHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  push(index, priority) {
    const node = { index, priority };
    this.values.push(node);
    this.bubbleUp(this.values.length - 1);
  }

  pop() {
    if (this.values.length === 0) {
      return null;
    }
    const top = this.values[0];
    const end = this.values.pop();
    if (this.values.length > 0 && end) {
      this.values[0] = end;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    let i = index;
    while (i > 0) {
      const parentIndex = Math.floor((i - 1) / 2);
      if (this.values[parentIndex].priority <= this.values[i].priority) {
        break;
      }
      [this.values[parentIndex], this.values[i]] = [
        this.values[i],
        this.values[parentIndex],
      ];
      i = parentIndex;
    }
  }

  sinkDown(index) {
    let i = index;
    const length = this.values.length;

    while (true) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;

      if (
        left < length &&
        this.values[left].priority < this.values[smallest].priority
      ) {
        smallest = left;
      }
      if (
        right < length &&
        this.values[right].priority < this.values[smallest].priority
      ) {
        smallest = right;
      }

      if (smallest === i) {
        break;
      }

      [this.values[i], this.values[smallest]] = [
        this.values[smallest],
        this.values[i],
      ];
      i = smallest;
    }
  }
}
