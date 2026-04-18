import { createRng } from "@fardvag/shared/random";
import { clamp } from "@fardvag/shared/utils";
import {
  buildSettlementCandidates,
  selectSettlements,
} from "./models/settlementModel";
import type { World } from "@fardvag/shared/types/world";

interface SettlementNameSource {
  settlementName: (
    id: number,
    options: { coastal?: boolean; river?: boolean },
  ) => string;
}

interface GeneratedSettlement {
  id: number;
  name?: string;
  coastal?: boolean;
  river?: boolean;
  agents?: Array<{ id: string }>;
}

const SETTLEMENT_MIN_AGENTS = 1;
const SETTLEMENT_MAX_AGENTS = 3;

export function generateSettlements(world: World, names: SettlementNameSource) {
  const { params, terrain, climate, hydrology } = world;
  const { width, size, isLand, elevation, coastMask, mountainField } = terrain;
  const { biome, moisture } = climate;
  const { coastDistance, waterDistance, riverStrength, lakeIdByCell } =
    hydrology;

  const requestedSettlementCount = clamp(
    Math.round(Number(params.settlementDensity ?? 30)),
    10,
    100,
  );
  const waterAffinity = clamp(Number(params.inlandPreference ?? 62), 0, 100);
  const rng = createRng(`${params.seed}::settlements`);
  const { candidates, habitableArea } = buildSettlementCandidates({
    width,
    size,
    isLand,
    elevation,
    coastMask,
    mountainField,
    biome,
    moisture,
    coastDistance,
    waterDistance,
    riverStrength,
    lakeIdByCell,
    rng,
    waterAffinity,
  });

  const effectiveDesiredCount = Math.min(
    requestedSettlementCount,
    Math.max(0, candidates.length),
  );
  if (effectiveDesiredCount <= 0) {
    return [];
  }
  const areaBasedSpacing = Math.sqrt(
    Math.max(1, habitableArea) / Math.max(1, effectiveDesiredCount),
  ) * 0.28;
  const spacingControl = clamp(Number(params.nodeMinDistance ?? 5), 2, 22);
  const spacingFloor = clamp(spacingControl * 0.34, 1.6, 8.5);
  const minSpacing = clamp(Math.max(areaBasedSpacing, spacingFloor), 1.5, 9.5);

  const settlements = selectSettlements({
    width,
    size,
    candidates,
    desiredCount: effectiveDesiredCount,
    minSpacing,
    waterAffinity,
    rng,
  }) as GeneratedSettlement[];

  settlements.forEach((settlement, index) => {
    settlement.id = index;
  });

  for (const settlement of settlements) {
    settlement.name = names.settlementName(settlement.id, {
      coastal: settlement.coastal,
      river: settlement.river,
    });
    settlement.agents = createSettlementAgents(rng, settlement.id);
  }

  return settlements;
}

function createSettlementAgents(rng, settlementId: number): Array<{ id: string }> {
  const count = rng
    .fork(`settlement:${settlementId}:agents`)
    .int(SETTLEMENT_MIN_AGENTS, SETTLEMENT_MAX_AGENTS);
  const agents = [];
  for (let index = 0; index < count; index += 1) {
    agents.push({
      id: `settlement-${settlementId}-agent-${index + 1}`,
    });
  }
  return agents;
}
