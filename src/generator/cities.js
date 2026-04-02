import { createRng } from "../random.js";
import { clamp } from "../utils.js";
import { buildCityCandidates, ensureInlandCities, maybeAddInlandOddballCity, selectCities } from "./cityModel.js";

export function generateCities(world, names) {
  const { params, terrain, climate, hydrology } = world;
  const { width, size, isLand, elevation, coastMask, mountainField } = terrain;
  const { biome, moisture } = climate;
  const { coastDistance, waterDistance, riverStrength, lakeIdByCell } = hydrology;

  const density = sliderFactor(params.cityDensity, 0.72);
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
    rng
  });
  const desiredCount = clamp(
    Math.round((habitableArea / 720) * (0.22 + density * 3.9)),
    2,
    32
  );
  const minSpacing = 16 - density * 9;
  const cities = selectCities({ width, candidates, desiredCount, minSpacing });
  maybeAddInlandOddballCity({ width, rng, candidates, cities, desiredCount, minSpacing });
  ensureInlandCities({
    width,
    rng,
    candidates,
    cities,
    desiredCount,
    minSpacing,
    density
  });

  cities.forEach((city, index) => {
    city.id = index;
  });

  for (const city of cities) {
    city.name = names.cityName(city.id, { coastal: city.coastal, river: city.river });
  }

  return cities;
}

function sliderFactor(value, curve) {
  return clamp(Math.pow(clamp(value / 100, 0, 1), curve), 0, 1);
}
