import { regionAtCell, regionAtPosition } from "./playQueries.js";
import { isNodeDiscovered } from "./travel.js?v=20260413a";
import { getNodeTitle } from "../node/model.js";

export function describePlayHud(world, playState) {
  if (!world || !playState) {
    return {
      locationLine: "",
      regionName: "",
      nodeTitle: null,
    };
  }

  if (playState.travel) {
    const nodes = world.features?.nodes ?? [];
    const toNode = nodes[playState.travel.targetNodeId];
    const regionName =
      playState.travel.routeType === "sea-route"
        ? "På havet"
        : formatHudRegionLine(regionFromPlayState(world, playState));

    return {
      locationLine: regionName,
      regionName,
      nodeTitle:
        toNode && isNodeDiscovered(playState, toNode.id)
          ? getNodeTitle(toNode)
          : "Okänd plats",
    };
  }

  const nodes = world.features?.nodes ?? [];
  const currentNode = nodes[playState.currentNodeId];
  const region = currentNode
    ? regionAtCell(world, currentNode.cell)
    : regionAtPosition(world, playState.position);
  const regionName = formatHudRegionLine(region);
  const nodeTitle =
    currentNode && isNodeDiscovered(playState, currentNode.id)
      ? getNodeTitle(currentNode)
      : null;

  return {
    locationLine: nodeTitle ? `${nodeTitle} - ${regionName}` : regionName,
    regionName,
    nodeTitle,
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
