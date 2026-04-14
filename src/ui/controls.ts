import {
  NUMERIC_PARAM_KEYS,
  PARAM_KEYS,
  PARAM_SCHEMA,
} from "../config";
import type { WorldInputParams } from "../types/world";

const TAB_ORDER = ["karta", "vatten", "noder", "avancerat"] as const;

const TAB_LABELS: Record<(typeof TAB_ORDER)[number], string> = {
  karta: "Landskap",
  vatten: "Vatten",
  noder: "Platser",
  avancerat: "Spel & Teknik",
};

type ParamKey = (typeof PARAM_KEYS)[number];
type NumericParamKey = Exclude<ParamKey, "seed">;

interface ParamUiSchema {
  label?: string;
  tab?: string;
  section?: string;
  order?: number;
  hint?: string;
}

interface NumberParamSchema {
  type: "number";
  min: number;
  max: number;
  step?: number;
  formatLabel?: (value: number) => string;
  ui?: ParamUiSchema;
}

interface ControlsRenderOptions {
  initialTab?: string;
}

export function renderControlsFromSchema(
  form: HTMLFormElement | null,
  options: ControlsRenderOptions = {},
): void {
  if (!form) {
    return;
  }

  const mount = form.querySelector<HTMLElement>("[data-controls-mount]");
  if (!mount) {
    return;
  }

  const entriesByTab = new Map<
    string,
    Array<{ key: ParamKey; schema: NumberParamSchema }>
  >();

  for (const [key, rawSchema] of Object.entries(PARAM_SCHEMA) as Array<[
    ParamKey,
    (typeof PARAM_SCHEMA)[ParamKey],
  ]>) {
    if (rawSchema.type !== "number") {
      continue;
    }

    const schema = rawSchema as NumberParamSchema;
    const tab = schema.ui?.tab ?? "avancerat";
    if (!entriesByTab.has(tab)) {
      entriesByTab.set(tab, []);
    }
    entriesByTab.get(tab)?.push({ key, schema });
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
    ...tabs.map((tab) => buildTabPanel(tab, entriesByTab.get(tab))),
  ].join("");

  const initialTab = tabs.includes(options.initialTab as (typeof TAB_ORDER)[number])
    ? options.initialTab
    : tabs[0];
  setActiveTab(mount, initialTab);

  for (const button of mount.querySelectorAll<HTMLButtonElement>(".tab-btn")) {
    button.addEventListener("click", () => {
      setActiveTab(mount, button.dataset.tab);
    });
  }
}

export function hydrateForm(params: WorldInputParams | null | undefined): void {
  if (!params) {
    return;
  }

  for (const key of PARAM_KEYS) {
    const el = document.querySelector<HTMLInputElement>(`#${key}`);
    const value = params[key as keyof WorldInputParams];
    if (!el || value == null) {
      continue;
    }
    el.value = String(value);
  }
}

export function getFormValues(form: HTMLFormElement): WorldInputParams {
  const data = new FormData(form);
  const values: WorldInputParams = {};

  for (const key of PARAM_KEYS) {
    const schema = PARAM_SCHEMA[key];
    const raw = data.get(key);

    if (key === "seed") {
      values.seed = typeof raw === "string" ? raw : "";
      continue;
    }

    if (schema.type === "number") {
      values[key as NumericParamKey] = Number(raw);
    }
  }

  return values;
}

export function bindRangeLabels(onUpdate: () => void = updateLabels): void {
  NUMERIC_PARAM_KEYS.forEach((key) => {
    document
      .querySelector<HTMLInputElement>(`#${key}`)
      ?.addEventListener("input", onUpdate);
  });
  onUpdate();
}

export function updateLabels(): void {
  NUMERIC_PARAM_KEYS.forEach((key) => {
    const formatter = (PARAM_SCHEMA[key] as NumberParamSchema | undefined)?.formatLabel;
    if (typeof formatter !== "function") {
      return;
    }

    const input = document.querySelector<HTMLInputElement>(`#${key}`);
    const valueNode = document.querySelector<HTMLElement>(`#${key}-value`);
    if (!input || !valueNode) {
      return;
    }

    valueNode.textContent = formatter(Number(input.value));
  });
}

export function setSeedValue(seed: string): void {
  const el = document.querySelector<HTMLInputElement>("#seed");
  if (el) {
    el.value = seed;
  }
}

export function randomSeed(): string {
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
  const parts: string[] = [];

  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `${consonants[Math.floor(Math.random() * consonants.length)]}${vowels[Math.floor(Math.random() * vowels.length)]}${consonants[Math.floor(Math.random() * consonants.length)]}`,
    );
  }

  return parts.join("-");
}

function buildRangeField(key: ParamKey, schema: NumberParamSchema): string {
  const label = schema.ui?.label ?? key;
  const step = schema.step ?? 1;
  const hint = schema.ui?.hint
    ? `<div class="field-hint">${schema.ui.hint}</div>`
    : "";

  return `<div class="field">
    <div class="field-header">
      <span class="field-label">${label}</span>
      <span id="${key}-value" class="field-value"></span>
    </div>
    ${hint}
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

function buildTabPanel(
  tab: string,
  entries: Array<{ key: ParamKey; schema: NumberParamSchema }> = [],
): string {
  const sections = new Map<string, Array<{ key: ParamKey; schema: NumberParamSchema }>>();

  for (const entry of entries) {
    const section = entry.schema.ui?.section ?? "";
    if (!sections.has(section)) {
      sections.set(section, []);
    }
    sections.get(section)?.push(entry);
  }

  const sectionHtml = Array.from(sections.entries())
    .map(([section, sectionEntries], index) => {
      const heading =
        section && section.trim()
          ? `<h3 class="form-section-heading">${section}</h3>`
          : "";
      const fields = sectionEntries
        .map(({ key, schema }) => buildRangeField(key, schema))
        .join("");
      const extraClass = index === 0 ? " form-section--first" : "";
      return `<section class="form-section${extraClass}">${heading}${fields}</section>`;
    })
    .join("");

  return `<div class="tab-panel" data-tab-panel="${tab}" hidden>${sectionHtml}</div>`;
}

function setActiveTab(root: HTMLElement, activeTab?: string): void {
  for (const button of root.querySelectorAll<HTMLElement>(".tab-btn")) {
    button.dataset.active = String(button.dataset.tab === activeTab);
  }
  for (const panel of root.querySelectorAll<HTMLElement>(".tab-panel")) {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  }
}
