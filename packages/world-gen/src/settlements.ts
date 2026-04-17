import { createRng } from "@fardvag/shared/random";
import { clamp, sliderFactor } from "@fardvag/shared/utils";
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

  const density = sliderFactor(params.settlementDensity, 1.06);
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
    inlandPreference: params.inlandPreference,
  });
  const densityPower = Math.pow(density, 1.85);
  const habitableBase = (habitableArea / 900) * (0.64 + density * 2.9);
  const candidateBonus = (candidates.length / 115) * densityPower;
  const minCountByArea = clamp(
    Math.round(habitableArea / (2200 - density * 900)),
    2,
    18,
  );
  const maxCountByArea = clamp(
    Math.round(candidates.length / (46 - density * 18)),
    18,
    190,
  );
  const desiredCount = clamp(
    Math.round(habitableBase + candidateBonus),
    minCountByArea,
    maxCountByArea,
  );
  const spacingControl = clamp(Number(params.nodeMinDistance ?? 5), 2, 22);
  const spreadControl = clamp(
    Number(params.settlementRandomness ?? 20) / 140,
    0,
    1,
  );
  const densitySpacing = clamp(17.2 - density * 10.8, 5.8, 17.2);
  const spacingFloorByControl =
    clamp(spacingControl, 2, 22) * (0.64 + spreadControl * 0.34);
  const minSpacing = Math.max(densitySpacing, spacingFloorByControl);
  const settlements = selectSettlements({
    width,
    size,
    candidates,
    desiredCount,
    minSpacing,
    settlementDensity: params.settlementDensity,
    spacingControl,
    randomness: params.settlementRandomness,
    inlandPreference: params.inlandPreference,
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
