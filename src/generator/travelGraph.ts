import { coordsOf, dedupePoints } from "../utils";

export function buildTravelGraph(network, width) {
  const graph = new Map();
  const stopNodes = network.nodes.filter((node) => node.nodeId != null);

  for (const stopNode of stopNodes) {
    const graphKey = stopNode.nodeId;
    graph.set(graphKey, collectNodeNeighbors(stopNode.id, network, width));
  }

  return graph;
}

function collectNodeNeighbors(startNodeId, network, width) {
  const startNode = network.nodes[startNodeId];
  const frontier = [
    {
      nodeId: startNodeId,
      points: [{ x: startNode.x, y: startNode.y }],
      cost: 0,
      hasSeaRoute: false,
    },
  ];
  const bestCostByNodeId = new Map([[startNodeId, 0]]);
  const bestByNodeId = new Map();

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    if (!current) {
      break;
    }

    for (const edge of network.adjacencyByNodeId.get(current.nodeId) ?? []) {
      const nextNode = network.nodes[edge.nodeId];
      const link = network.links[edge.linkId];
      const nextPoints = mergePaths(
        current.points,
        orientLinkPoints(link, current.nodeId, width),
      );
      const nextCost = current.cost + link.length;
      const nextHasSeaRoute = current.hasSeaRoute || link.type === "sea-route";

      const nextStopId = nextNode.nodeId ?? null;
      if (nextStopId != null && nextNode.id !== startNodeId) {
        const previous = bestByNodeId.get(nextStopId);
        if (!previous || nextCost < previous.cost) {
          bestByNodeId.set(nextStopId, {
            nodeId: nextStopId,
            points: nextPoints,
            cost: nextCost,
            routeType: nextHasSeaRoute ? "sea-route" : "road",
          });
        }
        // Also block the frontier from expanding through this stop node.
        if (
          nextCost <
          (bestCostByNodeId.get(nextNode.id) ?? Number.POSITIVE_INFINITY)
        ) {
          bestCostByNodeId.set(nextNode.id, nextCost);
        }
        continue;
      }

      if (
        nextCost >=
        (bestCostByNodeId.get(nextNode.id) ?? Number.POSITIVE_INFINITY)
      ) {
        continue;
      }

      bestCostByNodeId.set(nextNode.id, nextCost);
      frontier.push({
        nodeId: nextNode.id,
        points: nextPoints,
        cost: nextCost,
        hasSeaRoute: nextHasSeaRoute,
      });
    }
  }

  const neighbors = new Map();
  for (const [nodeId, value] of bestByNodeId.entries()) {
    neighbors.set(nodeId, {
      nodeId,
      points: value.points,
      routeType: value.routeType ?? "road",
    });
  }

  return neighbors;
}

function orientLinkPoints(link, fromNodeId, width) {
  const cells =
    link.fromNodeId === fromNodeId ? link.cells : [...link.cells].reverse();
  return cells.map((cell) => {
    const [x, y] = coordsOf(cell, width);
    return { x, y };
  });
}

function mergePaths(a, b) {
  return dedupePoints([...a, ...b]);
}
