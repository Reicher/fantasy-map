import { generateWorld } from "@fardvag/world-gen";
import { normalizeBiomeKeyName } from "@fardvag/shared/biomes";
import type { World } from "@fardvag/shared/types/world";

const params = {
  seed: "determinism-probe",
  mapSize: 61,
  mountainousness: 67,
  settlementDensity: 44,
  lakeAmount: 63,
  lakeSize: 58,
  coastComplexity: 71
};

const first = summarize(generateWorld(params));
const second = summarize(generateWorld(params));
const different = summarize(
  generateWorld({
    ...params,
    seed: "determinism-probe-b"
  })
);

const identical = JSON.stringify(first) === JSON.stringify(second);
const changed = JSON.stringify(first) !== JSON.stringify(different);
const biomeNormalizationStable =
  normalizeBiomeKeyName("  forest ") === "forest" &&
  normalizeBiomeKeyName("not-a-biome") === null;
const verbose = process.env.DETERMINISM_VERBOSE === "1";

console.log("Deterministic same-seed:", identical ? "PASS" : "FAIL");
console.log("Distinct other seed:", changed ? "PASS" : "FAIL");
console.log(
  "Biome normalization fallback:",
  biomeNormalizationStable ? "PASS" : "FAIL",
);

if (verbose) {
  console.log(JSON.stringify({ first, second, different }, null, 2));
}

const checksPassed = identical && changed && biomeNormalizationStable;
if (!checksPassed) {
  if (!verbose) {
    console.log(JSON.stringify({ first, second, different }, null, 2));
  }
  process.exit(1);
}

type WorldSummary = {
  title: string;
  style: string;
  settlements: string[];
  roads: Array<{
    type: string;
    fromSettlementId: number;
    settlementId: number;
    length: number;
    lastCell: number;
  }>;
  network: {
    nodes: number;
    links: number;
    components: number[];
  };
  roadComponents: number;
  rivers: string[];
  lakes: string[];
  mountainRegions: string[];
  biomeRegions: string[];
};

function summarize(world: World): WorldSummary {
  return {
    title: world.title,
    style: world.terrain.style.name,
    settlements: world.settlements.map((settlement) => settlement.name),
    roads: world.roads.roads.map((road) => ({
      type: road.type,
      fromSettlementId: road.fromSettlementId,
      settlementId: road.settlementId,
      length: road.length,
      lastCell: road.cells[road.cells.length - 1]
    })),
    network: {
      nodes: world.network.nodes.length,
      links: world.network.links.length,
      components: world.network.components.map((component) => component.settlementIds.length)
    },
    roadComponents: world.roads.componentCount,
    rivers: world.hydrology.rivers.map((river) => river.name),
    lakes: world.hydrology.lakes.map((lake) => lake.name),
    mountainRegions: world.regions.mountainRegions.map((region) => region.name),
    biomeRegions: world.regions.biomeRegions.slice(0, 10).map((region) => region.name)
  };
}
