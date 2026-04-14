import type {
  BiomeDefinition,
  BiomeGenerationConfig,
  BiomeRegionLabelStyle,
  JourneySilhouetteStyle,
  RGBTriplet,
  VegetationStyle,
} from "../types/biome";

function fail(message: string): never {
  throw new Error(`[biomes] ${message}`);
}

function asRecord(value: unknown, fieldPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertFiniteNumber(value: unknown, fieldPath: string): void {
  if (!Number.isFinite(value)) {
    fail(`${fieldPath} must be a finite number`);
  }
}

function assertInteger(value: unknown, fieldPath: string): void {
  if (!Number.isInteger(value)) {
    fail(`${fieldPath} must be an integer`);
  }
}

function assertString(value: unknown, fieldPath: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${fieldPath} must be a non-empty string`);
  }
}

function assertHexColor(value: unknown, fieldPath: string): void {
  assertString(value, fieldPath);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    fail(`${fieldPath} must be a hex color in #RRGGBB format`);
  }
}

function assertPalette(value: unknown, fieldPath: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${fieldPath} must be a non-empty array`);
  }

  for (let i = 0; i < value.length; i += 1) {
    const rgb = value[i] as RGBTriplet;
    if (!Array.isArray(rgb) || rgb.length !== 3) {
      fail(`${fieldPath}[${i}] must be an RGB triplet`);
    }

    for (let channel = 0; channel < 3; channel += 1) {
      const component = rgb[channel];
      assertInteger(component, `${fieldPath}[${i}][${channel}]`);
      if ((component as number) < 0 || (component as number) > 255) {
        fail(`${fieldPath}[${i}][${channel}] must be in range 0..255`);
      }
    }
  }
}

function assertRegionLabelStyle(value: unknown, fieldPath: string): void {
  const record = asRecord(value, fieldPath) as unknown as BiomeRegionLabelStyle;
  assertString(record.fontFamily, `${fieldPath}.fontFamily`);
  assertString(record.fontStyle, `${fieldPath}.fontStyle`);
  assertFiniteNumber(record.fontWeight, `${fieldPath}.fontWeight`);
  assertFiniteNumber(record.lineWidth, `${fieldPath}.lineWidth`);
  assertString(record.fillStyle, `${fieldPath}.fillStyle`);
  assertString(record.strokeStyle, `${fieldPath}.strokeStyle`);
}

function assertJourneySilhouette(value: unknown, fieldPath: string): void {
  const record = asRecord(value, fieldPath) as unknown as JourneySilhouetteStyle;
  assertFiniteNumber(record.baseY, `${fieldPath}.baseY`);
  assertFiniteNumber(record.amplitude, `${fieldPath}.amplitude`);
  assertFiniteNumber(record.wavelength1, `${fieldPath}.wavelength1`);
  assertFiniteNumber(record.wavelength2, `${fieldPath}.wavelength2`);
  assertFiniteNumber(record.sharpness, `${fieldPath}.sharpness`);
}

function assertVegetationStyle(value: unknown, fieldPath: string): void {
  const record = asRecord(value, fieldPath) as unknown as VegetationStyle;
  assertString(record.type, `${fieldPath}.type`);
  assertFiniteNumber(record.density, `${fieldPath}.density`);
  assertFiniteNumber(record.minSpacing, `${fieldPath}.minSpacing`);
  assertFiniteNumber(record.minSize, `${fieldPath}.minSize`);
  assertFiniteNumber(record.sizeRange, `${fieldPath}.sizeRange`);
  assertString(record.fill, `${fieldPath}.fill`);
  assertString(record.stroke, `${fieldPath}.stroke`);
}

function assertGeneration(value: unknown, fieldPath: string): void {
  const record = asRecord(value, fieldPath) as unknown as BiomeGenerationConfig;
  const roadTravelCost = record.roadTravelCost;
  if (
    !(
      Number.isFinite(roadTravelCost) ||
      roadTravelCost === Number.POSITIVE_INFINITY
    )
  ) {
    fail(`${fieldPath}.roadTravelCost must be finite or +Infinity`);
  }

  assertFiniteNumber(
    record.settlementHabitability,
    `${fieldPath}.settlementHabitability`,
  );
}

function assertNaming(value: unknown, fieldPath: string): void {
  const record = asRecord(value, fieldPath);
  const suffixes = record.regionSuffixes;
  if (!Array.isArray(suffixes)) {
    fail(`${fieldPath}.regionSuffixes must be an array`);
  }

  for (let i = 0; i < suffixes.length; i += 1) {
    assertString(suffixes[i], `${fieldPath}.regionSuffixes[${i}]`);
  }
}

export function validateBiomeDefinition(definition: unknown): void {
  const record = asRecord(definition, "definition") as unknown as BiomeDefinition;

  assertInteger(record.id, "definition.id");
  assertString(record.key, "definition.key");
  assertString(record.label, "definition.label");
  assertHexColor(record.baseColor, "definition.baseColor");

  if (record.render?.tonePalette) {
    assertPalette(record.render.tonePalette, "definition.render.tonePalette");
  }
  if (record.render?.vegetation) {
    assertVegetationStyle(
      record.render.vegetation,
      "definition.render.vegetation",
    );
  }

  assertRegionLabelStyle(record.labels?.mapRegion, "definition.labels.mapRegion");
  assertJourneySilhouette(
    record.journey?.silhouette,
    "definition.journey.silhouette",
  );
  assertGeneration(record.generation, "definition.generation");
  assertNaming(record.naming, "definition.naming");
}

export function validateBiomeDefinitionSet(definitions: unknown): void {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    fail("Expected a non-empty biome definition array");
  }

  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  for (const definition of definitions) {
    validateBiomeDefinition(definition);
    const typed = definition as BiomeDefinition;

    if (seenIds.has(typed.id)) {
      fail(`Duplicate biome id: ${typed.id}`);
    }
    if (seenKeys.has(typed.key)) {
      fail(`Duplicate biome key: ${typed.key}`);
    }

    seenIds.add(typed.id);
    seenKeys.add(typed.key);
  }
}
