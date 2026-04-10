import { createRng } from "../random.js";
import { clamp, sliderFactor } from "../utils.js";
import {
  buildSettlementCandidates,
  ensureInlandSettlements,
  selectSettlements,
} from "./settlementModel.js?v=20260409b";

export function generateSettlements(world, names) {
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
  const densityMultiplier = 0.18 + density * 3.8;
  const minCountByArea = clamp(Math.round(habitableArea / 1900), 2, 8);
  const maxCountByArea = clamp(Math.round(habitableArea / 300), 18, 76);
  const desiredCount = clamp(
    Math.round((habitableArea / 760) * densityMultiplier),
    minCountByArea,
    maxCountByArea,
  );
  const minSpacing = clamp(18 - density * 8.4, 8.5, 18);
  const settlements = selectSettlements({ width, candidates, desiredCount, minSpacing });
  ensureInlandSettlements({
    width,
    rng,
    candidates,
    settlements,
    desiredCount,
    minSpacing,
    density,
  });

  settlements.forEach((settlement, index) => {
    settlement.id = index;
  });

  for (const settlement of settlements) {
    settlement.name = names.settlementName(settlement.id, {
      coastal: settlement.coastal,
      river: settlement.river,
    });
  }

  return settlements;
}
