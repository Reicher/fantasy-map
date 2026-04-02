import { BIOME_KEYS } from "../config.js";

export function isSnowCell(biomeKey, elevation, mountain, temperature, showSnow = true) {
  if (!showSnow || biomeKey === BIOME_KEYS.OCEAN || biomeKey === BIOME_KEYS.LAKE) {
    return false;
  }

  const polarSnow = temperature < 0.16;
  const tundraSnow = biomeKey === BIOME_KEYS.TUNDRA && temperature < 0.28;
  const alpineSnow =
    (biomeKey === BIOME_KEYS.MOUNTAIN || biomeKey === BIOME_KEYS.HIGHLANDS || mountain > 0.62) &&
    elevation > 0.72 &&
    temperature < 0.34;
  const mountainApronSnow = mountain > 0.54 && elevation > 0.64 && temperature < 0.38;

  return polarSnow || tundraSnow || alpineSnow || mountainApronSnow;
}
