import { PARAM_LABELS } from "../config.js?v=20260408b";

const RANGE_KEYS = [
  "mapSize",
  "mountainousness",
  "cityDensity",
  "riverAmount",
  "lakeAmount",
  "lakeSize",
  "coastComplexity",
  "edgeDetail",
  "minBiomeSize",
  "renderScale",
  "fogVisionRadius",
  "temperatureBias",
  "moistureBias",
  "coastalBias",
  "poiSettlementWeight",
  "poiCrashSiteWeight",
  "poiSignpostWeight",
  "roadShortcutAggression",
  "roadReuseBias",
  "roadCityAvoidance",
  "roadMaxConnectionsPerCity",
];

export function hydrateForm(params) {
  const seedEl = document.querySelector("#seed");
  if (seedEl) seedEl.value = params.seed;
  for (const key of RANGE_KEYS) {
    const el = document.querySelector(`#${key}`);
    if (el) el.value = params[key];
  }
}

export function getFormValues(form) {
  const data = new FormData(form);
  return {
    seed: data.get("seed"),
    mapSize: Number(data.get("mapSize")),
    mountainousness: Number(data.get("mountainousness")),
    cityDensity: Number(data.get("cityDensity")),
    riverAmount: Number(data.get("riverAmount")),
    lakeAmount: Number(data.get("lakeAmount")),
    lakeSize: Number(data.get("lakeSize")),
    coastComplexity: Number(data.get("coastComplexity")),
    edgeDetail: Number(data.get("edgeDetail")),
    minBiomeSize: Number(data.get("minBiomeSize")),
    renderScale: Number(data.get("renderScale")),
    fogVisionRadius: Number(data.get("fogVisionRadius")),
    temperatureBias: Number(data.get("temperatureBias")),
    moistureBias: Number(data.get("moistureBias")),
    coastalBias: Number(data.get("coastalBias")),
    poiSettlementWeight: Number(data.get("poiSettlementWeight")),
    poiCrashSiteWeight: Number(data.get("poiCrashSiteWeight")),
    poiSignpostWeight: Number(data.get("poiSignpostWeight")),
    roadShortcutAggression: Number(data.get("roadShortcutAggression")),
    roadReuseBias: Number(data.get("roadReuseBias")),
    roadCityAvoidance: Number(data.get("roadCityAvoidance")),
    roadMaxConnectionsPerCity: Number(data.get("roadMaxConnectionsPerCity")),
  };
}

export function bindRangeLabels(onUpdate = updateLabels) {
  RANGE_KEYS.forEach((key) => {
    document.querySelector(`#${key}`)?.addEventListener("input", onUpdate);
  });
  onUpdate();
}

export function updateLabels() {
  Object.entries(PARAM_LABELS).forEach(([key, formatter]) => {
    const input = document.querySelector(`#${key}`);
    const valueNode = document.querySelector(`#${key}-value`);
    if (!input || !valueNode) {
      return;
    }
    valueNode.textContent = formatter(Number(input.value));
  });
}

export function setSeedValue(seed) {
  const el = document.querySelector("#seed");
  if (el) el.value = seed;
}

export function randomSeed() {
  const consonants = [
    "b",
    "d",
    "f",
    "g",
    "k",
    "l",
    "m",
    "n",
    "r",
    "s",
    "t",
    "v",
  ];
  const vowels = ["a", "e", "i", "o", "u", "ae", "ou"];
  const parts = [];
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `${consonants[Math.floor(Math.random() * consonants.length)]}${vowels[Math.floor(Math.random() * vowels.length)]}${consonants[Math.floor(Math.random() * consonants.length)]}`,
    );
  }
  return parts.join("-");
}
