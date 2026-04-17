import type { WorldParams } from "./types/world";

export const MAP_WIDTH = 300;
export const MAP_HEIGHT = 220;
export const RENDER_WIDTH = 1200;
export const RENDER_HEIGHT = 840;

export const DEFAULT_PARAMS: WorldParams = {
  seed: "saltwind-01",
  worldAspect: 1,
  worldScale: 100,
  fragmentation: 52,
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
  settlementRandomness: 20,
  abandonedFrequency: 50,
  nodeMinDistance: 5,
  startTimeOfDayHours: 12,
};

type NumericWorldParamKey = {
  [K in keyof WorldParams]: WorldParams[K] extends number ? K : never;
}[keyof WorldParams];

const PARAM_LABELS: Record<NumericWorldParamKey, (value: number) => string> = {
  worldAspect: (value: number) => {
    const shapeRatio = 1 + Math.max(0, value - 1) * 6.6667;
    return `${value.toFixed(2)} (ca ${shapeRatio.toFixed(1)}:1)`;
  },
  worldScale: (value: number) => `${Math.round(value)}%`,
  fragmentation: (value: number) =>
    value < 20
      ? "Sammanhängande"
      : value < 45
        ? "Sprucken"
        : value < 70
          ? "Fragmenterad"
          : "Arkipelagisk",
  mapSize: (value: number) => `${value}%`,
  mountainousness: (value: number) => `${value}%`,
  settlementDensity: (value: number) => `${value}%`,
  riverAmount: (value: number) => `${value}%`,
  lakeAmount: (value: number) => `${value}%`,
  lakeSize: (value: number) => `${value}%`,
  coastComplexity: (value: number) => `${value}%`,
  edgeDetail: (value: number) =>
    `${Math.round(value)} x ${Math.round(value * (MAP_HEIGHT / MAP_WIDTH))}`,
  minBiomeSize: (value: number) => `${Math.round(value)} celler`,
  renderScale: (value: number) =>
    `${(Math.max(50, value) / 100).toFixed(value % 100 === 0 ? 0 : 2)}x`,
  fogVisionRadius: (value: number) => `${Math.round(value)} celler`,
  temperatureBias: (value: number) =>
    value < 25
      ? "Arktisk"
      : value < 42
        ? "Kallare"
        : value < 58
          ? "Normal"
          : value < 75
            ? "Varmare"
            : "Tropisk",
  moistureBias: (value: number) =>
    value < 20
      ? "Ökenlik"
      : value < 40
        ? "Torrt"
        : value < 60
          ? "Normal"
          : value < 80
            ? "Fuktigt"
            : "Regnigt",
  inlandPreference: (value: number) =>
    value < 20
      ? "Tydligt kustnära"
      : value < 40
        ? "Mest kust"
        : value < 60
          ? "Blandat"
          : value < 80
            ? "Mest inland"
            : "Tydligt inland",
  settlementRandomness: (value: number) =>
    value < 15
      ? "Förutsägbart"
      : value < 35
        ? "Lätt variation"
        : value < 60
          ? "Blandat"
          : value < 85
            ? "Hög variation"
            : value < 110
              ? "Mycket variation"
              : "Extrem spridning",
  abandonedFrequency: (value: number) =>
    value < 15
      ? "Nästan inga"
      : value < 35
        ? "Få"
      : value < 65
          ? "Medel"
          : value < 85
            ? "Många"
            : "Väldigt många",
  nodeMinDistance: (value: number) => `${value.toFixed(1)} celler`,
  startTimeOfDayHours: (value: number) => {
    const normalized = ((Math.round(value) % 24) + 24) % 24;
    return `${String(normalized).padStart(2, "0")}:00`;
  },
};

export const PARAM_SCHEMA = {
  seed: {
    type: "string",
  },
  worldAspect: {
    type: "number",
    min: 1,
    max: 1.6,
    step: 0.05,
    formatLabel: PARAM_LABELS.worldAspect,
    ui: {
      label: "Avlång värld",
      tab: "karta",
      section: "Terrängform",
      order: 5,
      hint: "Öka för bredare värld i horisontell riktning. 1.30 motsvarar ungefär 3:1.",
    },
  },
  worldScale: {
    type: "number",
    min: 70,
    max: 220,
    step: 1,
    formatLabel: PARAM_LABELS.worldScale,
    ui: {
      label: "Världsyta",
      tab: "karta",
      section: "Terrängform",
      order: 8,
      hint: "Skalar upp hela kartans yta och avstånd (fler celler). Med samma landmängd ger högre värde mer vatten runt landmassorna.",
    },
  },
  fragmentation: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.fragmentation,
    ui: {
      label: "Fragmentering",
      tab: "karta",
      section: "Terrängform",
      order: 9,
      hint: "Lågt värde = mer sammanhängande land. Högt värde = mer uppsplittrat i öar och sund.",
    },
  },
  mapSize: {
    type: "number",
    min: 10,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.mapSize,
    ui: {
      label: "Landmängd",
      tab: "karta",
      section: "Terrängform",
      order: 10,
      hint: "Styr hur mycket land som skapas inom världsytan (fler/större landmassor). Ändrar inte världens totala utsträckning.",
    },
  },
  mountainousness: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.mountainousness,
    ui: {
      label: "Bergighet",
      tab: "karta",
      section: "Terrängform",
      order: 20,
      hint: "Mer berg ger svårare passager och tydligare höjdskillnader.",
    },
  },
  edgeDetail: {
    type: "number",
    min: 180,
    max: 520,
    step: 1,
    formatLabel: PARAM_LABELS.edgeDetail,
    ui: {
      label: "Simuleringsupplösning",
      tab: "avancerat",
      section: "Världsteknik",
      order: 35,
      hint: "Högre värde ger mer detalj men kostar prestanda.",
    },
  },
  minBiomeSize: {
    type: "number",
    min: 0,
    max: 40,
    step: 1,
    formatLabel: PARAM_LABELS.minBiomeSize,
    ui: {
      label: "Min biomyta",
      tab: "karta",
      section: "Biomstruktur",
      order: 10,
      hint: "Höj för färre små fläckar mellan biomer.",
    },
  },
  coastComplexity: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.coastComplexity,
    ui: {
      label: "Kustdetalj",
      tab: "karta",
      section: "Terrängform",
      order: 30,
      hint: "Påverkar hur kantig eller sönderbruten kusten blir.",
    },
  },
  riverAmount: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.riverAmount,
    ui: {
      label: "Flodnät",
      tab: "vatten",
      section: "Hydrologi",
      order: 10,
      hint: "Mängd aktiva flodsystem i världen.",
    },
  },
  lakeAmount: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.lakeAmount,
    ui: {
      label: "Sjöantal",
      tab: "vatten",
      section: "Hydrologi",
      order: 20,
      hint: "Hur många sjöar som försöker genereras.",
    },
  },
  lakeSize: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.lakeSize,
    ui: {
      label: "Sjöstorlek",
      tab: "vatten",
      section: "Hydrologi",
      order: 30,
      hint: "Påverkar sjöarnas genomsnittliga utbredning.",
    },
  },
  settlementDensity: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.settlementDensity,
    ui: {
      label: "Bosättningstäthet",
      tab: "noder",
      section: "Bosättningar",
      order: 10,
      hint: "Grundnivå för hur tätt bosättningar placeras.",
    },
  },
  settlementRandomness: {
    type: "number",
    min: 0,
    max: 140,
    step: 1,
    formatLabel: PARAM_LABELS.settlementRandomness,
    ui: {
      label: "Bosättningsspridning",
      tab: "noder",
      section: "Bosättningar",
      order: 20,
      hint: "Högre värde prioriterar jämnare spridning och mer varierade placeringar.",
    },
  },
  renderScale: {
    type: "number",
    min: 50,
    max: 250,
    step: 1,
    formatLabel: PARAM_LABELS.renderScale,
    ui: {
      label: "Renderupplösning",
      tab: "avancerat",
      section: "Prestanda",
      order: 10,
      hint: "Högre värde ger skarpare bild men kostar prestanda.",
    },
  },
  fogVisionRadius: {
    type: "number",
    min: 6,
    max: 40,
    step: 1,
    formatLabel: PARAM_LABELS.fogVisionRadius,
    ui: {
      label: "Siktradie (spel)",
      tab: "avancerat",
      section: "Spelkänsla",
      order: 10,
      hint: "Hur många celler som avtäcks runt spelaren.",
    },
  },
  temperatureBias: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.temperatureBias,
    ui: {
      label: "Temperatur",
      tab: "karta",
      section: "Klimat",
      order: 10,
      hint: "Skiftar världen mot kallare eller varmare klimat.",
    },
  },
  moistureBias: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.moistureBias,
    ui: {
      label: "Fuktighet",
      tab: "karta",
      section: "Klimat",
      order: 20,
      hint: "Skiftar världen mot torrare eller fuktigare biomer.",
    },
  },
  inlandPreference: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.inlandPreference,
    ui: {
      label: "Kust/inland-fokus",
      tab: "noder",
      section: "Bosättningar",
      order: 30,
      hint: "Vänster = fler kustnära platser, höger = mer inland.",
    },
  },
  abandonedFrequency: {
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    formatLabel: PARAM_LABELS.abandonedFrequency,
    ui: {
      label: "Övergivna platser",
      tab: "noder",
      section: "Nodtyper",
      order: 20,
      hint: "Fler övergivna platser längs vägarna.",
    },
  },
  nodeMinDistance: {
    type: "number",
    min: 2,
    max: 22,
    step: 0.5,
    formatLabel: PARAM_LABELS.nodeMinDistance,
    ui: {
      label: "Min avstånd mellan platser",
      tab: "noder",
      section: "Nodtyper",
      order: 15,
      hint: "Öka för jämnare spridning och färre kluster.",
    },
  },
  startTimeOfDayHours: {
    type: "number",
    min: 0,
    max: 23,
    step: 1,
    formatLabel: PARAM_LABELS.startTimeOfDayHours,
    ui: {
      label: "Starttid (spel)",
      tab: "avancerat",
      section: "Spelkänsla",
      order: 20,
      hint: "Välj klockslag när ett nytt spel börjar i färdläget.",
    },
  },
};

export const PARAM_KEYS = Object.keys(PARAM_SCHEMA) as Array<keyof typeof PARAM_SCHEMA>;
export const NUMERIC_PARAM_KEYS = PARAM_KEYS.filter(
  (key) => PARAM_SCHEMA[key]?.type === "number",
);

export { BIOME_INFO, BIOME_KEYS } from "./biomes/index";
