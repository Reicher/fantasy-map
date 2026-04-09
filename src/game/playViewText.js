import { regionAtCell, regionAtPosition } from "./playQueries.js";
import { getPoiTitle } from "../poi/poiModel.js";

export function describePlayView(world, playState) {
  if (!world || !playState) {
    return {
      title: "",
      subtitle: "",
      biomeKey: null,
    };
  }

  if (playState.travel) {
    const pois = world.pointsOfInterest ?? world.cities;
    const fromPoi =
      pois[playState.travel.startPoiId ?? playState.travel.startCityId];
    const toPoi =
      pois[playState.travel.targetPoiId ?? playState.travel.targetCityId];
    const region =
      playState.travel.routeType === "sea-route"
        ? null
        : regionFromPlayState(world, playState);
    const regionForBiome = travelRegionFromPlayState(world, playState, toPoi);

    return {
      title:
        fromPoi && toPoi
          ? `${getPoiTitle(fromPoi)} till ${getPoiTitle(toPoi)}`
          : "På resa",
      subtitle:
        playState.travel.routeType === "sea-route"
          ? "På havet"
          : formatRegionLine(region),
      biomeKey: regionForBiome?.biome ?? null,
    };
  }

  const pois = world.pointsOfInterest ?? world.cities;
  const currentPoi = pois[playState.currentPoiId ?? playState.currentCityId];
  const region = currentPoi
    ? regionAtCell(world, currentPoi.cell)
    : regionAtPosition(world, playState.position);

  return {
    title: currentPoi ? getPoiTitle(currentPoi) : "Okänd plats",
    subtitle: formatRegionLine(region) ?? "Okänd region",
    biomeKey: region?.biome ?? null,
  };
}

function formatRegionLine(region) {
  if (!region) {
    return "Mellan regioner";
  }

  return region.biomeLabel
    ? `${region.name} (${region.biomeLabel})`
    : region.name;
}

function regionFromPlayState(world, playState) {
  if (playState?.lastRegionId != null && playState.lastRegionId >= 0) {
    return world.features.biomeRegions[playState.lastRegionId] ?? null;
  }

  return regionAtPosition(world, playState?.position);
}

function travelRegionFromPlayState(world, playState, fallbackPoi) {
  const lastRegion = regionFromPlayState(world, playState);
  if (lastRegion) {
    return lastRegion;
  }

  if (fallbackPoi?.cell != null) {
    return regionAtCell(world, fallbackPoi.cell);
  }

  return regionAtPosition(world, playState?.position);
}
