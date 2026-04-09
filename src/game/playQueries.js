import { clamp } from "../utils.js";

export function regionAtCell(world, cell) {
  if (!world || cell == null || cell < 0) {
    return null;
  }
  const regionId = world.features?.indices?.biomeRegionId?.[cell];
  if (regionId == null || regionId < 0) {
    return null;
  }
  return world.features?.biomeRegions?.[regionId] ?? null;
}

export function regionAtPosition(world, position) {
  if (!world || !position || !world.terrain) {
    return null;
  }
  const x = clamp(Math.floor(position.x), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(position.y), 0, world.terrain.height - 1);
  return regionAtCell(world, y * world.terrain.width + x);
}

export function findPlayablePoiAtWorldPoint(
  world,
  validPoiIds,
  worldX,
  worldY,
  radius = 6.4,
) {
  if (!world || !validPoiIds || validPoiIds.size === 0) {
    return null;
  }

  return findPoiAtWorldPoint(world, validPoiIds, worldX, worldY, radius);
}

export function findPoiAtWorldPoint(
  world,
  candidatePoiIds,
  worldX,
  worldY,
  radius = 6.4,
) {
  if (!world || !candidatePoiIds || candidatePoiIds.size === 0) {
    return null;
  }

  let best = null;
  const pois = world.features?.pointsOfInterest ?? world.pointsOfInterest ?? world.cities;
  if (!pois) {
    return null;
  }

  for (const poiId of candidatePoiIds) {
    const poi = pois[poiId];
    if (!poi) {
      continue;
    }

    const distance = Math.hypot(worldX - poi.x, worldY - poi.y);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { poiId, distance };
    }
  }

  return best?.poiId ?? null;
}
