import { clamp, coordsOf, distance, segmentPointDistance } from "./utils.js";
import { isFrozenLake } from "./generator/models/surfaceModel.js?v=20260402b";
import { getNodeTitle } from "./node/model.js";

export function inspectWorldAt(world, worldX, worldY, renderContext = null) {
  const x = clamp(Math.floor(worldX), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(worldY), 0, world.terrain.height - 1);
  const index = y * world.terrain.width + x;
  const { nodes, lakes, biomeRegions, indices } = world.features;

  let nearestNode = null;
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

function findMountainGlyphHit(world, renderContext) {
  const hits = renderContext?.viewport?.mountainGlyphHits ?? [];
  const canvasX = renderContext?.canvasX;
  const canvasY = renderContext?.canvasY;
  if (!hits.length || canvasX == null || canvasY == null) {
    return null;
  }

  let nearest = null;
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

  return world.features.mountainRegions[nearest.hit.regionId] ?? null;
}

function riverDistanceInCells(world, cellX, cellY) {
  let best = null;
  for (const river of world.features.rivers) {
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
