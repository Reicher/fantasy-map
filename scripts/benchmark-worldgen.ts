import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { DEFAULT_PARAMS } from "@fardvag/shared/config";
import { generateWorld, normalizeParams } from "@fardvag/world-gen";

type Scenario = {
  name: string;
  params: Parameters<typeof normalizeParams>[0];
};

type ScenarioResult = {
  name: string;
  samplesMs: number[];
  statsMs: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
  };
  world: {
    width: number;
    height: number;
    settlements: number;
    roads: number;
    rivers: number;
    lakes: number;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_PATH = resolve(__dirname, "../baselines/worldgen-baseline.json");
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 12;
const SHOULD_WRITE = process.argv.includes("--write");

const scenarios: Scenario[] = [
  {
    name: "default-balance",
    params: {
      ...DEFAULT_PARAMS,
      seed: "baseline-default-balance",
    },
  },
  {
    name: "large-world",
    params: {
      ...DEFAULT_PARAMS,
      seed: "baseline-large-world",
      worldScale: 175,
      edgeDetail: 430,
      mapSize: 62,
      coastComplexity: 70,
      settlementDensity: 28,
      riverAmount: 62,
      lakeAmount: 65,
      mountainousness: 61,
    },
  },
  {
    name: "dense-network",
    params: {
      ...DEFAULT_PARAMS,
      seed: "baseline-dense-network",
      settlementDensity: 62,
      settlementRandomness: 58,
      mapSize: 68,
      fragmentation: 63,
      riverAmount: 52,
      lakeAmount: 50,
      mountainousness: 46,
      edgeDetail: 340,
    },
  },
];

const startedAtIso = new Date().toISOString();
const scenarioResults: ScenarioResult[] = [];

for (const scenario of scenarios) {
  const params = normalizeParams(scenario.params);

  for (let runIndex = 0; runIndex < WARMUP_RUNS; runIndex += 1) {
    generateWorld(params);
  }

  let lastWorld = generateWorld(params);
  const samplesMs: number[] = [];
  for (let runIndex = 0; runIndex < SAMPLE_RUNS; runIndex += 1) {
    const start = performance.now();
    lastWorld = generateWorld(params);
    const elapsed = performance.now() - start;
    samplesMs.push(round2(elapsed));
  }

  scenarioResults.push({
    name: scenario.name,
    samplesMs,
    statsMs: {
      min: round2(Math.min(...samplesMs)),
      max: round2(Math.max(...samplesMs)),
      mean: round2(mean(samplesMs)),
      p50: round2(percentile(samplesMs, 0.5)),
      p95: round2(percentile(samplesMs, 0.95)),
    },
    world: {
      width: lastWorld.terrain.width,
      height: lastWorld.terrain.height,
      settlements: lastWorld.settlements.length,
      roads: lastWorld.roads.roads.length,
      rivers: lastWorld.hydrology.rivers.length,
      lakes: lastWorld.hydrology.lakes.length,
    },
  });
}

const payload = {
  createdAt: startedAtIso,
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  config: {
    warmupRuns: WARMUP_RUNS,
    sampleRuns: SAMPLE_RUNS,
  },
  results: scenarioResults,
};

console.log(JSON.stringify(payload, null, 2));

if (SHOULD_WRITE) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\nWrote baseline: ${OUTPUT_PATH}`);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const blend = rank - lower;
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * blend;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
