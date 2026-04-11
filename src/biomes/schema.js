function fail(message) {
  throw new Error(`[biomes] ${message}`);
}

function assertFiniteNumber(value, fieldPath) {
  if (!Number.isFinite(value)) {
    fail(`${fieldPath} must be a finite number`);
  }
}

function assertInteger(value, fieldPath) {
  if (!Number.isInteger(value)) {
    fail(`${fieldPath} must be an integer`);
  }
}

function assertString(value, fieldPath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${fieldPath} must be a non-empty string`);
  }
}

function assertHexColor(value, fieldPath) {
  assertString(value, fieldPath);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    fail(`${fieldPath} must be a hex color in #RRGGBB format`);
  }
}

function assertPalette(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${fieldPath} must be a non-empty array`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const rgb = value[i];
    if (!Array.isArray(rgb) || rgb.length !== 3) {
      fail(`${fieldPath}[${i}] must be an RGB triplet`);
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const component = rgb[channel];
      assertInteger(component, `${fieldPath}[${i}][${channel}]`);
      if (component < 0 || component > 255) {
        fail(`${fieldPath}[${i}][${channel}] must be in range 0..255`);
      }
    }
  }
}

function assertRegionLabelStyle(value, fieldPath) {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }
  assertString(value.fontFamily, `${fieldPath}.fontFamily`);
  assertString(value.fontStyle, `${fieldPath}.fontStyle`);
  assertFiniteNumber(value.fontWeight, `${fieldPath}.fontWeight`);
  assertFiniteNumber(value.lineWidth, `${fieldPath}.lineWidth`);
  assertString(value.fillStyle, `${fieldPath}.fillStyle`);
  assertString(value.strokeStyle, `${fieldPath}.strokeStyle`);
}

function assertJourneySilhouette(value, fieldPath) {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }
  assertFiniteNumber(value.baseY, `${fieldPath}.baseY`);
  assertFiniteNumber(value.amplitude, `${fieldPath}.amplitude`);
  assertFiniteNumber(value.wavelength1, `${fieldPath}.wavelength1`);
  assertFiniteNumber(value.wavelength2, `${fieldPath}.wavelength2`);
  assertFiniteNumber(value.sharpness, `${fieldPath}.sharpness`);
}

function assertVegetationStyle(value, fieldPath) {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }
  assertString(value.type, `${fieldPath}.type`);
  assertFiniteNumber(value.density, `${fieldPath}.density`);
  assertFiniteNumber(value.minSpacing, `${fieldPath}.minSpacing`);
  assertFiniteNumber(value.minSize, `${fieldPath}.minSize`);
  assertFiniteNumber(value.sizeRange, `${fieldPath}.sizeRange`);
  assertString(value.fill, `${fieldPath}.fill`);
  assertString(value.stroke, `${fieldPath}.stroke`);
}

function assertGeneration(value, fieldPath) {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }

  const roadTravelCost = value.roadTravelCost;
  if (!(Number.isFinite(roadTravelCost) || roadTravelCost === Number.POSITIVE_INFINITY)) {
    fail(`${fieldPath}.roadTravelCost must be finite or +Infinity`);
  }

  assertFiniteNumber(
    value.settlementHabitability,
    `${fieldPath}.settlementHabitability`,
  );
}

function assertNaming(value, fieldPath) {
  if (!value || typeof value !== "object") {
    fail(`${fieldPath} must be an object`);
  }
  if (!Array.isArray(value.regionSuffixes)) {
    fail(`${fieldPath}.regionSuffixes must be an array`);
  }
  for (let i = 0; i < value.regionSuffixes.length; i += 1) {
    assertString(value.regionSuffixes[i], `${fieldPath}.regionSuffixes[${i}]`);
  }
}

export function validateBiomeDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    fail(`Biome definition must be an object`);
  }

  assertInteger(definition.id, `definition.id`);
  assertString(definition.key, `definition.key`);
  assertString(definition.label, `definition.label`);
  assertHexColor(definition.baseColor, `definition.baseColor`);

  if (definition.render?.tonePalette) {
    assertPalette(definition.render.tonePalette, `definition.render.tonePalette`);
  }
  if (definition.render?.vegetation) {
    assertVegetationStyle(
      definition.render.vegetation,
      `definition.render.vegetation`,
    );
  }

  assertRegionLabelStyle(
    definition.labels?.mapRegion,
    `definition.labels.mapRegion`,
  );
  assertJourneySilhouette(
    definition.journey?.silhouette,
    `definition.journey.silhouette`,
  );
  assertGeneration(definition.generation, `definition.generation`);
  assertNaming(definition.naming, `definition.naming`);
}

export function validateBiomeDefinitionSet(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    fail(`Expected a non-empty biome definition array`);
  }

  const seenIds = new Set();
  const seenKeys = new Set();
  for (const definition of definitions) {
    validateBiomeDefinition(definition);
    if (seenIds.has(definition.id)) {
      fail(`Duplicate biome id: ${definition.id}`);
    }
    if (seenKeys.has(definition.key)) {
      fail(`Duplicate biome key: ${definition.key}`);
    }
    seenIds.add(definition.id);
    seenKeys.add(definition.key);
  }
}
