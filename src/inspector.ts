import { clamp, coordsOf, distance, segmentPointDistance } from "@fardvag/shared/utils";
import { isFrozenLake } from "@fardvag/world-gen";
import { getNodeTitle } from "@fardvag/shared/node/model";
import type { World } from "@fardvag/shared/types/world";

interface WorldNodeLike {
  id: number;
  x: number;
  y: number;
  marker?: string;
  [key: string]: unknown;
}

interface WorldLakeLike {
  name: string;
  cells: number[];
  [key: string]: unknown;
}

interface WorldRiverLike {
  name: string;
  cells: number[];
  [key: string]: unknown;
}

interface WorldRegionLike {
  id: number;
  name: string;
  biomeLabel?: string;
  [key: string]: unknown;
}

interface WorldFeaturesLike {
  nodes: WorldNodeLike[];
  lakes: WorldLakeLike[];
  rivers: WorldRiverLike[];
  biomeRegions: WorldRegionLike[];
  mountainRegions: WorldRegionLike[];
  indices: {
    lakeIdByCell: number[] | Int32Array;
    biomeRegionId: number[] | Int32Array;
  };
}

interface MountainGlyphHit {
  x: number;
  y: number;
  radius: number;
  regionId: number;
}

interface InspectRenderContext {
  canvasX?: number;
  canvasY?: number;
  viewport?: {
    mountainGlyphHits?: MountainGlyphHit[];
  };
}

interface InspectHit {
  title: string;
  subtitle?: string;
  detail?: string;
}

export function inspectWorldAt(
  world: World,
  worldX: number,
  worldY: number,
  renderContext: InspectRenderContext | null = null,
): InspectHit | null {
  const x = clamp(Math.floor(worldX), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(worldY), 0, world.terrain.height - 1);
  const index = y * world.terrain.width + x;
  const features = world.features as WorldFeaturesLike;
  const { nodes, lakes, biomeRegions, indices } = features;

  let nearestNode: { node: WorldNodeLike; distance: number } | null = null;
  for (const node of nodes) {
    const d = distance(worldX, worldY, node.x, node.y);
    if (d <= 4.8 && (!nearestNode || d < nearestNode.distance)) {
      nearestNode = { node, distance: d };
    }
  }
  if (nearestNode) {
    return {
      title: getNodeTitle(nearestNode.node),
    };
  }

  const lakeId = indices.lakeIdByCell[index];
  if (lakeId >= 0) {
    const lake = lakes[lakeId];
    return {
      title: lake.name,
      subtitle: "Sjö",
      detail: isFrozenLake(world.climate, world.terrain, lake, true)
        ? "Genomfrusen"
        : "Inlandssjö",
    };
  }

  const riverHit = riverDistanceInCells(world, worldX, worldY);
  if (riverHit && riverHit.distance <= 1.25) {
    return {
      title: riverHit.river.name,
      subtitle: "Flod",
    };
  }

  const glyphMountainRegion = findMountainGlyphHit(world, renderContext);
  if (glyphMountainRegion) {
    return {
      title: glyphMountainRegion.name,
      subtitle: "Bergsområde",
    };
  }

  const biomeRegionId = indices.biomeRegionId[index];
  if (biomeRegionId >= 0) {
    const region = biomeRegions[biomeRegionId];
    return {
      title: region.name,
      subtitle: region.biomeLabel,
    };
  }

  return null;
}

function findMountainGlyphHit(
  world: World,
  renderContext: InspectRenderContext | null,
): WorldRegionLike | null {
  const hits = renderContext?.viewport?.mountainGlyphHits ?? [];
  const canvasX = renderContext?.canvasX;
  const canvasY = renderContext?.canvasY;
  if (!hits.length || canvasX == null || canvasY == null) {
    return null;
  }

  let nearest: { hit: MountainGlyphHit; distance: number } | null = null;
  for (const hit of hits) {
    const d = distance(canvasX, canvasY, hit.x, hit.y);
    if (d > hit.radius) {
      continue;
    }
    if (!nearest || d < nearest.distance) {
      nearest = { hit, distance: d };
    }
  }

  if (!nearest) {
    return null;
  }

  const mountainRegions = (world.features as WorldFeaturesLike).mountainRegions;
  return mountainRegions[nearest.hit.regionId] ?? null;
}

function riverDistanceInCells(world: World, cellX: number, cellY: number): {
  river: WorldRiverLike;
  distance: number;
  stepsToMouth: number;
} | null {
  let best: { river: WorldRiverLike; distance: number; stepsToMouth: number } | null =
    null;
  const rivers = (world.features as WorldFeaturesLike).rivers;

  for (const river of rivers) {
    for (let index = 0; index < river.cells.length - 1; index += 1) {
      const [ax, ay] = coordsOf(river.cells[index], world.terrain.width);
      const [bx, by] = coordsOf(river.cells[index + 1], world.terrain.width);
      const segmentDistance = segmentPointDistance(cellX, cellY, ax, ay, bx, by);
      if (!best || segmentDistance < best.distance) {
        best = {
          river,
          distance: segmentDistance,
          stepsToMouth: Math.max(0, river.cells.length - 1 - index),
        };
      }
    }
  }
  return best;
}
