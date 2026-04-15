import type { World } from "../types/world";

export interface WorldStatsSummary {
  Världsyta: string;
  Landrutor: string;
  Landandel: string;
  Noder: string;
  Vägar: string;
  Floder: string;
  Sjöar: string;
  Bergsområden: string;
  Biomregioner: string;
}

interface WorldFeaturesStatsLike {
  nodes?: unknown[];
  roads?: unknown[];
  rivers?: unknown[];
  lakes?: unknown[];
  mountainRegions?: unknown[];
  biomeRegions?: unknown[];
}

export function buildWorldStats(world: World): WorldStatsSummary {
  const isLand = world.terrain.isLand as ArrayLike<number>;
  const landTiles = Array.from(isLand).reduce((sum, value) => sum + value, 0);
  const totalTiles = world.terrain.size;
  const features = (world.features ?? {}) as WorldFeaturesStatsLike;

  return {
    Världsyta: `${world.terrain.width} x ${world.terrain.height}`,
    Landrutor: `${landTiles}`,
    Landandel: `${Math.round((landTiles / totalTiles) * 100)}%`,
    Noder: String(features.nodes?.length ?? 0),
    Vägar: String(features.roads?.length ?? 0),
    Floder: String(features.rivers?.length ?? 0),
    Sjöar: String(features.lakes?.length ?? 0),
    Bergsområden: String(features.mountainRegions?.length ?? 0),
    Biomregioner: String(features.biomeRegions?.length ?? 0),
  };
}
