import { clamp, distance } from "./utils.js";
import { riverDistanceInCells } from "./query/rivers.js";

export function inspectWorldAt(world, worldX, worldY) {
  const x = clamp(Math.floor(worldX), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(worldY), 0, world.terrain.height - 1);
  const index = y * world.terrain.width + x;
  const { cities, lakes, mountainRegions, biomeRegions, indices } = world.features;

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
      detail: "Inlandssjö"
    };
  }

  const riverHit = riverDistanceInCells(world, worldX, worldY);
  if (riverHit && riverHit.distance <= 1.25) {
    return {
      title: riverHit.river.name,
      subtitle: "Flod"
    };
  }

  const mountainRegionId = indices.mountainRegionId[index];
  if (mountainRegionId >= 0) {
    const region = mountainRegions[mountainRegionId];
    return {
      title: region.name,
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
