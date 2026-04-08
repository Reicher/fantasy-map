import { clamp } from "../utils.js";

export function regionAtCell(world, cell) {
  if (cell == null || cell < 0) {
    return null;
  }
  const regionId = world.features.indices.biomeRegionId[cell];
  if (regionId == null || regionId < 0) {
    return null;
  }
  return world.features.biomeRegions[regionId] ?? null;
}

export function regionAtPosition(world, position) {
  if (!world || !position) {
    return null;
  }
  const x = clamp(Math.floor(position.x), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(position.y), 0, world.terrain.height - 1);
  return regionAtCell(world, y * world.terrain.width + x);
}

export function findPlayableCityAtWorldPoint(
  world,
  playState,
  validCityIds,
  worldX,
  worldY,
  radius = 6.4,
) {
  if (!world || !playState || validCityIds.size === 0) {
    return null;
  }

  let best = null;

  for (const cityId of validCityIds) {
    const city = world.cities[cityId];
    if (!city) {
      continue;
    }

    const distance = Math.hypot(worldX - city.x, worldY - city.y);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { cityId, distance };
    }
  }

  return best?.cityId ?? null;
}
