import { clamp, coordsOf, distance, lerp } from "../utils.js";
import { describeNode } from "../node/model.js";

const DEFAULT_NODE_MIN_DISTANCE = 5;
const DEFAULT_SIGNPOST_FREQUENCY = 50;
const DEFAULT_ABANDONED_FREQUENCY = 50;

const MIN_SIGNPOST_DEGREE = 3;
const MAX_SETTLEMENT_SIGNPOST_SHARE = 0.32;
const MIN_SETTLEMENT_SIGNPOST_SHARE = 0.04;

const MIN_ABANDONED_ROAD_LENGTH = 22;
const MAX_ABANDONED_PER_ROAD = 6;
const ABANDONED_ENDPOINT_BUFFER = 4;

export function buildFeatureCatalog(world, names) {
  const nodeName =
    typeof names?.nodeName === "function"
      ? (kind, key) => names.nodeName(kind, key)
      : (_kind, key) => key;

  const signpostFrequency01 = getFrequency01(
    world.params?.signpostFrequency,
    DEFAULT_SIGNPOST_FREQUENCY,
  );

  const roadDegreeBySettlementId = buildRoadDegreeBySettlementId(
    world.network,
    world.settlements.length,
  );

  const settlementNodes = buildSettlementNodes(
    world,
    nodeName,
    roadDegreeBySettlementId,
  );
  promoteHubSettlementsToSignposts(
    world,
    settlementNodes,
    signpostFrequency01,
  );

  const signpostNodes = buildDedicatedSignpostNodes(
    world,
    settlementNodes,
  );

  const settlementAnchors = settlementNodes;
  const crashSiteNodes = buildDedicatedCrashSiteNodes(
    world,
    nodeName,
    settlementAnchors,
    signpostNodes,
  );

  const nodes = [...settlementNodes, ...signpostNodes, ...crashSiteNodes];

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

export function preselectCrashSiteCells(world) {
  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  if (!roads.length) {
    return [];
  }

  const abandonedFrequency01 = getFrequency01(
    world.params?.abandonedFrequency,
    DEFAULT_ABANDONED_FREQUENCY,
  );
  if (abandonedFrequency01 <= 0.001) {
    return [];
  }

  const nodeMinDistance = getEffectiveNodeMinDistance(world.params);
  const minSettlementClearance = Math.max(4.8, nodeMinDistance * 0.98);
  const minCrashSpacing = Math.max(4.8, nodeMinDistance * 0.96);

  const settlementAnchors = (world.settlements ?? []).map((settlement) => ({
    x: settlement.x,
    y: settlement.y,
  }));

  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const candidates = collectLongRoadCrashCandidates(
    world,
    roads,
    roadCellAdjacency,
    abandonedFrequency01,
    minSettlementClearance,
  );
  if (!candidates.length) {
    return [];
  }

  const selected = chooseSpreadCandidates(candidates, {
    target: candidates.length,
    minSelectedDistance: minCrashSpacing,
    minAnchorDistance: minSettlementClearance,
    anchorPoints: settlementAnchors,
    desiredSpacing: minCrashSpacing + 1.3,
  });

  return selected.map((entry) => entry.cell);
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

function promoteHubSettlementsToSignposts(
  world,
  settlementNodes,
  signpostFrequency01,
) {
  const candidates = settlementNodes.filter(
    (node) => node?.marker === "settlement" && (node.roadDegree ?? 0) >= MIN_SIGNPOST_DEGREE,
  );
  if (!candidates.length) {
    return;
  }

  const scoreValues = settlementNodes
    .map((node) => Number(node?.score ?? 0))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!scoreValues.length) {
    return;
  }

  const lowScoreThreshold = quantile(
    scoreValues,
    0.32 + signpostFrequency01 * 0.38,
  );

  const conversionBudget = clamp(
    Math.round(
      settlementNodes.length *
        (MIN_SETTLEMENT_SIGNPOST_SHARE +
          signpostFrequency01 * (MAX_SETTLEMENT_SIGNPOST_SHARE - MIN_SETTLEMENT_SIGNPOST_SHARE)),
    ),
    0,
    candidates.length,
  );
  if (conversionBudget <= 0) {
    return;
  }

  const spacing = Math.max(5.1, getEffectiveNodeMinDistance(world.params) * 1.02);

  const ranked = candidates
    .map((node) => {
      const hardship = getSettlementHardship(world, node.cell);
      const scorePenalty = Math.max(0, lowScoreThreshold - Number(node.score ?? 0));
      return {
        node,
        priority:
          ((node.roadDegree ?? 0) - 2) * 1.28 +
          scorePenalty * 2.0 +
          hardship * 0.85 +
          (!node.coastal && !node.river ? 0.2 : 0),
      };
    })
    .sort((a, b) => b.priority - a.priority);

  const converted = [];
  for (const entry of ranked) {
    if (converted.length >= conversionBudget) {
      break;
    }

    if (getNearestPointDistance(entry.node.x, entry.node.y, converted) < spacing) {
      continue;
    }

    const descriptor = describeNode({
      marker: "signpost",
      roadDegree: entry.node.roadDegree,
    });
    entry.node.marker = descriptor.marker;
    entry.node.kind = descriptor.kind;
    entry.node.subtitle = descriptor.subtitle;
    entry.node.detail = descriptor.detail;
    converted.push(entry.node);
  }
}

function buildDedicatedSignpostNodes(world, settlementNodes) {
  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  if (!roads.length) {
    return [];
  }

  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const settlementCellSet = new Set(
    settlementNodes.map((node) => node?.cell).filter((cell) => Number.isFinite(cell)),
  );
  const forcedCandidates = [];
  for (const [cell, neighbors] of roadCellAdjacency.entries()) {
    const degree = neighbors.size;
    // Structural rule: every real junction (degree >= 3) must become a node.
    if (degree < MIN_SIGNPOST_DEGREE || settlementCellSet.has(cell)) {
      continue;
    }

    const [x, y] = coordsOf(cell, world.terrain.width);
    forcedCandidates.push({
      id: cell,
      cell,
      x,
      y,
      degree,
      score: degree,
    });
  }

  if (!forcedCandidates.length) {
    return [];
  }

  const selected = forcedCandidates.sort((a, b) => a.cell - b.cell);

  const junctionByCell = new Map();
  for (const node of world.network?.nodes ?? []) {
    if (node?.type === "junction" && node.cell != null && node.cell >= 0) {
      junctionByCell.set(node.cell, node);
    }
  }

  const baseId = settlementNodes.length;
  return selected.map((entry, index) => {
    const nodeId = baseId + index;
    const networkJunction = junctionByCell.get(entry.cell);
    if (networkJunction && networkJunction.nodeId == null) {
      networkJunction.nodeId = nodeId;
    }

    const descriptor = describeNode({
      marker: "signpost",
      roadDegree: entry.degree,
    });
    return {
      id: nodeId,
      cell: entry.cell,
      x: entry.x,
      y: entry.y,
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

function buildDedicatedCrashSiteNodes(
  world,
  nodeName,
  settlementNodes,
  signpostNodes,
) {
  const crashNodes =
    world.network?.nodes?.filter((node) => node?.type === "abandoned") ?? [];
  if (!crashNodes.length) {
    return [];
  }

  const nodeMinDistance = getEffectiveNodeMinDistance(world.params);
  const settlementClearance = Math.max(4.8, nodeMinDistance * 0.98);
  const signpostClearance = Math.max(4.8, nodeMinDistance * 0.94);
  const crashClearance = Math.max(4.8, nodeMinDistance * 0.98);

  const eligible = crashNodes
    .filter((node) => {
      if (
        getNearestPointDistance(node.x, node.y, settlementNodes) < settlementClearance
      ) {
        return false;
      }
      if (getNearestPointDistance(node.x, node.y, signpostNodes) < signpostClearance) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.cell - b.cell);

  if (!eligible.length) {
    return [];
  }

  const spaced = [];
  for (const node of eligible) {
    if (getNearestPointDistance(node.x, node.y, spaced) < crashClearance) {
      continue;
    }
    spaced.push(node);
  }

  const descriptor = describeNode({ marker: "abandoned", roadDegree: 2 });
  const baseId = settlementNodes.length + signpostNodes.length;

  return spaced.map((node, index) => {
    const nodeId = baseId + index;
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

function collectLongRoadCrashCandidates(
  world,
  roads,
  roadCellAdjacency,
  abandonedFrequency01,
  minSettlementClearance,
) {
  const width = world.terrain.width;
  const settlementAnchors = (world.settlements ?? []).map((settlement) => ({
    x: settlement.x,
    y: settlement.y,
  }));

  const candidates = [];
  const occupiedCells = new Set();

  for (const road of roads) {
    const cells = road.cells ?? [];
    const longThreshold = Math.max(
      MIN_ABANDONED_ROAD_LENGTH,
      Math.round(lerp(78, 24, abandonedFrequency01)),
    );
    if (cells.length < longThreshold) {
      continue;
    }

    const count = getAbandonedCountForRoad(cells.length, abandonedFrequency01);
    if (count <= 0) {
      continue;
    }

    const start = ABANDONED_ENDPOINT_BUFFER;
    const end = Math.max(start, cells.length - 1 - ABANDONED_ENDPOINT_BUFFER);

    for (let i = 1; i <= count; i += 1) {
      const t = i / (count + 1);
      const desired = Math.round(start + (end - start) * t);
      const adjustedCell = findNearestStraightRoadCell(cells, desired, roadCellAdjacency, occupiedCells);
      if (adjustedCell == null) {
        continue;
      }

      const [x, y] = coordsOf(adjustedCell, width);
      if (getNearestPointDistance(x, y, settlementAnchors) < minSettlementClearance) {
        continue;
      }

      occupiedCells.add(adjustedCell);
      candidates.push({
        id: adjustedCell,
        cell: adjustedCell,
        x,
        y,
        score: cells.length + (1 - Math.abs(t - 0.5)) * 4,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return dedupeByCell(candidates);
}

function findNearestStraightRoadCell(cells, desiredIndex, roadCellAdjacency, occupiedCells) {
  const maxOffset = 4;
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    for (const direction of [-1, 1]) {
      const index =
        offset === 0 ? desiredIndex : desiredIndex + offset * direction;
      if (index <= 0 || index >= cells.length - 1) {
        continue;
      }
      const cell = cells[index];
      if (occupiedCells.has(cell)) {
        continue;
      }
      const degree = roadCellAdjacency.get(cell)?.size ?? 0;
      if (degree !== 2) {
        continue;
      }
      return cell;
    }
  }
  return null;
}

function getAbandonedCountForRoad(length, abandonedFrequency01) {
  const spacing = lerp(118, 28, abandonedFrequency01);
  const estimated = Math.max(0, Math.floor((length - 10) / spacing));
  return clamp(estimated, 1, MAX_ABANDONED_PER_ROAD);
}

function chooseSpreadCandidates(candidates, options = {}) {
  const {
    target = 0,
    minSelectedDistance = 0,
    minAnchorDistance = 0,
    anchorPoints = [],
    desiredSpacing = 10,
  } = options;

  if (target <= 0 || !candidates.length) {
    return [];
  }

  const spacingTarget = Math.max(1.5, Number(desiredSpacing) || 10);
  const selected = [];
  const selectedIds = new Set();

  while (selected.length < target) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidate || selectedIds.has(candidate.id)) {
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
        Number(candidate.score ?? 0) + spreadScore * 1.12 - crowdingPenalty * 1.24;

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
  }

  return selected;
}

function buildRoadDegreeBySettlementId(network, settlementCount) {
  const degreeBySettlementId = new Array(settlementCount).fill(0);
  if (!network?.nodes?.length || !network?.adjacencyByNodeId) {
    return degreeBySettlementId;
  }

  for (const node of network.nodes) {
    if (
      node?.type !== "settlement" ||
      node.settlementId == null ||
      node.settlementId < 0
    ) {
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
      const from = cells[i - 1];
      const to = cells[i];
      if (from === to) {
        continue;
      }
      addNeighbor(from, to);
      addNeighbor(to, from);
    }
  }

  return adjacency;
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

function dedupeByCell(candidates) {
  const byCell = new Map();
  for (const candidate of candidates) {
    const existing = byCell.get(candidate.cell);
    if (!existing || Number(candidate.score ?? 0) > Number(existing.score ?? 0)) {
      byCell.set(candidate.cell, candidate);
    }
  }
  return [...byCell.values()];
}

function getFrequency01(value, fallback) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return clamp(safe / 100, 0, 1);
}

function getEffectiveNodeMinDistance(params) {
  const numeric = Number(params?.nodeMinDistance);
  const safe = Number.isFinite(numeric) ? numeric : DEFAULT_NODE_MIN_DISTANCE;
  return clamp(safe, 2, 14);
}

function getSettlementHardship(world, cell) {
  if (!world || cell == null || cell < 0) {
    return 0;
  }

  const elevation = world.terrain?.elevation?.[cell] ?? 0;
  const mountain = world.terrain?.mountainField?.[cell] ?? 0;
  const moisture = world.climate?.moisture?.[cell] ?? 0.5;
  const waterDistance = world.hydrology?.waterDistance?.[cell] ?? 0;

  const ruggedness = clamp(mountain * 0.72 + elevation * 0.44, 0, 1);
  const aridity = clamp(Math.abs(moisture - 0.52) * 1.7, 0, 1);
  const remoteness = clamp(waterDistance / 12, 0, 1);
  return clamp(ruggedness * 0.43 + aridity * 0.26 + remoteness * 0.31, 0, 1);
}

function quantile(sortedValues, q) {
  if (!sortedValues?.length) {
    return 0;
  }
  const index = clamp(
    Math.floor((sortedValues.length - 1) * clamp(q, 0, 1)),
    0,
    sortedValues.length - 1,
  );
  return sortedValues[index];
}
