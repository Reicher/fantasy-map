import { coordsOf } from "../utils.js";

export function buildWorldNetwork(world) {
  return buildRoadNetwork({
    settlements: world.settlements,
    roads: world.roads.roads,
    width: world.terrain.width,
    crashSiteCells: world.crashSiteCells ?? [],
  });
}

export function buildRoadNetwork({
  settlements,
  roads,
  width,
  crashSiteCells = [],
}) {
  const nodes = [];
  const nodeIdByCell = new Map();

  for (const settlement of settlements) {
    const node = {
      id: nodes.length,
      type: "settlement",
      cell: settlement.cell,
      x: settlement.x,
      y: settlement.y,
      nodeId: settlement.id,
      settlementId: settlement.id,
      name: settlement.name,
    };
    nodes.push(node);
    nodeIdByCell.set(settlement.cell, node.id);
  }

  // Register abandoned-site cells as nodes BEFORE road endpoints so that
  // buildRoadLinks splits road edges at these positions.
  for (const cell of crashSiteCells) {
    if (nodeIdByCell.has(cell)) {
      continue;
    }
    const [x, y] = coordsOf(cell, width);
    const node = {
      id: nodes.length,
      type: "abandoned",
      cell,
      x,
      y,
      name: "Övergiven plats",
    };
    nodes.push(node);
    nodeIdByCell.set(cell, node.id);
  }

  for (const road of roads) {
    for (const endpoint of [road.cells[0], road.cells[road.cells.length - 1]]) {
      if (nodeIdByCell.has(endpoint)) {
        continue;
      }
      const [x, y] = coordsOf(endpoint, width);
      const node = {
        id: nodes.length,
        type: road.type === "sea-route" ? "harbor" : "junction",
        cell: endpoint,
        x,
        y,
        name: road.type === "sea-route" ? "Hamnpunkt" : "Vägknut",
      };
      nodes.push(node);
      nodeIdByCell.set(endpoint, node.id);
    }
  }

  const links = buildRoadLinks(roads, nodes, nodeIdByCell);
  const { components, adjacencyByNodeId } = buildNetworkComponents(
    nodes,
    links,
  );
  tagComponents(nodes, links, components);

  return {
    nodes,
    links,
    components,
    adjacencyByNodeId,
  };
}

function buildRoadLinks(roads, nodes, nodeIdByCell) {
  const links = [];

  for (const road of roads) {
    const breakpoints = [];

    for (let index = 0; index < road.cells.length; index += 1) {
      const cell = road.cells[index];
      const nodeId = nodeIdByCell.get(cell);
      if (nodeId == null) {
        continue;
      }
      if (breakpoints[breakpoints.length - 1]?.nodeId === nodeId) {
        continue;
      }
      breakpoints.push({ nodeId, index });
    }

    for (let index = 1; index < breakpoints.length; index += 1) {
      const start = breakpoints[index - 1];
      const end = breakpoints[index];
      if (start.nodeId === end.nodeId) {
        continue;
      }

      const cells = road.cells.slice(start.index, end.index + 1);
      if (cells.length < 2) {
        continue;
      }

      links.push({
        id: links.length,
        type: road.type,
        roadId: road.id,
        fromNodeId: start.nodeId,
        toNodeId: end.nodeId,
        fromSettlementId: nodes[start.nodeId].settlementId ?? null,
        toSettlementId: nodes[end.nodeId].settlementId ?? null,
        length: cells.length,
        cost: road.cost,
        cells,
      });
    }
  }

  return links;
}

function buildNetworkComponents(nodes, links) {
  const adjacency = new Map();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const link of links) {
    adjacency
      .get(link.fromNodeId)
      ?.push({ nodeId: link.toNodeId, linkId: link.id });
    adjacency
      .get(link.toNodeId)
      ?.push({ nodeId: link.fromNodeId, linkId: link.id });
  }

  const visited = new Uint8Array(nodes.length);
  const components = [];

  for (const node of nodes) {
    if (visited[node.id]) {
      continue;
    }

    const queue = [node.id];
    visited[node.id] = 1;
    const nodeIds = [];
    const linkIds = new Set();
    const settlementIds = [];

    while (queue.length > 0) {
      const current = queue.pop();
      nodeIds.push(current);
      if (nodes[current].settlementId != null) {
        settlementIds.push(nodes[current].settlementId);
      }

      for (const edge of adjacency.get(current) ?? []) {
        linkIds.add(edge.linkId);
        if (visited[edge.nodeId]) {
          continue;
        }
        visited[edge.nodeId] = 1;
        queue.push(edge.nodeId);
      }
    }

    components.push({
      id: components.length,
      nodeIds,
      linkIds: [...linkIds],
      settlementIds,
    });
  }

  return {
    components,
    adjacencyByNodeId: adjacency,
  };
}

function tagComponents(nodes, links, components) {
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      nodes[nodeId].componentId = component.id;
    }
    for (const linkId of component.linkIds) {
      links[linkId].componentId = component.id;
    }
  }
}
