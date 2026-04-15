import { getBiomeSettlementHabitabilityById } from "@fardvag/shared/biomes";
import { clamp, coordsOf, distance } from "@fardvag/shared/utils";

export function buildSettlementCandidates({
  width,
  size,
  isLand,
  elevation,
  coastMask,
  mountainField,
  biome,
  moisture,
  coastDistance,
  waterDistance,
  riverStrength,
  lakeIdByCell,
  rng,
  inlandPreference = 50,
}) {
  const inlandPreference01 = clamp(inlandPreference / 100, 0, 1);
  const coastalBias01 = 1 - inlandPreference01;
  const { componentByCell, componentSizeById } = buildLandComponentByCell({
    width,
    size,
    isLand,
    lakeIdByCell,
  });
  const riverDistance = buildRiverDistanceField({
    width,
    size,
    isLand,
    riverStrength,
  });
  const minIslandCells = resolveMinSettlementIslandCells(size);
  const candidates = [];
  let habitableArea = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      continue;
    }
    const componentId = componentByCell[index];
    if (componentId < 0 || componentSizeById[componentId] < minIslandCells) {
      continue;
    }

    const habitability = getBiomeSettlementHabitabilityById(biome[index]) ?? 0.4;
    const coastal = coastMask[index] === 1 || coastDistance[index] <= 1;
    const nearCoast = clamp(1 - coastDistance[index] / 9, 0, 1);
    const nearFreshWater = clamp(1 - waterDistance[index] / 5.5, 0, 1);
    const riverDistanceCells = riverDistance[index];
    const riverProximity = clamp(1 - riverDistanceCells / 4.6, 0, 1);
    const riverStrengthHere = clamp((riverStrength[index] - 0.28) / 0.96, 0, 1);
    const riverAffinity = Math.max(riverStrengthHere, riverProximity * 0.92);
    const river = riverDistanceCells <= 2;
    const lake =
      !coastal &&
      waterDistance[index] <= 2 &&
      riverDistanceCells > 2;
    const waterAnchor = Math.max(
      coastal ? 1 : 0,
      riverAffinity * 0.95,
      lake ? nearFreshWater : 0,
      !coastal ? nearFreshWater * 0.72 : 0,
    );
    const tooDryForSettlement = !coastal && waterDistance[index] > 4;
    if (tooDryForSettlement || waterAnchor < 0.16) {
      continue;
    }

    if (habitability > 0.24 && waterDistance[index] <= 5) {
      habitableArea += 1;
    }

    const flatness = clamp(1 - elevation[index], 0, 1);
    const coastalPreference = nearCoast * coastalBias01;
    const inlandWaterPreference =
      nearFreshWater * inlandPreference01 * (coastal ? 0.3 : 1);
    const waterPreference = coastalPreference + inlandWaterPreference;
    const riverPreference =
      riverAffinity * (coastal ? 0.22 : 1) * (0.72 + inlandPreference01 * 0.55);
    const estuaryBonus =
      coastal && riverAffinity > 0.58
        ? 0.055 + (riverAffinity - 0.58) * 0.11
        : 0;
    const score =
      habitability * 0.34 +
      waterAnchor * 0.35 +
      waterPreference * 0.19 +
      riverPreference * 0.15 +
      estuaryBonus +
      flatness * 0.09 +
      moisture[index] * 0.08 -
      mountainField[index] * 0.26 +
      rng.range(-0.055, 0.055);

    if (
      score > 0.17 &&
      (
        coastal ||
        river ||
        lake ||
        nearFreshWater > 0.32 ||
        riverAffinity > 0.3
      )
    ) {
      candidates.push({
        index,
        componentId,
        score,
        habitability,
        coastal,
        river,
        lake,
        waterDistance: waterDistance[index],
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return { candidates, habitableArea };
}

export function selectSettlements({
  width,
  size,
  candidates,
  desiredCount,
  minSpacing,
  settlementDensity = 50,
  spacingControl = 5,
  randomness = 0,
  inlandPreference = 50,
  rng,
}) {
  const rankedCandidates = initializeCandidateSelectionScores(candidates, rng);
  const settlements = [];
  const componentPlan = buildComponentPlan(rankedCandidates, desiredCount);
  const componentSelectedById = new Map();
  const density01 = clamp(Number(settlementDensity) / 100, 0, 1);
  const spreadControl01 = clamp(Number(randomness) / 140, 0, 1);
  const spacingControl01 = clamp((Number(spacingControl) - 2) / 20, 0, 1);
  const spacingFloor = clamp(8.6 - density01 * 2.2, 5.8, 8.6);
  const spacingBoost = spacingControl01 * 4.2 + spreadControl01 * 2.8;
  const effectiveMinSpacing = minSpacing + spacingBoost;
  const inlandPreference01 = clamp(inlandPreference / 100, 0, 1);
  const coastalBias01 = 1 - inlandPreference01;

  const coastalCandidates = rankedCandidates.filter((candidate) => candidate.coastal);
  const riverCandidates = rankedCandidates.filter((candidate) => candidate.river);
  const inlandWaterCandidates = rankedCandidates.filter(
    (candidate) => !candidate.coastal && (candidate.river || candidate.lake),
  );
  const regionalCoverage = createRegionalCoverageTracker({
    width,
    size,
    desiredCount,
    settlementDensity: density01,
  });

  const coastalTarget = clamp(
    Math.round(desiredCount * (0.18 + coastalBias01 * 0.56)),
    0,
    desiredCount,
  );
  const riverTarget = clamp(
    Math.round(desiredCount * (0.16 + coastalBias01 * 0.16 + inlandPreference01 * 0.1)),
    0,
    desiredCount,
  );
  const inlandWaterTarget = clamp(
    Math.round(desiredCount * (0.24 + inlandPreference01 * 0.54)),
    0,
    desiredCount,
  );

  seedMandatoryComponents({
    width,
    settlements,
    rankedCandidates,
    mandatoryComponentIds: componentPlan.mandatoryComponentIds,
    spacing: Math.max(spacingFloor + 0.9, effectiveMinSpacing - 1.2),
    componentSelectedById,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount: coastalTarget,
    pool: coastalCandidates,
    spacing: Math.max(spacingFloor + 1.3, effectiveMinSpacing),
    preferSpread: false,
    spreadWeight: 0.2 + density01 * 0.06 + spreadControl01 * 0.06,
    randomness,
    componentTargetById: componentPlan.targetById,
    componentSelectedById,
    regionalCoverage,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount: clamp(
      settlements.length +
        Math.max(0, riverTarget - countSettlementsWhere(settlements, (settlement) => settlement.river)),
      0,
      desiredCount,
    ),
    pool: riverCandidates,
    spacing: Math.max(spacingFloor + 0.8, effectiveMinSpacing - 0.45),
    preferSpread: true,
    spreadWeight: 0.3 + density01 * 0.2 + spreadControl01 * 0.12,
    randomness,
    componentTargetById: componentPlan.targetById,
    componentSelectedById,
    regionalCoverage,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount: clamp(
      settlements.length +
        Math.max(
          0,
          inlandWaterTarget -
            countSettlementsWhere(
              settlements,
              (settlement) => !settlement.coastal && (settlement.river || settlement.lake),
            ),
        ),
      0,
      desiredCount,
    ),
    pool: inlandWaterCandidates,
    spacing: Math.max(spacingFloor + 0.72, effectiveMinSpacing - 0.8),
    preferSpread: true,
    spreadWeight: 0.24 + density01 * 0.14 + spreadControl01 * 0.08,
    randomness,
    componentTargetById: componentPlan.targetById,
    componentSelectedById,
    regionalCoverage,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount,
    pool: rankedCandidates,
    spacing: Math.max(spacingFloor + 0.4, effectiveMinSpacing - 1),
    preferSpread: true,
    spreadWeight: 0.26 + density01 * 0.2 + spreadControl01 * 0.1,
    randomness,
    componentTargetById: componentPlan.targetById,
    componentSelectedById,
    regionalCoverage,
  });

  return settlements;
}

function fillSettlements({
  width,
  settlements,
  desiredCount,
  pool,
  spacing,
  preferSpread,
  spreadWeight = 0.24,
  randomness,
  componentTargetById,
  componentSelectedById,
  regionalCoverage,
}) {
  const available = [...pool];
  const randomness01 = clamp(Number(randomness) / 140, 0, 1);

  while (available.length > 0 && settlements.length < desiredCount) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      if (!canPlaceCandidate(width, settlements, candidate, spacing)) {
        continue;
      }

      const spreadBonus =
        settlements.length === 0 ? 0 : spreadValue(width, settlements, candidate);
      const inlandSpreadBonus =
        !candidate.coastal && !candidate.river
          ? 0.02
          : !candidate.coastal
            ? 0.015
            : 0;
      const baseSelectionScore =
        (candidate.rankScore ?? 0) * (1 - randomness01) +
        (candidate.randomScore ?? 0.5) * randomness01;
      const componentBalanceBonus = componentBalanceValue(
        candidate,
        componentTargetById,
        componentSelectedById,
      );
      const waterFeatureBonus = candidate.coastal
        ? 0.08
        : candidate.river
          ? 0.07
          : candidate.lake
            ? 0.03
            : -0.018;
      const regionalCoverageBonus = regionalCoverageValue(
        width,
        candidate,
        regionalCoverage,
      );
      const spreadMultiplier = preferSpread ? 1.1 : 0.85;
      const effectiveScore =
        baseSelectionScore +
        spreadBonus * spreadWeight * spreadMultiplier +
        inlandSpreadBonus +
        componentBalanceBonus +
        waterFeatureBonus +
        regionalCoverageBonus;

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const candidate = available.splice(bestIndex, 1)[0];
    if (settlements.length >= desiredCount) {
      break;
    }

    settlements.push(toSettlementRecord(width, settlements.length, candidate));
    trackSettlementComponentCount(candidate, componentSelectedById);
    trackRegionalCoverage(width, candidate, regionalCoverage);
  }
}

function initializeCandidateSelectionScores(candidates, rng) {
  const total = Math.max(1, candidates.length - 1);
  return candidates.map((candidate, index) => ({
    ...candidate,
    rankScore: 1 - index / total,
    randomScore: rng?.range(0, 1) ?? 0.5,
  }));
}

function toSettlementRecord(width, id, candidate) {
  const [x, y] = coordsOf(candidate.index, width);
  return {
    id,
    type: "settlement",
    cell: candidate.index,
    x,
    y,
    coastal: candidate.coastal,
    componentId: candidate.componentId,
    river: candidate.river,
    lake: Boolean(candidate.lake),
    habitability: Number(candidate.habitability ?? 0),
    score: candidate.score,
  };
}

function canPlaceCandidate(width, settlements, candidate, spacing) {
  const [cx, cy] = coordsOf(candidate.index, width);
  return settlements.every((settlement) => distance(cx, cy, settlement.x, settlement.y) >= spacing);
}

function spreadValue(width, settlements, candidate) {
  const [cx, cy] = coordsOf(candidate.index, width);
  let nearest = Number.POSITIVE_INFINITY;
  let secondNearest = Number.POSITIVE_INFINITY;
  let thirdNearest = Number.POSITIVE_INFINITY;
  for (const settlement of settlements) {
    const d = distance(cx, cy, settlement.x, settlement.y);
    if (d < nearest) {
      thirdNearest = secondNearest;
      secondNearest = nearest;
      nearest = d;
    } else if (d < secondNearest) {
      thirdNearest = secondNearest;
      secondNearest = d;
    } else if (d < thirdNearest) {
      thirdNearest = d;
    }
  }
  if (!Number.isFinite(nearest)) {
    return 0;
  }
  if (!Number.isFinite(secondNearest)) {
    return clamp(nearest / 24, 0, 1);
  }
  const hasThird = Number.isFinite(thirdNearest);
  const spreadMetric = hasThird
    ? nearest * 0.52 + secondNearest * 0.32 + thirdNearest * 0.16
    : nearest * 0.68 + secondNearest * 0.32;
  return clamp(spreadMetric / 26, 0, 1);
}

function countSettlementsWhere(settlements, predicate) {
  let count = 0;
  for (const settlement of settlements) {
    if (predicate(settlement)) {
      count += 1;
    }
  }
  return count;
}

function resolveMinSettlementIslandCells(size) {
  return clamp(Math.round(size * 0.00022), 18, 72);
}

function buildRiverDistanceField({ width, size, isLand, riverStrength }) {
  const distanceToRiver = new Uint16Array(size);
  distanceToRiver.fill(65535);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }
    if ((riverStrength[index] ?? 0) < 0.38) {
      continue;
    }
    distanceToRiver[index] = 0;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const currentDistance = distanceToRiver[current];
    if (currentDistance >= 10) {
      continue;
    }
    const [x, y] = coordsOf(current, width);
    forEachOrthogonalNeighbor(x, y, width, size, (neighbor) => {
      if (!isLand[neighbor]) {
        return;
      }
      const nextDistance = currentDistance + 1;
      if (nextDistance >= distanceToRiver[neighbor]) {
        return;
      }
      distanceToRiver[neighbor] = nextDistance;
      queue[tail] = neighbor;
      tail += 1;
    });
  }

  return distanceToRiver;
}

function buildLandComponentByCell({ width, size, isLand, lakeIdByCell }) {
  const componentByCell = new Int32Array(size);
  componentByCell.fill(-1);
  const componentSizeById = [];
  const queue = new Int32Array(size);
  let componentId = 0;

  for (let start = 0; start < size; start += 1) {
    if (!isLand[start] || lakeIdByCell[start] >= 0 || componentByCell[start] >= 0) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    componentByCell[start] = componentId;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const [x, y] = coordsOf(current, width);

      forEachOrthogonalNeighbor(x, y, width, size, (neighbor) => {
        if (
          !isLand[neighbor] ||
          lakeIdByCell[neighbor] >= 0 ||
          componentByCell[neighbor] >= 0
        ) {
          return;
        }
        componentByCell[neighbor] = componentId;
        queue[tail] = neighbor;
        tail += 1;
      });
    }

    componentSizeById[componentId] = tail;
    componentId += 1;
  }

  return { componentByCell, componentSizeById };
}

function createRegionalCoverageTracker({
  width,
  size,
  desiredCount,
  settlementDensity,
}) {
  const height = Math.max(1, Math.floor(size / width));
  const cols = clamp(
    Math.round(Math.sqrt(Math.max(1, desiredCount)) * (1.7 + settlementDensity * 0.85)),
    6,
    28,
  );
  const rows = clamp(
    Math.round(cols * (height / Math.max(1, width)) * 1.1),
    3,
    18,
  );
  return {
    cols,
    rows,
    height,
    counts: new Uint16Array(cols * rows),
  };
}

function regionalCoverageValue(width, candidate, regionalCoverage) {
  if (!regionalCoverage) {
    return 0;
  }
  const { cols, rows, height, counts } = regionalCoverage;
  const [x, y] = coordsOf(candidate.index, width);
  const col = clamp(Math.floor((x / Math.max(1, width - 1)) * cols), 0, cols - 1);
  const row = clamp(Math.floor((y / Math.max(1, height - 1)) * rows), 0, rows - 1);
  const ownIndex = row * cols + col;
  let load = counts[ownIndex];
  let neighbors = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = col + dx;
      const ny = row + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      load += counts[ny * cols + nx] * 0.48;
      neighbors += 1;
    }
  }

  const neighborhoodCapacity = 1 + neighbors * 0.48;
  const pressure = load / Math.max(0.001, neighborhoodCapacity);
  return clamp(0.19 - pressure * 0.16, -0.16, 0.19);
}

function trackRegionalCoverage(width, candidate, regionalCoverage) {
  if (!regionalCoverage) {
    return;
  }
  const { cols, rows, height, counts } = regionalCoverage;
  const [x, y] = coordsOf(candidate.index, width);
  const col = clamp(Math.floor((x / Math.max(1, width - 1)) * cols), 0, cols - 1);
  const row = clamp(Math.floor((y / Math.max(1, height - 1)) * rows), 0, rows - 1);
  counts[row * cols + col] += 1;
}

function buildComponentPlan(candidates, desiredCount) {
  const statsById = new Map();
  for (const candidate of candidates) {
    const componentId = Number(candidate.componentId);
    if (!Number.isFinite(componentId) || componentId < 0) {
      continue;
    }
    const current = statsById.get(componentId) ?? { componentId, count: 0 };
    current.count += 1;
    statsById.set(componentId, current);
  }

  const stats = [...statsById.values()].sort((a, b) => b.count - a.count);
  const targetById = new Map();
  if (stats.length === 0 || desiredCount <= 0) {
    return { targetById, mandatoryComponentIds: [] };
  }

  const topCount = stats[0].count;
  const mandatoryThreshold = Math.max(14, Math.round(topCount * 0.22));
  const maxMandatory = clamp(
    Math.round(desiredCount * 0.7),
    1,
    Math.max(1, desiredCount - 1),
  );
  const mandatoryComponentIds = [];
  for (const stat of stats) {
    if (mandatoryComponentIds.length >= maxMandatory) {
      break;
    }
    if (stat.count < mandatoryThreshold) {
      break;
    }
    targetById.set(stat.componentId, 1);
    mandatoryComponentIds.push(stat.componentId);
  }

  let remaining = desiredCount - mandatoryComponentIds.length;
  if (remaining <= 0) {
    return { targetById, mandatoryComponentIds };
  }

  const weights = stats.map((stat) => ({
    componentId: stat.componentId,
    weight: Math.sqrt(stat.count),
  }));
  const totalWeight = Math.max(
    0.0001,
    weights.reduce((sum, weight) => sum + weight.weight, 0),
  );
  const remainders = [];

  for (const weight of weights) {
    const raw = (remaining * weight.weight) / totalWeight;
    const extra = Math.floor(raw);
    if (extra > 0) {
      targetById.set(
        weight.componentId,
        (targetById.get(weight.componentId) ?? 0) + extra,
      );
      remaining -= extra;
    }
    remainders.push({
      componentId: weight.componentId,
      fractional: raw - Math.floor(raw),
    });
  }

  remainders.sort((a, b) => b.fractional - a.fractional);
  for (let index = 0; index < remainders.length && remaining > 0; index += 1) {
    const componentId = remainders[index].componentId;
    targetById.set(componentId, (targetById.get(componentId) ?? 0) + 1);
    remaining -= 1;
  }

  return { targetById, mandatoryComponentIds };
}

function seedMandatoryComponents({
  width,
  settlements,
  rankedCandidates,
  mandatoryComponentIds,
  spacing,
  componentSelectedById,
}) {
  if (!mandatoryComponentIds?.length) {
    return;
  }

  for (const componentId of mandatoryComponentIds) {
    const componentCandidates = rankedCandidates.filter(
      (candidate) => candidate.componentId === componentId,
    );
    if (!componentCandidates.length) {
      continue;
    }

    let picked = null;
    for (const candidate of componentCandidates) {
      if (canPlaceCandidate(width, settlements, candidate, spacing)) {
        picked = candidate;
        break;
      }
    }
    if (!picked) {
      for (const candidate of componentCandidates) {
        if (canPlaceCandidate(width, settlements, candidate, spacing * 0.65)) {
          picked = candidate;
          break;
        }
      }
    }
    if (!picked) {
      continue;
    }

    settlements.push(toSettlementRecord(width, settlements.length, picked));
    trackSettlementComponentCount(picked, componentSelectedById);
  }
}

function componentBalanceValue(
  candidate,
  componentTargetById,
  componentSelectedById,
) {
  const componentId = Number(candidate.componentId);
  if (!Number.isFinite(componentId) || componentId < 0) {
    return 0;
  }

  const target = componentTargetById?.get(componentId) ?? 0;
  const selected = componentSelectedById?.get(componentId) ?? 0;

  if (target <= 0) {
    return selected === 0 ? 0.015 : -Math.min(0.12, selected * 0.03);
  }

  const coverage = selected / target;
  if (coverage < 1) {
    return (1 - coverage) * 0.34;
  }
  return -Math.min(0.2, (coverage - 1) * 0.08);
}

function trackSettlementComponentCount(candidate, componentSelectedById) {
  if (!componentSelectedById) {
    return;
  }
  const componentId = Number(candidate.componentId);
  if (!Number.isFinite(componentId) || componentId < 0) {
    return;
  }
  componentSelectedById.set(
    componentId,
    (componentSelectedById.get(componentId) ?? 0) + 1,
  );
}

function forEachOrthogonalNeighbor(
  x,
  y,
  width,
  size,
  callback,
) {
  const height = Math.max(1, Math.floor(size / width));
  if (x > 0) {
    callback(y * width + (x - 1));
  }
  if (x + 1 < width) {
    callback(y * width + (x + 1));
  }
  if (y > 0) {
    callback((y - 1) * width + x);
  }
  if (y + 1 < height) {
    callback((y + 1) * width + x);
  }
}
