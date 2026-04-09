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

export function findPlayableNodeAtWorldPoint(
  world,
  validNodeIds,
  worldX,
  worldY,
  radius = 6.4,
) {
  if (!world || !validNodeIds || validNodeIds.size === 0) {
    return null;
  }

  return findNodeAtWorldPoint(world, validNodeIds, worldX, worldY, radius);
}

export function findNodeAtWorldPoint(
  world,
  candidateNodeIds,
  worldX,
  worldY,
  radius = 6.4,
) {
  if (!world || !candidateNodeIds || candidateNodeIds.size === 0) {
    return null;
  }

  let best = null;
  const nodes =
    world.features?.pointsOfInterest ?? world.pointsOfInterest ?? world.cities;
  if (!nodes) {
    return null;
  }

  for (const nodeId of candidateNodeIds) {
    const node = nodes[nodeId];
    if (!node) {
      continue;
    }

    const distance = Math.hypot(worldX - node.x, worldY - node.y);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { nodeId, distance };
    }
  }

  return best?.nodeId ?? null;
}
