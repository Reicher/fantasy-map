export const MAP_WIDTH = 300;
export const MAP_HEIGHT = 220;
export const RENDER_WIDTH = 1200;
export const RENDER_HEIGHT = 840;

export const DEFAULT_PARAMS = {
  seed: "saltwind-01",
  mapSize: 58,
  mountainousness: 54,
  settlementDensity: 20,
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
  inlandPreference: 50,
  roadLoopiness: 50,
};

export const PARAM_LABELS = {
  mapSize: (value) => `${value}%`,
  mountainousness: (value) => `${value}%`,
  settlementDensity: (value) => `${value}%`,
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
  inlandPreference: (value) =>
    value < 20
      ? "Kustbefolkat"
      : value < 40
        ? "Kustbetonat"
        : value < 60
          ? "Blandat"
          : value < 80
            ? "Blandat inland"
            : "Inlandskt",
  roadLoopiness: (value) =>
    value < 15
      ? "Inga slingor"
      : value < 35
        ? "Sparsamma slingor"
        : value < 65
          ? "Normala slingor"
          : value < 85
            ? "Många slingor"
            : "Täta slingor",
};

export const PARAM_SCHEMA = {
  seed: {
    type: "string",
  },
  mapSize: {
    type: "number",
    min: 10,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.mapSize,
    ui: { label: "Kartstorlek", tab: "karta", order: 10 },
  },
  mountainousness: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.mountainousness,
    ui: { label: "Bergighet", tab: "karta", order: 20 },
  },
  edgeDetail: {
    type: "number",
    min: 180,
    max: 520,
    step: 1,
    formatLabel: PARAM_LABELS.edgeDetail,
    ui: { label: "Kantdjup", tab: "karta", order: 30 },
  },
  minBiomeSize: {
    type: "number",
    min: 0,
    max: 20,
    step: 1,
    formatLabel: PARAM_LABELS.minBiomeSize,
    ui: { label: "Minsta biom", tab: "karta", order: 40 },
  },
  coastComplexity: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.coastComplexity,
    ui: { label: "Kustkomplexitet", tab: "karta", order: 50 },
  },
  riverAmount: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.riverAmount,
    ui: { label: "Flodmängd", tab: "vatten", order: 10 },
  },
  lakeAmount: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.lakeAmount,
    ui: { label: "Sjöantal", tab: "vatten", order: 20 },
  },
  lakeSize: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.lakeSize,
    ui: { label: "Sjöstorlek", tab: "vatten", order: 30 },
  },
  settlementDensity: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.settlementDensity,
    ui: { label: "Nodtäthet", tab: "noder", order: 10 },
  },
  renderScale: {
    type: "number",
    min: 50,
    max: 250,
    step: 1,
    formatLabel: PARAM_LABELS.renderScale,
    ui: { label: "Render-skala", tab: "avancerat", order: 10 },
  },
  fogVisionRadius: {
    type: "number",
    min: 6,
    max: 40,
    step: 1,
    formatLabel: PARAM_LABELS.fogVisionRadius,
    ui: { label: "Sikt (fog)", tab: "avancerat", order: 20 },
  },
  temperatureBias: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.temperatureBias,
    ui: { label: "Temperatur", tab: "avancerat", order: 30 },
  },
  moistureBias: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.moistureBias,
    ui: { label: "Fuktighet", tab: "avancerat", order: 40 },
  },
  inlandPreference: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.inlandPreference,
    ui: { label: "Inlandspreferens", tab: "avancerat", order: 50 },
  },
  roadLoopiness: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.roadLoopiness,
    ui: { label: "Vägslingor", tab: "noder", order: 20 },
  },
};

export const PARAM_KEYS = Object.keys(PARAM_SCHEMA);
export const NUMERIC_PARAM_KEYS = PARAM_KEYS.filter(
  (key) => PARAM_SCHEMA[key]?.type === "number",
);

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
