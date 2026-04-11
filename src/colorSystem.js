import {
  BIOME_DEFINITIONS,
  BIOME_INFO,
  BIOME_KEYS,
} from "./biomes/index.js";

const BIOME_BASE_HEX_BY_ID = Object.fromEntries(
  BIOME_DEFINITIONS.map((definition) => [
    definition.id,
    definition.baseColor.toLowerCase(),
  ]),
);

const BIOME_BASE_HEX_BY_NAME = Object.fromEntries(
  BIOME_DEFINITIONS.map((definition) => [
    definition.key,
    definition.baseColor.toLowerCase(),
  ]),
);

export const ALPHA = Object.freeze({
  clear: 0,
  whisper: 0.08,
  faint: 0.1,
  soft: 0.16,
  subtle: 0.24,
  medium: 0.42,
  strong: 0.52,
  vivid: 0.72,
  rich: 0.84,
  label: 0.88,
  surface: 0.92,
  opaqueSoft: 0.96,
  opaqueHard: 0.98,
  snowFill: 0.99,
  full: 1,
});

const ALPHA_VALUES = Object.freeze(
  [...new Set(Object.values(ALPHA))].sort((a, b) => a - b),
);

export const WORLD_RGB = {
  ocean: [138, 160, 168],
  lakeFrozen: [228, 233, 236],
  mountain: [193, 181, 163],
  snow: [244, 243, 238],
};

export const DEPTH_SHADE_BY_LAYER = {
  foreground: { target: [18, 14, 8], amount: 0.42 },
  near1: { target: [28, 22, 14], amount: 0.32 },
  near2: { target: [45, 42, 35], amount: 0.18 },
  mid: { target: [152, 158, 168], amount: 0.32 },
  far: { target: [192, 200, 214], amount: 0.54 },
  ground: { target: null, amount: 0 },
};

// Hard cap palette for world-rendered colors (<= 45 entries).
const GAME_PALETTE_RGB = [
    [18, 14, 8],
    [28, 22, 14],
    [45, 42, 35],
    [60, 108, 150],
    [64, 56, 47],
    [69, 92, 101],
    [72, 122, 162],
    [74, 58, 37],
    [80, 97, 66],
    [88, 90, 98],
    [90, 73, 49],
    [92, 69, 49],
    [98, 150, 186],
    [104, 118, 126],
    [107, 102, 94],
    [114, 108, 102],
    [121, 115, 108],
    [124, 92, 50],
    [126, 104, 72],
    [134, 128, 121],
    [138, 160, 168],
    [152, 158, 168],
    [152, 204, 240],
    [165, 136, 86],
    [168, 200, 222],
    [181, 188, 196],
    [192, 200, 214],
    [193, 181, 163],
    [229, 227, 222],
    [235, 233, 228],
    [244, 243, 238],
    [246, 244, 239],
    [255, 220, 100],
    [255, 255, 255],
    // Biome base colors
    [139, 165, 172],
    [144, 165, 173],
    [185, 178, 127],
    [125, 144, 101],
    [95, 123, 85],
    [201, 176, 123],
    [174, 178, 161],
    [148, 133, 108],
    [129, 112, 93],
];

const BIOME_TONE_PALETTE_BY_NAME = Object.fromEntries(
  BIOME_DEFINITIONS.filter(
    (definition) => definition.render?.tonePalette?.length > 0,
  ).map((definition) => [definition.key, definition.render.tonePalette]),
);

function normalizeAlpha(alpha) {
  let best = ALPHA_VALUES[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of ALPHA_VALUES) {
    const dist = Math.abs(alpha - candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function mixRgb(base, target, amount) {
  return [
    clampByte(base[0] * (1 - amount) + target[0] * amount),
    clampByte(base[1] * (1 - amount) + target[1] * amount),
    clampByte(base[2] * (1 - amount) + target[2] * amount),
  ];
}

export function rgbToRgbaString(rgb, alpha) {
  const normalizedAlpha = normalizeAlpha(alpha);
  return `rgba(${clampByte(rgb[0])}, ${clampByte(rgb[1])}, ${clampByte(rgb[2])}, ${normalizedAlpha})`;
}

export function getBiomeBaseHex(biomeKeyOrName) {
  if (typeof biomeKeyOrName === "number") {
    return BIOME_BASE_HEX_BY_ID[biomeKeyOrName] ?? BIOME_BASE_HEX_BY_ID[BIOME_KEYS.PLAINS];
  }
  return BIOME_BASE_HEX_BY_NAME[biomeKeyOrName] ?? BIOME_BASE_HEX_BY_NAME.plains;
}

export function getBiomeBaseRgb(biomeKeyOrName) {
  return hexToRgb(getBiomeBaseHex(biomeKeyOrName));
}

function resolveBiomeName(biomeKeyOrName) {
  if (typeof biomeKeyOrName === "number") {
    return BIOME_INFO[biomeKeyOrName]?.key ?? null;
  }
  return biomeKeyOrName ?? null;
}

function capToPalette(rgb, palette) {
  const [r, g, b] = rgb;
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    const dr = r - candidate[0];
    const dg = g - candidate[1];
    const db = b - candidate[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return [best[0], best[1], best[2]];
}

export function capToGamePalette(rgb) {
  return capToPalette(rgb, GAME_PALETTE_RGB);
}

export function capToBiomePalette(rgb, biomeKeyOrName) {
  const biomeName = resolveBiomeName(biomeKeyOrName);
  const palette = BIOME_TONE_PALETTE_BY_NAME[biomeName] ?? GAME_PALETTE_RGB;
  return capToPalette(rgb, palette);
}
