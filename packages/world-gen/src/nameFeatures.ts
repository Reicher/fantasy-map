import { BIOME_INFO } from "@fardvag/shared/config";
import { centroidFromCells } from "@fardvag/shared/utils";
import type {
  HydrologyData,
  RegionsData,
  TerrainData,
} from "@fardvag/shared/types/world";

interface NameGeneratorLike {
  lakeName: (index: number) => string;
  riverName: (index: number) => string;
  biomeRegionName: (regionId: number, biomeId: number) => string;
  mountainName: (regionId: number) => string;
}

interface BiomeRegionLike {
  id: number;
  biome: number;
  [key: string]: unknown;
}

interface MountainRegionLike {
  id: number;
  [key: string]: unknown;
}

interface FeatureNamedLake {
  type: "lake";
  name: string;
  centroid: { x: number; y: number };
  size: number;
  [key: string]: unknown;
}

interface FeatureNamedRiver {
  type: "river";
  name: string;
  centroid: { x: number; y: number };
  [key: string]: unknown;
}

export function applyFeatureNames(
  terrain: TerrainData,
  hydrology: HydrologyData,
  regions: RegionsData,
  names: NameGeneratorLike,
): {
  hydrology: HydrologyData & { lakes: FeatureNamedLake[]; rivers: FeatureNamedRiver[] };
  regions: RegionsData & {
    biomeRegions: Array<BiomeRegionLike & { biomeLabel: string; name: string }>;
    mountainRegions: Array<MountainRegionLike & { name: string }>;
    lakeRegions: FeatureNamedLake[];
  };
} {
  const lakes = hydrology.lakes.map((lake, index) => ({
    ...lake,
    type: "lake" as const,
    name: names.lakeName(index),
    centroid: centroidFromCells(lake.cells, terrain.width),
    size: lake.cells.length,
  }));

  const rivers = hydrology.rivers.map((river, index) => ({
    ...river,
    type: "river" as const,
    name: names.riverName(index),
    centroid: centroidFromCells(river.cells, terrain.width),
  }));

  const biomeRegions = (regions.biomeRegions as BiomeRegionLike[]).map((region) => ({
    ...region,
    biomeLabel: BIOME_INFO[region.biome]?.label ?? "Region",
    name: names.biomeRegionName(region.id, region.biome),
  }));

  const mountainRegions = (regions.mountainRegions as MountainRegionLike[]).map(
    (region) => ({
      ...region,
      name: names.mountainName(region.id),
    }),
  );

  return {
    hydrology: {
      ...hydrology,
      lakes,
      rivers,
    },
    regions: {
      ...regions,
      biomeRegions,
      mountainRegions,
      lakeRegions: lakes,
    },
  };
}
