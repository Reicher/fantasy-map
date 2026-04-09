import { BIOME_KEYS } from "../config.js";
import { buildRoadNetwork } from "./network.js?v=20260401i";
import { buildRoadPlanningState } from "./roadPlanning.js?v=20260409a";
import { clamp, coordsOf, distance, forEachNeighbor, indexOf } from "../utils.js";

const BIOME_TRAVEL_COST = {
  [BIOME_KEYS.OCEAN]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.LAKE]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.PLAINS]: 0.9,
  [BIOME_KEYS.FOREST]: 1.45,
  [BIOME_KEYS.RAINFOREST]: 1.8,
  [BIOME_KEYS.DESERT]: 1.28,
  [BIOME_KEYS.TUNDRA]: 1.52,
  [BIOME_KEYS.HIGHLANDS]: 2.25,
  [BIOME_KEYS.MOUNTAIN]: 4.8
};
const MAX_SEA_ROUTES_PER_ISLAND_COMPONENT = 2;
const ISLAND_COMPONENT_SIZE_RATIO_THRESHOLD = 0.6;
const SEA_ROUTE_RADIUS_STEPS = [40, 60, 84, 112, 150, 220];

export function generateRoads(world) {
  const { params, terrain, climate, hydrology, cities } = world;
  const { width, height, size, isLand, elevation, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength } = hydrology;

  if (cities.length < 2) {
    return {
      roads: [],
      roadUsage: new Uint16Array(size),
      componentCount: cities.length > 0 ? 1 : 0
    };
  }

  const baseCost = buildRoadBaseCost(size, isLand, lakeIdByCell, biome, elevation, mountainField);
  const cityByCell = buildCityByCell(cities);
  const roadUsage = new Uint16Array(size);
  const roads = [];
  const seedCityIds = new Set();
  let componentCount = 0;

  while (true) {
    if (seedCityIds.size === 0) {
      const hub = pickRoadHub(cities, new Set(cities.map((city) => city.id)));
      seedCityIds.add(hub.id);
      componentCount += 1;
    }

    const planning = buildRoadPlanningState({
      cities,
      roads,
      width,
      seedCityIds
    });
    if (planning.pendingCityIds.size === 0) {
      break;
    }

    const search = runRoadSearch({
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      roadUsage,
      baseCost,
      sources: planning.sourceCells,
      sourceSeedCostByCell: planning.sourceSeedCostByCell,
    });
    const target = pickNextRoadTarget(cities, planning.pendingCityIds, search.distance);

    if (!target) {
      const hub = pickRoadHub(cities, planning.pendingCityIds);
      seedCityIds.add(hub.id);
      componentCount += 1;
      continue;
    }

    const path = reconstructPath(target.city.cell, search.previous);
    if (path.length < 2) {
      seedCityIds.add(target.city.id);
      continue;
    }

    const fromCityId = findConnectedCityOnPath(path, cityByCell, planning.activeCityIds);
    roads.push({
      id: roads.length,
      type: "road",
      cityId: target.city.id,
      fromCityId,
      cells: path,
      length: path.length,
      cost: target.cost
    });
    markRoadUsage(path, roadUsage);
  }

  const normalizedRoads = collapseShortSettlementSpurs({
    roads,
    cities,
    width,
  });
  roads.length = 0;
  roads.push(...normalizedRoads);
  roadUsage.fill(0);
  for (const road of roads) {
    if (road.type === "road") {
      markRoadUsage(road.cells, roadUsage);
    }
  }

  const seaRoutes = buildSeaRoutes({
    cities,
    roads,
    terrain,
    climate
  });
  roads.push(...seaRoutes);

  return {
    roads,
    roadUsage,
    componentCount
  };
}

function collapseShortSettlementSpurs({
  roads,
  cities,
  width,
  maxSpurSteps = 4,
}) {
  const nextRoads = roads
    .filter((road) => road?.type === "road" && (road.cells?.length ?? 0) >= 2)
    .map((road) => ({
      ...road,
      cells: [...road.cells],
      length: road.cells.length,
    }));
  const movableCities = cities.filter((city) => city?.cell != null);
  if (!nextRoads.length || !movableCities.length) {
    return nextRoads;
  }

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 6) {
    iterations += 1;
    changed = false;

    const degreeByCell = buildRoadCellDegree(nextRoads);
    const cityByCell = new Map();
    for (const city of movableCities) {
      cityByCell.set(city.cell, city);
    }

    for (const city of movableCities) {
      const cityCell = city.cell;
      const endpointRoads = findEndpointRoadsForCity(nextRoads, cityCell);
      if (!endpointRoads.length) {
        continue;
      }

      let bestMove = null;
      for (const endpoint of endpointRoads) {
        const spur = findNearbyJunctionOnEndpointRoad(
          endpoint.road.cells,
          endpoint.atStart,
          degreeByCell,
          maxSpurSteps,
        );
        if (!spur) {
          continue;
        }
        if (cityByCell.has(spur.junctionCell)) {
          continue;
        }
        if (!bestMove || spur.steps < bestMove.spur.steps) {
          bestMove = { endpoint, spur };
        }
      }

      if (!bestMove) {
        continue;
      }

      const { endpoint, spur } = bestMove;
      const oldCell = city.cell;
      city.cell = spur.junctionCell;
      const [nextX, nextY] = coordsOf(spur.junctionCell, width);
      city.x = nextX;
      city.y = nextY;

      endpoint.road.cells = trimRoadFromEndpoint(
        endpoint.road.cells,
        endpoint.atStart,
        spur.steps,
      );

      changed = true;
      cityByCell.delete(oldCell);
      cityByCell.set(city.cell, city);
    }

    for (let index = nextRoads.length - 1; index >= 0; index -= 1) {
      if ((nextRoads[index].cells?.length ?? 0) < 2) {
        nextRoads.splice(index, 1);
      }
    }
  }

  return nextRoads.map((road, index) => {
    const cells = dedupePath(road.cells);
    return {
      ...road,
      id: index,
      cells,
      length: cells.length,
    };
  });
}

function findEndpointRoadsForCity(roads, cityCell) {
  const matches = [];
  for (const road of roads) {
    if (!road?.cells?.length) {
      continue;
    }
    const start = road.cells[0];
    const end = road.cells[road.cells.length - 1];
    if (start === cityCell) {
      matches.push({ road, atStart: true });
    } else if (end === cityCell) {
      matches.push({ road, atStart: false });
    }
  }
  return matches;
}

function findNearbyJunctionOnEndpointRoad(
  cells,
  atStart,
  degreeByCell,
  maxSpurSteps,
) {
  const maxSteps = Math.min(maxSpurSteps, Math.max(0, cells.length - 1));
  for (let steps = 1; steps <= maxSteps; steps += 1) {
    const cell = atStart ? cells[steps] : cells[cells.length - 1 - steps];
    const degree = degreeByCell.get(cell) ?? 0;
    if (degree >= 3) {
      return { junctionCell: cell, steps };
    }
  }
  return null;
}

function trimRoadFromEndpoint(cells, atStart, steps) {
  if (steps <= 0) {
    return cells;
  }
  return atStart
    ? cells.slice(steps)
    : cells.slice(0, Math.max(0, cells.length - steps));
}

function buildRoadCellDegree(roads) {
  const neighborsByCell = new Map();
  for (const road of roads) {
    const cells = road?.cells ?? [];
    for (let index = 1; index < cells.length; index += 1) {
      addRoadNeighbor(neighborsByCell, cells[index - 1], cells[index]);
      addRoadNeighbor(neighborsByCell, cells[index], cells[index - 1]);
    }
  }
  const degreeByCell = new Map();
  for (const [cell, neighbors] of neighborsByCell.entries()) {
    degreeByCell.set(cell, neighbors.size);
  }
  return degreeByCell;
}

function addRoadNeighbor(neighborsByCell, fromCell, toCell) {
  let neighbors = neighborsByCell.get(fromCell);
  if (!neighbors) {
    neighbors = new Set();
    neighborsByCell.set(fromCell, neighbors);
  }
  neighbors.add(toCell);
}

function buildRoadBaseCost(size, isLand, lakeIdByCell, biome, elevation, mountainField) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = BIOME_TRAVEL_COST[biome[index]] ?? 1.2;
    const slopePenalty = elevation[index] * 0.8;
    const mountainPenalty = mountainField[index] * 2.9 + Math.max(0, mountainField[index] - 0.68) * 4.2;
    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

function pickRoadHub(cities, allowedCityIds) {
  let best = null;
  const center = cities.reduce(
    (acc, city) => {
      acc.x += city.x;
      acc.y += city.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  center.x /= Math.max(1, cities.length);
  center.y /= Math.max(1, cities.length);

  for (const city of cities) {
    if (!allowedCityIds.has(city.id)) {
      continue;
    }
    const centrality = distance(city.x, city.y, center.x, center.y);
    const value = city.score * 1.2 - centrality * 0.04;
    if (!best || value > best.value) {
      best = { city, value };
    }
  }

  return best.city;
}

function pickNextRoadTarget(cities, remainingCityIds, distances) {
  let best = null;

  for (const cityId of remainingCityIds) {
    const city = cities[cityId];
    const cost = distances[city.cell];
    if (!Number.isFinite(cost)) {
      continue;
    }

    const score = cost - city.score * 0.4;
    if (!best || score < best.score) {
      best = { city, cost, score };
    }
  }

  return best;
}

function buildSeaRoutes({ cities, roads, terrain, climate }) {
  const { width, height, isLand } = terrain;
  const { biome } = climate;
  const cityByCell = buildCityByCell(cities);
  const landComponentByCell = buildLandComponents(width, height, isLand);
  const landComponentInfo = buildLandComponentInfo(landComponentByCell, isLand);
  const harborByCityId = buildHarborMap(cities, width, height, isLand, biome);
  const seaRoutes = [];

  for (let iteration = 0; iteration < Math.max(0, cities.length * 2); iteration += 1) {
    const activeNetwork = buildRoadNetwork({ cities, roads: [...roads, ...seaRoutes], width });
    const connectedComponents = activeNetwork.components.filter((component) => component.cityIds.length > 0);
    if (connectedComponents.length <= 1) {
      break;
    }

    const seaRouteCountByLandComponent = buildSeaRouteCountByLandComponent(
      [...roads, ...seaRoutes],
      cities,
      landComponentByCell
    );
    const bestCandidate = findBestSeaRouteByRadiusSteps({
      components: connectedComponents,
      cities,
      harborByCityId,
      landComponentByCell,
      landComponentInfo,
      seaRouteCountByLandComponent,
      width,
      height,
      isLand,
      biome
    });
    if (!bestCandidate) {
      break;
    }

    const route = materializeSeaRoute({
      city: bestCandidate.fromCity,
      candidate: bestCandidate.toCity,
      waterPath: bestCandidate.waterPath,
      cityByCell
    });
    if (!route) {
      break;
    }

    route.id = roads.length + seaRoutes.length;
    route.type = "sea-route";
    seaRoutes.push(route);
  }

  return seaRoutes;
}

function findBestSeaRouteByRadiusSteps({
  components,
  cities,
  harborByCityId,
  landComponentByCell,
  landComponentInfo,
  seaRouteCountByLandComponent,
  width,
  height,
  isLand,
  biome
}) {
  for (const maxCityDistance of SEA_ROUTE_RADIUS_STEPS) {
    const candidate = findBestSeaRouteCandidate({
      components,
      cities,
      harborByCityId,
      landComponentByCell,
      landComponentInfo,
      seaRouteCountByLandComponent,
      width,
      height,
      isLand,
      biome,
      maxCityDistance
    });
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function findBestSeaRouteCandidate({
  components,
  cities,
  harborByCityId,
  landComponentByCell,
  landComponentInfo,
  seaRouteCountByLandComponent,
  width,
  height,
  isLand,
  biome,
  maxCityDistance
}) {
  let best = null;

  for (let aIndex = 0; aIndex < components.length; aIndex += 1) {
    const componentA = components[aIndex];
    const portCitiesA = getComponentPortCities(componentA, cities, harborByCityId);
    if (portCitiesA.length === 0) {
      continue;
    }

    for (let bIndex = aIndex + 1; bIndex < components.length; bIndex += 1) {
      const componentB = components[bIndex];
      const portCitiesB = getComponentPortCities(componentB, cities, harborByCityId);
      if (portCitiesB.length === 0) {
        continue;
      }

      for (const fromCity of portCitiesA) {
        const sourceHarbor = harborByCityId.get(fromCity.id);
        const sourceLandComponent = landComponentByCell[fromCity.cell];
        if (
          sourceHarbor == null ||
          !canAddSeaRouteForLandComponent(
            sourceLandComponent,
            landComponentInfo,
            seaRouteCountByLandComponent
          )
        ) {
          continue;
        }

        for (const toCity of portCitiesB) {
          const targetHarbor = harborByCityId.get(toCity.id);
          const targetLandComponent = landComponentByCell[toCity.cell];
          if (
            targetHarbor == null ||
            sourceLandComponent === targetLandComponent ||
            !canAddSeaRouteForLandComponent(
              targetLandComponent,
              landComponentInfo,
              seaRouteCountByLandComponent
            )
          ) {
            continue;
          }

          const cityDistance = distance(fromCity.x, fromCity.y, toCity.x, toCity.y);
          if (cityDistance > maxCityDistance) {
            continue;
          }

          const waterPath =
            buildDirectSeaLane(sourceHarbor.cell, targetHarbor.cell, width, height, isLand, biome) ||
            buildSeaLane(sourceHarbor.cell, targetHarbor.cell, width, height, isLand, biome);
          if (!waterPath) {
            continue;
          }

          const candidate = {
            fromCity,
            toCity,
            waterPath,
            cityDistance,
            waterDistance: waterPath.length,
            harborOffset: sourceHarbor.distance + targetHarbor.distance
          };
          if (!best || isSeaRouteCandidateCloser(candidate, best)) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
}

function getComponentPortCities(component, cities, harborByCityId) {
  const portCities = component.cityIds
    .map((cityId) => cities[cityId])
    .filter((city) => harborByCityId.has(city.id));

  const coastal = component.cityIds
    .map((cityId) => cities[cityId])
    .filter((city) => city.coastal && harborByCityId.has(city.id));
  if (coastal.length > 0) {
    return coastal;
  }

  const nearCoastal = portCities.filter(
    (city) => (harborByCityId.get(city.id)?.distance ?? Number.POSITIVE_INFINITY) <= 3
  );
  if (nearCoastal.length > 0) {
    return nearCoastal;
  }

  return portCities;
}

function materializeSeaRoute({ city, candidate, waterPath, cityByCell }) {
  if (!waterPath || waterPath.length < 2) {
    return null;
  }

  const cells = dedupePath([city.cell, ...waterPath, candidate.cell]);
  const viaCityId = findSeaRouteTouchCity(cells, cityByCell, city.id, candidate.id);

  return {
    fromCityId: city.id,
    cityId: candidate.id,
    viaCityId,
    cells,
    length: cells.length,
    cost: waterPath.length
  };
}

function buildHarborMap(cities, width, height, isLand, biome) {
  const harborByCityId = new Map();

  for (const city of cities) {
    const harbor = findNearestOceanCell(
      city.cell,
      width,
      height,
      isLand,
      biome,
      city.coastal ? 4 : 8
    );
    if (harbor != null) {
      const [harborX, harborY] = coordsOf(harbor, width);
      harborByCityId.set(city.id, {
        cell: harbor,
        distance: distance(city.x, city.y, harborX, harborY)
      });
    }
  }

  return harborByCityId;
}

function findNearestOceanCell(startCell, width, height, isLand, biome, maxRadius = 4) {
  const [startX, startY] = coordsOf(startCell, width);
  let best = null;

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = Math.max(0, startY - radius); y <= Math.min(height - 1, startY + radius); y += 1) {
      for (let x = Math.max(0, startX - radius); x <= Math.min(width - 1, startX + radius); x += 1) {
        const cell = indexOf(x, y, width);
        if (isLand[cell] || biome[cell] !== BIOME_KEYS.OCEAN) {
          continue;
        }

        const dist = distance(startX, startY, x, y);
        if (!best || dist < best.dist) {
          best = { cell, dist };
        }
      }
    }

    if (best) {
      return best.cell;
    }
  }

  return null;
}

function buildDirectSeaLane(startCell, endCell, width, height, isLand, biome) {
  const [startX, startY] = coordsOf(startCell, width);
  const [endX, endY] = coordsOf(endCell, width);
  const cells = [];
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));

  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const x = clamp(Math.round(startX + (endX - startX) * t), 0, width - 1);
    const y = clamp(Math.round(startY + (endY - startY) * t), 0, height - 1);
    const cell = indexOf(x, y, width);
    if (cells[cells.length - 1] !== cell) {
      if (isLand[cell] || biome[cell] !== BIOME_KEYS.OCEAN) {
        return null;
      }
      cells.push(cell);
    }
  }

  return cells.length >= 2 ? cells : null;
}

function buildSeaLane(startCell, endCell, width, height, isLand, biome) {
  const visited = new Uint8Array(isLand.length);
  const previous = new Int32Array(isLand.length);
  previous.fill(-1);
  const queue = [startCell];
  let head = 0;

  visited[startCell] = 1;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;

    if (current === endCell) {
      return reconstructPath(endCell, previous).reverse();
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (visited[neighbor]) {
        return;
      }
      if (isLand[neighbor] || biome[neighbor] !== BIOME_KEYS.OCEAN) {
        return;
      }

      visited[neighbor] = 1;
      previous[neighbor] = current;
      queue.push(neighbor);
    });
  }

  return null;
}

function buildLandComponents(width, height, isLand) {
  const components = new Int32Array(isLand.length);
  components.fill(-1);
  let nextId = 0;

  for (let start = 0; start < isLand.length; start += 1) {
    if (!isLand[start] || components[start] >= 0) {
      continue;
    }

    const queue = [start];
    components[start] = nextId;
    while (queue.length > 0) {
      const current = queue.pop();
      const [x, y] = coordsOf(current, width);
      forEachNeighbor(width, height, x, y, true, (nx, ny) => {
        const neighbor = indexOf(nx, ny, width);
        if (!isLand[neighbor] || components[neighbor] >= 0) {
          return;
        }
        components[neighbor] = nextId;
        queue.push(neighbor);
      });
    }

    nextId += 1;
  }

  return components;
}

function buildLandComponentInfo(landComponentByCell, isLand) {
  const sizeByComponent = new Map();

  for (let cell = 0; cell < landComponentByCell.length; cell += 1) {
    if (!isLand[cell]) {
      continue;
    }
    const componentId = landComponentByCell[cell];
    if (componentId < 0) {
      continue;
    }
    sizeByComponent.set(componentId, (sizeByComponent.get(componentId) ?? 0) + 1);
  }

  let mainlandComponentId = -1;
  let mainlandSize = -1;
  for (const [componentId, size] of sizeByComponent.entries()) {
    if (size > mainlandSize) {
      mainlandSize = size;
      mainlandComponentId = componentId;
    }
  }

  return {
    sizeByComponent,
    mainlandComponentId,
    mainlandSize
  };
}

function buildSeaRouteCountByLandComponent(roads, cities, landComponentByCell) {
  const counts = new Map();
  const cityById = new Map(cities.map((city) => [city.id, city]));

  for (const road of roads) {
    if (road?.type !== "sea-route") {
      continue;
    }

    const sourceCity = cityById.get(road.fromCityId);
    const targetCity = cityById.get(road.cityId);
    if (!sourceCity || !targetCity) {
      continue;
    }

    const sourceComponent = landComponentByCell[sourceCity.cell];
    const targetComponent = landComponentByCell[targetCity.cell];
    if (sourceComponent < 0 || targetComponent < 0) {
      continue;
    }

    counts.set(sourceComponent, (counts.get(sourceComponent) ?? 0) + 1);
    if (targetComponent !== sourceComponent) {
      counts.set(targetComponent, (counts.get(targetComponent) ?? 0) + 1);
    }
  }

  return counts;
}

function canAddSeaRouteForLandComponent(componentId, landComponentInfo, seaRouteCountByLandComponent) {
  if (componentId < 0) {
    return false;
  }
  if (!isIslandLandComponent(componentId, landComponentInfo)) {
    return true;
  }
  return (seaRouteCountByLandComponent.get(componentId) ?? 0) < MAX_SEA_ROUTES_PER_ISLAND_COMPONENT;
}

function isIslandLandComponent(componentId, landComponentInfo) {
  if (componentId < 0 || componentId === landComponentInfo.mainlandComponentId) {
    return false;
  }

  const mainlandSize = landComponentInfo.mainlandSize;
  if (!Number.isFinite(mainlandSize) || mainlandSize <= 0) {
    return false;
  }

  const componentSize = landComponentInfo.sizeByComponent.get(componentId) ?? 0;
  return componentSize <= mainlandSize * ISLAND_COMPONENT_SIZE_RATIO_THRESHOLD;
}

function isSeaRouteCandidateCloser(candidate, currentBest) {
  const epsilon = 1e-4;
  if (candidate.cityDistance < currentBest.cityDistance - epsilon) {
    return true;
  }
  if (candidate.cityDistance > currentBest.cityDistance + epsilon) {
    return false;
  }

  if (candidate.waterDistance < currentBest.waterDistance - epsilon) {
    return true;
  }
  if (candidate.waterDistance > currentBest.waterDistance + epsilon) {
    return false;
  }

  if (candidate.harborOffset < currentBest.harborOffset - epsilon) {
    return true;
  }
  if (candidate.harborOffset > currentBest.harborOffset + epsilon) {
    return false;
  }

  return candidate.fromCity.score + candidate.toCity.score > currentBest.fromCity.score + currentBest.toCity.score;
}

function buildCityByCell(cities) {
  return new Map(cities.map((city) => [city.cell, city]));
}

function findConnectedCityOnPath(path, cityByCell, connectedCityIds) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const city = cityByCell.get(path[index]);
    if (city && connectedCityIds.has(city.id)) {
      return city.id;
    }
  }

  return null;
}

function findSeaRouteTouchCity(cells, cityByCell, sourceCityId, targetCityId) {
  for (let index = 1; index < cells.length - 1; index += 1) {
    const city = cityByCell.get(cells[index]);
    if (city && city.id !== sourceCityId && city.id !== targetCityId) {
      return city.id;
    }
  }

  return null;
}

function markRoadUsage(path, roadUsage) {
  for (const cell of path) {
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, 65535);
  }
}

function dedupePath(path) {
  const deduped = [];
  for (const cell of path) {
    if (deduped[deduped.length - 1] !== cell) {
      deduped.push(cell);
    }
  }
  return deduped;
}

function reconstructPath(start, previous) {
  const path = [start];
  let current = start;

  while (previous[current] >= 0) {
    current = previous[current];
    if (path[path.length - 1] !== current) {
      path.push(current);
    }
  }

  return path;
}

function runRoadSearch({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  roadUsage,
  baseCost,
  sources,
  sourceSeedCostByCell = new Map(),
}) {
  const distanceField = new Float32Array(size);
  distanceField.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(size);
  previous.fill(-1);
  const heap = new MinHeap();

  for (const source of sources) {
    if (!Number.isFinite(baseCost[source])) {
      continue;
    }
    const seedCost = Math.max(
      0,
      Number(sourceSeedCostByCell.get(source) ?? 0),
    );
    if (distanceField[source] <= seedCost) {
      continue;
    }
    distanceField[source] = seedCost;
    heap.push(source, distanceField[source]);
  }

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    if (priority > distanceField[current] + 1e-4) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
      const neighbor = indexOf(nx, ny, width);
      const stepCost = computeStepCost(
        current,
        neighbor,
        Math.abs(ox) + Math.abs(oy) === 2,
        isLand,
        lakeIdByCell,
        riverStrength,
        roadUsage,
        baseCost
      );
      if (!Number.isFinite(stepCost)) {
        return;
      }

      const nextCost = priority + stepCost;
      if (nextCost < distanceField[neighbor]) {
        distanceField[neighbor] = nextCost;
        previous[neighbor] = current;
        heap.push(neighbor, distanceField[neighbor]);
      }
    });
  }

  return {
    distance: distanceField,
    previous
  };
}

function computeStepCost(current, neighbor, diagonal, isLand, lakeIdByCell, riverStrength, roadUsage, baseCost) {
  if (!isLand[neighbor] || lakeIdByCell[neighbor] >= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(baseCost[current]) || !Number.isFinite(baseCost[neighbor])) {
    return Number.POSITIVE_INFINITY;
  }

  const stepLength = diagonal ? 1.4142 : 1;
  let cost = ((baseCost[current] + baseCost[neighbor]) * 0.5) * stepLength;
  const riverPenalty = Math.max(riverStrength[current], riverStrength[neighbor]);
  if (riverPenalty > 0.06) {
    cost += 3.6 + clamp(riverPenalty, 0, 4) * 4.8;
  }

  if (roadUsage[current] > 0 && roadUsage[neighbor] > 0) {
    cost *= 0.18;
  } else if (roadUsage[current] > 0 || roadUsage[neighbor] > 0) {
    cost *= 0.46;
  }

  return cost;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(index, priority) {
    const node = { index, priority };
    this.items.push(node);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.items[parent].priority <= this.items[current].priority) {
        break;
      }
      [this.items[parent], this.items[current]] = [this.items[current], this.items[parent]];
      current = parent;
    }
  }

  bubbleDown(index) {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;

      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) {
        smallest = right;
      }
      if (smallest === current) {
        break;
      }

      [this.items[current], this.items[smallest]] = [this.items[smallest], this.items[current]];
      current = smallest;
    }
  }
}
