import { generateWorld } from "../src/generator/worldGenerator.js";

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

console.log("Deterministic same-seed:", identical ? "PASS" : "FAIL");
console.log("Distinct other seed:", changed ? "PASS" : "FAIL");
console.log(JSON.stringify({ first, different }, null, 2));

if (!identical || !changed) {
  process.exit(1);
}

function summarize(world) {
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
