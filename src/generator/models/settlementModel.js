import { getBiomeSettlementHabitabilityById } from "../../biomes/index.js";
import { clamp, coordsOf, distance } from "../../utils.js";

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
  const candidates = [];
  let habitableArea = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      continue;
    }

    const habitability = getBiomeSettlementHabitabilityById(biome[index]) ?? 0.4;
    const coastal = coastMask[index] === 1;
    const nearCoast = clamp(1 - coastDistance[index] / 9, 0, 1);
    const nearFreshWater = clamp(1 - waterDistance[index] / 4.5, 0, 1);
    const river = riverStrength[index] > 0.85;
    const lake =
      !coastal &&
      waterDistance[index] <= 2 &&
      riverStrength[index] <= 0.85;
    const waterAnchor = Math.max(
      coastal ? 1 : 0,
      clamp(riverStrength[index] / 2.35, 0, 1),
      lake ? nearFreshWater : 0,
      !coastal ? nearFreshWater * 0.72 : 0,
    );
    const tooDryForSettlement = !coastal && waterDistance[index] > 3;
    if (tooDryForSettlement || waterAnchor < 0.2) {
      continue;
    }

    if (habitability > 0.3 && waterDistance[index] <= 4) {
      habitableArea += 1;
    }

    const flatness = clamp(1 - elevation[index], 0, 1);
    const coastalPreference = nearCoast * coastalBias01;
    const inlandWaterPreference =
      nearFreshWater * inlandPreference01 * (coastal ? 0.3 : 1);
    const waterPreference = coastalPreference + inlandWaterPreference;
    const score =
      habitability * 0.34 +
      waterAnchor * 0.35 +
      waterPreference * 0.19 +
      flatness * 0.09 +
      moisture[index] * 0.08 -
      mountainField[index] * 0.26 +
      rng.range(-0.055, 0.055);

    if (score > 0.22 && (coastal || river || lake || nearFreshWater > 0.45)) {
      candidates.push({
        index,
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
  candidates,
  desiredCount,
  minSpacing,
  randomness = 0,
  inlandPreference = 50,
  rng,
}) {
  const rankedCandidates = initializeCandidateSelectionScores(candidates, rng);
  const settlements = [];
  const inlandPreference01 = clamp(inlandPreference / 100, 0, 1);
  const coastalBias01 = 1 - inlandPreference01;

  const coastalCandidates = rankedCandidates.filter((candidate) => candidate.coastal);
  const inlandWaterCandidates = rankedCandidates.filter(
    (candidate) => !candidate.coastal && (candidate.river || candidate.lake),
  );

  const coastalTarget = clamp(
    Math.round(desiredCount * (0.16 + coastalBias01 * 0.63)),
    0,
    desiredCount,
  );
  const inlandWaterTarget = clamp(
    Math.round(desiredCount * (0.24 + inlandPreference01 * 0.54)),
    0,
    desiredCount,
  );

  fillSettlements({
    width,
    settlements,
    desiredCount: coastalTarget,
    pool: coastalCandidates,
    spacing: minSpacing,
    preferSpread: false,
    randomness,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount: clamp(
      Math.max(settlements.length, inlandWaterTarget),
      0,
      desiredCount,
    ),
    pool: inlandWaterCandidates,
    spacing: Math.max(8, minSpacing - 1.4),
    preferSpread: true,
    randomness,
  });

  fillSettlements({
    width,
    settlements,
    desiredCount,
    pool: rankedCandidates,
    spacing: Math.max(8, minSpacing - 1.8),
    preferSpread: true,
    randomness,
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
  randomness,
}) {
  const available = [...pool];
  const randomness01 = clamp(Number(randomness) / 100, 0, 1);

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
      const effectiveScore =
        baseSelectionScore +
        (preferSpread ? spreadBonus * 0.28 : spreadBonus * 0.18) +
        inlandSpreadBonus;

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
  for (const settlement of settlements) {
    nearest = Math.min(nearest, distance(cx, cy, settlement.x, settlement.y));
  }
  if (!Number.isFinite(nearest)) {
    return 0;
  }
  return clamp(nearest / 26, 0, 1);
}
