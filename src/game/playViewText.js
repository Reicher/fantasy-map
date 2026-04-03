import { clamp } from "../utils.js";

export function describePlayView(world, playState) {
  if (!world || !playState) {
    return {
      title: "",
      subtitle: "",
      biomeKey: null
    };
  }

  if (playState.travel) {
    const fromCity = world.cities[playState.travel.startCityId];
    const toCity = world.cities[playState.travel.targetCityId];
    const region =
      playState.travel.routeType === "sea-route" ? null : regionFromPlayState(world, playState);
    const regionForBiome = travelRegionFromPlayState(world, playState, toCity);

    return {
      title: fromCity && toCity ? `${fromCity.name} till ${toCity.name}` : "På resa",
      subtitle: playState.travel.routeType === "sea-route" ? "På havet" : formatRegionLine(region),
      biomeKey: regionForBiome?.biome ?? null
    };
  }

  const city = world.cities[playState.currentCityId];
  const region = city ? regionAtCell(world, city.cell) : regionAtPosition(world, playState.position);

  return {
    title: city?.name ?? "Okänd plats",
    subtitle: formatRegionLine(region) ?? "Okänd region",
    biomeKey: region?.biome ?? null
  };
}

function formatRegionLine(region) {
  if (!region) {
    return "Mellan regioner";
  }

  return region.biomeLabel ? `${region.name} (${region.biomeLabel})` : region.name;
}

function regionAtPosition(world, position) {
  if (!position) {
    return null;
  }

  const x = clamp(Math.floor(position.x), 0, world.terrain.width - 1);
  const y = clamp(Math.floor(position.y), 0, world.terrain.height - 1);
  return regionAtCell(world, y * world.terrain.width + x);
}

function regionFromPlayState(world, playState) {
  if (playState?.lastRegionId != null && playState.lastRegionId >= 0) {
    return world.features.biomeRegions[playState.lastRegionId] ?? null;
  }

  return regionAtPosition(world, playState?.position);
}

function travelRegionFromPlayState(world, playState, fallbackCity) {
  const lastRegion = regionFromPlayState(world, playState);
  if (lastRegion) {
    return lastRegion;
  }

  if (fallbackCity?.cell != null) {
    return regionAtCell(world, fallbackCity.cell);
  }

  return regionAtPosition(world, playState?.position);
}

function regionAtCell(world, cell) {
  if (cell == null || cell < 0) {
    return null;
  }

  const regionId = world.features.indices.biomeRegionId[cell];
  if (regionId == null || regionId < 0) {
    return null;
  }

  return world.features.biomeRegions[regionId] ?? null;
}
