import { regionAtCell, regionAtPosition } from "./playQueries.js";
import { getNodeTitle } from "../nodeModel.js";

export function describePlayHud(world, playState) {
  if (!world || !playState) {
    return {
      locationLine: "",
      regionName: "",
      poiTitle: null,
    };
  }

  if (playState.travel) {
    const pois =
      world.features?.pointsOfInterest ??
      world.pointsOfInterest ??
      world.cities;
    const toPoi =
      pois[playState.travel.targetNodeId ?? playState.travel.targetCityId];
    const regionName =
      playState.travel.routeType === "sea-route"
        ? "På havet"
        : formatHudRegionLine(regionFromPlayState(world, playState));

    return {
      locationLine: regionName,
      regionName,
      poiTitle: toPoi ? getNodeTitle(toPoi) : null,
    };
  }

  const pois =
    world.features?.pointsOfInterest ?? world.pointsOfInterest ?? world.cities;
  const currentPoi = pois[playState.currentNodeId ?? playState.currentCityId];
  const region = currentPoi
    ? regionAtCell(world, currentPoi.cell)
    : regionAtPosition(world, playState.position);
  const regionName = formatHudRegionLine(region);
  const poiTitle = currentPoi ? getNodeTitle(currentPoi) : null;

  return {
    locationLine: poiTitle ? `${poiTitle} - ${regionName}` : regionName,
    regionName,
    poiTitle,
  };
}

function formatHudRegionLine(region) {
  if (!region) {
    return "Mellan regioner";
  }
  return region.name || "Mellan regioner";
}

function regionFromPlayState(world, playState) {
  if (playState?.lastRegionId != null && playState.lastRegionId >= 0) {
    return world.features?.biomeRegions?.[playState.lastRegionId] ?? null;
  }

  return regionAtPosition(world, playState?.position);
}
