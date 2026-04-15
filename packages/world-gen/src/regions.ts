import { BIOME_INFO, BIOME_KEYS } from "@fardvag/shared/config";
import {
  centroidFromCells,
  coordsOf,
  forEachNeighbor,
  indexOf,
} from "@fardvag/shared/utils";
import {
  expandRegionIds,
  floodFillByKey,
  floodFillRegions,
} from "./grid";

export function buildRegions(terrain, climate, hydrology, params) {
  const { width, height, size, isLand, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell } = hydrology;
  const minBiomeSize = Math.max(0, Math.round(params.minBiomeSize));

  collapseDiagonalBiomeSingletons(width, height, isLand, lakeIdByCell, biome, 2);
  if (minBiomeSize > 0) {
    simplifyTinyBiomePatches(width, height, isLand, lakeIdByCell, biome, minBiomeSize, 2);
  }

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

function collapseDiagonalBiomeSingletons(width, height, isLand, lakeIdByCell, biome, passes = 1) {
  const orthogonalOffsets = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ];

  for (let pass = 0; pass < passes; pass += 1) {
    const changes = [];

    for (let index = 0; index < biome.length; index += 1) {
      if (isLand[index] !== 1 || lakeIdByCell[index] >= 0) {
        continue;
      }

      const currentBiome = biome[index];
      const [x, y] = coordsOf(index, width);
      let sameOrthogonalNeighbors = 0;
      const neighborCounts = new Map();

      for (const [dx, dy] of orthogonalOffsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const neighbor = indexOf(nx, ny, width);
        if (isLand[neighbor] !== 1 || lakeIdByCell[neighbor] >= 0) {
          continue;
        }

        const neighborBiome = biome[neighbor];
        if (neighborBiome === currentBiome) {
          sameOrthogonalNeighbors += 1;
        } else {
          neighborCounts.set(neighborBiome, (neighborCounts.get(neighborBiome) ?? 0) + 1);
        }
      }

      if (sameOrthogonalNeighbors > 0 || neighborCounts.size === 0) {
        continue;
      }

      const targetBiome = getMostCommonNeighborBiome(neighborCounts);

      if (targetBiome != null) {
        changes.push({ index, biome: targetBiome });
      }
    }

    if (changes.length === 0) {
      break;
    }

    for (const change of changes) {
      biome[change.index] = change.biome;
    }
  }
}

function simplifyTinyBiomePatches(width, height, isLand, lakeIdByCell, biome, maxRegionSize = 4, passes = 2) {
  for (let pass = 0; pass < passes; pass += 1) {
    const groups = floodFillByKey(
      width,
      height,
      (index) => isLand[index] === 1 && lakeIdByCell[index] < 0,
      (index) => biome[index],
      true
    );
    const changes = [];

    for (const group of groups) {
      if (group.cells.length > maxRegionSize) {
        continue;
      }

      const neighborCounts = new Map();
      for (const cell of group.cells) {
        const [x, y] = coordsOf(cell, width);
        forEachNeighbor(width, height, x, y, true, (nx, ny) => {
          const neighbor = indexOf(nx, ny, width);
          if (!isLand[neighbor] || lakeIdByCell[neighbor] >= 0) {
            return;
          }

          const neighborBiome = biome[neighbor];
          if (neighborBiome === group.key) {
            return;
          }

          neighborCounts.set(neighborBiome, (neighborCounts.get(neighborBiome) ?? 0) + 1);
        });
      }

      if (neighborCounts.size === 0) {
        continue;
      }

      const targetBiome = getMostCommonNeighborBiome(neighborCounts);

      if (targetBiome == null) {
        continue;
      }

      changes.push({ cells: group.cells, biome: targetBiome });
    }

    if (changes.length === 0) {
      break;
    }

    for (const change of changes) {
      for (const cell of change.cells) {
        biome[cell] = change.biome;
      }
    }
  }
}

function getMostCommonNeighborBiome(neighborCounts) {
  let targetBiome = null;
  let bestCount = -1;
  for (const [neighborBiome, count] of neighborCounts.entries()) {
    if (count > bestCount) {
      targetBiome = neighborBiome;
      bestCount = count;
    }
  }
  return targetBiome;
}
