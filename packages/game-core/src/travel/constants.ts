export const DEFAULT_MAX_HEALTH = 12;
export const DEFAULT_MAX_STAMINA = 60;
export const STAMINA_PER_TRAVEL_HOUR = 3;
export const STAMINA_PER_HUNT_HOUR = 6;
export const STAMINA_PER_REST_HOUR = 9;
export const ACTION_HOUR_OPTIONS = Object.freeze([1, 3, 8]);
export const REST_HOUR_OPTIONS = ACTION_HOUR_OPTIONS;
export const HUNT_HOUR_OPTIONS = ACTION_HOUR_OPTIONS;
export const HUNT_MEAT_LOOT_COLUMNS = 1;
export const HUNT_MEAT_LOOT_ROWS = 1;
export const HUNT_AREA_RECOVERY_PER_HOUR = 0.024;
export const HUNT_SUCCESS_MIN_CHANCE = 0.04;
export const HUNT_SUCCESS_MAX_CHANCE = 0.93;
export const HUNT_SEA_ROUTE_REASON =
  "Det finns inget jaktbart vilt ute på öppet hav.";
export const HUNT_UNAVAILABLE_REASON =
  "Här finns inga tydliga jaktspår just nu.";
export const HUNT_TIME_OF_DAY_MODIFIERS = Object.freeze([
  { start: 0, end: 4, factor: 0.5, label: "Djup natt" },
  { start: 4, end: 7, factor: 0.88, label: "Gryning" },
  { start: 7, end: 11, factor: 0.64, label: "Morgon" },
  { start: 11, end: 16, factor: 0.48, label: "Mitt på dagen" },
  { start: 16, end: 20, factor: 0.85, label: "Skymning" },
  { start: 20, end: 24, factor: 0.63, label: "Sen kväll" },
]);
export const HUNT_BIOME_FACTORS = Object.freeze({
  forest: 0.92,
  rainforest: 0.88,
  plains: 0.68,
  highlands: 0.72,
  mountain: 0.45,
  tundra: 0.43,
  desert: 0.31,
  lake: 0.5,
  ocean: 0.16,
});
