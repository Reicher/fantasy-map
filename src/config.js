export const MAP_WIDTH = 300;
export const MAP_HEIGHT = 220;
export const RENDER_WIDTH = 1200;
export const RENDER_HEIGHT = 840;

function numberParam(defaultValue, min, max, formatLabel, extra = {}) {
  return {
    type: "number",
    default: defaultValue,
    min,
    max,
    formatLabel,
    ...extra,
  };
}

const labelPercent = (value) => `${value}%`;
const labelRoundedPercent = (value) => `${Math.round(value)}%`;
const labelClimateTemperature = (value) =>
  value < 25
    ? "Arktisk"
    : value < 42
      ? "Kallare"
      : value < 58
        ? "Normal"
        : value < 75
          ? "Varmare"
          : "Tropisk";
const labelClimateMoisture = (value) =>
  value < 20
    ? "Ökenlik"
    : value < 40
      ? "Torrt"
      : value < 60
        ? "Normal"
        : value < 80
          ? "Fuktigt"
          : "Regnigt";
const labelCoastalBias = (value) =>
  value < 20
    ? "Inlandskt"
    : value < 40
      ? "Blandat inland"
      : value < 60
        ? "Blandat"
        : value < 80
          ? "Kustbetonat"
          : "Kustbefolkat";
const labelRoadShortcut = (value) =>
  value < 20
    ? "Sällan"
    : value < 45
      ? "Försiktigt"
      : value < 70
        ? "Balans"
        : value < 90
          ? "Ofta"
          : "Väldigt ofta";
const labelRoadReuse = (value) =>
  value < 20
    ? "Spritt nät"
    : value < 45
      ? "Lätt spritt"
      : value < 70
        ? "Balans"
        : value < 90
          ? "Tydliga leder"
          : "Starka huvudleder";
const labelRoadCityAvoidance = (value) =>
  value < 20
    ? "Lågt"
    : value < 45
      ? "Måttligt"
      : value < 70
        ? "Tydligt"
        : value < 90
        ? "Högt"
          : "Max";
const uiMeta = (label, tab, order) => ({
  ui: {
    label,
    tab,
    order,
  },
});

const NUMERIC_PARAM_SCHEMA = {
  mapSize: numberParam(58, 10, 100, labelPercent, uiMeta("Kartstorlek", "karta", 10)),
  coastComplexity: numberParam(62, 0, 100, labelPercent, uiMeta("Kustlinje", "karta", 20)),
  mountainousness: numberParam(54, 0, 100, labelPercent, uiMeta("Bergighet", "karta", 30)),
  temperatureBias: numberParam(50, 0, 100, labelClimateTemperature, uiMeta("Klimat", "karta", 40)),
  moistureBias: numberParam(50, 0, 100, labelClimateMoisture, uiMeta("Fuktighet", "karta", 50)),
  riverAmount: numberParam(56, 0, 100, labelPercent, uiMeta("Floder", "vatten", 10)),
  lakeAmount: numberParam(56, 0, 100, labelPercent, {
    ...uiMeta("Sjömängd", "vatten", 20),
    legacyFallbackKey: "waterRichness",
    legacyDefault: 56,
  }),
  lakeSize: numberParam(52, 0, 100, labelPercent, {
    ...uiMeta("Sjöstorlek", "vatten", 30),
    legacyFallbackKey: "waterRichness",
    legacyDefault: 56,
  }),
  cityDensity: numberParam(20, 0, 100, labelPercent, uiMeta("POI-täthet", "poi", 10)),
  coastalBias: numberParam(50, 0, 100, labelCoastalBias, uiMeta("Vattennära bias", "poi", 20)),
  poiSettlementWeight: numberParam(62, 0, 100, labelRoundedPercent, uiMeta("Andel bosättningar", "poi", 30)),
  poiCrashSiteWeight: numberParam(28, 0, 100, labelRoundedPercent, uiMeta("Andel kraschplatser", "poi", 40)),
  poiSignpostWeight: numberParam(24, 0, 100, labelRoundedPercent, uiMeta("Andel vägvisare", "poi", 50)),
  roadShortcutAggression: numberParam(50, 0, 100, labelRoadShortcut, uiMeta("Genvägar mellan POI", "vagar", 10)),
  roadReuseBias: numberParam(50, 0, 100, labelRoadReuse, uiMeta("Huvudleder", "vagar", 20)),
  roadCityAvoidance: numberParam(50, 0, 100, labelRoadCityAvoidance, uiMeta("Undvik POI-kärnor", "vagar", 30)),
  roadMaxConnectionsPerCity: numberParam(
    5,
    2,
    8,
    (value) => `${Math.round(value)} vägar`,
    uiMeta("Max vägar per POI", "vagar", 40),
  ),
  edgeDetail: numberParam(
    300,
    180,
    520,
    (value) =>
      `${Math.round(value)} x ${Math.round(value * (MAP_HEIGHT / MAP_WIDTH))}`,
    {
      ...uiMeta("Rasterupplösning", "avancerat", 10),
      step: 10,
    },
  ),
  minBiomeSize: numberParam(
    15,
    0,
    30,
    (value) => `${Math.round(value)} celler`,
    uiMeta("Minsta biomstorlek", "avancerat", 20),
  ),
  renderScale: numberParam(
    150,
    50,
    250,
    (value) =>
      `${(Math.max(50, value) / 100).toFixed(value % 100 === 0 ? 0 : 2)}x`,
    {
      ...uiMeta("Renderupplösning", "avancerat", 30),
      step: 25,
    },
  ),
  fogVisionRadius: numberParam(
    18,
    6,
    40,
    (value) => `${Math.round(value)} celler`,
    uiMeta("Siktradie", "avancerat", 40),
  ),
};

export const PARAM_SCHEMA = {
  seed: { type: "string", default: "saltwind-01" },
  ...NUMERIC_PARAM_SCHEMA,
};

export const PARAM_KEYS = Object.keys(PARAM_SCHEMA);
export const NUMERIC_PARAM_KEYS = PARAM_KEYS.filter(
  (key) => PARAM_SCHEMA[key].type === "number",
);

export const DEFAULT_PARAMS = Object.freeze(
  Object.fromEntries(PARAM_KEYS.map((key) => [key, PARAM_SCHEMA[key].default])),
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
