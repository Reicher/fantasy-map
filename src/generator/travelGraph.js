import { coordsOf, dedupePoints } from "../utils.js";

export function buildTravelGraph(network, width) {
  const graph = new Map();
  const cityNodes = network.nodes.filter((node) => node.cityId != null);

  for (const cityNode of cityNodes) {
    graph.set(
      cityNode.cityId,
      collectCityNeighbors(cityNode.id, network, width),
    );
  }

  return graph;
}

function collectCityNeighbors(startNodeId, network, width) {
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
  const bestByCityId = new Map();

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

      if (nextNode.cityId != null && nextNode.id !== startNodeId) {
        const previous = bestByCityId.get(nextNode.cityId);
        if (!previous || nextCost < previous.cost) {
          bestByCityId.set(nextNode.cityId, {
            cityId: nextNode.cityId,
            points: nextPoints,
            cost: nextCost,
            routeType: nextHasSeaRoute ? "sea-route" : "road",
          });
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
  for (const [cityId, value] of bestByCityId.entries()) {
    neighbors.set(cityId, {
      cityId,
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
