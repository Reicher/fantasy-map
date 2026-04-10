export function buildRoadPlanningState({
  settlements = [],
  roads = [],
  width,
  seedSettlementIds = new Set(),
  blockedSourceSettlementIds = new Set(),
}) {
  const { activeSettlementIds, activeRoadIndices } = buildActiveConnectivity(
    settlements,
    roads,
    seedSettlementIds,
  );
  const pendingSettlementIds = new Set();
  for (const settlement of settlements) {
    if (!activeSettlementIds.has(settlement.id)) {
      pendingSettlementIds.add(settlement.id);
    }
  }

  const sourceSeedCostByCell = buildSourceSeedCosts({
    settlements,
    roads,
    activeSettlementIds,
    activeRoadIndices,
    width,
    blockedSourceSettlementIds,
  });
  const sourceCells = new Set(sourceSeedCostByCell.keys());

  // Safety fallback for malformed state.
  if (sourceCells.size === 0 && settlements.length > 0 && settlements[0].cell != null) {
    sourceCells.add(settlements[0].cell);
    sourceSeedCostByCell.set(settlements[0].cell, 0);
  }

  return {
    activeSettlementIds,
    pendingSettlementIds,
    sourceCells,
    sourceSeedCostByCell,
    width,
  };
}

function buildActiveConnectivity(settlements, roads, seedSettlementIds) {
  const activeSettlementIds = new Set();
  for (const seedSettlementId of seedSettlementIds) {
    if (settlements[seedSettlementId] != null) {
      activeSettlementIds.add(seedSettlementId);
    }
  }

  const activeRoadIndices = new Set();
  const activeRoadCells = new Set();

  let changed = true;
  while (changed) {
    changed = false;
    for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
      if (activeRoadIndices.has(roadIndex)) {
        continue;
      }
      const road = roads[roadIndex];
      if (!road) {
        continue;
      }

      if (
        !roadTouchesActiveSettlements(road, activeSettlementIds) &&
        !roadTouchesActiveCells(road, activeRoadCells)
      ) {
        continue;
      }

      activeRoadIndices.add(roadIndex);
      changed = true;
      for (const cell of road.cells ?? []) {
        activeRoadCells.add(cell);
      }
      for (const settlementId of collectRoadSettlementIds(road)) {
        if (!activeSettlementIds.has(settlementId) && settlements[settlementId] != null) {
          activeSettlementIds.add(settlementId);
          changed = true;
        }
      }
    }
  }

  return {
    activeSettlementIds,
    activeRoadIndices,
  };
}

function buildSourceSeedCosts({
  settlements,
  roads,
  activeSettlementIds,
  activeRoadIndices,
  width,
  blockedSourceSettlementIds,
}) {
  const sourceSeedCostByCell = new Map();
  const roadAdjacency = new Map();

  // Active settlement cells are always valid seeds.
  for (const settlementId of activeSettlementIds) {
    if (blockedSourceSettlementIds.has(settlementId)) {
      continue;
    }
    const settlement = settlements[settlementId];
    if (!settlement || settlement.cell == null) {
      continue;
    }
    setMinSourceCost(sourceSeedCostByCell, settlement.cell, 0);
  }

  for (const roadIndex of activeRoadIndices) {
    const cells = roads[roadIndex]?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      addRoadAdjacency(roadAdjacency, cells[i - 1], cells[i]);
      addRoadAdjacency(roadAdjacency, cells[i], cells[i - 1]);
    }
  }

  for (const [cell, neighbors] of roadAdjacency.entries()) {
    const degree = neighbors.size;
    if (degree <= 0) {
      continue;
    }

    const candidate = classifyAttachmentSource(cell, neighbors, width);
    if (!candidate.include) {
      continue;
    }
    setMinSourceCost(sourceSeedCostByCell, cell, candidate.cost);
  }

  return sourceSeedCostByCell;
}

function classifyAttachmentSource(cell, neighbors, width) {
  const degree = neighbors.size;

  if (degree >= 4) {
    // Favor crossroads as reliable attachment hubs.
    return { include: isCellSelected(cell, 4), cost: 0.48 };
  }

  if (degree === 3) {
    const shape = classifyThreeWayShape(cell, [...neighbors], width);
    if (shape === "t") {
      return { include: true, cost: 0.04 };
    }
    // Y junctions are allowed, but should be clearly rarer than T joins.
    return { include: isCellSelected(cell, 40), cost: 1.52 };
  }

  if (degree === 2) {
    const straightness = computeStraightness(cell, [...neighbors], width);
    if (straightness >= 0.94) {
      return { include: isCellSelected(cell, 4), cost: 0.26 };
    }
    // Bent two-way points are a common source of fork-shaped joins, so keep
    // these very sparse as valid seeds.
    return { include: isCellSelected(cell, 80), cost: 1.72 };
  }

  // Dead-end attachment is possible, but should be very rare.
  return { include: isCellSelected(cell, 104), cost: 2.04 };
}

function classifyThreeWayShape(centerCell, neighborCells, width) {
  if (neighborCells.length !== 3) {
    return "y";
  }

  let maxSep = 0;
  for (let i = 0; i < neighborCells.length; i += 1) {
    for (let j = i + 1; j < neighborCells.length; j += 1) {
      const sep = getVectorSeparationDeg(
        centerCell,
        neighborCells[i],
        neighborCells[j],
        width,
      );
      maxSep = Math.max(maxSep, sep);
    }
  }

  return maxSep >= 146 ? "t" : "y";
}

function computeStraightness(centerCell, neighborCells, width) {
  if (neighborCells.length !== 2) {
    return 0;
  }
  const [vx1, vy1] = getUnitVector(centerCell, neighborCells[0], width);
  const [vx2, vy2] = getUnitVector(centerCell, neighborCells[1], width);
  return Math.abs(vx1 * vx2 + vy1 * vy2);
}

function getVectorSeparationDeg(centerCell, neighborA, neighborB, width) {
  const [vx1, vy1] = getUnitVector(centerCell, neighborA, width);
  const [vx2, vy2] = getUnitVector(centerCell, neighborB, width);
  const dot = clamp(vx1 * vx2 + vy1 * vy2, -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

function getUnitVector(fromCell, toCell, width) {
  const fromX = fromCell % width;
  const fromY = Math.floor(fromCell / width);
  const toX = toCell % width;
  const toY = Math.floor(toCell / width);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) {
    return [0, 0];
  }
  return [dx / len, dy / len];
}

function isCellSelected(cell, mod) {
  if (mod <= 1) {
    return true;
  }
  return Math.abs(hashInt(cell)) % mod === 0;
}

function setMinSourceCost(costByCell, cell, cost) {
  const current = costByCell.get(cell);
  if (current == null || cost < current) {
    costByCell.set(cell, cost);
  }
}

function addRoadAdjacency(adjacency, fromCell, toCell) {
  let neighbors = adjacency.get(fromCell);
  if (!neighbors) {
    neighbors = new Set();
    adjacency.set(fromCell, neighbors);
  }
  neighbors.add(toCell);
}

function roadTouchesActiveSettlements(road, activeSettlementIds) {
  for (const settlementId of collectRoadSettlementIds(road)) {
    if (activeSettlementIds.has(settlementId)) {
      return true;
    }
  }
  return false;
}

function roadTouchesActiveCells(road, activeRoadCells) {
  for (const cell of road?.cells ?? []) {
    if (activeRoadCells.has(cell)) {
      return true;
    }
  }
  return false;
}

function collectRoadSettlementIds(road) {
  const ids = new Set();
  pushSettlementId(ids, road?.settlementId);
  pushSettlementId(ids, road?.fromSettlementId);
  pushSettlementId(ids, road?.viaSettlementId);
  return ids;
}

function pushSettlementId(settlementIds, value) {
  if (Number.isInteger(value) && value >= 0) {
    settlementIds.add(value);
  }
}

function hashInt(value) {
  let v = value | 0;
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
  return v ^ (v >>> 16);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
