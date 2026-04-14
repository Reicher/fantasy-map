import type { PlayState } from "../../types/play";

export function isNodeDiscovered(
  playState: PlayState | null | undefined,
  nodeId: number | null | undefined,
): boolean {
  if (nodeId == null || nodeId < 0) {
    return false;
  }

  const discoveredNodeIds = playState?.discoveredNodeIds;
  if (
    discoveredNodeIds &&
    nodeId < discoveredNodeIds.length &&
    discoveredNodeIds[nodeId]
  ) {
    return true;
  }

  return playState?.currentNodeId === nodeId;
}

export function getDiscoveredNodeIds(playState: PlayState | null | undefined): number[] {
  return [...collectDiscoveredNodeIdSet(playState)].sort((a, b) => a - b);
}

export function getVisibleNodeIds(playState: PlayState | null | undefined): number[] {
  if (!playState) {
    return [];
  }

  const discoveredNodeIds = collectDiscoveredNodeIdSet(playState);
  const visibleNodeIds = new Set(discoveredNodeIds);
  const currentNodeId = playState.currentNodeId;
  if (currentNodeId != null) {
    visibleNodeIds.add(currentNodeId);
    const neighbors = playState.graph?.get(currentNodeId);
    if (neighbors) {
      for (const neighborId of neighbors.keys()) {
        if (neighborId != null) {
          visibleNodeIds.add(neighborId);
        }
      }
    }
  }

  return [...visibleNodeIds].sort((a, b) => a - b);
}

export function getValidTargetIds(playState: PlayState | null | undefined): number[] {
  if (!playState) {
    return [];
  }

  if (playState.travel || playState.rest || playState.hunt) {
    return [];
  }

  return [...(playState.graph?.get(playState.currentNodeId as number)?.keys() ?? [])];
}

function collectDiscoveredNodeIdSet(playState: PlayState | null | undefined): Set<number> {
  const discoveredNodeIds = new Set<number>();
  const marks = playState?.discoveredNodeIds;
  if (marks?.length) {
    for (let nodeId = 0; nodeId < marks.length; nodeId += 1) {
      if (marks[nodeId]) {
        discoveredNodeIds.add(nodeId);
      }
    }
  }

  if (playState?.currentNodeId != null) {
    discoveredNodeIds.add(playState.currentNodeId);
  }
  return discoveredNodeIds;
}
