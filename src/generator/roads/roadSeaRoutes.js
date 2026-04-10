import { BIOME_KEYS } from "../../config.js";
import { buildRoadNetwork } from "../network.js?v=20260401i";
import {
  clamp,
  coordsOf,
  distance,
  forEachNeighbor,
  indexOf,
} from "../../utils.js";

export function buildSeaRoutes({
  settlements,
  roads,
  roadSignatures = null,
  terrain,
  climate,
  landComponentByCell,
}) {
  const { width, height, isLand } = terrain;
  const { biome } = climate;
  const harborBySettlementId = buildHarborMap(
    settlements,
    width,
    height,
    isLand,
    biome,
  );
  const seaRoutes = [];

  for (
    let iteration = 0;
    iteration < settlements.length * 2;
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

    const cells = [];
    for (const cell of [
      best.fromSettlement.cell,
      ...best.waterPath,
      best.toSettlement.cell,
    ]) {
      if (cells[cells.length - 1] !== cell) {
        cells.push(cell);
      }
    }
    if (cells.length < 2) {
      break;
    }
    const signature = buildRoadSignature("sea-route", cells);
    if (roadSignatures?.has(signature)) {
      continue;
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
    roadSignatures?.add(signature);
  }

  return seaRoutes;
}

function buildRoadSignature(type, cells) {
  const forward = cells.join(",");
  const reverse = [...cells].reverse().join(",");
  const canonical = forward < reverse ? forward : reverse;
  return `${type}|${canonical}`;
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

          const settlementDist = distance(
            fromSettlement.x,
            fromSettlement.y,
            toSettlement.x,
            toSettlement.y,
          );
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
    (settlement) =>
      settlement.coastal && harborBySettlementId.has(settlement.id),
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

function findNearestOceanCell(startCell, width, height, isLand, biome, maxRadius) {
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
      const path = [endCell];
      let step = endCell;
      while (previous[step] >= 0) {
        step = previous[step];
        if (path[path.length - 1] !== step) {
          path.push(step);
        }
      }
      return path.reverse();
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
