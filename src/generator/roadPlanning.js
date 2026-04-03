import { buildRoadNetwork } from "./network.js?v=20260401i";

const MIN_BRANCH_DISTANCE_FROM_CITY = 18;

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
    }

    const activeCityCells = collectActiveCityCells(cities, activeCityIds);

    for (const componentId of seededComponentIds) {
      const component = componentById.get(componentId);
      if (!component) {
        continue;
      }

      for (const nodeId of component.nodeIds) {
        const node = network.nodes[nodeId];
        const allowNearCity = node.cityId != null;
        pushSourceCell(
          node.cell,
          sourceCells,
          seenSourceCells,
          width,
          activeCityCells,
          allowNearCity
        );
      }

      for (const linkId of component.linkIds) {
        for (const cell of network.links[linkId].cells) {
          pushSourceCell(cell, sourceCells, seenSourceCells, width, activeCityCells, false);
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

function pushSourceCell(
  cell,
  sourceCells,
  seenSourceCells,
  width = 0,
  activeCityCells = [],
  allowNearCity = false
) {
  if (!allowNearCity && isNearActiveCity(cell, width, activeCityCells)) {
    return;
  }
  if (seenSourceCells.has(cell)) {
    return;
  }
  seenSourceCells.add(cell);
  sourceCells.push(cell);
}

function collectActiveCityCells(cities, activeCityIds) {
  const activeCityCells = [];
  for (const cityId of activeCityIds) {
    const city = cities[cityId];
    if (!city || city.cell == null) {
      continue;
    }
    activeCityCells.push(city.cell);
  }
  return activeCityCells;
}

function isNearActiveCity(cell, width, activeCityCells) {
  if (!width || activeCityCells.length === 0) {
    return false;
  }

  const x = cell % width;
  const y = Math.floor(cell / width);
  const minDistanceSq = MIN_BRANCH_DISTANCE_FROM_CITY * MIN_BRANCH_DISTANCE_FROM_CITY;

  for (const cityCell of activeCityCells) {
    if (cityCell === cell) {
      return true;
    }
    const cityX = cityCell % width;
    const cityY = Math.floor(cityCell / width);
    const dx = x - cityX;
    const dy = y - cityY;
    if (dx * dx + dy * dy < minDistanceSq) {
      return true;
    }
  }

  return false;
}
