import { createNameGenerator } from "../naming.js?v=20260402d";
import { createRng } from "../random.js";
import { generateCities } from "./cities.js?v=20260407a";
import { generateClimate } from "./climate.js?v=20260407a";
import { compileGeometry } from "./compileGeometry.js?v=20260403a";
import { buildFeatureCatalog } from "./features.js?v=20260403a";
import { generateHydrology } from "./hydrology.js?v=20260407a";
import { buildWorldNetwork } from "./network.js?v=20260401i";
import { applyFeatureNames } from "./nameFeatures.js";
import { buildRegions } from "./regions.js?v=20260402c";
import { generateRoads } from "./roads.js?v=20260403c";
import { buildSurfaceGeometry } from "./surface.js?v=20260403b";
import { generateTerrain } from "./terrain.js?v=20260401i";
import { buildTravelGraph } from "./travelGraph.js?v=20260401a";
import { buildWorldStats } from "./worldStats.js?v=20260402c";

export function normalizeParams(input) {
  const legacyWater = asNumber(input.waterRichness, 56);
  return {
    seed: String(input.seed ?? "saltwind-01").trim() || "saltwind-01",
    mapSize: clamp(asNumber(input.mapSize, 58), 10, 100),
    mountainousness: clamp(asNumber(input.mountainousness, 54), 0, 100),
    cityDensity: clamp(asNumber(input.cityDensity, 20), 0, 100),
    riverAmount: clamp(asNumber(input.riverAmount, 56), 0, 100),
    lakeAmount: clamp(asNumber(input.lakeAmount, legacyWater), 0, 100),
    lakeSize: clamp(asNumber(input.lakeSize, legacyWater), 0, 100),
    coastComplexity: clamp(asNumber(input.coastComplexity, 62), 0, 100),
    edgeDetail: clamp(asNumber(input.edgeDetail, 300), 180, 520),
    minBiomeSize: clamp(asNumber(input.minBiomeSize, 15), 0, 20),
    renderScale: clamp(asNumber(input.renderScale, 150), 50, 250),
    fogVisionRadius: clamp(asNumber(input.fogVisionRadius, 18), 6, 40),
    temperatureBias: clamp(asNumber(input.temperatureBias, 50), 0, 100),
    moistureBias: clamp(asNumber(input.moistureBias, 50), 0, 100),
    coastalBias: clamp(asNumber(input.coastalBias, 50), 0, 100),
  };
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
