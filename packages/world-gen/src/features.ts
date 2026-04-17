import { clamp, coordsOf, distance, lerp } from "@fardvag/shared/utils";
import { describeNode } from "@fardvag/shared/node/model";

const DEFAULT_NODE_MIN_DISTANCE = 5;
const DEFAULT_ABANDONED_FREQUENCY = 50;

const MIN_SIGNPOST_DEGREE = 3;
const MIN_SIGNPOST_SETTLEMENT_ROAD_STEPS = 4;
const MIN_SIGNPOST_SETTLEMENT_CLEARANCE = 2.4;
const SIGNPOST_SETTLEMENT_CLEARANCE_FACTOR = 0.52;

const MIN_ABANDONED_ROAD_LENGTH = 22;
const MAX_ABANDONED_PER_ROAD = 6;
const ABANDONED_ENDPOINT_BUFFER = 4;

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
    const fallback = collectFallbackCrashCandidates(
      world,
      roads,
      roadCellAdjacency,
      minSettlementClearance,
    );
    return fallback.map((entry) => entry.cell);
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

function buildDedicatedSignpostNodes(world, settlementNodes) {
  const roads = (world.roads?.roads ?? []).filter(
    (road) => (road?.type ?? "road") === "road",
  );
  if (!roads.length) {
    return [];
  }

  const roadCellAdjacency = buildRoadCellAdjacency(roads);
  const settlementCellSet = new Set(
    settlementNodes
      .map((node) => node?.cell)
      .filter((cell) => Number.isFinite(cell)),
  );
  const settlementAnchors = settlementNodes.map((node) => ({
    x: Number(node?.x),
    y: Number(node?.y),
  }));
  const nodeMinDistance = getEffectiveNodeMinDistance(world.params);
  const settlementClearance = Math.max(
    MIN_SIGNPOST_SETTLEMENT_CLEARANCE,
    nodeMinDistance * SIGNPOST_SETTLEMENT_CLEARANCE_FACTOR,
  );
  const signpostSpacing = Math.max(1.9, nodeMinDistance * 0.48);
  const settlementRoadDistanceByCell = buildRoadDistanceFromSettlementCells(
    roadCellAdjacency,
    settlementCellSet,
  );

  const junctionByCell = new Map();
  for (const node of world.network?.nodes ?? []) {
    if (node?.type === "junction" && node.cell != null && node.cell >= 0) {
      junctionByCell.set(node.cell, node);
    }
  }

  const preferredCells = world.roads?.signpostCells ?? [];
  const preferredCellSet = new Set(preferredCells);
  const sourceCells = [...new Set([...preferredCells, ...junctionByCell.keys()])];
  const candidates = sourceCells
    .map((cell) => {
      const degree = roadCellAdjacency.get(cell)?.size ?? 0;
      const [x, y] = coordsOf(cell, world.terrain.width);
      return {
        id: cell,
        cell,
        degree,
        settlementRoadDistance:
          settlementRoadDistanceByCell.get(cell) ?? Number.POSITIVE_INFINITY,
        x,
        y,
        score:
          degree +
          (preferredCellSet.has(cell) ? 1.05 : 0) +
          clamp(degree / 8, 0, 0.45),
      };
    })
    .filter(
      (candidate) =>
        candidate.degree >= MIN_SIGNPOST_DEGREE &&
        !settlementCellSet.has(candidate.cell) &&
        candidate.settlementRoadDistance >= MIN_SIGNPOST_SETTLEMENT_ROAD_STEPS &&
        getNearestPointDistance(candidate.x, candidate.y, settlementAnchors) >=
          settlementClearance,
    )
    .sort((a, b) => {
      if (Math.abs(Number(b.score) - Number(a.score)) > 1e-6) {
        return Number(b.score) - Number(a.score);
      }
      return a.cell - b.cell;
    });

  if (!candidates.length) {
    return [];
  }

  const mandatoryCandidates = candidates.filter(
    (candidate) =>
      candidate.degree >= 4 || preferredCellSet.has(candidate.cell),
  );
  const optionalCandidates = candidates.filter(
    (candidate) =>
      !mandatoryCandidates.some((mandatory) => mandatory.cell === candidate.cell),
  );

  const targetSignpostCount = clamp(
    Math.round(settlementNodes.length * 0.55 + Math.sqrt(roads.length) * 1.25),
    Math.min(2, candidates.length),
    Math.min(candidates.length, 18),
  );

  const selectedMandatory = chooseSpreadCandidates(mandatoryCandidates, {
    target: mandatoryCandidates.length,
    minSelectedDistance: signpostSpacing * 0.78,
    minAnchorDistance: settlementClearance,
    anchorPoints: settlementAnchors,
    desiredSpacing: signpostSpacing,
  });

  const selectedMandatoryCells = new Set(
    selectedMandatory.map((candidate) => candidate.cell),
  );
  const selectedOptionalPool = optionalCandidates.filter(
    (candidate) => !selectedMandatoryCells.has(candidate.cell),
  );
  const optionalTarget = Math.max(0, targetSignpostCount - selectedMandatory.length);
  const selectedOptional = chooseSpreadCandidates(selectedOptionalPool, {
    target: optionalTarget,
    minSelectedDistance: signpostSpacing,
    minAnchorDistance: settlementClearance,
    anchorPoints: [...settlementAnchors, ...selectedMandatory],
    desiredSpacing: signpostSpacing + 0.9,
  });

  const selectedCandidates = [...selectedMandatory, ...selectedOptional]
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.cell === candidate.cell) === index,
    )
    .sort((a, b) => a.cell - b.cell);

  if (selectedCandidates.length < targetSignpostCount) {
    const topUps = chooseSpreadCandidates(candidates, {
      target: targetSignpostCount,
      minSelectedDistance: signpostSpacing * 0.72,
      minAnchorDistance: settlementClearance,
      anchorPoints: settlementAnchors,
      desiredSpacing: signpostSpacing,
    }).sort((a, b) => a.cell - b.cell);

    for (const candidate of topUps) {
      if (selectedCandidates.some((selected) => selected.cell === candidate.cell)) {
        continue;
      }
      selectedCandidates.push(candidate);
    }
  }

  selectedCandidates.sort((a, b) => a.cell - b.cell);

  if (!selectedCandidates.length) {
    return [];
  }

  const trimmedCandidates = chooseSpreadCandidates(selectedCandidates, {
    target: targetSignpostCount,
    minSelectedDistance: signpostSpacing * 0.82,
    minAnchorDistance: settlementClearance,
    anchorPoints: settlementAnchors,
    desiredSpacing: signpostSpacing,
  }).sort((a, b) => a.cell - b.cell);

  const finalCandidates = trimmedCandidates.length > 0 ? trimmedCandidates : selectedCandidates;

  const baseId = settlementNodes.length;
  return finalCandidates.map((entry, index) => {
    const nodeId = baseId + index;
    const { x, y } = entry;
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
      x,
      y,
      name: "Vägvisare",
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
      14,
      Math.round(lerp(52, MIN_ABANDONED_ROAD_LENGTH, abandonedFrequency01)),
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

function collectFallbackCrashCandidates(
  world,
  roads,
  roadCellAdjacency,
  minSettlementClearance,
) {
  const width = world.terrain.width;
  const settlementAnchors = (world.settlements ?? []).map((settlement) => ({
    x: settlement.x,
    y: settlement.y,
  }));
  const sortedRoads = [...roads].sort(
    (a, b) => (b?.cells?.length ?? 0) - (a?.cells?.length ?? 0),
  );
  const chosen = [];
  const occupiedCells = new Set();

  for (const road of sortedRoads) {
    if (chosen.length >= 2) {
      break;
    }
    const cells = road?.cells ?? [];
    if (cells.length < 12) {
      continue;
    }
    const desiredIndex = Math.round(cells.length * 0.5);
    const cell = findNearestStraightRoadCell(
      cells,
      desiredIndex,
      roadCellAdjacency,
      occupiedCells,
    );
    if (cell == null) {
      continue;
    }
    const [x, y] = coordsOf(cell, width);
    if (getNearestPointDistance(x, y, settlementAnchors) < minSettlementClearance) {
      continue;
    }
    occupiedCells.add(cell);
    chosen.push({
      id: cell,
      cell,
      x,
      y,
      score: cells.length,
    });
  }

  return chosen;
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

interface SpreadChoiceOptions {
  target?: number;
  minSelectedDistance?: number;
  minAnchorDistance?: number;
  anchorPoints?: Array<{ x: number; y: number }>;
  desiredSpacing?: number;
}

function chooseSpreadCandidates(candidates, options: SpreadChoiceOptions = {}) {
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

function buildRoadDistanceFromSettlementCells(roadCellAdjacency, settlementCellSet) {
  const distanceByCell = new Map();
  const queue = [];

  for (const cell of settlementCellSet ?? []) {
    if (!roadCellAdjacency.has(cell)) {
      continue;
    }
    if (distanceByCell.has(cell)) {
      continue;
    }
    distanceByCell.set(cell, 0);
    queue.push(cell);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const currentDistance = distanceByCell.get(current);
    if (!Number.isFinite(currentDistance)) {
      continue;
    }

    for (const neighbor of roadCellAdjacency.get(current) ?? []) {
      if (distanceByCell.has(neighbor)) {
        continue;
      }
      distanceByCell.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distanceByCell;
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
  return clamp(safe, 2, 22);
}
