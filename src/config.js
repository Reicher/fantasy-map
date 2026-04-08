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
  fogVisionRadius: 18,
  temperatureBias: 50,
  moistureBias: 50,
  coastalBias: 50,
  poiSettlementWeight: 62,
  poiCrashSiteWeight: 28,
  poiSignpostWeight: 24,
  roadShortcutAggression: 50,
  roadReuseBias: 50,
  roadCityAvoidance: 50,
  roadMaxConnectionsPerCity: 5,
};

export const PARAM_LABELS = {
  mapSize: (value) => `${value}%`,
  mountainousness: (value) => `${value}%`,
  cityDensity: (value) => `${value}%`,
  riverAmount: (value) => `${value}%`,
  lakeAmount: (value) => `${value}%`,
  lakeSize: (value) => `${value}%`,
  coastComplexity: (value) => `${value}%`,
  edgeDetail: (value) =>
    `${Math.round(value)} x ${Math.round(value * (MAP_HEIGHT / MAP_WIDTH))}`,
  minBiomeSize: (value) => `${Math.round(value)} celler`,
  renderScale: (value) =>
    `${(Math.max(50, value) / 100).toFixed(value % 100 === 0 ? 0 : 2)}x`,
  fogVisionRadius: (value) => `${Math.round(value)} celler`,
  temperatureBias: (value) =>
    value < 25
      ? "Arktisk"
      : value < 42
        ? "Kallare"
        : value < 58
          ? "Normal"
          : value < 75
            ? "Varmare"
            : "Tropisk",
  moistureBias: (value) =>
    value < 20
      ? "Ökenlik"
      : value < 40
        ? "Torrt"
        : value < 60
          ? "Normal"
          : value < 80
            ? "Fuktigt"
            : "Regnigt",
  coastalBias: (value) =>
    value < 20
      ? "Inlandskt"
      : value < 40
        ? "Blandat inland"
        : value < 60
          ? "Blandat"
          : value < 80
            ? "Kustbetonat"
            : "Kustbefolkat",
  poiSettlementWeight: (value) => `${Math.round(value)}%`,
  poiCrashSiteWeight: (value) => `${Math.round(value)}%`,
  poiSignpostWeight: (value) => `${Math.round(value)}%`,
  roadShortcutAggression: (value) =>
    value < 20
      ? "Sällan"
      : value < 45
        ? "Försiktigt"
        : value < 70
          ? "Balans"
          : value < 90
            ? "Ofta"
            : "Väldigt ofta",
  roadReuseBias: (value) =>
    value < 20
      ? "Spritt nät"
      : value < 45
        ? "Lätt spritt"
        : value < 70
          ? "Balans"
          : value < 90
            ? "Tydliga leder"
            : "Starka huvudleder",
  roadCityAvoidance: (value) =>
    value < 20
      ? "Lågt"
      : value < 45
        ? "Måttligt"
        : value < 70
          ? "Tydligt"
          : value < 90
            ? "Högt"
            : "Max",
  roadMaxConnectionsPerCity: (value) => `${Math.round(value)} vägar`,
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
  MOUNTAIN: 8,
};

export const BIOME_INFO = {
  [BIOME_KEYS.OCEAN]: { key: "ocean", label: "Hav", color: "#90a5ad" },
  [BIOME_KEYS.LAKE]: { key: "lake", label: "Sjö", color: "#8ba5ac" },
  [BIOME_KEYS.PLAINS]: { key: "plains", label: "Slätt", color: "#b9b27f" },
  [BIOME_KEYS.FOREST]: { key: "forest", label: "Skog", color: "#7d9065" },
  [BIOME_KEYS.RAINFOREST]: {
    key: "rainforest",
    label: "Djupskog",
    color: "#5f7b55",
  },
  [BIOME_KEYS.DESERT]: { key: "desert", label: "Öken", color: "#c9b07b" },
  [BIOME_KEYS.TUNDRA]: { key: "tundra", label: "Tundra", color: "#aeb2a1" },
  [BIOME_KEYS.HIGHLANDS]: {
    key: "highlands",
    label: "Högland",
    color: "#94856c",
  },
  [BIOME_KEYS.MOUNTAIN]: { key: "mountain", label: "Berg", color: "#81705d" },
};
