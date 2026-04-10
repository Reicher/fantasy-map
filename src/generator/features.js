import { createRng } from "../random.js";
import { clamp, coordsOf, distance } from "../utils.js";
import { describeNode } from "../nodeModel.js";

const DEFAULT_NODE_WEIGHT = 50;

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
  const signpostNodes = buildDedicatedSignpostNodes(world, settlementNodes);
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

  const signpostWeight = getWeight01(
    world.params?.nodeSignpostWeight,
    DEFAULT_NODE_WEIGHT,
  );
  if (signpostWeight <= 0.01) {
    return [];
  }
  const minSettlementClearance = lerp(5.5, 4.5, signpostWeight);

  const candidates = [];

  for (const node of network.nodes) {
    if (node?.type !== "junction" || node.cell == null || node.cell < 0) {
      continue;
    }

    const adjacency = network.adjacencyByNodeId.get(node.id) ?? [];
    const degree = adjacency.length;
    if (degree < 3) {
      continue;
    }

    const shape = classifyJunctionShape(node, adjacency, network.nodes);
    if (shape === "y") {
      continue;
    }
    const nearestSettlementDistance = getNearestNodeDistance(
      node,
      settlementNodes,
    );
    if (nearestSettlementDistance < minSettlementClearance) {
      continue;
    }

    let totalEdgeLength = 0;
    for (const edge of adjacency) {
      totalEdgeLength += getEdgeLength(network.links, edge.linkId);
    }
    const meanEdgeLength = totalEdgeLength / Math.max(1, adjacency.length);

    const shapeScore =
      shape === "cross"
        ? 1
        : shape === "t"
          ? 0.84
          : shape === "multi"
            ? 0.66
            : 0.32;
    const spacingScore = clamp((nearestSettlementDistance - 3) / 9, 0, 1);
    const spanScore = clamp((meanEdgeLength - 3) / 18, 0, 1);
    const score =
      degree * 0.5 + shapeScore * 1.25 + spacingScore * 0.75 + spanScore * 0.42;

    candidates.push({
      id: node.id,
      x: node.x,
      y: node.y,
      node,
      degree,
      shape,
      score,
    });
  }

  if (!candidates.length) {
    return [];
  }

  candidates.sort((a, b) => b.score - a.score);

  const target = clamp(
    Math.round(settlementNodes.length * lerp(0.08, 0.7, signpostWeight)),
    signpostWeight >= 0.12 ? 1 : 0,
    candidates.length,
  );
  if (target <= 0) {
    return [];
  }

  const selected = chooseSpreadCandidates(candidates, {
    target,
    seedKey: `${world.params.seed}::node-signpost-select`,
    anchorPoints: settlementNodes,
    desiredSpacing: lerp(13.5, 8.2, signpostWeight),
    scoreCandidate(candidate, context) {
      const anchorClearZone = lerp(8.5, 7.0, signpostWeight);
      const anchorPenalty =
        clamp(
          (anchorClearZone - context.nearestAnchorDistance) / anchorClearZone,
          0,
          1,
        ) * 2.8;
      return (
        candidate.score +
        context.spreadScore * 1.06 -
        context.crowdingPenalty * 1.2 -
        anchorPenalty
      );
    },
  });

  const baseId = settlementNodes.length;
  return selected.map((entry, index) => {
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
      score: clamp(entry.score / 8, 0, 1),
      coastal: false,
      river: false,
    };
  });
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

  // Settlements/signposts don't exist yet so pass empty arrays; spacing
  // quality is slightly lower but cell selection is fully correct.
  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const candidates = mergeCrashCandidates(
    collectGenericCrashCandidates(world, roads, [], [], roadCellAdjacency),
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
    anchorPoints: [],
    desiredSpacing: lerp(11.6, 7.6, crashWeight),
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

  const descriptor = describeNode({ marker: "abandoned", roadDegree: 2 });
  const baseId = settlementNodes.length + signpostNodes.length;
  return crashNodes.map((node, index) => {
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

  for (const road of roads) {
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      addCellNeighbor(adjacency, cells[i - 1], cells[i]);
      addCellNeighbor(adjacency, cells[i], cells[i - 1]);
    }
  }

  return adjacency;
}

function addCellNeighbor(adjacency, fromCell, toCell) {
  let neighbors = adjacency.get(fromCell);
  if (!neighbors) {
    neighbors = new Set();
    adjacency.set(fromCell, neighbors);
  }
  neighbors.add(toCell);
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

function getNearestNodeDistance(node, nodes) {
  let best = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const d = distance(node.x, node.y, node.x, node.y);
    if (d < best) {
      best = d;
    }
  }
  return best;
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
) {
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
      if (degree <= 0) {
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
      const degreeScore =
        degree === 2 ? 1 : degree === 3 ? 0.45 : degree >= 4 ? 0.22 : 0.18;
      const endpointPenalty = isEndpoint ? 0.82 : 0;
      const score =
        interiorScore * 1.2 +
        degreeScore * 0.88 +
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

function getEdgeLength(links, linkId) {
  const link = links[linkId];
  return Math.max(1, Number(link?.length ?? 1));
}

function getWeight01(value, fallback = DEFAULT_NODE_WEIGHT) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return clamp(safe / 100, 0, 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
