import { BIOME_KEYS } from "../config.js";
import { createRng } from "../random.js";
import { coordsOf } from "../utils.js";
import {
  buildClimateCells,
  classifyBiome,
  computeMoisture,
  computeRainShadow,
  computeTemperature,
  sampleClimateCell,
  sampleClimateNoise,
  WIND_OPTIONS
} from "./climateModel.js?v=20260331k";

export function generateClimate(terrain, hydrology, params) {
  const {
    width,
    height,
    size,
    isLand,
    elevation,
    mountainField,
    provinceField,
    reliefHeightField,
    reliefMoistureField,
    reliefHeatField,
    coastMask
  } = terrain;
  const { oceanDistance, waterDistance, baseRainfall, riverStrength, lakeIdByCell } = hydrology;
  const rng = createRng(`${params.seed}::climate`);
  const windAngle = rng.pick(WIND_OPTIONS);
  const temperatureBias = rng.range(-0.12, 0.12);
  const climateCells = buildClimateCells(rng);

  const temperature = new Float32Array(size);
  const moisture = new Float32Array(size);
  const biome = new Uint8Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] && lakeIdByCell[index] >= 0) {
      biome[index] = BIOME_KEYS.LAKE;
      continue;
    }

    if (!isLand[index]) {
      biome[index] = BIOME_KEYS.OCEAN;
      continue;
    }

    if (lakeIdByCell[index] >= 0) {
      biome[index] = BIOME_KEYS.LAKE;
      continue;
    }

    const [x, y] = coordsOf(index, width);
    const climateCell = sampleClimateCell(climateCells, x / width, y / height);
    const noise = sampleClimateNoise(x, y, params.seed);
    const rainShadow = computeRainShadow(x, y, width, height, mountainField, windAngle);
    const reliefHeight = reliefHeightField[index];
    const reliefMoisture = reliefMoistureField[index];
    const reliefHeat = reliefHeatField[index];

    temperature[index] = computeTemperature({
      y,
      height,
      beltNoise: noise.beltNoise,
      latShift: climateCell.latShift,
      elevation: elevation[index],
      mountain: mountainField[index],
      tempNoise: noise.tempNoise,
      tempBias: climateCell.tempBias,
      reliefHeat,
      temperatureBias
    });
    moisture[index] = computeMoisture({
      baseRainfall: baseRainfall[index],
      waterDistance: waterDistance[index],
      lakeAmount: params.lakeAmount,
      lakeSize: params.lakeSize,
      y,
      height,
      beltNoise: noise.beltNoise,
      latShift: climateCell.latShift,
      oceanDistance: oceanDistance[index],
      mapSize: params.mapSize,
      riverStrength: riverStrength[index],
      wetNoise: noise.wetNoise,
      climateMoistureBias: climateCell.moistureBias,
      reliefMoisture,
      reliefHeight,
      provinceField: provinceField[index],
      temperature: temperature[index],
      rainShadow
    });

    biome[index] = classifyBiome({
      isCoast: coastMask[index] === 1,
      elevation: elevation[index],
      mountain: mountainField[index],
      temperature: temperature[index],
      moisture: moisture[index],
      reliefHeight
    });
  }

  return {
    windAngle,
    temperature,
    moisture,
    biome
  };
}
