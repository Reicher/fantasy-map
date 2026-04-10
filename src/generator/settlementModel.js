import { BIOME_KEYS } from "../config.js";
import { clamp, coordsOf, distance } from "../utils.js";

const BIOME_HABITABILITY = {
  [BIOME_KEYS.PLAINS]: 1,
  [BIOME_KEYS.FOREST]: 0.84,
  [BIOME_KEYS.RAINFOREST]: 0.64,
  [BIOME_KEYS.DESERT]: 0.16,
  [BIOME_KEYS.TUNDRA]: 0.2,
  [BIOME_KEYS.HIGHLANDS]: 0.48,
  [BIOME_KEYS.MOUNTAIN]: 0.05,
};

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
  // coastalBias01 = 1.0 → fully water-oriented (inlandPreference=0)
  // coastalBias01 = 0.0 → fully inland-oriented (inlandPreference=100)
  const coastalBias01 = 1 - clamp(inlandPreference / 100, 0, 1);
  const coastalWeight = 0.16 + coastalBias01 * 0.56;
  const candidates = [];
  let habitableArea = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      continue;
    }

    const habitability = BIOME_HABITABILITY[biome[index]] ?? 0.4;
    if (habitability > 0.35) {
      habitableArea += 1;
    }

    const coastal = coastMask[index] === 1;
    const river = riverStrength[index] > 0.85;
    const inlandness = clamp(coastDistance[index] / 18, 0, 1);
    const nearWater = clamp(1 - waterDistance[index] / 6, 0, 1);
    const inlandWater = !coastal && waterDistance[index] <= 2;
    const dryInland =
      !coastal && waterDistance[index] >= 3 && waterDistance[index] <= 7;
    const oddballBoost = rng.chance(0.045) ? 0.22 : 0;
    const flatness = clamp(1 - elevation[index], 0, 1);
    const waterBonus =
      (coastal ? coastalWeight : 0) +
      nearWater * (0.16 + coastalBias01 * 0.14) +
      clamp(riverStrength[index] / 3.2, 0, 1) * (0.16 + inlandness * 0.15) +
      (inlandWater ? 0.17 + inlandness * 0.08 : 0);
    const inlandBonus =
      (!coastal ? inlandness * 0.025 : 0) +
      (dryInland ? 0.03 + inlandness * 0.03 : 0) +
      (coastDistance[index] >= 8 &&
      coastDistance[index] <= 22 &&
      mountainField[index] < 0.22
        ? 0.02
        : 0);
    const farWaterPenalty =
      !coastal && waterDistance[index] >= 5
        ? (0.03 + coastalBias01 * 0.09) *
          clamp((waterDistance[index] - 4) / 6, 0, 1)
        : 0;
    const remotePenalty =
      coastDistance[index] > 16 &&
      waterDistance[index] > 6 &&
      mountainField[index] > 0.2
        ? 0.08 + coastalBias01 * 0.07
        : 0;
    const score =
      habitability * 0.4 +
      waterBonus +
      inlandBonus +
      flatness * 0.18 +
      moisture[index] * 0.1 +
      inlandness * 0.02 -
      farWaterPenalty -
      mountainField[index] * 0.24 -
      remotePenalty +
      oddballBoost +
      rng.range(-0.08, 0.08);

    if (
      (score > 0.26 && (habitability > 0.18 || oddballBoost > 0)) ||
      (oddballBoost > 0 &&
        habitability > 0.18 &&
        elevation[index] < 0.72 &&
        mountainField[index] < 0.32)
    ) {
      candidates.push({
        index,
        score,
        coastal,
        river: river || inlandWater,
        oddball: oddballBoost > 0,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return { candidates, habitableArea };
}

export function selectSettlements({ width, candidates, desiredCount, minSpacing }) {
  const settlements = [];

  fillSettlements({
    width,
    settlements,
    desiredCount,
    pool: candidates.filter(
      (candidate) => !candidate.oddball || candidate.score > 0.42,
    ),
    spacing: minSpacing,
    preferSpread: false,
  });

  if (settlements.length < desiredCount) {
    fillSettlements({
      width,
      settlements,
      desiredCount,
      pool: candidates,
      spacing: Math.max(8, minSpacing - 1.25),
      preferSpread: true,
    });
  }

  return settlements;
}

export function ensureInlandSettlements({
  width,
  rng,
  candidates,
  settlements,
  desiredCount,
  minSpacing,
  density,
}) {
  const targetInlandCount = density >= 0.82 ? 2 : 1;
  let currentInlandCount = settlements.filter(
    (settlement) => !settlement.coastal && !settlement.river,
  ).length;

  const inlandCandidates = candidates.filter(
    (candidate) =>
      !candidate.coastal && !candidate.river && candidate.score > 0.18,
  );

  // If no inland settlement exists yet, try adding one with a 60% chance (looser thresholds)
  if (currentInlandCount === 0 && rng.chance(0.6)) {
    const oddball = inlandCandidates.find((c) =>
      canPlaceCandidate(width, settlements, c, Math.max(7.5, minSpacing - 1.8)),
    );
    if (oddball) {
      if (settlements.length >= desiredCount) {
        const replaceIndex = settlements.findIndex(
          (settlement) => settlement.coastal || settlement.river,
        );
        if (replaceIndex >= 0) {
          settlements.splice(replaceIndex, 1);
        }
      }
      settlements.push(toSettlementRecord(width, settlements.length, oddball));
      currentInlandCount += 1;
    }
  }

  // Ensure minimum inland count with stricter score threshold
  const strictCandidates = inlandCandidates.filter((c) => c.score > 0.2);
  for (const candidate of strictCandidates) {
    if (currentInlandCount >= targetInlandCount) {
      break;
    }
    if (
      !canPlaceCandidate(
        width,
        settlements,
        candidate,
        Math.max(8, minSpacing - 2.2),
      )
    ) {
      continue;
    }
    if (settlements.length >= desiredCount) {
      const replaceIndex = findReplaceableSettlementIndex(
        settlements,
        candidate,
        width,
        minSpacing,
      );
      if (replaceIndex < 0) {
        continue;
      }
      settlements.splice(replaceIndex, 1);
    }
    settlements.push(toSettlementRecord(width, settlements.length, candidate));
    currentInlandCount += 1;
  }

  // Last-resort fallback with relaxed spacing
  if (currentInlandCount < targetInlandCount && rng.chance(0.25)) {
    const fallback = strictCandidates.find((c) =>
      canPlaceCandidate(width, settlements, c, Math.max(7, minSpacing - 2.8)),
    );
    if (fallback) {
      if (settlements.length >= desiredCount) {
        const replaceIndex = settlements.findIndex(
          (settlement) => settlement.coastal && !settlement.river,
        );
        if (replaceIndex >= 0) {
          settlements.splice(replaceIndex, 1);
        }
      }
      settlements.push(toSettlementRecord(width, settlements.length, fallback));
    }
  }
}

function fillSettlements({
  width,
  settlements,
  desiredCount,
  pool,
  spacing,
  preferSpread,
}) {
  const available = [...pool];

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
      const effectiveScore =
        candidate.score +
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

function findReplaceableSettlementIndex(settlements, candidate, width, minSpacing) {
  const [cx, cy] = coordsOf(candidate.index, width);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < settlements.length; index += 1) {
    const settlement = settlements[index];
    if (!settlement.coastal && !settlement.river) {
      continue;
    }

    const distanceToCandidate = distance(cx, cy, settlement.x, settlement.y);
    if (distanceToCandidate < Math.max(7, minSpacing - 2.6)) {
      continue;
    }

    const replacePenalty =
      (settlement.coastal ? 1 : 0) + (settlement.river ? 0.4 : 0) - settlement.score;
    if (replacePenalty < bestScore) {
      bestScore = replacePenalty;
      bestIndex = index;
    }
  }

  return bestIndex;
}
