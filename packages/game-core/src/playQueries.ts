import { clamp } from "@fardvag/shared/utils";
import type { World } from "@fardvag/shared/types/world";

interface RegionLike {
  id?: number;
  name?: string;
}

interface PositionLike {
  x: number;
  y: number;
}

interface NodePointLike {
  x: number;
  y: number;
}

interface WorldFeaturesLike {
  indices?: { biomeRegionId?: number[] | Int32Array | Uint16Array | Uint32Array };
  biomeRegions?: Array<RegionLike | undefined>;
  nodes?: Array<(NodePointLike & { id?: number }) | undefined>;
}

export function regionAtCell(
  world: World | null | undefined,
  cell: number | null | undefined,
): RegionLike | null {
  if (!world || cell == null || cell < 0) {
    return null;
  }
  const features = world.features as WorldFeaturesLike | null | undefined;
  const regionId = features?.indices?.biomeRegionId?.[cell];
  if (regionId == null || regionId < 0) {
    return null;
  }
  return features?.biomeRegions?.[regionId] ?? null;
}

export function regionAtPosition(
  world: World | null | undefined,
  position: PositionLike | null | undefined,
): RegionLike | null {
  if (!world || !position || !world.terrain) {
    return null;
  }
  const x = clamp(Math.floor(position.x), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(position.y), 0, world.terrain.height - 1);
  return regionAtCell(world, y * world.terrain.width + x);
}

export function findPlayableNodeAtWorldPoint(
  world: World | null | undefined,
  validNodeIds: Set<number> | null | undefined,
  worldX: number,
  worldY: number,
  radius = 6.4,
): number | null {
  if (!world || !validNodeIds || validNodeIds.size === 0) {
    return null;
  }

  return findNodeAtWorldPoint(world, validNodeIds, worldX, worldY, radius);
}

export function findNodeAtWorldPoint(
  world: World | null | undefined,
  candidateNodeIds: Set<number> | null | undefined,
  worldX: number,
  worldY: number,
  radius = 6.4,
): number | null {
  if (!world || !candidateNodeIds || candidateNodeIds.size === 0) {
    return null;
  }

  let best: { nodeId: number; distance: number } | null = null;
  const features = world.features as WorldFeaturesLike | null | undefined;
  const nodes = features?.nodes ?? [];
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
