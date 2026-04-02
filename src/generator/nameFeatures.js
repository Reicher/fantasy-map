import { BIOME_INFO } from "../config.js";
import { centroidFromCells } from "../utils.js";

export function applyFeatureNames(terrain, hydrology, regions, names) {
  const lakes = hydrology.lakes.map((lake, index) => ({
    ...lake,
    type: "lake",
    name: names.lakeName(index),
    centroid: centroidFromCells(lake.cells, terrain.width),
    size: lake.cells.length
  }));

  const rivers = hydrology.rivers.map((river, index) => ({
    ...river,
    type: "river",
    name: names.riverName(index),
    centroid: centroidFromCells(river.cells, terrain.width)
  }));

  const biomeRegions = regions.biomeRegions.map((region) => ({
    ...region,
    biomeLabel: BIOME_INFO[region.biome]?.label ?? "Region",
    name: names.biomeRegionName(region.id, region.biome)
  }));

  const mountainRegions = regions.mountainRegions.map((region) => ({
    ...region,
    name: names.mountainName(region.id)
  }));

  return {
    hydrology: {
      ...hydrology,
      lakes,
      rivers
    },
    regions: {
      ...regions,
      biomeRegions,
      mountainRegions,
      lakeRegions: lakes
    }
  };
}
