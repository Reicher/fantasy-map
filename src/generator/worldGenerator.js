import { createNameGenerator } from "../naming.js?v=20260402d";
import { createRng } from "../random.js";
import { generateCities } from "./cities.js?v=20260402a";
import { generateClimate } from "./climate.js?v=20260331k";
import { compileGeometry } from "./compileGeometry.js?v=20260402j";
import { buildFeatureCatalog } from "./features.js";
import { generateHydrology } from "./hydrology.js?v=20260402b";
import { buildWorldNetwork } from "./network.js?v=20260401i";
import { applyFeatureNames } from "./nameFeatures.js";
import { buildRegions } from "./regions.js?v=20260402c";
import { generateRoads } from "./roads.js?v=20260401q";
import { buildSurfaceGeometry } from "./surface.js?v=20260402b";
import { generateTerrain } from "./terrain.js?v=20260401i";
import { buildTravelGraph } from "./travelGraph.js?v=20260401a";
import { buildWorldStats } from "./worldStats.js?v=20260402c";

export function normalizeParams(input) {
  const legacyWater = Number(input.waterRichness ?? 56);
  const rawEdgeDetail = Number(input.edgeDetail ?? 300);
  return {
    seed: String(input.seed ?? "saltwind-01"),
    mapSize: Number(input.mapSize ?? 58),
    mountainousness: Number(input.mountainousness ?? 54),
    cityDensity: Number(input.cityDensity ?? 42),
    riverAmount: Number(input.riverAmount ?? 56),
    lakeAmount: Number(input.lakeAmount ?? legacyWater),
    lakeSize: Number(input.lakeSize ?? legacyWater),
    coastComplexity: Number(input.coastComplexity ?? 62),
    edgeDetail: rawEdgeDetail <= 100 ? 180 + (rawEdgeDetail / 100) * 340 : rawEdgeDetail,
    minBiomeSize: Number(input.minBiomeSize ?? 4)
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
    regions: named.regions
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
  const city = rng.weighted(candidates, (candidate) => Math.max(1, candidate.score));

  return {
    cityId: city.id,
    x: city.x,
    y: city.y
  };
}
