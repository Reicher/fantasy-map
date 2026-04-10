import { createRng } from "../random.js";
import { clamp, coordsOf, distance } from "../utils.js";
import { describeNode } from "../node/model.js";

const DEFAULT_NODE_WEIGHT = 50;
const DEFAULT_NODE_MIN_DISTANCE = 5;
const MAX_NODE_MIN_DISTANCE = 14;
const MIN_SIGNPOST_DEGREE = 3;
const MIN_CRASH_SETTLEMENT_CLEARANCE = 6.2;
const MIN_CRASH_SIGNPOST_CLEARANCE = 5.1;

export function buildFeatureCatalog(world, names) {
  const nodeName =
    typeof names?.nodeName === "function"
      ? (kind, key) => names.nodeName(kind, key)
      : (_kind, key) => key;
  const roadDegreeBySettlementId = buildRoadDegreeBySettlementId(
    world.network,
    world.settlements.length,
  );
  const settlementNodes = buildSettlementNodes(
    world,
    nodeName,
    roadDegreeBySettlementId,
  );
  const signpostNodes = ensureIntersectionCoverage(
    world,
    settlementNodes,
    buildDedicatedSignpostNodes(world, settlementNodes),
  );
  const crashSiteNodes = buildDedicatedCrashSiteNodes(
    world,
    nodeName,
    settlementNodes,
    signpostNodes,
  );
  const nodes = [
    ...settlementNodes,
    ...signpostNodes,
    ...crashSiteNodes,
  ];

  return {
    nodes,
    lakes: world.hydrology.lakes.map((lake) => ({ ...lake })),
    rivers: world.hydrology.rivers.map((river) => ({ ...river })),
    biomeRegions: world.regions.biomeRegions.map((region) => ({ ...region })),
    mountainRegions: world.regions.mountainRegions.map((region) => ({
      ...region,
    })),
    roads: world.roads.roads.map((road) => ({ ...road })),
    indices: {
      lakeIdByCell: world.hydrology.lakeIdByCell,
      biomeRegionId: world.regions.biomeRegionId,
      mountainRegionId: world.regions.mountainRegionId,
    },
  };
}

function buildSettlementNodes(world, nodeName, roadDegreeBySettlementId) {
  const descriptor = describeNode({ marker: "settlement", roadDegree: 0 });

  return world.settlements.map((settlement) => {
    const roadDegree = roadDegreeBySettlementId[settlement.id] ?? 0;
    const name = String(settlement.name ?? "").trim()
      ? settlement.name
      : nodeName("settlement", `settlement-${settlement.id}`);
    const enriched = {
      ...settlement,
      name,
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree,
      subtitle: descriptor.subtitle,
      detail: descriptor.detail,
    };
    world.settlements[settlement.id] = enriched;
    return enriched;
  });
}

function buildDedicatedSignpostNodes(world, settlementNodes) {
  const network = world.network;
  if (
    !network?.nodes?.length ||
    !network?.adjacencyByNodeId ||
    !network?.links
  ) {
    return [];
  }

  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const junctions = [];
  for (const node of network.nodes) {
    if (node?.type !== "junction" || node.cell == null || node.cell < 0) {
      continue;
    }
    const networkDegree = (network.adjacencyByNodeId.get(node.id) ?? []).length;
    const degree = roadCellAdjacency.get(node.cell)?.size ?? networkDegree;
    if (degree < MIN_SIGNPOST_DEGREE) {
      continue;
    }
    junctions.push({ node, degree });
  }

  if (!junctions.length) {
    return [];
  }

  junctions.sort((a, b) => a.node.cell - b.node.cell);

  const baseId = settlementNodes.length;
  return junctions.map((entry, index) => {
    const nodeId = baseId + index;
    // Tag the network node so buildTravelGraph treats this junction as a stop.
    entry.node.nodeId = nodeId;
    const descriptor = describeNode({
      marker: "signpost",
      roadDegree: entry.degree,
    });
    return {
      id: nodeId,
      cell: entry.node.cell,
      x: entry.node.x,
      y: entry.node.y,
      name: "",
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree: entry.degree,
      subtitle: descriptor.subtitle,
      detail: descriptor.detail,
      score: clamp(entry.degree / 6, 0.35, 1),
      coastal: false,
      river: false,
    };
  });
}

function ensureIntersectionCoverage(world, settlementNodes, signpostNodes) {
  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  if (!roads.length) {
    return signpostNodes;
  }

  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const width = world.terrain?.width ?? 0;
  if (width <= 0 || !roadCellAdjacency.size) {
    return signpostNodes;
  }

  const coveredCells = new Set();
  for (const settlement of settlementNodes) {
    if (settlement?.cell != null) {
      coveredCells.add(settlement.cell);
    }
  }
  for (const signpost of signpostNodes) {
    if (signpost?.cell != null) {
      coveredCells.add(signpost.cell);
    }
  }

  const networkJunctionByCell = new Map();
  for (const node of world.network?.nodes ?? []) {
    if (node?.type === "junction" && node.cell != null && node.cell >= 0) {
      networkJunctionByCell.set(node.cell, node);
    }
  }

  let nextNodeId = settlementNodes.length + signpostNodes.length;
  const fallbackSignposts = [];
  const junctionCells = [...roadCellAdjacency.entries()]
    .filter(([, neighbors]) => neighbors.size >= MIN_SIGNPOST_DEGREE)
    .map(([cell]) => cell)
    .sort((a, b) => a - b);

  for (const cell of junctionCells) {
    if (coveredCells.has(cell)) {
      continue;
    }
    const roadDegree = roadCellAdjacency.get(cell)?.size ?? MIN_SIGNPOST_DEGREE;
    const descriptor = describeNode({
      marker: "signpost",
      roadDegree,
    });
    const networkJunction = networkJunctionByCell.get(cell) ?? null;
    const [x, y] =
      networkJunction != null
        ? [networkJunction.x, networkJunction.y]
        : coordsOf(cell, width);
    if (networkJunction && networkJunction.nodeId == null) {
      networkJunction.nodeId = nextNodeId;
    }
    fallbackSignposts.push({
      id: nextNodeId,
      cell,
      x,
      y,
      name: "",
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree,
      subtitle: descriptor.subtitle,
      detail: descriptor.detail,
      score: clamp(roadDegree / 6, 0.35, 1),
      coastal: false,
      river: false,
    });
    coveredCells.add(cell);
    nextNodeId += 1;
  }

  if (!fallbackSignposts.length) {
    return signpostNodes;
  }
  return [...signpostNodes, ...fallbackSignposts];
}

/**
 * Pre-compute which road cells should become crash-site nodes BEFORE the
 * network is built.  The world object only needs `roads`, `terrain`,
 * `climate`, and `params` at this point.
 */
export function preselectCrashSiteCells(world) {
  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  if (!roads.length) {
    return [];
  }

  const crashWeight = getWeight01(
    world.params?.nodeCrashSiteWeight,
    DEFAULT_NODE_WEIGHT,
  );
  if (crashWeight <= 0.01) {
    return [];
  }
  const crashSpacing = getCrashSpacingThresholds(world.params);

  const settlementAnchors = (world.settlements ?? []).map((settlement) => ({
    x: settlement.x,
    y: settlement.y,
  }));
  // Signposts do not exist yet at preselection time.
  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const candidates = mergeCrashCandidates(
    collectGenericCrashCandidates(
      world,
      roads,
      settlementAnchors,
      [],
      roadCellAdjacency,
      {
        minSettlementClearance: crashSpacing.settlementClearance,
        minSignpostClearance: crashSpacing.signpostClearance,
      },
    ),
  );

  if (!candidates.length) {
    return [];
  }

  candidates.sort((a, b) => b.score - a.score);
  const totalRoadCells = roads.reduce(
    (sum, road) => sum + Math.max(0, (road.cells?.length ?? 0) - 1),
    0,
  );
  const maxByRoadLength = clamp(Math.round(totalRoadCells / 120), 1, 42);
  const target = clamp(
    Math.round(
      Math.max(1, world.settlements?.length ?? 1) * lerp(0.05, 0.62, crashWeight),
    ),
    crashWeight >= 0.15 ? 1 : 0,
    Math.min(candidates.length, maxByRoadLength),
  );
  if (target <= 0) {
    return [];
  }

  const selected = chooseSpreadCandidates(candidates, {
    target,
    seedKey: `${world.params.seed}::node-crash-select`,
    anchorPoints: settlementAnchors,
    desiredSpacing: Math.max(
      lerp(11.6, 7.6, crashWeight),
      crashSpacing.crashClearance + 1.2,
    ),
    minSelectedDistance: crashSpacing.crashClearance,
    minAnchorDistance: crashSpacing.settlementClearance,
    initialStats: { endpointCount: 0 },
    scoreCandidate(candidate, context) {
      const endpointShare =
        context.stats.endpointCount / Math.max(1, context.target);
      const endpointPenalty = candidate.isEndpoint
        ? 1.2 + endpointShare * 1.4
        : 0;
      const corridorBoost = candidate.isCorridorCandidate ? 0.84 : 0;
      return (
        candidate.score +
        corridorBoost +
        context.spreadScore * 1.1 -
        context.crowdingPenalty * 1.28 -
        endpointPenalty
      );
    },
    onPick(candidate, stats) {
      if (candidate.isEndpoint) {
        stats.endpointCount += 1;
      }
    },
  });

  return selected.map((entry) => entry.cell);
}

function buildDedicatedCrashSiteNodes(
  world,
  nodeName,
  settlementNodes,
  signpostNodes,
) {
  const crashWeight = getWeight01(
    world.params?.nodeCrashSiteWeight,
    DEFAULT_NODE_WEIGHT,
  );
  if (crashWeight <= 0.01) {
    return [];
  }

  // Find abandoned-site nodes that were pre-injected into the network.
  const crashNodes =
    world.network?.nodes?.filter((node) => node?.type === "abandoned") ?? [];
  if (!crashNodes.length) {
    return [];
  }
  const crashSpacing = getCrashSpacingThresholds(world.params);

  const eligibleCrashNodes = crashNodes.filter((node) => {
    const settlementClearance = getNearestPointDistance(
      node.x,
      node.y,
      settlementNodes,
    );
    if (settlementClearance < crashSpacing.settlementClearance) {
      return false;
    }
    const signpostClearance = getNearestPointDistance(
      node.x,
      node.y,
      signpostNodes,
    );
    if (signpostClearance < crashSpacing.signpostClearance) {
      return false;
    }
    return true;
  });
  if (!eligibleCrashNodes.length) {
    return [];
  }
  const spacedCrashNodes = [];
  const sortedCrashNodes = [...eligibleCrashNodes].sort((a, b) => a.cell - b.cell);
  for (const node of sortedCrashNodes) {
    const nearestCrashClearance = getNearestPointDistance(
      node.x,
      node.y,
      spacedCrashNodes,
    );
    if (nearestCrashClearance < crashSpacing.crashClearance) {
      continue;
    }
    spacedCrashNodes.push(node);
  }
  if (!spacedCrashNodes.length) {
    return [];
  }

  const descriptor = describeNode({ marker: "abandoned", roadDegree: 2 });
  const baseId = settlementNodes.length + signpostNodes.length;
  return spacedCrashNodes.map((node, index) => {
    const nodeId = baseId + index;
    // Tag the node so buildTravelGraph treats it as a stop.
    node.nodeId = nodeId;
    return {
      id: nodeId,
      cell: node.cell,
      x: node.x,
      y: node.y,
      name: nodeName("abandoned", `abandoned-${node.cell}-${index}`),
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree: 2,
      subtitle: descriptor.subtitle,
      detail: descriptor.detail,
      score: 0.5,
      coastal: false,
      river: false,
    };
  });
}

function chooseSpreadCandidates(candidates, options = {}) {
  const {
    target = 0,
    seedKey = "node-spread",
    anchorPoints = [],
    desiredSpacing = 10,
    minSelectedDistance = 0,
    minAnchorDistance = 0,
    initialStats = {},
    scoreCandidate = (candidate) => Number(candidate?.score ?? 0),
    onPick = null,
  } = options;

  if (target <= 0 || !candidates.length) {
    return [];
  }

  const rng = createRng(seedKey);
  const selected = [];
  const selectedIds = new Set();
  const stats = { ...initialStats };
  const spacingTarget = Math.max(1.5, Number(desiredSpacing) || 10);

  while (selected.length < target) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (selectedIds.has(candidate.id)) {
        continue;
      }

      const nearestSelectedDistance = getNearestPointDistance(
        candidate.x,
        candidate.y,
        selected,
      );
      const nearestAnchorDistance = getNearestPointDistance(
        candidate.x,
        candidate.y,
        anchorPoints,
      );
      if (nearestSelectedDistance < minSelectedDistance) {
        continue;
      }
      if (nearestAnchorDistance < minAnchorDistance) {
        continue;
      }
      const nearestDistance = Math.min(
        nearestSelectedDistance,
        nearestAnchorDistance,
      );
      const spreadScore = clamp(nearestDistance / spacingTarget, 0, 1);
      const crowdingPenalty = clamp(
        (spacingTarget - nearestDistance) / spacingTarget,
        0,
        1,
      );
      const effectiveScore =
        scoreCandidate(candidate, {
          target,
          selected,
          stats,
          nearestDistance,
          nearestSelectedDistance,
          nearestAnchorDistance,
          spreadScore,
          crowdingPenalty,
        }) + rng.range(-0.05, 0.05);

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        best = candidate;
      }
    }

    if (!best) {
      break;
    }

    selected.push(best);
    selectedIds.add(best.id);
    if (typeof onPick === "function") {
      onPick(best, stats);
    }
  }

  return selected;
}

function buildRoadDegreeBySettlementId(network, settlementCount) {
  const degreeBySettlementId = new Array(settlementCount).fill(0);
  if (!network?.nodes?.length || !network?.adjacencyByNodeId) {
    return degreeBySettlementId;
  }

  for (const node of network.nodes) {
    if (node?.type !== "settlement" || node.settlementId == null || node.settlementId < 0) {
      continue;
    }
    degreeBySettlementId[node.settlementId] = (
      network.adjacencyByNodeId.get(node.id) ?? []
    ).length;
  }

  return degreeBySettlementId;
}

function buildRoadCellAdjacency(roads) {
  const adjacency = new Map();

  const addNeighbor = (fromCell, toCell) => {
    let neighbors = adjacency.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacency.set(fromCell, neighbors);
    }
    neighbors.add(toCell);
  };

  for (const road of roads) {
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      addNeighbor(cells[i - 1], cells[i]);
      addNeighbor(cells[i], cells[i - 1]);
    }
  }

  return adjacency;
}

function classifyJunctionShape(node, adjacency, nodes) {
  if (!adjacency?.length) {
    return "multi";
  }
  if (adjacency.length === 3) {
    const maxSep = getMaxPairSeparationDeg(node, adjacency, nodes);
    return maxSep >= 146 ? "t" : "y";
  }
  if (adjacency.length === 4) {
    let oppositePairs = 0;
    for (let i = 0; i < adjacency.length; i += 1) {
      for (let j = i + 1; j < adjacency.length; j += 1) {
        const a = nodes[adjacency[i].nodeId];
        const b = nodes[adjacency[j].nodeId];
        if (!a || !b) {
          continue;
        }
        const sep = getAngleSeparationDeg(node, a, b);
        if (sep >= 160) {
          oppositePairs += 1;
        }
      }
    }
    return oppositePairs >= 2 ? "cross" : "multi";
  }
  return adjacency.length > 4 ? "cross" : "multi";
}

function getMaxPairSeparationDeg(node, adjacency, nodes) {
  let maxSep = 0;
  for (let i = 0; i < adjacency.length; i += 1) {
    for (let j = i + 1; j < adjacency.length; j += 1) {
      const a = nodes[adjacency[i].nodeId];
      const b = nodes[adjacency[j].nodeId];
      if (!a || !b) {
        continue;
      }
      maxSep = Math.max(maxSep, getAngleSeparationDeg(node, a, b));
    }
  }
  return maxSep;
}

function getAngleSeparationDeg(origin, pointA, pointB) {
  const ax = pointA.x - origin.x;
  const ay = pointA.y - origin.y;
  const bx = pointB.x - origin.x;
  const by = pointB.y - origin.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA <= 1e-6 || lenB <= 1e-6) {
    return 0;
  }
  const dot = clamp((ax * bx + ay * by) / (lenA * lenB), -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

function getNearestPointDistance(x, y, points) {
  if (!points?.length) {
    return Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const d = distance(x, y, point.x, point.y);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

function collectGenericCrashCandidates(
  world,
  roads,
  settlementNodes,
  signpostNodes,
  roadCellAdjacency,
  { minSettlementClearance, minSignpostClearance } = {},
) {
  const effectiveSettlementClearance = Math.max(
    0,
    Number(minSettlementClearance) || MIN_CRASH_SETTLEMENT_CLEARANCE,
  );
  const effectiveSignpostClearance = Math.max(
    0,
    Number(minSignpostClearance) || MIN_CRASH_SIGNPOST_CLEARANCE,
  );
  const { width } = world.terrain;
  const seenCells = new Set();
  const candidates = [];
  const rng = createRng(`${world.params.seed}::node-crash-candidates`);

  for (const road of roads) {
    const cells = road.cells ?? [];
    if (cells.length < 4) {
      continue;
    }

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (seenCells.has(cell)) {
        continue;
      }
      seenCells.add(cell);

      const isEndpoint = index === 0 || index === cells.length - 1;
      const distanceToRoadEnd = Math.min(index, cells.length - 1 - index);
      if (!isEndpoint && distanceToRoadEnd < 2) {
        continue;
      }

      const degree = roadCellAdjacency.get(cell)?.size ?? 0;
      if (degree !== 2) {
        continue;
      }

      const [x, y] = coordsOf(cell, width);
      const nearestSettlementDistance = getNearestPointDistance(
        x,
        y,
        settlementNodes,
      );
      const nearestSignpostDistance = getNearestPointDistance(
        x,
        y,
        signpostNodes,
      );
      if (nearestSettlementDistance < effectiveSettlementClearance) {
        continue;
      }
      if (nearestSignpostDistance < effectiveSignpostClearance) {
        continue;
      }
      const elevation = world.terrain.elevation[cell] ?? 0;
      const mountainField = world.terrain.mountainField[cell] ?? 0;
      const moisture = world.climate.moisture[cell] ?? 0.5;
      const ruggedness = clamp(mountainField * 0.72 + elevation * 0.48, 0, 1);
      const dryness = clamp(1 - moisture, 0, 1);
      const settlementSpacingScore = clamp(
        (nearestSettlementDistance - 2.4) / 10.5,
        0,
        1,
      );
      const signpostSpacingScore = clamp(
        (nearestSignpostDistance - 1.8) / 8.5,
        0,
        1,
      );
      const interiorScore = clamp(
        distanceToRoadEnd / Math.max(2, Math.round(cells.length * 0.35)),
        0,
        1,
      );
      const endpointPenalty = isEndpoint ? 0.82 : 0;
      const score =
        interiorScore * 1.2 +
        0.88 +
        ruggedness * 0.46 +
        settlementSpacingScore * 0.48 +
        signpostSpacingScore * 0.38 +
        dryness * 0.26 -
        endpointPenalty +
        rng.range(-0.08, 0.08);
      if (score < 0.16) {
        continue;
      }

      candidates.push({
        id: cell,
        cell,
        x,
        y,
        degree,
        isEndpoint,
        isCorridorCandidate: false,
        score,
      });
    }
  }

  return candidates;
}

function mergeCrashCandidates(candidates) {
  const byCell = new Map();

  for (const candidate of candidates) {
    if (!candidate || candidate.cell == null) {
      continue;
    }
    const existing = byCell.get(candidate.cell);
    if (!existing || candidate.score > existing.score) {
      byCell.set(candidate.cell, candidate);
      continue;
    }
    if (candidate.isCorridorCandidate && !existing.isCorridorCandidate) {
      byCell.set(candidate.cell, {
        ...existing,
        isCorridorCandidate: true,
      });
    }
  }

  return [...byCell.values()];
}

function getWeight01(value, fallback = DEFAULT_NODE_WEIGHT) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return clamp(safe / 100, 0, 1);
}

function getCrashSpacingThresholds(params) {
  const nodeMinDistance = getEffectiveNodeMinDistance(params);
  return {
    settlementClearance: Math.max(MIN_CRASH_SETTLEMENT_CLEARANCE, nodeMinDistance),
    signpostClearance: Math.max(MIN_CRASH_SIGNPOST_CLEARANCE, nodeMinDistance),
    crashClearance: Math.max(MIN_CRASH_SIGNPOST_CLEARANCE, nodeMinDistance),
  };
}

function getEffectiveNodeMinDistance(params) {
  const numeric = Number(params?.nodeMinDistance);
  const safe = Number.isFinite(numeric) ? numeric : DEFAULT_NODE_MIN_DISTANCE;
  return clamp(safe, 2, MAX_NODE_MIN_DISTANCE);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
