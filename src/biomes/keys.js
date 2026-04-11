export const BIOME_KEYS = Object.freeze({
  OCEAN: 0,
  LAKE: 1,
  PLAINS: 2,
  FOREST: 3,
  RAINFOREST: 4,
  DESERT: 5,
  TUNDRA: 6,
  HIGHLANDS: 7,
  MOUNTAIN: 8,
});

export const BIOME_ID_LIST = Object.freeze(
  Object.values(BIOME_KEYS).sort((a, b) => a - b),
);
