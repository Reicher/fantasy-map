import { BIOME_KEYS } from "../../config.js";
import { fractalNoise2D } from "../../noise.js";
import { clamp, indexOf } from "../../utils.js";

export const WIND_OPTIONS = [
  { x: 1, y: 0.25 },
  { x: -1, y: 0.15 },
  { x: 0.65, y: 0.85 },
  { x: -0.45, y: 1 },
];

export function buildClimateCells(rng) {
  const cells = [];
  const count = rng.int(5, 9);
  for (let index = 0; index < count; index += 1) {
    cells.push({
      x: rng.range(0.1, 0.9),
      y: rng.range(0.1, 0.9),
      rx: rng.range(0.14, 0.32),
      ry: rng.range(0.16, 0.34),
      tempBias: rng.range(-0.45, 0.45),
      moistureBias: rng.range(-0.5, 0.5),
      latShift: rng.range(-0.45, 0.45),
    });
  }
  return cells;
}

export function sampleClimateCell(cells, x, y) {
  let tempBias = 0;
  let moistureBias = 0;
  let latShift = 0;
  let total = 0;

  for (const cell of cells) {
    const dx = (x - cell.x) / cell.rx;
    const dy = (y - cell.y) / cell.ry;
    const influence = Math.exp(-(dx * dx + dy * dy) * 1.8);
    if (influence < 0.03) {
      continue;
    }
    total += influence;
    tempBias += cell.tempBias * influence;
    moistureBias += cell.moistureBias * influence;
    latShift += cell.latShift * influence;
  }

  if (total <= 0) {
    return { tempBias: 0, moistureBias: 0, latShift: 0 };
  }

  return {
    tempBias: tempBias / total,
    moistureBias: moistureBias / total,
    latShift: latShift / total,
  };
}

export function sampleClimateNoise(x, y, seed) {
  return {
    tempNoise:
      fractalNoise2D(x * 0.04 + 3.5, y * 0.04 + 1.2, `${seed}::temp`, {
        octaves: 4,
        gain: 0.52,
      }) - 0.5,
    wetNoise:
      fractalNoise2D(x * 0.05 - 7.1, y * 0.05 + 0.9, `${seed}::wet`, {
        octaves: 4,
        gain: 0.56,
      }) - 0.5,
    beltNoise:
      fractalNoise2D(x * 0.025 - 2.1, y * 0.025 + 6.7, `${seed}::lat-bands`, {
        octaves: 3,
        gain: 0.58,
      }) - 0.5,
  };
}

export function computeRainShadow(
  x,
  y,
  width,
  height,
  mountainField,
  windAngle,
) {
  let shadow = 0;
  for (let step = 1; step <= 7; step += 1) {
    const sx = Math.round(x - windAngle.x * step * 2);
    const sy = Math.round(y - windAngle.y * step * 2);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      break;
    }
    shadow += mountainField[indexOf(sx, sy, width)] * (1 - step / 8);
  }
  return clamp(shadow * 0.65, 0, 1);
}

export function computeTemperature({
  y,
  height,
  beltNoise,
  latShift,
  elevation,
  mountain,
  tempNoise,
  tempBias,
  reliefHeat,
  temperatureBias,
}) {
  const warpedLatitude = sampleWarpedLatitude(y, height, beltNoise, latShift);
  const polarCold = smootherPolar(warpedLatitude);

  return clamp(
    1 -
      warpedLatitude * 0.82 -
      polarCold * 0.24 -
      elevation * 0.44 -
      mountain * 0.12 +
      tempNoise * 0.18 +
      tempBias * 0.24 +
      reliefHeat * 0.22 +
      temperatureBias,
    0,
    1,
  );
}

export function computeMoisture({
  baseRainfall,
  waterDistance,
  lakeAmount,
  lakeSize,
  y,
  height,
  beltNoise,
  latShift,
  oceanDistance,
  mapSize,
  riverStrength,
  wetNoise,
  climateMoistureBias,
  reliefMoisture,
  reliefHeight,
  provinceField,
  temperature,
  rainShadow,
  globalMoistureBias = 0,
}) {
  const warpedLatitude = sampleWarpedLatitude(y, height, beltNoise, latShift);
  const lakeInfluence = (lakeAmount + lakeSize) * 0.5;
  const nearWater = clamp(
    1 - waterDistance / (13 + lakeInfluence * 0.08),
    0,
    1,
  );
  const nearOcean = clamp(1 - oceanDistance / (18 + mapSize * 0.08), 0, 1);
  const continentality = clamp(
    (oceanDistance - waterDistance * 0.55) / (10 + mapSize * 0.06),
    0,
    1,
  );
  const inlandMoisturePocket =
    Math.max(0, climateMoistureBias) * clamp(oceanDistance / 18, 0, 1);
  const equatorialWetness = smootherEquator(warpedLatitude);
  const subtropicalDryness = subtropicalBelt(warpedLatitude);

  // Latitude-driven base moisture: equatorial wet belt, subtropical dry belt, base rainfall
  const latitudeMoisture =
    equatorialWetness * 0.52 - subtropicalDryness * 0.18 + baseRainfall * 0.36;
  // Proximity to water reduces dryness; distance from ocean (continentality) increases it
  const proximityMoisture =
    nearWater * 0.12 +
    nearOcean * 0.03 +
    riverStrength * 0.05 -
    continentality * 0.12;
  // Terrain relief adds or removes moisture; mountain rain shadow reduces it
  const terrainModifier =
    reliefMoisture * 0.38 + Math.max(0, -reliefHeight) * 0.2 - rainShadow * 0.3;
  // Climate cell bias, noise, inland pockets, and temperature correction
  const climateBias =
    climateMoistureBias * 0.34 +
    inlandMoisturePocket * 0.26 +
    wetNoise * 0.18 -
    (provinceField - 0.5) * 0.06 -
    Math.max(0, temperature - 0.7) * 0.1;

  return clamp(
    latitudeMoisture +
      proximityMoisture +
      terrainModifier +
      climateBias +
      globalMoistureBias,
    0,
    1,
  );
}

export function classifyBiome({
  isCoast,
  elevation,
  mountain,
  temperature,
  moisture,
  reliefHeight,
}) {
  if (mountain > 0.8 && elevation > 0.7) {
    return BIOME_KEYS.MOUNTAIN;
  }
  if (temperature < 0.24) {
    return BIOME_KEYS.TUNDRA;
  }
  if (moisture < 0.12 && temperature > 0.64) {
    return BIOME_KEYS.DESERT;
  }
  if (moisture > 0.72 && temperature > 0.54) {
    return BIOME_KEYS.RAINFOREST;
  }
  if (moisture > 0.32 && (reliefHeight < 0.22 || mountain < 0.62)) {
    return BIOME_KEYS.FOREST;
  }
  if (
    (elevation > 0.86 && reliefHeight > -0.06 && moisture < 0.54) ||
    (elevation > 0.76 &&
      mountain > 0.62 &&
      reliefHeight > -0.08 &&
      moisture < 0.46)
  ) {
    return BIOME_KEYS.HIGHLANDS;
  }
  return BIOME_KEYS.PLAINS;
}

function smootherPolar(latitude) {
  const t = clamp((latitude - 0.56) / 0.44, 0, 1);
  return t * t * (3 - 2 * t);
}

function sampleWarpedLatitude(y, height, beltNoise, latShift) {
  return clamp(
    Math.abs(
      (y / Math.max(1, height - 1)) * 2 -
        1 +
        beltNoise * 0.42 +
        latShift * 0.24,
    ),
    0,
    1,
  );
}

function smootherEquator(latitude) {
  const t = clamp(1 - latitude / 0.32, 0, 1);
  return t * t * (3 - 2 * t);
}

function subtropicalBelt(latitude) {
  const distance = Math.abs(latitude - 0.34);
  const t = clamp(1 - distance / 0.16, 0, 1);
  return t * t * (3 - 2 * t);
}
