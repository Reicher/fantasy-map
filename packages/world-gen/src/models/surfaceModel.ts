import { BIOME_KEYS } from "@fardvag/shared/config";
import { coordsOf, forEachNeighbor, indexOf } from "@fardvag/shared/utils";

interface SurfaceClimate {
  temperature: ArrayLike<number>;
  biome: ArrayLike<number>;
}

interface SurfaceTerrain {
  width: number;
  height: number;
  isLand?: ArrayLike<number>;
  elevation?: ArrayLike<number>;
  mountainField?: ArrayLike<number>;
}

interface SurfaceLake {
  cells?: number[];
}

export function isSnowCell(
  biomeKey: number,
  elevation: number,
  mountain: number,
  temperature: number,
  showSnow = true,
): boolean {
  if (!showSnow || biomeKey === BIOME_KEYS.OCEAN || biomeKey === BIOME_KEYS.LAKE) {
    return false;
  }

  const polarSnow = temperature < 0.16;
  const tundraSnow = biomeKey === BIOME_KEYS.TUNDRA && temperature < 0.28;
  const alpineSnow =
    (biomeKey === BIOME_KEYS.MOUNTAIN || biomeKey === BIOME_KEYS.HIGHLANDS || mountain > 0.62) &&
    elevation > 0.72 &&
    temperature < 0.34;
  const mountainApronSnow = mountain > 0.54 && elevation > 0.64 && temperature < 0.38;

  return polarSnow || tundraSnow || alpineSnow || mountainApronSnow;
}

export function isFrozenLake(
  climate: SurfaceClimate,
  terrain: SurfaceTerrain,
  lake: SurfaceLake | null | undefined,
  showSnow = true,
): boolean {
  if (
    !showSnow ||
    !lake?.cells?.length ||
    !terrain.isLand ||
    !terrain.elevation ||
    !terrain.mountainField
  ) {
    return false;
  }
  const { isLand, elevation, mountainField } = terrain;

  let coldCells = 0;
  let temperatureSum = 0;
  const shorelineLand = new Set<number>();

  for (const cell of lake.cells) {
    const temperature = climate.temperature[cell];
    temperatureSum += temperature;
    if (temperature < 0.3) {
      coldCells += 1;
    }

    const [x, y] = coordsOf(cell, terrain.width);
    forEachNeighbor(terrain.width, terrain.height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, terrain.width);
      if (isLand[neighbor] === 1 && climate.biome[neighbor] !== BIOME_KEYS.LAKE) {
        shorelineLand.add(neighbor);
      }
    });
  }

  const averageTemperature = temperatureSum / Math.max(1, lake.cells.length);
  const coldShare = coldCells / Math.max(1, lake.cells.length);

  let snowyShore = 0;
  for (const cell of shorelineLand) {
    if (
      isSnowCell(
        climate.biome[cell],
        elevation[cell],
        mountainField[cell],
        climate.temperature[cell],
        showSnow
      )
    ) {
      snowyShore += 1;
    }
  }

  const snowyShoreShare = snowyShore / Math.max(1, shorelineLand.size);
  return averageTemperature < 0.25 && coldShare > 0.72 && snowyShoreShare > 0.34 && snowyShore >= 6;
}
