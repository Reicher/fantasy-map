import { clamp, distance } from "./utils.js";
import { isFrozenLake } from "./generator/surfaceModel.js?v=20260402b";
import { riverDistanceInCells } from "./query/rivers.js";

export function inspectWorldAt(world, worldX, worldY, renderContext = null) {
  const x = clamp(Math.floor(worldX), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(worldY), 0, world.terrain.height - 1);
  const index = y * world.terrain.width + x;
  const { cities, lakes, biomeRegions, indices } = world.features;

  let nearestCity = null;
  for (const city of cities) {
    const d = distance(worldX, worldY, city.x, city.y);
    if (d <= 4 && (!nearestCity || d < nearestCity.distance)) {
      nearestCity = { city, distance: d };
    }
  }
  if (nearestCity) {
    return {
      title: nearestCity.city.name,
      subtitle: "Stad",
      detail: nearestCity.city.coastal ? "Kustnära bosättning" : nearestCity.city.river ? "Vattennära bosättning" : "Inlandsstad"
    };
  }

  const lakeId = indices.lakeIdByCell[index];
  if (lakeId >= 0) {
    const lake = lakes[lakeId];
    return {
      title: lake.name,
      subtitle: "Sjö",
      detail: isFrozenLake(world.climate, world.terrain, lake, true) ? "Genomfrusen" : "Inlandssjö"
    };
  }

  const riverHit = riverDistanceInCells(world, worldX, worldY);
  if (riverHit && riverHit.distance <= 1.25) {
    return {
      title: riverHit.river.name,
      subtitle: "Flod"
    };
  }

  const glyphMountainRegion = findMountainGlyphHit(world, renderContext);
  if (glyphMountainRegion) {
    return {
      title: glyphMountainRegion.name,
      subtitle: "Bergsområde"
    };
  }

  const biomeRegionId = indices.biomeRegionId[index];
  if (biomeRegionId >= 0) {
    const region = biomeRegions[biomeRegionId];
    return {
      title: region.name,
      subtitle: region.biomeLabel
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
