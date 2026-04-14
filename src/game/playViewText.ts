import { regionAtCell, regionAtPosition } from "./playQueries";
import { isNodeDiscovered } from "./travel/selectors";
import { getNodeTitle } from "../node/model";
import type { NodeLike } from "../node/model";
import type { PlayState } from "../types/play";
import type { World } from "../types/world";

interface RegionLike {
  name?: string;
}

interface PlayHudDescription {
  locationLine: string;
  regionName: string;
  nodeTitle: string | null;
}

export function describePlayHud(
  world: World | null | undefined,
  playState: PlayState | null | undefined,
): PlayHudDescription {
  if (!world || !playState) {
    return {
      locationLine: "",
      regionName: "",
      nodeTitle: null,
    };
  }

  if (playState.travel) {
    const nodes = getWorldNodes(world);
    const targetNodeId =
      typeof playState.travel.targetNodeId === "number"
        ? playState.travel.targetNodeId
        : -1;
    const toNode = nodes[targetNodeId];
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

  const nodes = getWorldNodes(world);
  const currentNodeId =
    typeof playState.currentNodeId === "number" ? playState.currentNodeId : -1;
  const currentNode = nodes[currentNodeId];
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

function formatHudRegionLine(region: RegionLike | null | undefined): string {
  if (!region) {
    return "Mellan regioner";
  }
  return region.name || "Mellan regioner";
}

function regionFromPlayState(
  world: World,
  playState: PlayState,
): RegionLike | null {
  if (playState?.lastRegionId != null && playState.lastRegionId >= 0) {
    const biomeRegions = getWorldBiomeRegions(world);
    return biomeRegions[playState.lastRegionId] ?? null;
  }

  return regionAtPosition(world, playState?.position) as RegionLike | null;
}

function getWorldNodes(world: World): Array<(NodeLike & { id?: number; cell?: number }) | undefined> {
  const features = world.features as
    | { nodes?: Array<(NodeLike & { id?: number; cell?: number }) | undefined> }
    | null
    | undefined;
  return Array.isArray(features?.nodes) ? features.nodes : [];
}

function getWorldBiomeRegions(world: World): Array<RegionLike | undefined> {
  const features = world.features as
    | { biomeRegions?: Array<RegionLike | undefined> }
    | null
    | undefined;
  return Array.isArray(features?.biomeRegions) ? features.biomeRegions : [];
}
