import { coordsOf } from "@fardvag/shared/utils";

const JUNCTION_SETTLEMENT_EXCLUSION_RADIUS = 4.5;
const JUNCTION_CLUSTER_RADIUS = 2;
const JUNCTION_SIGNPOST_EXCLUSION_RADIUS = 3;

export function buildWorldNetwork(world) {
  return buildRoadNetwork({
    settlements: world.settlements,
    roads: world.roads.roads,
    width: world.terrain.width,
    height: world.terrain.height,
    crashSiteCells: world.crashSiteCells ?? [],
  });
}

export function buildRoadNetwork({
  settlements,
  roads,
  width,
  height,
  crashSiteCells = [],
}) {
  const nodes = [];
  const nodeIdByCell = new Map();
  let nextStopNodeId = Math.max(0, settlements?.length ?? 0);

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
      nodeId: nextStopNodeId,
      cell,
      x,
      y,
      name: "Övergiven plats",
    };
    nodes.push(node);
    nextStopNodeId += 1;
    nodeIdByCell.set(cell, node.id);
  }

  const { representativeCells, representativeByCell } =
    collectLandRoadJunctionCells(
      roads,
      width,
      height,
      settlements.map((settlement) => Number(settlement.cell)).filter(Number.isFinite),
    );

  for (const cell of representativeCells) {
    if (nodeIdByCell.has(cell)) {
      continue;
    }
    const [x, y] = coordsOf(cell, width);
    const node = {
      id: nodes.length,
      type: "signpost",
      nodeId: nextStopNodeId,
      cell,
      x,
      y,
      name: "Vägvisare",
    };
    nodes.push(node);
    nextStopNodeId += 1;
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
    const cells = road?.cells ?? [];
    if (cells.length < 1) {
      continue;
    }
    if ((road?.type ?? "road") !== "sea-route") {
      continue;
    }
    for (const endpoint of [cells[0], cells[cells.length - 1]]) {
      if (nodeIdByCell.has(endpoint)) {
        continue;
      }
      const [x, y] = coordsOf(endpoint, width);
      const nodeType = road.type === "sea-route" ? "harbor" : "signpost";
      const isStopNode = nodeType !== "harbor";
      const node = {
        id: nodes.length,
        type: nodeType,
        nodeId: isStopNode ? nextStopNodeId : null,
        cell: endpoint,
        x,
        y,
        name: road.type === "sea-route" ? "Hamnpunkt" : "Vägvisare",
      };
      nodes.push(node);
      if (isStopNode) {
        nextStopNodeId += 1;
      }
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

function collectLandRoadJunctionCells(
  roads,
  width,
  height,
  settlementCells = [],
) {
  const adjacencyByCell = new Map();
  const roadIdsByCell = new Map();

  const connect = (fromCell, toCell, roadId) => {
    let neighbors = adjacencyByCell.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacencyByCell.set(fromCell, neighbors);
    }
    neighbors.add(toCell);

    let roadIds = roadIdsByCell.get(fromCell);
    if (!roadIds) {
      roadIds = new Set();
      roadIdsByCell.set(fromCell, roadIds);
    }
    roadIds.add(roadId);
  };

  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    const roadId = Number(road?.id);
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      const fromCell = cells[i - 1];
      const toCell = cells[i];
      if (fromCell === toCell) {
        continue;
      }
      connect(fromCell, toCell, roadId);
      connect(toCell, fromCell, roadId);
    }
  }

  const junctions = [];
  for (const [cell, neighbors] of adjacencyByCell.entries()) {
    const roadCount = Number(roadIdsByCell.get(cell)?.size ?? 0);
    if (neighbors.size >= 3 && roadCount >= 2) {
      junctions.push(cell);
    }
  }

  const settlementCoords = settlementCells
    .filter((cell) => Number.isInteger(cell) && cell >= 0)
    .map((cell) => coordsOf(cell, width));
  const exclusionRadiusSq =
    JUNCTION_SETTLEMENT_EXCLUSION_RADIUS * JUNCTION_SETTLEMENT_EXCLUSION_RADIUS;

  const uniqueJunctions = [...new Set<number>(junctions)].sort((a, b) => a - b);
  const junctionSet = new Set<number>(uniqueJunctions);
  const visited = new Set<number>();
  const representativeByCell = new Map<number, number>();
  const representativeCells = [];
  const candidates = [];

  for (const start of uniqueJunctions) {
    if (visited.has(start)) {
      continue;
    }

    const component = [];
    const stack = [start];
    visited.add(start);

    while (stack.length > 0) {
      const cell = Number(stack.pop());
      component.push(cell);
      const [x, y] = coordsOf(cell, width);
      for (let oy = -JUNCTION_CLUSTER_RADIUS; oy <= JUNCTION_CLUSTER_RADIUS; oy += 1) {
        for (let ox = -JUNCTION_CLUSTER_RADIUS; ox <= JUNCTION_CLUSTER_RADIUS; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const next = ny * width + nx;
          if (!junctionSet.has(next) || visited.has(next)) {
            continue;
          }
          visited.add(next);
          stack.push(next);
        }
      }
    }

    let skip = false;
    for (const cell of component) {
      const [x, y] = coordsOf(cell, width);
      for (const [sx, sy] of settlementCoords) {
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy <= exclusionRadiusSq) {
          skip = true;
          break;
        }
      }
      if (skip) {
        break;
      }
    }
    if (skip) {
      continue;
    }

    component.sort((a, b) => a - b);
    const representative = component[0];
    candidates.push({
      representative,
      degree: Number(adjacencyByCell.get(representative)?.size ?? 0),
      component,
    });
  }

  candidates.sort((a, b) => {
    if (b.degree !== a.degree) {
      return b.degree - a.degree;
    }
    return a.representative - b.representative;
  });

  const selectedRepresentatives = [];
  const signpostExclusionRadiusSq =
    JUNCTION_SIGNPOST_EXCLUSION_RADIUS * JUNCTION_SIGNPOST_EXCLUSION_RADIUS;

  for (const candidate of candidates) {
    const [x, y] = coordsOf(candidate.representative, width);
    let tooClose = false;
    for (const selectedCell of selectedRepresentatives) {
      const [sx, sy] = coordsOf(selectedCell, width);
      const dx = x - sx;
      const dy = y - sy;
      if (dx * dx + dy * dy <= signpostExclusionRadiusSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      continue;
    }

    selectedRepresentatives.push(candidate.representative);
    representativeCells.push(candidate.representative);
    for (const cell of candidate.component) {
      representativeByCell.set(cell, candidate.representative);
    }
  }

  representativeCells.sort((a, b) => a - b);
  return {
    representativeCells,
    representativeByCell,
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
