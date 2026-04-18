import { getBiomeRoadTravelCostById } from "@fardvag/shared/biomes";
import { clamp, coordsOf, distance, forEachNeighbor } from "@fardvag/shared/utils";

const MAX_ROAD_USAGE = 65535;

const LAND_RIVER_THRESHOLD = 0.08;
const LAND_RIVER_PENALTY_BASE = 1.8;
const LAND_RIVER_PENALTY_SCALE = 2.4;
const LAND_MOUNTAIN_SCALE = 8.2;
const LAND_ELEVATION_SCALE = 1.4;
const LAND_REUSE_MULTIPLIER = 0.38;
const LAND_NEAR_REUSE_MULTIPLIER = 0.82;
const JUNCTION_NODE_BUFFER_RADIUS = 2.2;
const JUNCTION_ALIGNMENT_PENALTY = 1.35;
const JUNCTION_ALIGNMENT_MIN_MAG = 0.35;
const MAX_SHORTCUT_ADDITIONS = 512;
const MAX_SHORTCUT_CANDIDATE_POOL = 140;
const MAX_SHORTCUT_ROUTE_EVALUATIONS = 96;
const SHORTCUT_PROXY_MARGIN = 0.22;

const SEA_EDGE_MULTIPLIER = 3.6;
const SEA_EDGE_OFFSET = 10;
const SEA_STEP_COST = 3.8;
const SEA_REUSE_MULTIPLIER = 0.45;

interface SettlementLike {
  id: number;
  cell?: number;
  x: number;
  y: number;
  coastal?: boolean;
  [key: string]: unknown;
}

interface WorldLike {
  terrain?: any;
  climate?: any;
  hydrology?: any;
  settlements?: SettlementLike[];
  params?: any;
}

interface SettAccess {
  settlement: SettlementLike;
  index: number;
  landmassId: number;
  waterRegionId: number;
  coastal: boolean;
}

interface RouteResult {
  cells: number[];
  cost: number;
}

interface EdgeCandidate {
  a: number;
  b: number;
  type: "road" | "sea-route";
  baseWeight: number;
  tie: number;
  key: string;
  cachedVersion: number;
  cachedCost: number;
  cachedRoute: RouteResult | null;
  queuePriority: number;
}

interface RoadsOutput {
  roads: Array<{
    id: number;
    type: "road" | "sea-route";
    fromSettlementId: number;
    settlementId: number;
    length: number;
    cost: number;
    cells: number[];
  }>;
  roadUsage: Uint16Array;
  componentCount: number;
  signpostCells: number[];
  [key: string]: unknown;
}

interface WorldContext {
  settlements: SettlementLike[];
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
  biome?: ArrayLike<number>;
  elevation?: ArrayLike<number>;
  mountainField?: ArrayLike<number>;
  riverStrength?: ArrayLike<number>;
  settlementCellSet: Set<number>;
  junctionBlockMask: Uint8Array;
}

interface RoutingNetwork {
  roads: RoadsOutput["roads"];
  roadUsage: Uint16Array;
  seaRouteUsage: Uint16Array;
  roadDirX: Float32Array;
  roadDirY: Float32Array;
  networkVersion: number;
}

export function generateRoads(world: WorldLike): RoadsOutput {
  const width = Number(world?.terrain?.width ?? 0);
  const height = Number(world?.terrain?.height ?? 0);
  const size = Number(world?.terrain?.size ?? width * height);
  const isLand = world?.terrain?.isLand;

  const emptyUsage = new Uint16Array(Math.max(0, size));
  if (
    width <= 0 ||
    height <= 0 ||
    size <= 0 ||
    !isLand ||
    isLand.length < size ||
    !Array.isArray(world?.settlements)
  ) {
    return {
      roads: [],
      roadUsage: emptyUsage,
      componentCount: 0,
      signpostCells: [],
    };
  }

  const lakeIdByCell = world?.hydrology?.lakeIdByCell;
  const riverStrength = world?.hydrology?.riverStrength;
  const elevation = world?.terrain?.elevation;
  const mountainField = world?.terrain?.mountainField;
  const coastMask = world?.terrain?.coastMask;
  const biome = world?.climate?.biome;

  const normalizedSettlements = normalizeSettlements(world.settlements, size);
  world.settlements = normalizedSettlements;

  if (normalizedSettlements.length <= 1) {
    return {
      roads: [],
      roadUsage: emptyUsage,
      componentCount: normalizedSettlements.length,
      signpostCells: [],
    };
  }

  const landmassIdByCell = buildLandmassIdByCell({
    width,
    height,
    size,
    isLand,
    lakeIdByCell,
  });
  const waterRegionIdByCell = buildWaterRegionIdByCell({
    width,
    height,
    size,
    isLand,
    lakeIdByCell,
  });

  const initialAccess = annotateSettlementAccess({
    settlements: normalizedSettlements,
    width,
    height,
    size,
    isLand,
    coastMask,
    lakeIdByCell,
    landmassIdByCell,
    waterRegionIdByCell,
  });

  const keepIndices = largestPotentialComponentIndices(initialAccess);
  if (keepIndices.size < normalizedSettlements.length) {
    world.settlements = reindexSettlements(
      normalizedSettlements.filter((_entry, index) => keepIndices.has(index)),
    );
  }

  const settlements = world.settlements as SettlementLike[];
  if (settlements.length <= 1) {
    return {
      roads: [],
      roadUsage: emptyUsage,
      componentCount: settlements.length,
      signpostCells: [],
    };
  }

  const access = annotateSettlementAccess({
    settlements,
    width,
    height,
    size,
    isLand,
    coastMask,
    lakeIdByCell,
    landmassIdByCell,
    waterRegionIdByCell,
  });

  const candidates = buildEdgeCandidates(access);
  const connectedCandidates = ensureCandidateConnectivity(candidates, access);
  const shortcutFactor = clamp(Number(world?.params?.roadConnectivity ?? 2), 1, 5);

  const roads: RoadsOutput["roads"] = [];
  const roadUsage = new Uint16Array(size);
  const seaRouteUsage = new Uint16Array(size);
  const roadDirX = new Float32Array(size);
  const roadDirY = new Float32Array(size);
  const builtPairs = new Set<string>();
  const degreeByNode = new Int16Array(settlements.length);
  const settlementCells = settlements
    .map((settlement) => Number(settlement.cell))
    .filter(
      (cell): cell is number =>
        Number.isInteger(cell) && cell >= 0 && cell < size,
    );
  const settlementCellSet = new Set<number>(settlementCells);
  const junctionBlockMask = buildRadiusMask({
    width,
    height,
    size,
    sourceCells: settlementCells,
    radius: JUNCTION_NODE_BUFFER_RADIUS,
  });

  const network = {
    roads,
    roadUsage,
    seaRouteUsage,
    roadDirX,
    roadDirY,
    networkVersion: 0,
  };
  const unionFind = new UnionFind(settlements.length);
  const worldContext: WorldContext = {
    settlements,
    width,
    height,
    size,
    isLand,
    lakeIdByCell,
    biome,
    elevation,
    mountainField,
    riverStrength,
    settlementCellSet,
    junctionBlockMask,
  };
  const rejectedPairs = new Set<string>();

  // Steg 1: låt varje nod försöka koppla sin billigaste granne.
  // Om den billigaste kopplingen redan byggts av en annan nod gör vi inget mer
  // för den noden i detta steg.
  for (let settlementIndex = 0; settlementIndex < settlements.length; settlementIndex += 1) {
    while (true) {
      const candidate = selectBestCandidate({
        candidates: connectedCandidates,
        builtPairs,
        rejectedPairs,
        network,
        worldContext,
        predicate: (entry) =>
          entry.a === settlementIndex || entry.b === settlementIndex,
        includeBuiltPairs: true,
      });
      if (!candidate) {
        break;
      }

      if (builtPairs.has(candidate.key)) {
        break;
      }

      if (!materializeCandidate(candidate, settlements, network, builtPairs, width)) {
        rejectedPairs.add(candidate.key);
        continue;
      }

      unionFind.union(candidate.a, candidate.b);
      degreeByNode[candidate.a] += 1;
      degreeByNode[candidate.b] += 1;
      break;
    }
  }

  // Komplettera eventuella noder som fortfarande saknar koppling.
  for (let attempts = 0; attempts < settlements.length; attempts += 1) {
    let progress = false;
    for (let settlementIndex = 0; settlementIndex < settlements.length; settlementIndex += 1) {
      if (degreeByNode[settlementIndex] > 0) {
        continue;
      }

      while (true) {
        const candidate = selectBestCandidate({
          candidates: connectedCandidates,
          builtPairs,
          rejectedPairs,
          network,
          worldContext,
          predicate: (entry) =>
            entry.a === settlementIndex || entry.b === settlementIndex,
          includeBuiltPairs: false,
        });
        if (!candidate) {
          break;
        }

        if (!materializeCandidate(candidate, settlements, network, builtPairs, width)) {
          rejectedPairs.add(candidate.key);
          continue;
        }

        unionFind.union(candidate.a, candidate.b);
        degreeByNode[candidate.a] += 1;
        degreeByNode[candidate.b] += 1;
        progress = true;
        break;
      }
    }

    if (degreeByNode.every((value) => value > 0)) {
      break;
    }
    if (!progress) {
      break;
    }
  }

  // Steg 2: koppla ihop delgrafer tills en enda graf återstår.
  while (countRoots(unionFind, settlements.length) > 1) {
    const groups = collectUnionGroups(unionFind, settlements.length);
    if (groups.length <= 1) {
      break;
    }

    const componentByNode = new Int32Array(settlements.length);
    for (let index = 0; index < settlements.length; index += 1) {
      componentByNode[index] = unionFind.find(index);
    }

    const proposals = new Map<string, EdgeCandidate>();
    for (const group of groups) {
      const bridge = selectBestCandidate({
        candidates: connectedCandidates,
        builtPairs,
        rejectedPairs,
        network,
        worldContext,
        predicate: (candidate) => {
          const rootA = componentByNode[candidate.a];
          const rootB = componentByNode[candidate.b];
          return (
            (rootA === group.root && rootB !== group.root) ||
            (rootB === group.root && rootA !== group.root)
          );
        },
        includeBuiltPairs: false,
      });
      if (bridge) {
        proposals.set(bridge.key, bridge);
      }
    }

    if (proposals.size === 0) {
      break;
    }

    const orderedBridges = [...proposals.values()].sort(
      (a, b) => a.cachedCost - b.cachedCost || a.tie - b.tie,
    );
    let addedThisRound = 0;

    for (const candidate of orderedBridges) {
      if (unionFind.find(candidate.a) === unionFind.find(candidate.b)) {
        continue;
      }

      refreshCandidateCache(candidate, network, worldContext);
      if (!materializeCandidate(candidate, settlements, network, builtPairs, width)) {
        rejectedPairs.add(candidate.key);
        continue;
      }

      unionFind.union(candidate.a, candidate.b);
      degreeByNode[candidate.a] += 1;
      degreeByNode[candidate.b] += 1;
      addedThisRound += 1;
    }

    if (addedThisRound === 0) {
      break;
    }
  }

  // Steg 3: lägg till billiga genvägar när befintlig nätväg är tillräckligt mycket längre.
  const shortestMatrix = buildNetworkShortestCostMatrix(
    settlements.length,
    roads,
  );
  const shortcutCandidates = connectedCandidates
    .filter(
      (candidate) =>
        !builtPairs.has(candidate.key) && !rejectedPairs.has(candidate.key),
    )
    .map((candidate) => {
      const networkCost =
        shortestMatrix[candidate.a]?.[candidate.b] ?? Number.POSITIVE_INFINITY;
      const baseCost = Math.max(1e-6, Number(candidate.baseWeight));
      const proxyRatio = networkCost / baseCost;
      return { candidate, proxyRatio };
    })
    .filter(
      ({ proxyRatio }) =>
        Number.isFinite(proxyRatio) &&
        proxyRatio >= shortcutFactor * SHORTCUT_PROXY_MARGIN,
    )
    .sort((a, b) => b.proxyRatio - a.proxyRatio)
    .slice(0, MAX_SHORTCUT_CANDIDATE_POOL)
    .map((entry) => entry.candidate);
  const maxShortcutAdditions = Math.min(
    MAX_SHORTCUT_ADDITIONS,
    shortcutCandidates.length,
  );
  let shortcutEvaluations = 0;
  let shortcutAdded = 0;
  while (shortcutAdded < maxShortcutAdditions) {
    let bestShortcut: EdgeCandidate | null = null;
    let bestRatio = Number.NEGATIVE_INFINITY;

    for (const candidate of shortcutCandidates) {
      if (builtPairs.has(candidate.key) || rejectedPairs.has(candidate.key)) {
        continue;
      }

      const currentNetworkCost =
        shortestMatrix[candidate.a]?.[candidate.b] ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(currentNetworkCost) || currentNetworkCost <= 0) {
        continue;
      }

      if (candidate.cachedVersion !== network.networkVersion) {
        if (shortcutEvaluations >= MAX_SHORTCUT_ROUTE_EVALUATIONS) {
          continue;
        }
        refreshCandidateCache(candidate, network, worldContext);
        shortcutEvaluations += 1;
      }
      if (!candidate.cachedRoute || !Number.isFinite(candidate.cachedCost)) {
        continue;
      }

      const directCost = Number(candidate.cachedCost);
      if (!(directCost > 0)) {
        continue;
      }

      const ratio = currentNetworkCost / directCost;
      if (ratio + 1e-9 < shortcutFactor) {
        continue;
      }

      if (
        ratio > bestRatio + 1e-9 ||
        (Math.abs(ratio - bestRatio) < 1e-9 &&
          directCost <
            Number(bestShortcut?.cachedCost ?? Number.POSITIVE_INFINITY))
      ) {
        bestRatio = ratio;
        bestShortcut = candidate;
      }
    }

    if (!bestShortcut) {
      break;
    }

    if (
      !materializeCandidate(
        bestShortcut,
        settlements,
        network,
        builtPairs,
        width,
      )
    ) {
      rejectedPairs.add(bestShortcut.key);
      continue;
    }

    unionFind.union(bestShortcut.a, bestShortcut.b);
    degreeByNode[bestShortcut.a] += 1;
    degreeByNode[bestShortcut.b] += 1;
    updateShortestCostMatrixWithEdge(
      shortestMatrix,
      bestShortcut.a,
      bestShortcut.b,
      Number(bestShortcut.cachedCost),
    );
    shortcutAdded += 1;
  }

  if (countSettlementComponents(settlements.length, roads) > 1) {
    pruneToLargestBuiltComponent(world, roads);
  }

  const finalSettlements = Array.isArray(world.settlements)
    ? (world.settlements as SettlementLike[])
    : [];
  const finalRoadUsage = new Uint16Array(size);
  for (const road of roads) {
    if (road.type === "road") {
      incrementRoadUsage(finalRoadUsage, road.cells);
    }
  }

  return {
    roads,
    roadUsage: finalRoadUsage,
    componentCount: countSettlementComponents(finalSettlements.length, roads),
    signpostCells: [],
  };
}

function selectBestCandidate({
  candidates,
  builtPairs,
  rejectedPairs,
  network,
  worldContext,
  predicate,
  includeBuiltPairs = false,
}: {
  candidates: EdgeCandidate[];
  builtPairs: Set<string>;
  rejectedPairs: Set<string>;
  network: RoutingNetwork;
  worldContext: WorldContext;
  predicate: (candidate: EdgeCandidate) => boolean;
  includeBuiltPairs?: boolean;
}): EdgeCandidate | null {
  let best: EdgeCandidate | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (
      (!includeBuiltPairs && builtPairs.has(candidate.key)) ||
      rejectedPairs.has(candidate.key) ||
      !predicate(candidate)
    ) {
      continue;
    }

    refreshCandidateCache(candidate, network, worldContext);
    if (!candidate.cachedRoute || !Number.isFinite(candidate.cachedCost)) {
      continue;
    }

    if (
      candidate.cachedCost < bestCost ||
      (Math.abs(candidate.cachedCost - bestCost) < 1e-9 &&
        candidate.tie < Number(best?.tie ?? Number.POSITIVE_INFINITY))
    ) {
      bestCost = candidate.cachedCost;
      best = candidate;
    }
  }

  return best;
}

function refreshCandidateCache(
  candidate: EdgeCandidate,
  network: RoutingNetwork,
  worldContext: WorldContext,
): void {
  if (candidate.cachedVersion === network.networkVersion) {
    return;
  }

  const route = computeCandidateRoute(candidate, network, worldContext);
  candidate.cachedVersion = network.networkVersion;
  candidate.cachedRoute = route;
  candidate.cachedCost = Number.isFinite(route?.cost)
    ? Number(route?.cost)
    : Number.POSITIVE_INFINITY;
}

function computeCandidateRoute(
  candidate: EdgeCandidate,
  network: {
    roadUsage: Uint16Array;
    seaRouteUsage: Uint16Array;
    roadDirX: Float32Array;
    roadDirY: Float32Array;
  },
  context: {
    settlements: SettlementLike[];
    width: number;
    height: number;
    size: number;
    isLand: ArrayLike<number>;
    lakeIdByCell?: ArrayLike<number>;
    biome?: ArrayLike<number>;
    elevation?: ArrayLike<number>;
    mountainField?: ArrayLike<number>;
    riverStrength?: ArrayLike<number>;
    settlementCellSet: Set<number>;
    junctionBlockMask: Uint8Array;
  },
): RouteResult | null {
  const from = context.settlements[candidate.a];
  const to = context.settlements[candidate.b];
  const startCell = Number(from?.cell);
  const endCell = Number(to?.cell);

  if (
    !Number.isInteger(startCell) ||
    !Number.isInteger(endCell) ||
    startCell < 0 ||
    endCell < 0 ||
    startCell >= context.size ||
    endCell >= context.size
  ) {
    return null;
  }

  if (candidate.type === "sea-route") {
    return findSeaRoute({
      width: context.width,
      height: context.height,
      size: context.size,
      isLand: context.isLand,
      lakeIdByCell: context.lakeIdByCell,
      seaRouteUsage: network.seaRouteUsage,
      startCell,
      endCell,
    });
  }

  return findLandRoute({
    width: context.width,
    height: context.height,
    size: context.size,
    isLand: context.isLand,
    lakeIdByCell: context.lakeIdByCell,
    biome: context.biome,
    elevation: context.elevation,
    mountainField: context.mountainField,
    riverStrength: context.riverStrength,
    roadUsage: network.roadUsage,
    roadDirX: network.roadDirX,
    roadDirY: network.roadDirY,
    settlementCellSet: context.settlementCellSet,
    junctionBlockMask: context.junctionBlockMask,
    startCell,
    endCell,
  });
}

function materializeCandidate(
  candidate: EdgeCandidate,
  settlements: SettlementLike[],
  network: {
    roads: RoadsOutput["roads"];
    roadUsage: Uint16Array;
    seaRouteUsage: Uint16Array;
    roadDirX: Float32Array;
    roadDirY: Float32Array;
  },
  builtPairs: Set<string>,
  width: number,
): boolean {
  if (!candidate.cachedRoute || !Number.isFinite(candidate.cachedCost)) {
    return false;
  }

  const from = settlements[candidate.a];
  const to = settlements[candidate.b];
  if (!from || !to) {
    return false;
  }

  const cells = dedupeConsecutive(candidate.cachedRoute.cells);
  if (cells.length < 2) {
    return false;
  }

  network.roads.push({
    id: network.roads.length,
    type: candidate.type,
    fromSettlementId: from.id,
    settlementId: to.id,
    length: cells.length,
    cost: candidate.cachedCost,
    cells,
  });

  if (candidate.type === "sea-route") {
    incrementRoadUsage(network.seaRouteUsage, cells);
  } else {
    incrementRoadUsage(network.roadUsage, cells);
    accumulateRoadDirection(network.roadDirX, network.roadDirY, cells, width);
  }

  builtPairs.add(candidate.key);
  return true;
}

function buildEdgeCandidates(access: SettAccess[]): EdgeCandidate[] {
  const candidates: EdgeCandidate[] = [];

  for (let i = 0; i < access.length; i += 1) {
    const source = access[i];
    for (let j = i + 1; j < access.length; j += 1) {
      const target = access[j];
      const d = distance(
        source.settlement.x,
        source.settlement.y,
        target.settlement.x,
        target.settlement.y,
      );

      const landAllowed =
        source.landmassId >= 0 && source.landmassId === target.landmassId;
      const seaAllowed =
        source.coastal &&
        target.coastal &&
        source.waterRegionId >= 0 &&
        source.waterRegionId === target.waterRegionId &&
        source.landmassId !== target.landmassId;

      if (!landAllowed && !seaAllowed) {
        continue;
      }

      const type: "road" | "sea-route" = landAllowed ? "road" : "sea-route";
      const baseWeight = landAllowed
        ? Math.max(1, d)
        : Math.max(1, d * SEA_EDGE_MULTIPLIER + SEA_EDGE_OFFSET);
      const key = edgeKey(i, j);
      const tie = pairTieBreaker(i, j);

      candidates.push({
        a: i,
        b: j,
        type,
        baseWeight,
        tie,
        key,
        cachedVersion: -1,
        cachedCost: Number.POSITIVE_INFINITY,
        cachedRoute: null,
        queuePriority: baseWeight + tie,
      });
    }
  }

  return candidates;
}

function ensureCandidateConnectivity(
  edges: EdgeCandidate[],
  access: SettAccess[],
): EdgeCandidate[] {
  const nodeCount = access.length;
  if (nodeCount <= 1) {
    return edges;
  }

  const byKey = new Map<string, EdgeCandidate>();
  for (const edge of edges) {
    byKey.set(edge.key, edge);
  }

  const unionFind = new UnionFind(nodeCount);
  for (const edge of edges) {
    unionFind.union(edge.a, edge.b);
  }

  for (let attempt = 0; attempt < nodeCount * nodeCount; attempt += 1) {
    const groups = collectUnionGroups(unionFind, nodeCount);
    if (groups.length <= 1) {
      break;
    }

    const anchor = groups[0];
    let bestBridge: EdgeCandidate | null = null;

    for (const group of groups.slice(1)) {
      for (const a of anchor.indices) {
        for (const b of group.indices) {
          const source = access[a];
          const target = access[b];
          const d = distance(
            source.settlement.x,
            source.settlement.y,
            target.settlement.x,
            target.settlement.y,
          );

          const landAllowed =
            source.landmassId >= 0 && source.landmassId === target.landmassId;
          const seaAllowed =
            source.coastal &&
            target.coastal &&
            source.waterRegionId >= 0 &&
            source.waterRegionId === target.waterRegionId;

          if (!landAllowed && !seaAllowed) {
            continue;
          }

          const type: "road" | "sea-route" = landAllowed
            ? "road"
            : "sea-route";
          const weight = landAllowed
            ? Math.max(1, d * 1.04)
            : Math.max(1, d * SEA_EDGE_MULTIPLIER + SEA_EDGE_OFFSET);

          if (!bestBridge || weight < bestBridge.baseWeight) {
            const key = edgeKey(a, b);
            bestBridge = {
              a,
              b,
              type,
              baseWeight: weight,
              tie: pairTieBreaker(a, b),
              key,
              cachedVersion: -1,
              cachedCost: Number.POSITIVE_INFINITY,
              cachedRoute: null,
              queuePriority: weight,
            };
          }
        }
      }
    }

    if (!bestBridge) {
      break;
    }

    byKey.set(bestBridge.key, bestBridge);
    unionFind.union(bestBridge.a, bestBridge.b);
  }

  return [...byKey.values()];
}

function findLandRoute({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  biome,
  elevation,
  mountainField,
  riverStrength,
  roadUsage,
  roadDirX,
  roadDirY,
  settlementCellSet,
  junctionBlockMask,
  startCell,
  endCell,
}: {
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
  biome?: ArrayLike<number>;
  elevation?: ArrayLike<number>;
  mountainField?: ArrayLike<number>;
  riverStrength?: ArrayLike<number>;
  roadUsage: Uint16Array;
  roadDirX: Float32Array;
  roadDirY: Float32Array;
  settlementCellSet: Set<number>;
  junctionBlockMask: Uint8Array;
  startCell: number;
  endCell: number;
}): RouteResult | null {
  if (
    !isWalkableLand(startCell, isLand, lakeIdByCell) ||
    !isWalkableLand(endCell, isLand, lakeIdByCell)
  ) {
    return null;
  }

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);
  const heap = new MinHeap();

  gScore[startCell] = 0;
  heap.push(startCell, heuristic(startCell, endCell, width));

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }

    const current = node.index;
    if (current === endCell) {
      return {
        cells: reconstructPath(cameFrom, endCell),
        cost: gScore[endCell],
      };
    }

    if (
      node.priority >
      gScore[current] + heuristic(current, endCell, width) + 1e-9
    ) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
      const next = ny * width + nx;
      if (!isWalkableLand(next, isLand, lakeIdByCell)) {
        return;
      }
      const isEndpoint = next === startCell || next === endCell;
      if (!isEndpoint && settlementCellSet.has(next)) {
        return;
      }
      const nextOnRoad = roadUsage[next] > 0;
      if (!isEndpoint && nextOnRoad && junctionBlockMask[next] > 0) {
        return;
      }

      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const distanceCost = diagonal ? Math.SQRT2 : 1;

      let stepCost =
        (getBiomeRoadTravelCostById(Number(biome?.[next] ?? 0)) ?? 1.2) *
        distanceCost;
      stepCost += Number(elevation?.[next] ?? 0) * LAND_ELEVATION_SCALE;
      stepCost += Number(mountainField?.[next] ?? 0) * LAND_MOUNTAIN_SCALE;

      const river = Math.max(
        Number(riverStrength?.[current] ?? 0),
        Number(riverStrength?.[next] ?? 0),
      );
      if (river > LAND_RIVER_THRESHOLD) {
        stepCost +=
          LAND_RIVER_PENALTY_BASE +
          clamp(river, 0, 4) * LAND_RIVER_PENALTY_SCALE;
      }

      if (nextOnRoad) {
        stepCost *= LAND_REUSE_MULTIPLIER;
      } else if (isNearUsedCell(next, width, height, roadUsage)) {
        stepCost *= LAND_NEAR_REUSE_MULTIPLIER;
      }

      const enteringRoad = !isEndpoint && roadUsage[current] === 0 && nextOnRoad;
      if (enteringRoad) {
        const localDirX = Number(roadDirX[next] ?? 0);
        const localDirY = Number(roadDirY[next] ?? 0);
        const localMag = Math.hypot(localDirX, localDirY);
        if (localMag >= JUNCTION_ALIGNMENT_MIN_MAG) {
          const moveDirX = ox / distanceCost;
          const moveDirY = oy / distanceCost;
          const alignment = Math.abs(
            (moveDirX * localDirX + moveDirY * localDirY) / localMag,
          );
          stepCost += alignment * JUNCTION_ALIGNMENT_PENALTY;
        }
      }

      if (!Number.isFinite(stepCost) || stepCost <= 0) {
        return;
      }

      const tentative = gScore[current] + stepCost;
      if (tentative + 1e-9 >= gScore[next]) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      heap.push(next, tentative + heuristic(next, endCell, width));
    });
  }

  return null;
}

function findSeaRoute({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  seaRouteUsage,
  startCell,
  endCell,
}: {
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
  seaRouteUsage: Uint16Array;
  startCell: number;
  endCell: number;
}): RouteResult | null {
  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);
  const heap = new MinHeap();

  gScore[startCell] = 0;
  heap.push(startCell, heuristic(startCell, endCell, width));

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }

    const current = node.index;
    if (current === endCell) {
      return {
        cells: reconstructPath(cameFrom, endCell),
        cost: gScore[endCell],
      };
    }

    if (
      node.priority >
      gScore[current] + heuristic(current, endCell, width) + 1e-9
    ) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
      const next = ny * width + nx;
      const endpoint = next === startCell || next === endCell;
      if (!endpoint && !isSeaCell(next, isLand, lakeIdByCell)) {
        return;
      }
      if (seaRouteUsage[next] > 0 && !endpoint) {
        return;
      }

      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const distanceCost = diagonal ? Math.SQRT2 : 1;
      let stepCost = endpoint ? 0.8 * distanceCost : SEA_STEP_COST * distanceCost;

      if (seaRouteUsage[next] > 0) {
        stepCost *= SEA_REUSE_MULTIPLIER;
      }

      const tentative = gScore[current] + stepCost;
      if (tentative + 1e-9 >= gScore[next]) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      heap.push(next, tentative + heuristic(next, endCell, width));
    });
  }

  return null;
}

function normalizeSettlements(
  settlements: SettlementLike[],
  size: number,
): SettlementLike[] {
  const normalized = settlements
    .map((settlement, index) => {
      const cell = Number(settlement?.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell >= size) {
        return null;
      }
      const id = Number.isInteger(settlement?.id)
        ? Number(settlement.id)
        : index;
      return {
        ...settlement,
        id,
        cell,
      } as SettlementLike;
    })
    .filter((settlement): settlement is SettlementLike => Boolean(settlement));

  normalized.sort((a, b) => a.id - b.id);
  return reindexSettlements(normalized);
}

function reindexSettlements(settlements: SettlementLike[]): SettlementLike[] {
  return settlements.map((settlement, index) => ({
    ...settlement,
    id: index,
  }));
}

function annotateSettlementAccess({
  settlements,
  width,
  height,
  size,
  isLand,
  coastMask,
  lakeIdByCell,
  landmassIdByCell,
  waterRegionIdByCell,
}: {
  settlements: SettlementLike[];
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  coastMask?: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
  landmassIdByCell: Int32Array;
  waterRegionIdByCell: Int32Array;
}): SettAccess[] {
  return settlements.map((settlement, index) => {
    const cell = Number(settlement.cell);
    const landmassId =
      Number.isInteger(cell) && cell >= 0 && cell < size
        ? Number(landmassIdByCell[cell] ?? -1)
        : -1;
    const waterRegionId = findAdjacentWaterRegion({
      cell,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      waterRegionIdByCell,
    });
    const coastal =
      settlement.coastal === true ||
      Boolean(
        Number.isInteger(cell) &&
          cell >= 0 &&
          cell < size &&
          Number(coastMask?.[cell] ?? 0) > 0,
      );

    return {
      settlement,
      index,
      landmassId,
      waterRegionId,
      coastal: coastal && waterRegionId >= 0,
    };
  });
}

function largestPotentialComponentIndices(access: SettAccess[]): Set<number> {
  const count = access.length;
  if (count <= 1) {
    return new Set(access.map((entry) => entry.index));
  }

  const adjacency: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i += 1) {
    const a = access[i];
    for (let j = i + 1; j < count; j += 1) {
      const b = access[j];
      const landLinked =
        a.landmassId >= 0 && a.landmassId === b.landmassId;
      const seaLinked =
        a.coastal &&
        b.coastal &&
        a.waterRegionId >= 0 &&
        a.waterRegionId === b.waterRegionId;

      if (!landLinked && !seaLinked) {
        continue;
      }

      adjacency[i].push(j);
      adjacency[j].push(i);
    }
  }

  const visited = new Uint8Array(count);
  let best: number[] = [];

  for (let start = 0; start < count; start += 1) {
    if (visited[start]) {
      continue;
    }

    const stack = [start];
    const component: number[] = [];
    visited[start] = 1;

    while (stack.length > 0) {
      const current = Number(stack.pop());
      component.push(current);
      for (const next of adjacency[current]) {
        if (visited[next]) {
          continue;
        }
        visited[next] = 1;
        stack.push(next);
      }
    }

    if (
      component.length > best.length ||
      (component.length === best.length &&
        component[0] < (best[0] ?? Number.POSITIVE_INFINITY))
    ) {
      best = component;
    }
  }

  return new Set(best.map((entry) => access[entry].index));
}

function buildLandmassIdByCell({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
}: {
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
}): Int32Array {
  const ids = new Int32Array(size);
  ids.fill(-1);

  let nextId = 0;
  const queue: number[] = [];

  for (let start = 0; start < size; start += 1) {
    if (!isWalkableLand(start, isLand, lakeIdByCell) || ids[start] >= 0) {
      continue;
    }

    ids[start] = nextId;
    queue.length = 0;
    queue.push(start);

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const [x, y] = coordsOf(current, width);
      forEachNeighbor(width, height, x, y, false, (nx, ny) => {
        const next = ny * width + nx;
        if (!isWalkableLand(next, isLand, lakeIdByCell) || ids[next] >= 0) {
          return;
        }
        ids[next] = nextId;
        queue.push(next);
      });
    }

    nextId += 1;
  }

  return ids;
}

function buildWaterRegionIdByCell({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
}: {
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
}): Int32Array {
  const ids = new Int32Array(size);
  ids.fill(-1);

  let nextId = 0;
  const queue: number[] = [];

  for (let start = 0; start < size; start += 1) {
    if (!isSeaCell(start, isLand, lakeIdByCell) || ids[start] >= 0) {
      continue;
    }

    ids[start] = nextId;
    queue.length = 0;
    queue.push(start);

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const [x, y] = coordsOf(current, width);
      forEachNeighbor(width, height, x, y, false, (nx, ny) => {
        const next = ny * width + nx;
        if (!isSeaCell(next, isLand, lakeIdByCell) || ids[next] >= 0) {
          return;
        }
        ids[next] = nextId;
        queue.push(next);
      });
    }

    nextId += 1;
  }

  return ids;
}

function findAdjacentWaterRegion({
  cell,
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  waterRegionIdByCell,
}: {
  cell: number;
  width: number;
  height: number;
  size: number;
  isLand: ArrayLike<number>;
  lakeIdByCell?: ArrayLike<number>;
  waterRegionIdByCell: Int32Array;
}): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= size) {
    return -1;
  }

  const [x, y] = coordsOf(cell, width);
  let best = -1;
  forEachNeighbor(width, height, x, y, true, (nx, ny) => {
    const next = ny * width + nx;
    if (!isSeaCell(next, isLand, lakeIdByCell)) {
      return;
    }

    const region = Number(waterRegionIdByCell[next] ?? -1);
    if (region >= 0 && (best < 0 || region < best)) {
      best = region;
    }
  });

  return best;
}

function isWalkableLand(
  cell: number,
  isLand: ArrayLike<number>,
  lakeIdByCell?: ArrayLike<number>,
): boolean {
  if (Number(isLand[cell] ?? 0) !== 1) {
    return false;
  }
  return Number(lakeIdByCell?.[cell] ?? -1) < 0;
}

function isSeaCell(
  cell: number,
  isLand: ArrayLike<number>,
  lakeIdByCell?: ArrayLike<number>,
): boolean {
  if (Number(isLand[cell] ?? 0) === 1) {
    return false;
  }
  return Number(lakeIdByCell?.[cell] ?? -1) < 0;
}

function isNearUsedCell(
  cell: number,
  width: number,
  height: number,
  usage: Uint16Array,
): boolean {
  const [x, y] = coordsOf(cell, width);
  let found = false;

  forEachNeighbor(width, height, x, y, true, (nx, ny) => {
    if (found) {
      return;
    }
    const next = ny * width + nx;
    if (usage[next] > 0) {
      found = true;
    }
  });

  return found;
}

function buildRadiusMask({
  width,
  height,
  size,
  sourceCells,
  radius,
}: {
  width: number;
  height: number;
  size: number;
  sourceCells: number[];
  radius: number;
}): Uint8Array {
  const mask = new Uint8Array(size);
  if (radius <= 0) {
    return mask;
  }

  const radiusSq = radius * radius;
  for (const source of sourceCells) {
    if (!Number.isInteger(source) || source < 0 || source >= size) {
      continue;
    }
    const [sx, sy] = coordsOf(source, width);
    const minX = Math.max(0, Math.floor(sx - radius));
    const maxX = Math.min(width - 1, Math.ceil(sx + radius));
    const minY = Math.max(0, Math.floor(sy - radius));
    const maxY = Math.min(height - 1, Math.ceil(sy + radius));

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

function accumulateRoadDirection(
  roadDirX: Float32Array,
  roadDirY: Float32Array,
  cells: number[],
  width: number,
): void {
  if (cells.length < 2) {
    return;
  }

  for (let i = 1; i < cells.length; i += 1) {
    const from = cells[i - 1];
    const to = cells[i];
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < 0 ||
      from >= roadDirX.length ||
      to >= roadDirX.length
    ) {
      continue;
    }

    const [fx, fy] = coordsOf(from, width);
    const [tx, ty] = coordsOf(to, width);
    const dx = tx - fx;
    const dy = ty - fy;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude <= 0) {
      continue;
    }
    const unitX = dx / magnitude;
    const unitY = dy / magnitude;

    roadDirX[from] += unitX;
    roadDirY[from] += unitY;
    roadDirX[to] += unitX;
    roadDirY[to] += unitY;
  }
}

function reconstructPath(cameFrom: Int32Array, end: number): number[] {
  const path = [end];
  let current = end;
  while (cameFrom[current] >= 0) {
    current = cameFrom[current];
    path.push(current);
  }
  path.reverse();
  return dedupeConsecutive(path);
}

function dedupeConsecutive(cells: number[]): number[] {
  if (cells.length <= 1) {
    return cells;
  }

  const deduped = [cells[0]];
  for (let i = 1; i < cells.length; i += 1) {
    if (cells[i] !== cells[i - 1]) {
      deduped.push(cells[i]);
    }
  }

  return deduped;
}

function incrementRoadUsage(roadUsage: Uint16Array, cells: number[]): void {
  for (const cell of cells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= roadUsage.length) {
      continue;
    }
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, MAX_ROAD_USAGE);
  }
}

function pruneToLargestBuiltComponent(
  world: WorldLike,
  roads: RoadsOutput["roads"],
): void {
  const settlements = Array.isArray(world.settlements)
    ? (world.settlements as SettlementLike[])
    : [];
  if (settlements.length <= 1) {
    return;
  }

  const components = collectRoadComponents(settlements.length, roads);
  if (components.length <= 1) {
    return;
  }

  const largest = components[0];
  const oldToNewId = new Map<number, number>();

  const filteredSettlements = settlements
    .filter((settlement) => largest.indices.has(settlement.id))
    .sort((a, b) => a.id - b.id)
    .map((settlement, index) => {
      oldToNewId.set(settlement.id, index);
      return {
        ...settlement,
        id: index,
      };
    });

  const filteredRoads: RoadsOutput["roads"] = [];
  for (const road of roads) {
    const from = oldToNewId.get(road.fromSettlementId);
    const to = oldToNewId.get(road.settlementId);
    if (from == null || to == null) {
      continue;
    }
    filteredRoads.push({
      ...road,
      id: filteredRoads.length,
      fromSettlementId: from,
      settlementId: to,
    });
  }

  roads.length = 0;
  roads.push(...filteredRoads);
  world.settlements = filteredSettlements;
}

function collectRoadComponents(
  settlementCount: number,
  roads: RoadsOutput["roads"],
): Array<{ root: number; indices: Set<number> }> {
  const unionFind = new UnionFind(settlementCount);
  for (const road of roads) {
    unionFind.union(road.fromSettlementId, road.settlementId);
  }

  const byRoot = new Map<number, Set<number>>();
  for (let index = 0; index < settlementCount; index += 1) {
    const root = unionFind.find(index);
    if (!byRoot.has(root)) {
      byRoot.set(root, new Set());
    }
    byRoot.get(root)?.add(index);
  }

  return [...byRoot.entries()]
    .map(([root, indices]) => ({ root, indices }))
    .sort((a, b) => b.indices.size - a.indices.size || a.root - b.root);
}

function countSettlementComponents(
  settlementCount: number,
  roads: RoadsOutput["roads"],
): number {
  if (settlementCount <= 0) {
    return 0;
  }

  const unionFind = new UnionFind(settlementCount);
  for (const road of roads) {
    unionFind.union(road.fromSettlementId, road.settlementId);
  }

  return countRoots(unionFind, settlementCount);
}

function countRoots(unionFind: UnionFind, count: number): number {
  const roots = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    roots.add(unionFind.find(i));
  }
  return roots.size;
}

function collectUnionGroups(
  unionFind: UnionFind,
  nodeCount: number,
): Array<{ root: number; indices: number[] }> {
  const byRoot = new Map<number, number[]>();

  for (let index = 0; index < nodeCount; index += 1) {
    const root = unionFind.find(index);
    if (!byRoot.has(root)) {
      byRoot.set(root, []);
    }
    byRoot.get(root)?.push(index);
  }

  return [...byRoot.entries()]
    .map(([root, indices]) => ({ root, indices }))
    .sort((a, b) => b.indices.length - a.indices.length || a.root - b.root);
}

function buildNetworkShortestCostMatrix(
  nodeCount: number,
  roads: RoadsOutput["roads"],
): number[][] {
  const adjacency = Array.from(
    { length: nodeCount },
    () => [] as Array<{ to: number; cost: number }>,
  );

  for (const road of roads) {
    const a = Number(road?.fromSettlementId);
    const b = Number(road?.settlementId);
    const cost = Number(road?.cost);
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= nodeCount ||
      b >= nodeCount ||
      !Number.isFinite(cost) ||
      cost <= 0
    ) {
      continue;
    }

    adjacency[a].push({ to: b, cost });
    adjacency[b].push({ to: a, cost });
  }

  const matrix: number[][] = Array.from({ length: nodeCount }, () =>
    Array.from({ length: nodeCount }, () => Number.POSITIVE_INFINITY),
  );

  for (let start = 0; start < nodeCount; start += 1) {
    const dist = new Float64Array(nodeCount);
    dist.fill(Number.POSITIVE_INFINITY);
    dist[start] = 0;
    const heap = new MinHeap();
    heap.push(start, 0);

    while (heap.size > 0) {
      const currentNode = heap.pop();
      if (!currentNode) {
        break;
      }
      const current = currentNode.index;
      if (currentNode.priority > dist[current] + 1e-9) {
        continue;
      }

      for (const edge of adjacency[current]) {
        const next = edge.to;
        const nextCost = dist[current] + edge.cost;
        if (nextCost + 1e-9 >= dist[next]) {
          continue;
        }
        dist[next] = nextCost;
        heap.push(next, nextCost);
      }
    }

    const row = matrix[start];
    for (let node = 0; node < nodeCount; node += 1) {
      row[node] = Number(dist[node]);
    }
  }

  return matrix;
}

function updateShortestCostMatrixWithEdge(
  matrix: number[][],
  a: number,
  b: number,
  edgeCost: number,
): void {
  if (
    !Number.isFinite(edgeCost) ||
    edgeCost <= 0 ||
    a < 0 ||
    b < 0 ||
    a >= matrix.length ||
    b >= matrix.length
  ) {
    return;
  }

  const nodeCount = matrix.length;
  for (let i = 0; i < nodeCount; i += 1) {
    const distIA = matrix[i][a];
    const distIB = matrix[i][b];
    if (!Number.isFinite(distIA) && !Number.isFinite(distIB)) {
      continue;
    }

    for (let j = 0; j < nodeCount; j += 1) {
      const current = matrix[i][j];
      const viaAB = distIA + edgeCost + matrix[b][j];
      const viaBA = distIB + edgeCost + matrix[a][j];
      const next = Math.min(current, viaAB, viaBA);
      if (next + 1e-9 < current) {
        matrix[i][j] = next;
      }
    }
  }
}

function heuristic(from: number, to: number, width: number): number {
  const [x0, y0] = coordsOf(from, width);
  const [x1, y1] = coordsOf(to, width);
  return Math.hypot(x1 - x0, y1 - y0);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function pairTieBreaker(a: number, b: number): number {
  const seed = (a + 1) * 73856093 + (b + 1) * 19349663;
  const normalized = Math.abs(seed % 1000000) / 1000000;
  return normalized * 0.0001;
}

class UnionFind {
  parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i += 1) {
      this.parent[i] = i;
    }
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    while (this.parent[index] !== index) {
      const parent = this.parent[index];
      this.parent[index] = root;
      index = parent;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return;
    }
    this.parent[rootB] = rootA;
  }
}

class MinHeap {
  values: Array<{ index: number; priority: number }>;

  constructor() {
    this.values = [];
  }

  get size(): number {
    return this.values.length;
  }

  push(index: number, priority: number): void {
    const node = { index, priority };
    this.values.push(node);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): { index: number; priority: number } | null {
    if (this.values.length === 0) {
      return null;
    }

    const top = this.values[0];
    const end = this.values.pop();
    if (this.values.length > 0 && end) {
      this.values[0] = end;
      this.bubbleDown(0);
    }

    return top;
  }

  bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.values[parent].priority <= this.values[i].priority) {
        break;
      }
      [this.values[parent], this.values[i]] = [
        this.values[i],
        this.values[parent],
      ];
      i = parent;
    }
  }

  bubbleDown(index: number): void {
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
