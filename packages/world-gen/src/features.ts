import { describeNode } from "@fardvag/shared/node/model";

export function buildFeatureCatalog(world, names) {
  const nodeName =
    typeof names?.nodeName === "function"
      ? (kind, key) => names.nodeName(kind, key)
      : (_kind, key) => key;

  const roadDegreeBySettlementId = buildRoadDegreeBySettlementId(
    world.roads?.roads ?? [],
    world.settlements.length,
  );

  const settlementNodes = world.settlements.map((settlement) => {
    const roadDegree = roadDegreeBySettlementId[settlement.id] ?? 0;
    const descriptor = describeNode({ marker: "settlement", roadDegree });
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
  const settlementNodeById = new Map(
    settlementNodes.map((node) => [Number(node.id), node]),
  );
  const roadDegreeByNodeId = buildRoadDegreeByNodeId(world.network);
  const networkNodes = buildNetworkFeatureNodes(
    world,
    nodeName,
    settlementNodeById,
    roadDegreeByNodeId,
  );

  return {
    nodes: networkNodes,
    lakes: (world.hydrology?.lakes ?? []).map((lake) => ({ ...lake })),
    rivers: (world.hydrology?.rivers ?? []).map((river) => ({ ...river })),
    biomeRegions: (world.regions?.biomeRegions ?? []).map((region) => ({
      ...region,
    })),
    mountainRegions: (world.regions?.mountainRegions ?? []).map((region) => ({
      ...region,
    })),
    roads: (world.roads?.roads ?? []).map((road) => ({ ...road })),
    indices: {
      lakeIdByCell: world.hydrology?.lakeIdByCell,
      biomeRegionId: world.regions?.biomeRegionId,
      mountainRegionId: world.regions?.mountainRegionId,
    },
  };
}

const ABANDONED_MAX_SEGMENT_MIN = 5;
const ABANDONED_MAX_SEGMENT_MAX = 100;

export function preselectCrashSiteCells(world?) {
  const rawMaxSegment = Number(world?.params?.abandonedMaxSegmentLength ?? 36);
  const maxSegmentLength = clampNumber(
    rawMaxSegment,
    ABANDONED_MAX_SEGMENT_MIN,
    ABANDONED_MAX_SEGMENT_MAX,
  );
  if (!Number.isFinite(maxSegmentLength) || maxSegmentLength <= 0) {
    return [];
  }

  const blockedNodeCells = new Set<number>(
    Array.isArray(world?.network?.nodes)
      ? world.network.nodes
          .map((node) => Number(node?.cell))
          .filter((cell) => Number.isInteger(cell) && cell >= 0)
      : [],
  );
  const selected = new Set<number>();
  const segments = collectAbandonedCandidateSegments(world);

  for (const segment of segments) {
    const cells = segment.cells;
    if (cells.length < 3) {
      continue;
    }

    const steps = cells.length - 1;
    if (steps <= maxSegmentLength) {
      continue;
    }

    // If length is 2x threshold, add 2 breakpoints, etc.
    const breakpointCount = Math.floor(steps / maxSegmentLength);
    for (let i = 1; i <= breakpointCount; i += 1) {
      const targetIndex = clampNumber(
        Math.round((i * steps) / (breakpointCount + 1)),
        1,
        cells.length - 2,
      );
      const crashCell = pickCrashCellNearTarget(
        cells,
        targetIndex,
        blockedNodeCells,
        selected,
      );
      if (crashCell != null) {
        selected.add(crashCell);
      }
    }
  }

  return [...selected].sort((a, b) => a - b);
}

function pickCrashCellNearTarget(
  cells,
  targetIndex,
  blockedNodeCells: Set<number>,
  selected: Set<number>,
) {
  const maxOffset = Math.max(8, Math.floor(cells.length * 0.1));
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const indices =
      offset === 0
        ? [targetIndex]
        : [targetIndex - offset, targetIndex + offset];
    for (const index of indices) {
      if (!Number.isInteger(index) || index <= 0 || index >= cells.length - 1) {
        continue;
      }
      const cell = Number(cells[index]);
      if (!Number.isInteger(cell) || cell < 0) {
        continue;
      }
      if (blockedNodeCells.has(cell) || selected.has(cell)) {
        continue;
      }
      return cell;
    }
  }
  return null;
}

function collectAbandonedCandidateSegments(world?) {
  const linkSegments = Array.isArray(world?.network?.links)
    ? world.network.links
        .filter((link) => (link?.type ?? "road") === "road")
        .map((link) => ({
          id: Number(link?.id),
          cells: Array.isArray(link?.cells) ? link.cells : [],
        }))
        .filter((segment) => segment.cells.length >= 2)
    : [];
  if (linkSegments.length > 0) {
    return linkSegments;
  }

  const roadSegments = Array.isArray(world?.roads?.roads)
    ? world.roads.roads
        .filter((road) => (road?.type ?? "road") === "road")
        .map((road) => ({
          id: Number(road?.id),
          cells: Array.isArray(road?.cells) ? road.cells : [],
        }))
        .filter((segment) => segment.cells.length >= 2)
    : [];
  return roadSegments;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function buildRoadDegreeBySettlementId(roads, settlementCount) {
  const degree = new Int16Array(Math.max(0, settlementCount));
  for (const road of roads ?? []) {
    const fromId = Number(road?.fromSettlementId);
    const toId = Number(road?.settlementId);
    if (Number.isInteger(fromId) && fromId >= 0 && fromId < degree.length) {
      degree[fromId] += 1;
    }
    if (Number.isInteger(toId) && toId >= 0 && toId < degree.length) {
      degree[toId] += 1;
    }
  }

  return degree;
}

function buildRoadDegreeByNodeId(network) {
  const degree = new Map();
  if (!network?.adjacencyByNodeId) {
    return degree;
  }

  for (const [rawNodeId, edges] of network.adjacencyByNodeId.entries?.() ?? []) {
    const nodeId = Number(rawNodeId);
    if (!Number.isInteger(nodeId) || nodeId < 0) {
      continue;
    }
    degree.set(nodeId, Array.isArray(edges) ? edges.length : 0);
  }

  return degree;
}

function buildNetworkFeatureNodes(
  world,
  nodeName,
  settlementNodeById,
  roadDegreeByNodeId,
) {
  const rawNodes = Array.isArray(world?.network?.nodes) ? world.network.nodes : [];
  if (!rawNodes.length) {
    return [...settlementNodeById.values()].sort((a, b) => a.id - b.id);
  }

  const featureNodes = [];

  for (const rawNode of rawNodes) {
    const featureId = Number(rawNode?.nodeId);
    if (!Number.isInteger(featureId) || featureId < 0) {
      continue;
    }

    const nodeType = String(rawNode?.type ?? "");
    const marker = resolveFeatureNodeMarker(nodeType);
    const roadDegree = Number(roadDegreeByNodeId.get(Number(rawNode?.id)) ?? 0);
    const descriptor = describeNode({ marker, roadDegree });
    const settlementId = Number(rawNode?.settlementId);
    const settlementNode =
      Number.isInteger(settlementId) && settlementId >= 0
        ? settlementNodeById.get(settlementId)
        : null;
    const generatedName = nodeName(marker, `node-${featureId}`);
    const resolvedName = String(
      settlementNode?.name ??
        rawNode?.name ??
        generatedName ??
        "",
    ).trim();

    featureNodes[featureId] = {
      id: featureId,
      nodeId: featureId,
      settlementId:
        Number.isInteger(settlementId) && settlementId >= 0 ? settlementId : null,
      cell: Number(rawNode?.cell),
      x: Number(rawNode?.x),
      y: Number(rawNode?.y),
      name: resolvedName,
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree,
      subtitle: descriptor.subtitle,
      detail: descriptor.detail,
    };
  }

  return featureNodes.filter(Boolean).sort((a, b) => a.id - b.id);
}

function resolveFeatureNodeMarker(nodeType) {
  if (nodeType === "abandoned") {
    return "abandoned";
  }
  if (nodeType === "settlement") {
    return "settlement";
  }
  return "signpost";
}
