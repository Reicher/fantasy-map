import { PARAM_SCHEMA } from "../config.js";
import { createNameGenerator } from "../naming.js?v=20260402d";
import { createRng } from "../random.js";
import { clamp } from "../utils.js";
import { generateCities } from "./cities.js?v=20260407a";
import { generateClimate } from "./climate.js?v=20260407a";
import { compileGeometry } from "./compileGeometry.js?v=20260408c";
import { buildFeatureCatalog } from "./features.js?v=20260408h";
import { generateHydrology } from "./hydrology.js?v=20260407a";
import { buildWorldNetwork } from "./network.js?v=20260401i";
import { applyFeatureNames } from "./nameFeatures.js";
import { buildRegions } from "./regions.js?v=20260402c";
import { generateRoads } from "./roads.js?v=20260408n";
import { buildSurfaceGeometry } from "./surface.js?v=20260403b";
import { generateTerrain } from "./terrain.js?v=20260401i";
import { buildTravelGraph } from "./travelGraph.js?v=20260401a";
import { buildWorldStats } from "./worldStats.js?v=20260408a";

export function normalizeParams(input) {
  const source = input ?? {};
  const normalized = {};

  for (const [key, schema] of Object.entries(PARAM_SCHEMA)) {
    if (schema.type === "string") {
      normalized[key] = normalizeSeed(source[key], schema.default);
      continue;
    }

    normalized[key] = clamp(
      asNumber(source[key], schema.default),
      schema.min,
      schema.max,
    );
  }

  return normalized;
}

export function generateWorld(inputParams) {
  const params = normalizeParams(inputParams);
  const terrain = generateTerrain(params);
  const hydrology = generateHydrology(terrain, params);
  const climate = generateClimate(terrain, hydrology, params);
  const names = createNameGenerator(params.seed);
  const regions = buildRegions(terrain, climate, hydrology, params);
  const named = applyFeatureNames(terrain, hydrology, regions, names);

  const world = {
    params,
    terrain,
    hydrology: named.hydrology,
    climate,
    regions: named.regions,
  };

  world.surface = buildSurfaceGeometry(world);
  world.cities = generateCities(world, names);
  world.playerStart = selectPlayerStart(world.cities, params.seed);
  world.roads = generateRoads(world);
  world.network = buildWorldNetwork(world);
  world.travelGraph = buildTravelGraph(world.network, world.terrain.width);
  world.features = buildFeatureCatalog(world);
  world.geometry = compileGeometry(world);
  world.title = "";
  world.stats = buildWorldStats(world);

  return world;
}

function selectPlayerStart(cities, seed) {
  if (!cities.length) {
    return null;
  }

  const coastalCities = cities.filter((city) => city.coastal);
  const candidates = coastalCities.length > 0 ? coastalCities : cities;
  const rng = createRng(`${seed}::player-start`);
  const city = rng.weighted(candidates, (candidate) =>
    Math.max(1, candidate.score),
  );

  return {
    cityId: city.id,
    x: city.x,
    y: city.y,
  };
}

function asNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSeed(value, fallback) {
  const trimmed = String(value ?? fallback).trim();
  return trimmed || fallback;
}
