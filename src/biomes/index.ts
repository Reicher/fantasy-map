import { BIOME_DEFINITIONS as RAW_BIOME_DEFINITIONS } from "./definitions/index";
import { BIOME_ID_LIST, BIOME_KEYS, type BiomeId } from "./keys";
import { validateBiomeDefinitionSet } from "./schema";
import type { BiomeDefinition, BiomeInfoEntry, BiomeKeyName } from "../types/biome";

const BIOME_DEFINITIONS = Object.freeze(
  [...RAW_BIOME_DEFINITIONS]
    .sort((a, b) => a.id - b.id)
    .map((definition) => Object.freeze(definition)),
) as readonly BiomeDefinition[];

validateBiomeDefinitionSet(BIOME_DEFINITIONS);

const BIOME_DEFINITION_BY_ID = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.id, definition])),
) as Record<number, BiomeDefinition>;

const BIOME_DEFINITION_BY_KEY = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.key, definition])),
) as Record<string, BiomeDefinition>;

const BIOME_KEY_NAME_BY_ID = Object.freeze(
  Object.fromEntries(BIOME_DEFINITIONS.map((definition) => [definition.id, definition.key])),
) as Record<number, BiomeKeyName>;

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
) as Readonly<Record<number, BiomeInfoEntry>>;

const PLAINS_KEY: BiomeKeyName = "plains";
const PLAINS_ID: BiomeId = BIOME_KEYS.PLAINS;

export {
  BIOME_DEFINITIONS,
  BIOME_DEFINITION_BY_ID,
  BIOME_DEFINITION_BY_KEY,
  BIOME_ID_LIST,
  BIOME_KEYS,
};

export function getBiomeDefinitionById(id: number): BiomeDefinition {
  return BIOME_DEFINITION_BY_ID[id] ?? BIOME_DEFINITION_BY_ID[PLAINS_ID];
}

export function getBiomeDefinitionByKey(key: string): BiomeDefinition {
  return BIOME_DEFINITION_BY_KEY[key] ?? BIOME_DEFINITION_BY_KEY[PLAINS_KEY];
}

export function normalizeBiomeKeyName(value: unknown): BiomeKeyName | null {
  if (typeof value === "number") {
    return BIOME_KEY_NAME_BY_ID[value] ?? null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return BIOME_DEFINITION_BY_KEY[normalized]
      ? (normalized as BiomeKeyName)
      : null;
  }
  return null;
}

export function getBiomeRoadTravelCostById(id: number): number {
  return getBiomeDefinitionById(id).generation.roadTravelCost;
}

export function getBiomeSettlementHabitabilityById(id: number): number {
  return getBiomeDefinitionById(id).generation.settlementHabitability;
}

export function getBiomeRegionSuffixesById(id: number): string[] {
  return getBiomeDefinitionById(id).naming.regionSuffixes;
}
