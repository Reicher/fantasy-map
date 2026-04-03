import { PARAM_LABELS } from "../config.js?v=20260403d";

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
  "fogVisionRadius"
];

export function hydrateForm(params) {
  document.querySelector("#seed").value = params.seed;
  document.querySelector("#mapSize").value = params.mapSize;
  document.querySelector("#mountainousness").value = params.mountainousness;
  document.querySelector("#cityDensity").value = params.cityDensity;
  document.querySelector("#riverAmount").value = params.riverAmount;
  document.querySelector("#lakeAmount").value = params.lakeAmount;
  document.querySelector("#lakeSize").value = params.lakeSize;
  document.querySelector("#coastComplexity").value = params.coastComplexity;
  document.querySelector("#edgeDetail").value = params.edgeDetail;
  document.querySelector("#minBiomeSize").value = params.minBiomeSize;
  document.querySelector("#renderScale").value = params.renderScale;
  document.querySelector("#fogVisionRadius").value = params.fogVisionRadius;
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
    fogVisionRadius: Number(data.get("fogVisionRadius"))
  };
}

export function bindRangeLabels(onUpdate = updateLabels) {
  RANGE_KEYS.forEach((key) => {
    document.querySelector(`#${key}`).addEventListener("input", onUpdate);
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
  document.querySelector("#seed").value = seed;
}

export function randomSeed() {
  const consonants = ["b", "d", "f", "g", "k", "l", "m", "n", "r", "s", "t", "v"];
  const vowels = ["a", "e", "i", "o", "u", "ae", "ou"];
  const parts = [];
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `${consonants[Math.floor(Math.random() * consonants.length)]}${vowels[Math.floor(Math.random() * vowels.length)]}${consonants[Math.floor(Math.random() * consonants.length)]}`
    );
  }
  return parts.join("-");
}
