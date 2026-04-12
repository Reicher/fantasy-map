import { createNameGenerator } from "../naming.js?v=20260411a";
import { createRng } from "../random.js";
import { clamp } from "../utils.js";
import { generateSettlements } from "./settlements.js?v=20260411d";
import { generateClimate } from "./climate.js?v=20260407a";
import { compileGeometry } from "./compileGeometry.js?v=20260409c";
import {
  buildFeatureCatalog,
  preselectCrashSiteCells,
} from "./features.js?v=20260411p";
import { generateHydrology } from "./hydrology.js?v=20260407a";
import { buildWorldNetwork } from "./network.js?v=20260411j";
import { applyFeatureNames } from "./nameFeatures.js";
import { buildRegions } from "./regions.js?v=20260402c";
import { generateRoads } from "./roads/index.js?v=20260411o";
import { buildSurfaceGeometry } from "./surface.js?v=20260403b";
import { generateTerrain } from "./terrain.js?v=20260401i";
import { buildTravelGraph } from "./travelGraph.js?v=20260409b";
import { buildWorldStats } from "./worldStats.js?v=20260402c";

export function normalizeParams(input) {
  const legacyWater = asNumber(input.waterRichness, 56);
  return {
    seed: String(input.seed ?? "saltwind-01").trim() || "saltwind-01",
    mapSize: clamp(asNumber(input.mapSize, 58), 10, 100),
    mountainousness: clamp(asNumber(input.mountainousness, 54), 0, 100),
    settlementDensity: clamp(asNumber(input.settlementDensity, 20), 0, 100),
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
    // inlandPreference: 0 = fully water-oriented, 100 = fully inland.
    // Legacy: if only coastalBias is provided, invert it.
    inlandPreference: clamp(
      asNumber(
        input.inlandPreference ?? 100 - asNumber(input.coastalBias, 50),
        50,
      ),
      0,
      100,
    ),
    settlementRandomness: clamp(asNumber(input.settlementRandomness, 20), 0, 100),
    abandonedFrequency: clamp(asNumber(input.abandonedFrequency, 50), 0, 100),
    nodeMinDistance: clamp(asNumber(input.nodeMinDistance, 5), 2, 14),
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
  world.settlements = generateSettlements(world, names);
  world.playerStart = selectPlayerStart(world.settlements, params.seed);
  world.roads = generateRoads(world);
  world.crashSiteCells = preselectCrashSiteCells(world);
  world.network = buildWorldNetwork(world);
  world.features = buildFeatureCatalog(world, names);
  world.travelGraph = buildTravelGraph(world.network, world.terrain.width);
  world.geometry = compileGeometry(world);
  world.title = "";
  world.stats = buildWorldStats(world);

  return world;
}

function selectPlayerStart(settlements, seed) {
  if (!settlements.length) {
    return null;
  }

  const coastalSettlements = settlements.filter((settlement) => settlement.coastal);
  const candidates = coastalSettlements.length > 0 ? coastalSettlements : settlements;
  const rng = createRng(`${seed}::player-start`);
  const settlement = rng.weighted(candidates, (candidate) =>
    Math.max(1, candidate.score),
  );

  return {
    nodeId: settlement.id,
    x: settlement.x,
    y: settlement.y,
  };
}

function asNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
