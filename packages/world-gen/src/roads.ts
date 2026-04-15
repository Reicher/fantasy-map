import { getBiomeRoadTravelCostById } from "@fardvag/shared/biomes";
import { createRng } from "@fardvag/shared/random";
import {
  clamp,
  coordsOf,
  distance,
  forEachNeighbor,
} from "@fardvag/shared/utils";

const MAX_ROAD_USAGE = 65535;

const RIVER_COST_THRESHOLD = 0.06;
const RIVER_BASE_PENALTY = 2.6;
const RIVER_STRENGTH_SCALE = 3.2;

const MOUNTAIN_ROAD_PENALTY_LINEAR = 8.2;
const MOUNTAIN_ROAD_PENALTY_RIDGE_START = 0.32;
const MOUNTAIN_ROAD_PENALTY_RIDGE_SCALE = 16.4;
const MOUNTAIN_ROAD_PENALTY_CORE_START = 0.58;
const MOUNTAIN_ROAD_PENALTY_CORE_SCALE = 28.6;

const ON_ROAD_COST_FACTOR = 0.7;
const TOUCHING_ROAD_COST_FACTOR = 0.86;
const PARALLEL_ROAD_PENALTY = 2.4;
const SETTLEMENT_CLEARANCE_PENALTY = 4.8;

const MIN_SIGNPOST_DEGREE = 3;
const DEFAULT_SIGNPOST_CLUSTER_DISTANCE = 1.6;

interface SettlementPairEdge {
  i: number;
  j: number;
  cost: number;
  distance: number;
}

interface SelectedGraphEdges {
  backboneEdges: SettlementPairEdge[];
  loopEdges: SettlementPairEdge[];
}

export function generateRoads(world) {
  const { terrain, climate, hydrology, settlements, params } = world;
  const { width, height, size, isLand, elevation, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength } = hydrology;

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

  const rng = createRng(`${String(params?.seed ?? "seed")}::roads`);
  const density01 = clamp(Number(params?.settlementDensity ?? 50) / 100, 0, 1);
  const isolation01 = clamp(Number(params?.fragmentation ?? 52) / 100, 0, 1);
  const nodeSpacing = getRoadNodeSpacing(params);

  const baseCost = buildBaseCost({
    size,
    isLand,
    lakeIdByCell,
    biome,
    elevation,
    mountainField,
  });

  const settlementClearanceMask = buildNeighborhoodMask({
    width,
    height,
    size,
    sourceCells: settlements.map((settlement) => settlement.cell),
    radius: clamp(Math.round(nodeSpacing * 0.45), 2, 4),
  });

  const landCandidates = buildLandCandidateEdges({
    settlements,
    width,
    size,
    baseCost,
    riverStrength,
    nodeSpacing,
    density01,
  });

  const landSelection = selectGraphEdges({
    nodeCount: settlements.length,
    edges: landCandidates,
    targetComponents: resolveTargetComponentCount(
      settlements.length,
      isolation01,
      density01,
    ),
    loopBudget: resolveLoopBudget({
      edgeCount: landCandidates.length,
      nodeCount: settlements.length,
      density01,
      multiplier: 0.6,
      hardCap: Math.max(8, Math.floor(settlements.length * 0.9)),
    }),
    loopDetourThreshold: 1.16 + (1 - density01) * 0.1,
    loopProbability: 0.42 + density01 * 0.26,
    rng,
  });

  materializeLandEdges({
    selected: landSelection,
    settlements,
    roads,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    settlementClearanceMask,
    roadUsage,
  });

  ensureAtLeastOneLandRoad({
    settlements,
    roads,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    settlementClearanceMask,
    roadUsage,
    landCandidates,
  });

  const seaCandidates = buildSeaCandidateEdges({
    settlements,
    density01,
  });
  const maritimeNodeIds = collectMaritimeNodeIds(settlements);

  if (seaCandidates.length > 0 && maritimeNodeIds.length >= 2) {
    const seaSelection = selectGraphEdges({
      nodeCount: settlements.length,
      edges: seaCandidates,
      activeNodeIds: maritimeNodeIds,
      targetComponents: resolveTargetComponentCount(
        maritimeNodeIds.length,
        isolation01 * 0.52,
        density01,
      ),
      loopBudget: resolveLoopBudget({
        edgeCount: seaCandidates.length,
        nodeCount: maritimeNodeIds.length,
        density01,
        multiplier: 0.14,
        hardCap: 4,
      }),
      loopDetourThreshold: 1.14 + (1 - density01) * 0.08,
      loopProbability: 0.18 + density01 * 0.12,
      rng: rng.fork("sea"),
    });

    materializeSeaEdges({
      selected: seaSelection,
      settlements,
      roads,
      terrain,
    });
  }

  ensureNoIsolatedSettlements({
    settlements,
    roads,
    terrain,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    settlementClearanceMask,
    roadUsage,
  });

  ensureConnectedSettlementNetwork({
    settlements,
    roads,
    terrain,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    settlementClearanceMask,
    roadUsage,
  });

  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  signpostCells.push(
    ...collectSignpostCells({
      roads,
      width,
      settlementCellSet: new Set(
        settlements
          .map((settlement) => settlement?.cell)
          .filter((cell) => Number.isInteger(cell)),
      ),
      clusterDistance: clamp(
        2.1 + nodeSpacing * 0.24,
        Math.max(DEFAULT_SIGNPOST_CLUSTER_DISTANCE, 2.6),
        5.6,
      ),
    }),
  );

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
    if (!isLand[index] || (lakeIdByCell?.[index] ?? -1) >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const mountain = Number(mountainField?.[index] ?? 0);
    const biomeCost = getBiomeRoadTravelCostById(Number(biome?.[index] ?? 0)) ?? 1.2;
    const slopePenalty = Number(elevation?.[index] ?? 0) * 1.15;
    const mountainPenalty =
      mountain * MOUNTAIN_ROAD_PENALTY_LINEAR +
      Math.max(0, mountain - MOUNTAIN_ROAD_PENALTY_RIDGE_START) *
        MOUNTAIN_ROAD_PENALTY_RIDGE_SCALE +
      Math.max(0, mountain - MOUNTAIN_ROAD_PENALTY_CORE_START) *
        MOUNTAIN_ROAD_PENALTY_CORE_SCALE;

    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

function buildLandCandidateEdges({
  settlements,
  width,
  size,
  baseCost,
  riverStrength,
  nodeSpacing,
  density01,
}) {
  const nodeCount = settlements.length;
  if (nodeCount < 2) {
    return [];
  }

  const k = clamp(Math.round(3 + density01 * 2 + (nodeSpacing - 2) * 0.1), 3, 6);
  const height = Math.max(1, Math.round(size / Math.max(1, width)));
  const worldDiagonal = Math.hypot(width, height);
  const localDistanceBudget = 11 + nodeSpacing * 2.4 + density01 * 8;
  const worldScaledBudget = worldDiagonal * (0.18 + (1 - density01) * 0.07);
  const maxDistance = clamp(
    Math.max(localDistanceBudget, worldScaledBudget),
    24,
    worldDiagonal * 0.45,
  );
  const seenPairs = new Set();
  const edges: SettlementPairEdge[] = [];

  for (let i = 0; i < nodeCount; i += 1) {
    const nearest = rankNearestSettlementIndices(settlements, i, maxDistance);
    const limit = Math.min(k, nearest.length);

    for (let t = 0; t < limit; t += 1) {
      const target = nearest[t];
      const j = target.index;
      const key = settlementPairKey(i, j);
      if (seenPairs.has(key)) {
        continue;
      }
      seenPairs.add(key);

      const estimatedCost = estimateStraightLandCost({
        from: settlements[i]?.cell,
        to: settlements[j]?.cell,
        width,
        size,
        baseCost,
        riverStrength,
      });
      if (!Number.isFinite(estimatedCost)) {
        continue;
      }

      const importance = clamp(
        (Number(settlements[i]?.score ?? 0) + Number(settlements[j]?.score ?? 0)) /
          220,
        0,
        0.22,
      );

      edges.push({
        i: Math.min(i, j),
        j: Math.max(i, j),
        cost: Math.max(1e-3, estimatedCost * (1 - importance)),
        distance: target.distance,
      });
    }
  }

  return edges.sort(compareEdgeOrder);
}

function buildSeaCandidateEdges({ settlements, density01 }) {
  const maritimeNodeIds = collectMaritimeNodeIds(settlements);
  if (maritimeNodeIds.length < 2) {
    return [];
  }

  const k = clamp(Math.round(1 + density01 * 1.2), 1, 3);
  const maxDistance = clamp(18 + density01 * 18, 16, 42);
  const seenPairs = new Set();
  const edges: SettlementPairEdge[] = [];

  for (const sourceId of maritimeNodeIds) {
    const source = settlements[sourceId];
    const rankedTargets = [];

    for (const targetId of maritimeNodeIds) {
      if (targetId === sourceId) {
        continue;
      }
      const target = settlements[targetId];
      const pairDistance = distance(source.x, source.y, target.x, target.y);
      if (!Number.isFinite(pairDistance) || pairDistance > maxDistance) {
        continue;
      }

      rankedTargets.push({
        targetId,
        pairDistance,
        estimatedCost:
          pairDistance +
          (maritimeEndpointPenalty(source) + maritimeEndpointPenalty(target)) * 12,
      });
    }

    rankedTargets.sort((a, b) => {
      if (Math.abs(a.estimatedCost - b.estimatedCost) > 1e-6) {
        return a.estimatedCost - b.estimatedCost;
      }
      if (Math.abs(a.pairDistance - b.pairDistance) > 1e-6) {
        return a.pairDistance - b.pairDistance;
      }
      return a.targetId - b.targetId;
    });

    const limit = Math.min(k, rankedTargets.length);
    for (let i = 0; i < limit; i += 1) {
      const target = rankedTargets[i];
      const key = settlementPairKey(sourceId, target.targetId);
      if (seenPairs.has(key)) {
        continue;
      }
      seenPairs.add(key);

      edges.push({
        i: Math.min(sourceId, target.targetId),
        j: Math.max(sourceId, target.targetId),
        cost: Math.max(1e-3, target.estimatedCost),
        distance: target.pairDistance,
      });
    }
  }

  return edges.sort(compareEdgeOrder);
}

function rankNearestSettlementIndices(settlements, sourceIndex, maxDistance) {
  const source = settlements[sourceIndex];
  const targets = [];

  for (let index = 0; index < settlements.length; index += 1) {
    if (index === sourceIndex) {
      continue;
    }
    const target = settlements[index];
    const d = distance(source.x, source.y, target.x, target.y);
    if (!Number.isFinite(d) || d > maxDistance) {
      continue;
    }
    targets.push({
      index,
      distance: d,
    });
  }

  targets.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > 1e-6) {
      return a.distance - b.distance;
    }
    return a.index - b.index;
  });

  return targets;
}

function estimateStraightLandCost({
  from,
  to,
  width,
  size,
  baseCost,
  riverStrength,
}) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= size ||
    to >= size
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const cells = rasterLineCells(from, to, width, size);
  if (!cells.length) {
    return Number.POSITIVE_INFINITY;
  }

  let total = 0;
  let visited = 0;
  for (const cell of cells) {
    const base = baseCost[cell];
    if (!Number.isFinite(base)) {
      return Number.POSITIVE_INFINITY;
    }

    const river = Number(riverStrength?.[cell] ?? 0);
    const riverPenalty =
      river > RIVER_COST_THRESHOLD
        ? RIVER_BASE_PENALTY + clamp(river, 0, 4) * RIVER_STRENGTH_SCALE
        : 0;

    total += base + riverPenalty;
    visited += 1;
  }

  if (visited <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return total;
}

function rasterLineCells(from, to, width, size) {
  const [x0, y0] = coordsOf(from, width);
  const [x1, y1] = coordsOf(to, width);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  if (steps <= 0) {
    return [from];
  }

  const cells = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    const cell = y * width + x;
    if (!Number.isInteger(cell) || cell < 0 || cell >= size) {
      continue;
    }
    if (cells[cells.length - 1] !== cell) {
      cells.push(cell);
    }
  }

  return cells;
}

function selectGraphEdges({
  nodeCount,
  edges,
  targetComponents,
  loopBudget,
  loopDetourThreshold,
  loopProbability,
  rng,
  activeNodeIds = null,
}): SelectedGraphEdges {
  if (!edges?.length || nodeCount <= 1) {
    return {
      backboneEdges: [],
      loopEdges: [],
    };
  }

  const activeSet =
    Array.isArray(activeNodeIds) && activeNodeIds.length > 0
      ? new Set(activeNodeIds)
      : null;
  const activeNodeCount = activeSet ? activeSet.size : nodeCount;

  const clampedTargetComponents = clamp(
    Math.round(targetComponents),
    1,
    Math.max(1, activeNodeCount - 1),
  );

  const rankedEdges = edges
    .map((edge) => ({
      edge,
      rankCost: edge.cost * rng.range(0.94, 1.06),
    }))
    .sort((a, b) => {
      if (Math.abs(a.rankCost - b.rankCost) > 1e-6) {
        return a.rankCost - b.rankCost;
      }
      return compareEdgeOrder(a.edge, b.edge);
    })
    .map((entry) => entry.edge);

  const selectedKeySet = new Set();
  const uf = new UnionFind(nodeCount);
  let components = activeNodeCount;
  const backboneEdges: SettlementPairEdge[] = [];

  for (const edge of rankedEdges) {
    if (components <= clampedTargetComponents) {
      break;
    }
    if (uf.find(edge.i) === uf.find(edge.j)) {
      continue;
    }
    if (!uf.union(edge.i, edge.j)) {
      continue;
    }

    backboneEdges.push(edge);
    selectedKeySet.add(settlementPairKey(edge.i, edge.j));
    if (!activeSet || (activeSet.has(edge.i) && activeSet.has(edge.j))) {
      components = Math.max(1, components - 1);
    }
  }

  if (!backboneEdges.length) {
    const fallback = rankedEdges[0];
    if (fallback) {
      backboneEdges.push(fallback);
      selectedKeySet.add(settlementPairKey(fallback.i, fallback.j));
    }
  }

  const adjacency = buildNodeAdjacency(nodeCount, backboneEdges);
  const loopEdges: SettlementPairEdge[] = [];

  const remaining = edges
    .filter((edge) => !selectedKeySet.has(settlementPairKey(edge.i, edge.j)))
    .sort(compareEdgeOrder);

  for (const edge of remaining) {
    if (loopEdges.length >= loopBudget) {
      break;
    }

    const pathCost = shortestPathCostOnNodeGraph(adjacency, edge.i, edge.j);
    if (!Number.isFinite(pathCost) || pathCost <= 0) {
      continue;
    }

    const detourRatio = pathCost / Math.max(1e-6, edge.cost);
    if (detourRatio < loopDetourThreshold) {
      continue;
    }

    const acceptance = clamp(
      loopProbability * (1 + (detourRatio - loopDetourThreshold) * 0.5),
      0.08,
      0.95,
    );
    if (!rng.chance(acceptance)) {
      continue;
    }

    loopEdges.push(edge);
    selectedKeySet.add(settlementPairKey(edge.i, edge.j));
    insertGraphEdgeToAdjacency(adjacency, edge);
  }

  return {
    backboneEdges,
    loopEdges,
  };
}

function buildNodeAdjacency(nodeCount, edges) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    insertGraphEdgeToAdjacency(adjacency, edge);
  }
  return adjacency;
}

function insertGraphEdgeToAdjacency(adjacency, edge) {
  adjacency[edge.i].push({ to: edge.j, cost: edge.cost });
  adjacency[edge.j].push({ to: edge.i, cost: edge.cost });
}

function shortestPathCostOnNodeGraph(adjacency, from, to) {
  if (from === to) {
    return 0;
  }

  const size = adjacency.length;
  if (from < 0 || to < 0 || from >= size || to >= size) {
    return Number.POSITIVE_INFINITY;
  }

  const distances = new Float64Array(size);
  distances.fill(Number.POSITIVE_INFINITY);
  distances[from] = 0;

  const heap = new MinHeap();
  heap.push(from, 0);

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }
    const { index, priority } = node;
    if (priority > distances[index] + 1e-9) {
      continue;
    }
    if (index === to) {
      return priority;
    }

    for (const edge of adjacency[index]) {
      const nextCost = priority + edge.cost;
      if (nextCost < distances[edge.to] - 1e-9) {
        distances[edge.to] = nextCost;
        heap.push(edge.to, nextCost);
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function materializeLandEdges({
  selected,
  settlements,
  roads,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
}) {
  const landRoadEdgeSet = new Set();

  const buildEdges = [
    ...selected.backboneEdges.map((edge) => ({ edge, strictness: 1.0 })),
    ...selected.loopEdges.map((edge) => ({ edge, strictness: 1.35 })),
  ];

  for (const entry of buildEdges) {
    materializeLandEdge({
      edge: entry.edge,
      strictness: entry.strictness,
      settlements,
      roads,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      settlementClearanceMask,
      roadUsage,
      landRoadEdgeSet,
    });
  }
}

function materializeLandEdge({
  edge,
  strictness,
  settlements,
  roads,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
  landRoadEdgeSet,
}) {
  const fromSettlement = settlements[edge.i];
  const toSettlement = settlements[edge.j];
  if (!fromSettlement || !toSettlement) {
    return false;
  }

  const strictnessPasses = [strictness, Math.max(0.72, strictness * 0.78)];
  for (const strictnessPass of strictnessPasses) {
    const path = findLandRoutePath({
      from: fromSettlement.cell,
      to: toSettlement.cell,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      settlementClearanceMask,
      roadUsage,
      landRoadEdgeSet,
      strictness: strictnessPass,
    });

    if (!path || path.length < 2) {
      continue;
    }

    if (countNewEdges(path, landRoadEdgeSet) <= 0) {
      continue;
    }

    const routeCost = resolveSettlementEdgeMetricCost({
      cost: edge.cost,
      length: path.length,
      distance: edge.distance,
    });

    const inserted = pushRoadRecord(roads, {
      type: "road",
      settlementId: toSettlement.id,
      fromSettlementId: fromSettlement.id,
      cells: path,
      cost: routeCost,
    });
    if (!inserted) {
      continue;
    }

    incrementRoadUsage(roadUsage, path);
    registerRoadCellsToAdjacency(path, null, landRoadEdgeSet);
    return true;
  }

  return false;
}

function ensureAtLeastOneLandRoad({
  settlements,
  roads,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
  landCandidates,
}) {
  if (roads.some((road) => (road?.type ?? "road") === "road")) {
    return;
  }

  const landRoadEdgeSet = new Set();
  const attempts = (landCandidates.length
    ? landCandidates
    : buildFallbackLandCandidateEdges(settlements))
    .slice()
    .sort(compareEdgeOrder)
    .slice(0, Math.min(10, Math.max(10, landCandidates.length)));

  for (const edge of attempts) {
    const fromSettlement = settlements[edge.i];
    const toSettlement = settlements[edge.j];
    if (!fromSettlement || !toSettlement) {
      continue;
    }

    const path = findLandRoutePath({
      from: fromSettlement.cell,
      to: toSettlement.cell,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      settlementClearanceMask,
      roadUsage,
      landRoadEdgeSet,
      strictness: 0.72,
    });
    if (!path || path.length < 2) {
      continue;
    }

    const inserted = pushRoadRecord(roads, {
      type: "road",
      settlementId: toSettlement.id,
      fromSettlementId: fromSettlement.id,
      cells: path,
      cost: resolveSettlementEdgeMetricCost({
        cost: edge.cost,
        length: path.length,
        distance: edge.distance,
      }),
    });
    if (!inserted) {
      continue;
    }

    incrementRoadUsage(roadUsage, path);
    registerRoadCellsToAdjacency(path, null, landRoadEdgeSet);
    break;
  }
}

function buildFallbackLandCandidateEdges(settlements): SettlementPairEdge[] {
  const edges: SettlementPairEdge[] = [];
  for (let i = 0; i < settlements.length; i += 1) {
    const from = settlements[i];
    for (let j = i + 1; j < settlements.length; j += 1) {
      const to = settlements[j];
      const pairDistance = distance(from.x, from.y, to.x, to.y);
      if (!Number.isFinite(pairDistance)) {
        continue;
      }
      edges.push({
        i,
        j,
        cost: Math.max(1e-3, pairDistance),
        distance: pairDistance,
      });
    }
  }
  return edges.sort(compareEdgeOrder);
}

function ensureNoIsolatedSettlements({
  settlements,
  roads,
  terrain,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
}) {
  if (!Array.isArray(settlements) || settlements.length < 2) {
    return;
  }

  const settlementIndexById = new Map<number, number>();
  for (let index = 0; index < settlements.length; index += 1) {
    const id = Number(settlements[index]?.id);
    if (Number.isInteger(id) && id >= 0) {
      settlementIndexById.set(id, index);
    }
  }

  const connectedMask = new Uint8Array(settlements.length);
  for (const road of roads) {
    const fromIndex = settlementIndexById.get(Number(road?.fromSettlementId));
    const toIndex = settlementIndexById.get(Number(road?.settlementId));
    if (fromIndex != null) {
      connectedMask[fromIndex] = 1;
    }
    if (toIndex != null) {
      connectedMask[toIndex] = 1;
    }
  }

  const landRoadEdgeSet = new Set();
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      continue;
    }
    registerRoadCellsToAdjacency(cells, null, landRoadEdgeSet);
  }

  for (let sourceIndex = 0; sourceIndex < settlements.length; sourceIndex += 1) {
    if (connectedMask[sourceIndex]) {
      continue;
    }

    const source = settlements[sourceIndex];
    const targets = rankNearestSettlementIndices(
      settlements,
      sourceIndex,
      Number.POSITIVE_INFINITY,
    );

    let connected = false;
    for (const target of targets) {
      const targetIndex = target.index;
      if (targetIndex === sourceIndex) {
        continue;
      }

      const targetSettlement = settlements[targetIndex];
      const landPath = findLandRoutePath({
        from: source.cell,
        to: targetSettlement.cell,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        settlementClearanceMask,
        roadUsage,
        landRoadEdgeSet,
        strictness: 0.64,
      });
      if (landPath && landPath.length >= 2) {
        const inserted = pushRoadRecord(roads, {
          type: "road",
          settlementId: targetSettlement.id,
          fromSettlementId: source.id,
          cells: landPath,
          cost: resolveSettlementEdgeMetricCost({
            distance: target.distance,
            length: landPath.length,
          }),
        });
        if (inserted) {
          incrementRoadUsage(roadUsage, landPath);
          registerRoadCellsToAdjacency(landPath, null, landRoadEdgeSet);
          connectedMask[sourceIndex] = 1;
          connectedMask[targetIndex] = 1;
          connected = true;
          break;
        }
      }

      if (
        !isMaritimeSettlement(source) ||
        !isMaritimeSettlement(targetSettlement)
      ) {
        continue;
      }

      const seaPath = findSeaRoutePath(terrain, source.cell, targetSettlement.cell);
      if (!seaPath || seaPath.length < 2) {
        continue;
      }
      if (
        hasDirectLandRoadConnection(
          roads,
          Number(source.id),
          Number(targetSettlement.id),
        )
      ) {
        continue;
      }

      const inserted = pushRoadRecord(roads, {
        type: "sea-route",
        settlementId: targetSettlement.id,
        fromSettlementId: source.id,
        cells: seaPath,
        cost: resolveSettlementEdgeMetricCost({
          distance: target.distance,
          length: seaPath.length,
        }),
      });
      if (!inserted) {
        continue;
      }

      connectedMask[sourceIndex] = 1;
      connectedMask[targetIndex] = 1;
      connected = true;
      break;
    }

    if (!connected) {
      // If a settlement is truly isolated by terrain topology, keep it as-is.
      connectedMask[sourceIndex] = 1;
    }
  }
}

function ensureConnectedSettlementNetwork({
  settlements,
  roads,
  terrain,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
}) {
  if (!Array.isArray(settlements) || settlements.length < 2) {
    return;
  }

  const landRoadEdgeSet = new Set();
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      continue;
    }
    registerRoadCellsToAdjacency(cells, null, landRoadEdgeSet);
  }

  const blockedPairs = new Set();
  const maxAttempts = Math.max(2, settlements.length * 3);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = buildSettlementConnectivityState(settlements, roads);
    if (state.components.length <= 1) {
      return;
    }

    const largest = state.components[0];
    if (!largest?.indices?.length) {
      return;
    }

    const candidatePairs = [];
    for (let sourceIndex = 0; sourceIndex < settlements.length; sourceIndex += 1) {
      if (state.componentBySettlementIndex[sourceIndex] === largest.id) {
        continue;
      }

      for (const targetIndex of largest.indices) {
        const source = settlements[sourceIndex];
        const target = settlements[targetIndex];
        if (!source || !target) {
          continue;
        }
        candidatePairs.push({
          sourceIndex,
          targetIndex,
          distance: distance(source.x, source.y, target.x, target.y),
        });
      }
    }

    candidatePairs.sort((a, b) => {
      if (Math.abs(a.distance - b.distance) > 1e-6) {
        return a.distance - b.distance;
      }
      if (a.sourceIndex !== b.sourceIndex) {
        return a.sourceIndex - b.sourceIndex;
      }
      return a.targetIndex - b.targetIndex;
    });

    let merged = false;
    for (const pair of candidatePairs) {
      const pairKey = settlementPairKey(pair.sourceIndex, pair.targetIndex);
      if (blockedPairs.has(pairKey)) {
        continue;
      }

      const source = settlements[pair.sourceIndex];
      const target = settlements[pair.targetIndex];
      if (!source || !target) {
        blockedPairs.add(pairKey);
        continue;
      }

      const landPath = findLandRoutePath({
        from: source.cell,
        to: target.cell,
        width,
        height,
        size,
        baseCost,
        riverStrength,
        settlementClearanceMask,
        roadUsage,
        landRoadEdgeSet,
        strictness: 0.56,
      });
      if (landPath && landPath.length >= 2) {
        const inserted = pushRoadRecord(roads, {
          type: "road",
          settlementId: target.id,
          fromSettlementId: source.id,
          cells: landPath,
          cost: resolveSettlementEdgeMetricCost({
            distance: pair.distance,
            length: landPath.length,
          }),
        });
        if (inserted) {
          incrementRoadUsage(roadUsage, landPath);
          registerRoadCellsToAdjacency(landPath, null, landRoadEdgeSet);
          merged = true;
          break;
        }
      }

      if (
        !isMaritimeSettlement(source) ||
        !isMaritimeSettlement(target) ||
        hasDirectLandRoadConnection(roads, Number(source.id), Number(target.id))
      ) {
        blockedPairs.add(pairKey);
        continue;
      }

      const seaPath = findSeaRoutePath(terrain, source.cell, target.cell);
      if (!seaPath || seaPath.length < 2) {
        blockedPairs.add(pairKey);
        continue;
      }

      const inserted = pushRoadRecord(roads, {
        type: "sea-route",
        settlementId: target.id,
        fromSettlementId: source.id,
        cells: seaPath,
        cost: resolveSettlementEdgeMetricCost({
          distance: pair.distance,
          length: seaPath.length,
        }),
      });
      if (!inserted) {
        blockedPairs.add(pairKey);
        continue;
      }

      merged = true;
      break;
    }

    if (!merged) {
      return;
    }
  }
}

function buildSettlementConnectivityState(settlements, roads) {
  const settlementCount = settlements.length;
  const settlementIndexById = new Map();
  for (let index = 0; index < settlementCount; index += 1) {
    const id = Number(settlements[index]?.id);
    if (Number.isInteger(id) && id >= 0) {
      settlementIndexById.set(id, index);
    }
  }

  const uf = new UnionFind(settlementCount);
  for (const road of roads) {
    const fromIndex = settlementIndexById.get(Number(road?.fromSettlementId));
    const toIndex = settlementIndexById.get(Number(road?.settlementId));
    if (fromIndex == null || toIndex == null || fromIndex === toIndex) {
      continue;
    }
    uf.union(fromIndex, toIndex);
  }

  const byRoot = new Map<number, number[]>();
  for (let index = 0; index < settlementCount; index += 1) {
    const root = uf.find(index);
    let indices = byRoot.get(root);
    if (!indices) {
      indices = [];
      byRoot.set(root, indices);
    }
    indices.push(index);
  }

  const components = [...byRoot.entries()]
    .map(([id, indices]) => ({
      id,
      indices: indices.sort((a, b) => a - b),
      size: indices.length,
    }))
    .sort((a, b) => {
      if (b.size !== a.size) {
        return b.size - a.size;
      }
      return a.indices[0] - b.indices[0];
    });

  const componentBySettlementIndex = new Int32Array(settlementCount);
  componentBySettlementIndex.fill(-1);
  for (const component of components) {
    for (const index of component.indices) {
      componentBySettlementIndex[index] = component.id;
    }
  }

  return {
    components,
    componentBySettlementIndex,
  };
}

function findLandRoutePath({
  from,
  to,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
  landRoadEdgeSet,
  strictness,
}) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= size ||
    to >= size ||
    !Number.isFinite(baseCost[from]) ||
    !Number.isFinite(baseCost[to])
  ) {
    return null;
  }

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const heap = new MinHeap();
  gScore[from] = 0;
  heap.push(from, heuristic(from, to, width));

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }
    const current = node.index;

    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const next = ny * width + nx;
      const stepCost = computeLandAStarStepCost({
        from: current,
        to: next,
        target: to,
        width,
        baseCost,
        riverStrength,
        settlementClearanceMask,
        roadUsage,
        landRoadEdgeSet,
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
      heap.push(next, tentative + heuristic(next, to, width));
    });
  }

  return null;
}

function computeLandAStarStepCost({
  from,
  to,
  target,
  width,
  baseCost,
  riverStrength,
  settlementClearanceMask,
  roadUsage,
  landRoadEdgeSet,
  strictness,
}) {
  let cost = computeBaseLandStepCost({ from, to, baseCost, riverStrength });
  if (!Number.isFinite(cost)) {
    return Number.POSITIVE_INFINITY;
  }

  const edgeExists = landRoadEdgeSet.has(edgeKey(from, to));
  const fromOnRoad = roadUsage[from] > 0;
  const toOnRoad = roadUsage[to] > 0;

  if (edgeExists) {
    cost *= ON_ROAD_COST_FACTOR;
  } else if (fromOnRoad || toOnRoad) {
    cost *= TOUCHING_ROAD_COST_FACTOR;
  }

  if (!toOnRoad && isNearRoadCell(to, roadUsage, width)) {
    cost += PARALLEL_ROAD_PENALTY * strictness;
  }

  if (to !== target && settlementClearanceMask[to]) {
    cost += SETTLEMENT_CLEARANCE_PENALTY * strictness;
  }

  return cost;
}

function computeBaseLandStepCost({ from, to, baseCost, riverStrength }) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return Number.POSITIVE_INFINITY;
  }

  let cost = (baseCost[from] + baseCost[to]) * 0.5;
  const river = Math.max(Number(riverStrength?.[from] ?? 0), Number(riverStrength?.[to] ?? 0));
  if (river > RIVER_COST_THRESHOLD) {
    cost += RIVER_BASE_PENALTY + clamp(river, 0, 4) * RIVER_STRENGTH_SCALE;
  }

  return cost;
}

function materializeSeaEdges({ selected, settlements, roads, terrain }) {
  const edges = [...selected.backboneEdges, ...selected.loopEdges].sort(compareEdgeOrder);

  for (const edge of edges) {
    materializeSeaRouteEdge({
      edge,
      settlements,
      roads,
      terrain,
    });
  }
}

function materializeSeaRouteEdge({ edge, settlements, roads, terrain }) {
  const fromSettlement = settlements[edge.i];
  const toSettlement = settlements[edge.j];
  if (!fromSettlement || !toSettlement) {
    return null;
  }
  if (
    hasDirectLandRoadConnection(
      roads,
      Number(fromSettlement.id),
      Number(toSettlement.id),
    )
  ) {
    return null;
  }

  const path = findSeaRoutePath(terrain, fromSettlement.cell, toSettlement.cell);
  if (!path || path.length < 2) {
    return null;
  }

  const routeCost = resolveSettlementEdgeMetricCost({
    cost: edge.cost,
    length: path.length,
    distance: edge.distance,
  });

  const inserted = pushRoadRecord(roads, {
    type: "sea-route",
    settlementId: toSettlement.id,
    fromSettlementId: fromSettlement.id,
    cells: path,
    cost: routeCost,
  });

  return inserted ? routeCost : null;
}

function findSeaRoutePath(terrain, from, to) {
  const { width, height, size, isLand } = terrain;
  if (
    width <= 0 ||
    height <= 0 ||
    size <= 0 ||
    !isLand?.length ||
    isLand.length < size ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= size ||
    to >= size
  ) {
    return null;
  }

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const heap = new MinHeap();
  gScore[from] = 0;
  heap.push(from, heuristic(from, to, width));

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }
    const current = node.index;
    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const next = ny * width + nx;
      const stepCost = 1 + (isLand[next] ? 26 : 0);
      const tentative = gScore[current] + stepCost;
      if (tentative >= gScore[next] - 1e-9) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      heap.push(next, tentative + heuristic(next, to, width));
    });
  }

  return null;
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

function buildNeighborhoodMask({
  width,
  height,
  size,
  sourceCells,
  radius,
}) {
  const mask = new Uint8Array(size);
  if (
    !sourceCells?.length ||
    width <= 0 ||
    height <= 0 ||
    size <= 0 ||
    !Number.isFinite(radius) ||
    radius <= 0
  ) {
    return mask;
  }

  const radiusSq = radius * radius;
  for (const source of sourceCells) {
    if (!Number.isInteger(source) || source < 0 || source >= size) {
      continue;
    }

    const [sx, sy] = coordsOf(source, width);
    const minY = Math.max(0, Math.ceil(sy - radius));
    const maxY = Math.min(height - 1, Math.floor(sy + radius));
    const minX = Math.max(0, Math.ceil(sx - radius));
    const maxX = Math.min(width - 1, Math.floor(sx + radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
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

function registerRoadCellsToAdjacency(cells, adjacency, roadEdgeSet = null) {
  const connect = (a, b) => {
    if (!adjacency) {
      return;
    }
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

    if (roadEdgeSet) {
      roadEdgeSet.add(edgeKey(from, to));
    }

    connect(from, to);
    connect(to, from);
  }
}

function buildRoadCellAdjacency(roads) {
  const adjacency = new Map();

  for (const road of roads) {
    const cells = road?.cells ?? [];
    if (cells.length < 2) {
      continue;
    }
    registerRoadCellsToAdjacency(cells, adjacency);
  }

  return adjacency;
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
    if (!Number.isInteger(cell) || cell < 0 || cell >= roadUsage.length) {
      continue;
    }
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

function collectMaritimeNodeIds(settlements) {
  const ids = [];
  for (let index = 0; index < settlements.length; index += 1) {
    if (isMaritimeSettlement(settlements[index])) {
      ids.push(index);
    }
  }
  return ids;
}

function isMaritimeSettlement(settlement) {
  // Sea routes should represent open-water travel between coast-facing nodes.
  return Boolean(settlement && settlement.coastal);
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

function resolveTargetComponentCount(nodeCount, isolation01, density01) {
  if (nodeCount <= 2) {
    return 1;
  }

  const maxTarget = Math.max(1, Math.floor(Math.sqrt(nodeCount) * 0.85));
  const raw = 1 + isolation01 * maxTarget - density01 * 0.75;
  return clamp(Math.round(raw), 1, Math.min(maxTarget, nodeCount - 1));
}

function resolveLoopBudget({ edgeCount, nodeCount, density01, multiplier, hardCap }) {
  if (edgeCount <= 0 || nodeCount <= 1) {
    return 0;
  }

  const base = Math.round(nodeCount * (0.18 + density01 * multiplier));
  return clamp(base, 0, Math.min(edgeCount, hardCap));
}

function resolveSettlementEdgeMetricCost(edgeLike) {
  const weightedCost = Number(edgeLike?.cost);
  if (Number.isFinite(weightedCost) && weightedCost > 0) {
    return weightedCost;
  }

  const fallbackLength = Number(edgeLike?.length ?? edgeLike?.distance);
  if (Number.isFinite(fallbackLength) && fallbackLength > 0) {
    return fallbackLength;
  }

  return 1;
}

function settlementPairKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function compareEdgeOrder(a, b) {
  if (Math.abs(a.cost - b.cost) > 1e-6) {
    return a.cost - b.cost;
  }
  if (Math.abs(a.distance - b.distance) > 1e-6) {
    return a.distance - b.distance;
  }
  if (a.i !== b.i) {
    return a.i - b.i;
  }
  return a.j - b.j;
}

function isNearRoadCell(cell, roadUsage, width) {
  if (
    !Number.isInteger(cell) ||
    !roadUsage?.length ||
    width <= 0 ||
    cell < 0 ||
    cell >= roadUsage.length
  ) {
    return false;
  }

  const x = cell % width;
  const y = Math.floor(cell / width);
  const height = Math.ceil(roadUsage.length / width);

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

function getRoadNodeSpacing(params) {
  return clamp(Number(params?.nodeMinDistance ?? 5), 2, 22);
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

function hasDirectLandRoadConnection(
  roads,
  settlementAId,
  settlementBId,
) {
  if (!Number.isInteger(settlementAId) || !Number.isInteger(settlementBId)) {
    return false;
  }
  const a = Math.min(settlementAId, settlementBId);
  const b = Math.max(settlementAId, settlementBId);
  return roads.some((road) => {
    if ((road?.type ?? "road") !== "road") {
      return false;
    }
    const fromId = Number(road?.fromSettlementId);
    const toId = Number(road?.settlementId);
    if (!Number.isInteger(fromId) || !Number.isInteger(toId)) {
      return false;
    }
    return Math.min(fromId, toId) === a && Math.max(fromId, toId) === b;
  });
}

class UnionFind {
  parent: number[];
  rank: Uint8Array;

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
  values: Array<{ index: number; priority: number }>;

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
      const right = left + 1;
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
