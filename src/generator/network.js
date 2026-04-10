import { coordsOf } from "../utils.js";

const JUNCTION_NODE_MERGE_RADIUS = 0;
const JUNCTION_CLUSTER_RADIUS = 0;

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

  const mergeAnchorNodes = nodes.filter(
    (node) => node?.type === "settlement" || node?.type === "abandoned",
  );

  const { representativeCells, representativeByCell } =
    collectLandRoadJunctionCells(roads, width);

  for (const cell of representativeCells) {
    if (nodeIdByCell.has(cell)) {
      continue;
    }
    const mergeTargetNodeId = findNearestNodeIdWithinRadius(
      cell,
      width,
      mergeAnchorNodes,
      JUNCTION_NODE_MERGE_RADIUS,
    );
    if (mergeTargetNodeId != null) {
      nodeIdByCell.set(cell, mergeTargetNodeId);
      continue;
    }
    const [x, y] = coordsOf(cell, width);
    const node = {
      id: nodes.length,
      type: "junction",
      cell,
      x,
      y,
      name: "Vägknut",
    };
    nodes.push(node);
    nodeIdByCell.set(cell, node.id);
  }

  for (const [cell, representativeCell] of representativeByCell.entries()) {
    if (cell === representativeCell || nodeIdByCell.has(cell)) {
      continue;
    }
    const representativeNodeId = nodeIdByCell.get(representativeCell);
    if (representativeNodeId != null) {
      nodeIdByCell.set(cell, representativeNodeId);
    }
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
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      nodes[nodeId].componentId = component.id;
    }
    for (const linkId of component.linkIds) {
      links[linkId].componentId = component.id;
    }
  }

  return {
    nodes,
    links,
    components,
    adjacencyByNodeId,
  };
}

function collectLandRoadJunctionCells(roads, width) {
  const adjacencyByCell = new Map();

  const connect = (fromCell, toCell) => {
    let neighbors = adjacencyByCell.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacencyByCell.set(fromCell, neighbors);
    }
    neighbors.add(toCell);
  };

  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      const fromCell = cells[i - 1];
      const toCell = cells[i];
      if (fromCell === toCell) {
        continue;
      }
      connect(fromCell, toCell);
      connect(toCell, fromCell);
    }
  }

  const junctions = [];
  for (const [cell, neighbors] of adjacencyByCell.entries()) {
    if (neighbors.size >= 3) {
      junctions.push(cell);
    }
  }
  return clusterNearbyJunctionCells(junctions, width, JUNCTION_CLUSTER_RADIUS);
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

function findNearestNodeIdWithinRadius(cell, width, nodes, radius) {
  if (!nodes?.length || !Number.isFinite(cell) || width <= 0 || radius <= 0) {
    return null;
  }
  const [x, y] = coordsOf(cell, width);
  let bestNodeId = null;
  let bestDistanceSq = radius * radius;

  for (const node of nodes) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      continue;
    }
    const dx = x - node.x;
    const dy = y - node.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > bestDistanceSq) {
      continue;
    }
    if (bestNodeId == null || distanceSq < bestDistanceSq) {
      bestNodeId = node.id;
      bestDistanceSq = distanceSq;
    }
  }

  return bestNodeId;
}

function clusterNearbyJunctionCells(cells, width, maxDistance) {
  const representativeByCell = new Map();
  const uniqueCells = [...new Set(cells)].sort((a, b) => a - b);
  if (uniqueCells.length === 0) {
    return {
      representativeCells: [],
      representativeByCell,
    };
  }
  if (uniqueCells.length === 1 || maxDistance <= 0 || width <= 0) {
    for (const cell of uniqueCells) {
      representativeByCell.set(cell, cell);
    }
    return {
      representativeCells: uniqueCells,
      representativeByCell,
    };
  }

  const maxDistanceSq = maxDistance * maxDistance;
  const clusters = [];
  const cellCoords = new Map();

  for (const cell of uniqueCells) {
    const [x, y] = coordsOf(cell, width);
    cellCoords.set(cell, { x, y });
    let bestCluster = null;
    let bestDistanceSq = maxDistanceSq;

    for (const cluster of clusters) {
      const dx = x - cluster.centerX;
      const dy = y - cluster.centerY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > bestDistanceSq) {
        continue;
      }
      bestDistanceSq = distanceSq;
      bestCluster = cluster;
    }

    if (!bestCluster) {
      clusters.push({
        cells: [cell],
        sumX: x,
        sumY: y,
        centerX: x,
        centerY: y,
      });
      continue;
    }

    bestCluster.cells.push(cell);
    bestCluster.sumX += x;
    bestCluster.sumY += y;
    const count = bestCluster.cells.length;
    bestCluster.centerX = bestCluster.sumX / count;
    bestCluster.centerY = bestCluster.sumY / count;
  }

  const representativeCells = [];
  for (const cluster of clusters) {
    let representativeCell = cluster.cells[0];
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const cell of cluster.cells) {
      const point = cellCoords.get(cell);
      const dx = point.x - cluster.centerX;
      const dy = point.y - cluster.centerY;
      const distanceSq = dx * dx + dy * dy;
      if (
        distanceSq < bestDistanceSq ||
        (Math.abs(distanceSq - bestDistanceSq) < 1e-9 &&
          cell < representativeCell)
      ) {
        representativeCell = cell;
        bestDistanceSq = distanceSq;
      }
    }
    representativeCells.push(representativeCell);
    for (const cell of cluster.cells) {
      representativeByCell.set(cell, representativeCell);
    }
  }

  representativeCells.sort((a, b) => a - b);
  return {
    representativeCells,
    representativeByCell,
  };
}
