export const MAP_WIDTH = 300;
export const MAP_HEIGHT = 220;
export const RENDER_WIDTH = 1200;
export const RENDER_HEIGHT = 840;

export const DEFAULT_PARAMS = {
  seed: "saltwind-01",
  mapSize: 58,
  mountainousness: 54,
  cityDensity: 20,
  riverAmount: 56,
  lakeAmount: 56,
  lakeSize: 52,
  coastComplexity: 62,
  edgeDetail: 300,
  minBiomeSize: 15,
  renderScale: 150,
  fogVisionRadius: 18
};

export const PARAM_LABELS = {
  mapSize: (value) => `${value}%`,
  mountainousness: (value) => `${value}%`,
  cityDensity: (value) => `${value}%`,
  riverAmount: (value) => `${value}%`,
  lakeAmount: (value) => `${value}%`,
  lakeSize: (value) => `${value}%`,
  coastComplexity: (value) => `${value}%`,
  edgeDetail: (value) => `${Math.round(value)} x ${Math.round(value * (MAP_HEIGHT / MAP_WIDTH))}`,
  minBiomeSize: (value) => `${Math.round(value)} celler`,
  renderScale: (value) => `${(Math.max(50, value) / 100).toFixed(value % 100 === 0 ? 0 : 2)}x`,
  fogVisionRadius: (value) => `${Math.round(value)} celler`
};

export const BIOME_KEYS = {
  OCEAN: 0,
  LAKE: 1,
  PLAINS: 2,
  FOREST: 3,
  RAINFOREST: 4,
  DESERT: 5,
  TUNDRA: 6,
  HIGHLANDS: 7,
  MOUNTAIN: 8
};

export const BIOME_INFO = {
  [BIOME_KEYS.OCEAN]: { key: "ocean", label: "Hav", color: "#90a5ad" },
  [BIOME_KEYS.LAKE]: { key: "lake", label: "Sjö", color: "#8ba5ac" },
  [BIOME_KEYS.PLAINS]: { key: "plains", label: "Slätt", color: "#b9b27f" },
  [BIOME_KEYS.FOREST]: { key: "forest", label: "Skog", color: "#7d9065" },
  [BIOME_KEYS.RAINFOREST]: { key: "rainforest", label: "Djupskog", color: "#5f7b55" },
  [BIOME_KEYS.DESERT]: { key: "desert", label: "Öken", color: "#c9b07b" },
  [BIOME_KEYS.TUNDRA]: { key: "tundra", label: "Tundra", color: "#aeb2a1" },
  [BIOME_KEYS.HIGHLANDS]: { key: "highlands", label: "Högland", color: "#94856c" },
  [BIOME_KEYS.MOUNTAIN]: { key: "mountain", label: "Berg", color: "#81705d" }
};
