import { generateWorld } from "../src/generator/worldGenerator.js";

const scenarios = [
  {
    seed: "saltwind-01",
    mapSize: 58,
    mountainousness: 54,
    settlementDensity: 42,
    lakeAmount: 56,
    lakeSize: 52,
    coastComplexity: 62
  },
  {
    seed: "glass-reef",
    mapSize: 52,
    mountainousness: 72,
    settlementDensity: 28,
    lakeAmount: 67,
    lakeSize: 61,
    coastComplexity: 79
  },
  {
    seed: "amber-cairn",
    mapSize: 74,
    mountainousness: 36,
    settlementDensity: 68,
    lakeAmount: 41,
    lakeSize: 36,
    coastComplexity: 48
  }
];

for (const params of scenarios) {
  const world = generateWorld(params);
  console.log(`\nseed=${params.seed}`);
  console.log(
    `style=${world.terrain.style.name} settlements=${world.settlements.length} roads=${world.roads.roads.length} roadComponents=${world.roads.componentCount} rivers=${world.hydrology.rivers.length} lakes=${world.hydrology.lakes.length} mountains=${world.regions.mountainRegions.length}`
  );
  console.log(`first settlements: ${world.settlements.slice(0, 5).map((settlement) => settlement.name).join(", ")}`);
  console.log(`major rivers: ${world.hydrology.rivers.slice(0, 3).map((river) => river.name).join(", ")}`);
}
