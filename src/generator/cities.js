import { createRng } from "../random.js";
import { clamp, sliderFactor } from "../utils.js";
import {
  buildCityCandidates,
  ensureInlandCities,
  selectCities,
} from "./cityModel.js?v=20260409a";

export function generateCities(world, names) {
  const { params, terrain, climate, hydrology } = world;
  const { width, size, isLand, elevation, coastMask, mountainField } = terrain;
  const { biome, moisture } = climate;
  const { coastDistance, waterDistance, riverStrength, lakeIdByCell } =
    hydrology;

  const density = sliderFactor(params.cityDensity, 1.06);
  const rng = createRng(`${params.seed}::cities`);
  const { candidates, habitableArea } = buildCityCandidates({
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
    coastalBias: params.coastalBias,
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
  const cities = selectCities({ width, candidates, desiredCount, minSpacing });
  ensureInlandCities({
    width,
    rng,
    candidates,
    cities,
    desiredCount,
    minSpacing,
    density,
  });

  cities.forEach((city, index) => {
    city.id = index;
  });

  for (const city of cities) {
    city.name = names.cityName(city.id, {
      coastal: city.coastal,
      river: city.river,
    });
  }

  return cities;
}
