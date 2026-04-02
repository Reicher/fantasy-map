import { BIOME_INFO, BIOME_KEYS } from "../config.js";
import { centroidFromCells } from "../utils.js";
import { expandRegionIds, floodFillByKey, floodFillRegions } from "./grid.js";

export function buildRegions(terrain, climate, hydrology) {
  const { width, height, size, isLand, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell } = hydrology;

  const biomeRegionId = new Int32Array(size);
  biomeRegionId.fill(-1);
  const biomeRegionGroups = floodFillByKey(
    width,
    height,
    (index) => isLand[index] === 1 && lakeIdByCell[index] < 0,
    (index) => biome[index],
    true
  );
  const biomeRegions = biomeRegionGroups.map(({ key, cells }, id) => ({
    id,
    type: "biome-region",
    biome: key,
    biomeLabel: BIOME_INFO[key]?.label ?? "Region",
    cells,
    centroid: centroidFromCells(cells, width),
    size: cells.length
  }));
  for (const region of biomeRegions) {
    for (const cell of region.cells) {
      biomeRegionId[cell] = region.id;
    }
  }

  const mountainCoreMask = new Uint8Array(size);
  const mountainHaloMask = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }
    if (mountainField[index] > 0.62 || biome[index] === BIOME_KEYS.MOUNTAIN) {
      mountainCoreMask[index] = 1;
    }
    if (
      mountainField[index] > 0.38 ||
      biome[index] === BIOME_KEYS.MOUNTAIN ||
      (biome[index] === BIOME_KEYS.HIGHLANDS && mountainField[index] > 0.24)
    ) {
      mountainHaloMask[index] = 1;
    }
  }
  const mountainRegionId = new Int32Array(size);
  mountainRegionId.fill(-1);
  let mountainGroups = floodFillRegions(
    width,
    height,
    (index) => mountainCoreMask[index] === 1,
    true
  ).filter((cells) => cells.length >= 4);

  if (mountainGroups.length === 0) {
    mountainGroups = floodFillRegions(
      width,
      height,
      (index) => mountainHaloMask[index] === 1,
      true
    ).filter((cells) => cells.length >= 6);
  }

  const mountainRegions = mountainGroups.map((cells, id) => ({
    id,
    type: "mountain-region",
    cells,
    centroid: centroidFromCells(cells, width),
    size: cells.length
  }));
  for (const region of mountainRegions) {
    for (const cell of region.cells) {
      mountainRegionId[cell] = region.id;
    }
  }

  expandRegionIds(width, height, mountainRegionId, mountainHaloMask, mountainRegions, true);

  for (const region of mountainRegions) {
    region.size = region.cells.length;
    region.centroid = centroidFromCells(region.cells, width);
  }

  return {
    biomeRegionId,
    biomeRegions,
    mountainRegionId,
    mountainRegions
  };
}
