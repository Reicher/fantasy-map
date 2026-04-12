import { BIOME_DEFINITIONS as RAW_BIOME_DEFINITIONS } from "./definitions/index.js";
import { BIOME_ID_LIST, BIOME_KEYS } from "./keys.js";
import { validateBiomeDefinitionSet } from "./schema.js";

const BIOME_DEFINITIONS = Object.freeze(
  [...RAW_BIOME_DEFINITIONS]
    .sort((a, b) => a.id - b.id)
    .map((definition) => Object.freeze(definition)),
);

validateBiomeDefinitionSet(BIOME_DEFINITIONS);

const BIOME_DEFINITION_BY_ID = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.id, definition])),
);

const BIOME_DEFINITION_BY_KEY = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.key, definition])),
);

const BIOME_KEY_NAME_BY_ID = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.id, definition.key])),
);

export const BIOME_INFO = Object.freeze(
  Object.fromEntries(
    BIOME_DEFINITIONS.map((definition) => [
      definition.id,
      Object.freeze({
        key: definition.key,
        label: definition.label,
        color: definition.baseColor,
      }),
    ]),
  ),
);

const PLAINS_KEY = "plains";
const PLAINS_ID = BIOME_KEYS.PLAINS;

export {
  BIOME_DEFINITIONS,
  BIOME_DEFINITION_BY_ID,
  BIOME_DEFINITION_BY_KEY,
  BIOME_ID_LIST,
  BIOME_KEYS,
};

export function getBiomeDefinitionById(id) {
  return BIOME_DEFINITION_BY_ID[id] ?? BIOME_DEFINITION_BY_ID[PLAINS_ID];
}

export function getBiomeDefinitionByKey(key) {
  return BIOME_DEFINITION_BY_KEY[key] ?? BIOME_DEFINITION_BY_KEY[PLAINS_KEY];
}

export function normalizeBiomeKeyName(value) {
  if (typeof value === "number") {
    return BIOME_KEY_NAME_BY_ID[value] ?? null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return BIOME_DEFINITION_BY_KEY[normalized] ? normalized : null;
  }
  return null;
}

export function getBiomeRoadTravelCostById(id) {
  return getBiomeDefinitionById(id).generation.roadTravelCost;
}

export function getBiomeSettlementHabitabilityById(id) {
  return getBiomeDefinitionById(id).generation.settlementHabitability;
}

export function getBiomeRegionSuffixesById(id) {
  return getBiomeDefinitionById(id).naming.regionSuffixes;
}
