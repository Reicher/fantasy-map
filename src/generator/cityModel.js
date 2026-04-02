import { BIOME_KEYS } from "../config.js";
import { clamp, coordsOf, distance } from "../utils.js";

export const BIOME_HABITABILITY = {
  [BIOME_KEYS.PLAINS]: 1,
  [BIOME_KEYS.FOREST]: 0.84,
  [BIOME_KEYS.RAINFOREST]: 0.64,
  [BIOME_KEYS.DESERT]: 0.16,
  [BIOME_KEYS.TUNDRA]: 0.2,
  [BIOME_KEYS.HIGHLANDS]: 0.48,
  [BIOME_KEYS.MOUNTAIN]: 0.05
};

export function buildCityCandidates({ width, size, isLand, elevation, coastMask, mountainField, biome, moisture, coastDistance, waterDistance, riverStrength, lakeIdByCell, rng }) {
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
    const dryInland = !coastal && waterDistance[index] >= 3 && waterDistance[index] <= 7;
    const oddballBoost = rng.chance(0.045) ? 0.22 : 0;
    const flatness = clamp(1 - elevation[index], 0, 1);
    const waterBonus =
      (coastal ? 0.34 : 0) +
      nearWater * 0.12 +
      clamp(riverStrength[index] / 3.2, 0, 1) * (0.14 + inlandness * 0.14) +
      (inlandWater ? 0.16 + inlandness * 0.08 : 0);
    const inlandBonus =
      (!coastal ? inlandness * 0.025 : 0) +
      (dryInland ? 0.03 + inlandness * 0.03 : 0) +
      (coastDistance[index] >= 8 && coastDistance[index] <= 22 && mountainField[index] < 0.22 ? 0.02 : 0);
    const remotePenalty =
      coastDistance[index] > 16 && waterDistance[index] > 6 && mountainField[index] > 0.2 ? 0.08 : 0;
    const score =
      habitability * 0.4 +
      waterBonus +
      inlandBonus +
      flatness * 0.18 +
      moisture[index] * 0.1 +
      inlandness * 0.02 -
      mountainField[index] * 0.24 -
      remotePenalty +
      oddballBoost +
      rng.range(-0.08, 0.08);

    if (
      (score > 0.26 && (habitability > 0.18 || oddballBoost > 0)) ||
      (oddballBoost > 0 && habitability > 0.18 && elevation[index] < 0.72 && mountainField[index] < 0.32)
    ) {
      candidates.push({
        index,
        score,
        coastal,
        river: river || inlandWater,
        oddball: oddballBoost > 0
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return { candidates, habitableArea };
}

export function selectCities({ width, candidates, desiredCount, minSpacing }) {
  const cities = [];

  fillCities({
    width,
    cities,
    desiredCount,
    pool: candidates.filter((candidate) => !candidate.oddball || candidate.score > 0.42),
    spacing: minSpacing,
    preferSpread: false
  });

  if (cities.length < desiredCount) {
    fillCities({
      width,
      cities,
      desiredCount,
      pool: candidates,
      spacing: Math.max(7, minSpacing - 1.5),
      preferSpread: true
    });
  }

  return cities;
}

export function maybeAddInlandOddballCity({ width, rng, candidates, cities, desiredCount, minSpacing }) {
  if (cities.some((city) => !city.coastal && !city.river) || !rng.chance(0.6)) {
    return;
  }

  const fallback = candidates.find(
    (candidate) =>
      !candidate.coastal &&
      !candidate.river &&
      candidate.score > 0.18 &&
      canPlaceCandidate(width, cities, candidate, Math.max(5, minSpacing - 2))
  );

  if (!fallback) {
    return;
  }

  if (cities.length >= desiredCount) {
    const replaceIndex = cities.findIndex((city) => city.coastal || city.river);
    if (replaceIndex >= 0) {
      cities.splice(replaceIndex, 1);
    }
  }

  cities.push(toCityRecord(width, cities.length, fallback));
}

export function ensureInlandCities({ width, rng, candidates, cities, desiredCount, minSpacing, density }) {
  const targetInlandCount = density >= 0.82 ? 2 : 1;
  let currentInlandCount = cities.filter((city) => !city.coastal && !city.river).length;

  if (currentInlandCount >= targetInlandCount) {
    return;
  }

  const inlandCandidates = candidates.filter(
    (candidate) =>
      !candidate.coastal &&
      !candidate.river &&
      candidate.score > 0.2
  );

  for (const candidate of inlandCandidates) {
    if (currentInlandCount >= targetInlandCount) {
      break;
    }

    if (!canPlaceCandidate(width, cities, candidate, Math.max(5.5, minSpacing - 2.5))) {
      continue;
    }

    if (cities.length >= desiredCount) {
      const replaceIndex = findReplaceableCityIndex(cities, candidate, width, minSpacing);
      if (replaceIndex < 0) {
        continue;
      }
      cities.splice(replaceIndex, 1);
    }

    cities.push(toCityRecord(width, cities.length, candidate));
    currentInlandCount += 1;
  }

  if (currentInlandCount < targetInlandCount && rng.chance(0.25)) {
    const fallback = inlandCandidates.find((candidate) =>
      canPlaceCandidate(width, cities, candidate, Math.max(4.5, minSpacing - 3))
    );
    if (fallback) {
      if (cities.length >= desiredCount) {
        const replaceIndex = cities.findIndex((city) => city.coastal && !city.river);
        if (replaceIndex >= 0) {
          cities.splice(replaceIndex, 1);
        }
      }
      cities.push(toCityRecord(width, cities.length, fallback));
    }
  }
}

function fillCities({ width, cities, desiredCount, pool, spacing, preferSpread }) {
  const available = [...pool];

  while (available.length > 0 && cities.length < desiredCount) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      if (!canPlaceCandidate(width, cities, candidate, spacing)) {
        continue;
      }

      const spreadBonus = cities.length === 0 ? 0 : spreadValue(width, cities, candidate);
      const inlandSpreadBonus =
        !candidate.coastal && !candidate.river ? 0.02 : !candidate.coastal ? 0.015 : 0;
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
    if (cities.length >= desiredCount) {
      break;
    }

    cities.push(toCityRecord(width, cities.length, candidate));
  }
}

function toCityRecord(width, id, candidate) {
  const [x, y] = coordsOf(candidate.index, width);
  return {
    id,
    type: "city",
    cell: candidate.index,
    x,
    y,
    coastal: candidate.coastal,
    river: candidate.river,
    score: candidate.score
  };
}

function canPlaceCandidate(width, cities, candidate, spacing) {
  const [cx, cy] = coordsOf(candidate.index, width);
  return cities.every((city) => distance(cx, cy, city.x, city.y) >= spacing);
}

function spreadValue(width, cities, candidate) {
  const [cx, cy] = coordsOf(candidate.index, width);
  let nearest = Number.POSITIVE_INFINITY;
  for (const city of cities) {
    nearest = Math.min(nearest, distance(cx, cy, city.x, city.y));
  }
  if (!Number.isFinite(nearest)) {
    return 0;
  }
  return clamp(nearest / 26, 0, 1);
}

function findReplaceableCityIndex(cities, candidate, width, minSpacing) {
  const [cx, cy] = coordsOf(candidate.index, width);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 0; index < cities.length; index += 1) {
    const city = cities[index];
    if (!city.coastal && !city.river) {
      continue;
    }

    const distanceToCandidate = distance(cx, cy, city.x, city.y);
    if (distanceToCandidate < Math.max(4.5, minSpacing - 3)) {
      continue;
    }

    const replacePenalty = (city.coastal ? 1 : 0) + (city.river ? 0.4 : 0) - city.score;
    if (replacePenalty < bestScore) {
      bestScore = replacePenalty;
      bestIndex = index;
    }
  }

  return bestIndex;
}
