import {
  NUMERIC_PARAM_KEYS,
  PARAM_KEYS,
  PARAM_SCHEMA,
} from "../config.js?v=20260410d";

const TAB_ORDER = ["karta", "vatten", "noder", "vagar", "avancerat"];
const TAB_LABELS = {
  karta: "Karta",
  vatten: "Vatten",
  noder: "Noder",
  vagar: "Vägar",
  avancerat: "Avancerat",
};

export function renderControlsFromSchema(form, options = {}) {
  if (!form) {
    return;
  }

  const mount = form.querySelector("[data-controls-mount]");
  if (!mount) {
    return;
  }

  const entriesByTab = new Map();
  for (const [key, schema] of Object.entries(PARAM_SCHEMA)) {
    if (schema.type !== "number") {
      continue;
    }
    const tab = schema.ui?.tab ?? "avancerat";
    if (!entriesByTab.has(tab)) {
      entriesByTab.set(tab, []);
    }
    entriesByTab.get(tab).push({ key, schema });
  }

  for (const entries of entriesByTab.values()) {
    entries.sort(
      (a, b) =>
        (a.schema.ui?.order ?? Number.MAX_SAFE_INTEGER) -
        (b.schema.ui?.order ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const tabs = TAB_ORDER.filter((tab) => (entriesByTab.get(tab)?.length ?? 0) > 0);
  mount.innerHTML = [
    `<nav class="tab-bar" aria-label="Inställningar">`,
    ...tabs.map(
      (tab) =>
        `<button class="tab-btn" data-tab="${tab}" type="button">${TAB_LABELS[tab] ?? tab}</button>`,
    ),
    "</nav>",
    ...tabs.map((tab) => {
      const fields = entriesByTab
        .get(tab)
        .map(({ key, schema }) => buildRangeField(key, schema))
        .join("");
      return `<div class="tab-panel" data-tab-panel="${tab}" hidden>${fields}</div>`;
    }),
  ].join("");

  const initialTab = tabs.includes(options.initialTab) ? options.initialTab : tabs[0];
  setActiveTab(mount, initialTab);
  for (const button of mount.querySelectorAll(".tab-btn")) {
    button.addEventListener("click", () => {
      setActiveTab(mount, button.dataset.tab);
    });
  }
}

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

function buildRangeField(key, schema) {
  const label = schema.ui?.label ?? key;
  const step = schema.step ?? 1;
  return `<div class="field">
    <div class="field-header">
      <span class="field-label">${label}</span>
      <span id="${key}-value" class="field-value"></span>
    </div>
    <input
      id="${key}"
      name="${key}"
      type="range"
      min="${schema.min}"
      max="${schema.max}"
      step="${step}"
    />
  </div>`;
}

function setActiveTab(root, activeTab) {
  for (const button of root.querySelectorAll(".tab-btn")) {
    button.dataset.active = String(button.dataset.tab === activeTab);
  }
  for (const panel of root.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  }
}
