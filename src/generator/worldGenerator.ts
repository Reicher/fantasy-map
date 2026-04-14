import { createNameGenerator } from "../naming";
import { createRng } from "../random";
import { clamp } from "../utils";
import { generateSettlements } from "./settlements";
import { generateClimate } from "./climate";
import { compileGeometry } from "./compileGeometry";
import {
  buildFeatureCatalog,
  preselectCrashSiteCells,
} from "./features";
import { generateHydrology } from "./hydrology";
import { buildWorldNetwork } from "./network";
import { applyFeatureNames } from "./nameFeatures";
import { buildRegions } from "./regions";
import { generateRoads } from "./roads/index";
import { buildSurfaceGeometry } from "./surface";
import { generateTerrain } from "./terrain";
import { buildTravelGraph } from "./travelGraph";
import { buildWorldStats } from "./worldStats";
import type {
  HydrologyData,
  PlayerStart,
  RegionsData,
  SettlementData,
  World,
  WorldInputParams,
  WorldParams,
} from "../types/world";

export function normalizeParams(input: WorldInputParams = {}): WorldParams {
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
    settlementRandomness: clamp(
      asNumber(input.settlementRandomness, 20),
      0,
      100,
    ),
    abandonedFrequency: clamp(asNumber(input.abandonedFrequency, 50), 0, 100),
    nodeMinDistance: clamp(asNumber(input.nodeMinDistance, 5), 2, 14),
  };
}

export function generateWorld(inputParams: WorldInputParams = {}): World {
  const params = normalizeParams(inputParams);
  const terrain = generateTerrain(params) as World["terrain"];
  const hydrology = generateHydrology(terrain, params) as HydrologyData;
  const climate = generateClimate(terrain, hydrology, params) as World["climate"];
  const names = createNameGenerator(params.seed);
  const regions = buildRegions(terrain, climate, hydrology, params) as RegionsData;
  const named = applyFeatureNames(terrain, hydrology, regions, names);

  const world: World = {
    params,
    terrain,
    hydrology: named.hydrology as HydrologyData,
    climate,
    regions: named.regions as RegionsData,
    surface: null,
    settlements: [],
    playerStart: null,
    roads: { roads: [], componentCount: 0 },
    crashSiteCells: [],
    network: { nodes: [], links: [], components: [] },
    features: null,
    travelGraph: null,
    geometry: null,
    title: "",
    stats: null,
  };

  world.surface = buildSurfaceGeometry(world) as World["surface"];
  world.settlements = generateSettlements(world, names) as SettlementData[];
  world.playerStart = selectPlayerStart(world.settlements, params.seed);
  world.roads = generateRoads(world) as World["roads"];
  world.crashSiteCells = preselectCrashSiteCells(world) as number[];
  world.network = buildWorldNetwork(world) as World["network"];
  world.features = buildFeatureCatalog(world, names) as World["features"];
  world.travelGraph = buildTravelGraph(world.network, world.terrain.width);
  world.geometry = compileGeometry(world) as World["geometry"];
  world.stats = buildWorldStats(world) as World["stats"];

  return world;
}

function selectPlayerStart(
  settlements: SettlementData[],
  seed: string,
): PlayerStart | null {
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

function asNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
