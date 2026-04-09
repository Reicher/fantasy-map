import {
  NUMERIC_PARAM_KEYS,
  PARAM_KEYS,
  PARAM_SCHEMA,
} from "../config.js?v=20260408b";

export function hydrateForm(params) {
  for (const key of PARAM_KEYS) {
    const el = document.querySelector(`#${key}`);
    if (!el || params[key] == null) {
      continue;
    }
    el.value = String(params[key]);
  }
}

export function getFormValues(form) {
  const data = new FormData(form);
  const values = {};

  for (const key of PARAM_KEYS) {
    const schema = PARAM_SCHEMA[key];
    const raw = data.get(key);
    values[key] =
      schema.type === "number"
        ? Number(raw)
        : typeof raw === "string"
          ? raw
          : "";
  }

  return values;
}

export function bindRangeLabels(onUpdate = updateLabels) {
  NUMERIC_PARAM_KEYS.forEach((key) => {
    document.querySelector(`#${key}`)?.addEventListener("input", onUpdate);
  });
  onUpdate();
}

export function updateLabels() {
  NUMERIC_PARAM_KEYS.forEach((key) => {
    const formatter = PARAM_SCHEMA[key]?.formatLabel;
    if (typeof formatter !== "function") {
      return;
    }
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
