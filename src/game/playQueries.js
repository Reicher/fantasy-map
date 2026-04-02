export function findPlayableCityAtWorldPoint(world, playState, validCityIds, worldX, worldY, radius = 5.2) {
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
