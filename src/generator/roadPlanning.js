import { buildRoadNetwork } from "./network.js?v=20260401i";

export function buildRoadPlanningState({ cities, roads, width, seedCityIds }) {
  const network = buildRoadNetwork({ cities, roads, width });
  const activeCityIds = new Set();
  const pendingCityIds = new Set();
  const sourceCells = [];
  const seenSourceCells = new Set();

  if (seedCityIds && seedCityIds.size > 0) {
    const componentById = new Map(network.components.map((component) => [component.id, component]));
    const seededComponentIds = collectSeededComponentIds(network.nodes, cities, seedCityIds);

    for (const componentId of seededComponentIds) {
      const component = componentById.get(componentId);
      if (!component) {
        continue;
      }

      for (const cityId of component.cityIds) {
        activeCityIds.add(cityId);
      }

      for (const nodeId of component.nodeIds) {
        pushSourceCell(network.nodes[nodeId].cell, sourceCells, seenSourceCells);
      }

      for (const linkId of component.linkIds) {
        for (const cell of network.links[linkId].cells) {
          pushSourceCell(cell, sourceCells, seenSourceCells);
        }
      }
    }
  }

  for (const city of cities) {
    if (!activeCityIds.has(city.id)) {
      pendingCityIds.add(city.id);
    }
  }

  return {
    activeCityIds,
    pendingCityIds,
    sourceCells
  };
}

function collectSeededComponentIds(nodes, cities, seedCityIds) {
  const componentIds = new Set();

  for (const cityId of seedCityIds) {
    const city = cities[cityId];
    if (!city) {
      continue;
    }

    const node = nodes.find((candidate) => candidate.cityId === city.id);
    if (node?.componentId != null) {
      componentIds.add(node.componentId);
    }
  }

  return componentIds;
}

function pushSourceCell(cell, sourceCells, seenSourceCells) {
  if (seenSourceCells.has(cell)) {
    return;
  }
  seenSourceCells.add(cell);
  sourceCells.push(cell);
}
