import { BIOME_KEYS } from "../config.js";
import { buildRoadNetwork } from "./network.js?v=20260401i";
import { clamp, coordsOf, dedupeCells, distance, forEachNeighbor, indexOf } from "../utils.js";

const MAX_ROADS_PER_CITY = 5;

const BIOME_TRAVEL_COST = {
  [BIOME_KEYS.OCEAN]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.LAKE]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.PLAINS]: 0.9,
  [BIOME_KEYS.FOREST]: 1.3,
  [BIOME_KEYS.RAINFOREST]: 1.55,
  [BIOME_KEYS.DESERT]: 1.15,
  [BIOME_KEYS.TUNDRA]: 1.4,
  [BIOME_KEYS.HIGHLANDS]: 1.95,
  [BIOME_KEYS.MOUNTAIN]: 3.15
};

export function generateRoads(world) {
  const { terrain, climate, hydrology, cities } = world;
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
  const landComponentByCell = buildLandComponents(width, height, isLand);
  const cityIdsByLandComponent = groupCityIdsByLandComponent(cities, landComponentByCell);
  const cityByCell = buildCityByCell(cities);
  const roadUsage = new Uint16Array(size);
  const cityRoadDegree = new Uint8Array(cities.length);
  const roads = [];

  for (const cityIds of cityIdsByLandComponent.values()) {
    connectCitiesOnLandComponent({
      cities,
      cityIds,
      cityByCell,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      baseCost,
      roadUsage,
      roads,
      cityRoadDegree
    });
  }

  const seaRoutes = buildSeaRoutes({
    cities,
    roads,
    terrain,
    climate
  });
  roads.push(...seaRoutes);
  const componentCount = buildRoadNetwork({ cities, roads, width }).components.filter(
    (component) => component.cityIds.length > 0
  ).length;

  return {
    roads,
    roadUsage,
    componentCount
  };
}

function connectCitiesOnLandComponent({
  cities,
  cityIds,
  cityByCell,
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  baseCost,
  roadUsage,
  roads,
  cityRoadDegree
}) {
  if (!cityIds || cityIds.length < 2) {
    return;
  }

  const cityIdSet = new Set(cityIds);
  const connectedCityIds = new Set();
  const sourceCells = new Set();
  const hub = pickRoadHub(cities, cityIdSet);
  if (!hub) {
    return;
  }

  connectedCityIds.add(hub.id);
  sourceCells.add(hub.cell);

  const maxIdleIterations = Math.max(16, cityIds.length * 8);
  let idleIterations = 0;

  while (connectedCityIds.size < cityIdSet.size && idleIterations < maxIdleIterations) {
    const searchSources = collectRoadSearchSources(sourceCells, cityByCell, connectedCityIds, cityRoadDegree);
    if (searchSources.length === 0) {
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
      sources: searchSources
    });

    const target = pickNextPendingCity(cities, cityIds, connectedCityIds, cityRoadDegree, search.distance);
    if (!target) {
      break;
    }

    const path = reconstructPath(target.city.cell, search.previous);
    if (path.length < 2) {
      idleIterations += 1;
      continue;
    }

    const fromCityId = findConnectedCityOnPath(path, cityByCell, connectedCityIds, cityRoadDegree);

    roads.push({
      id: roads.length,
      type: "road",
      cityId: target.city.id,
      fromCityId,
      cells: path,
      length: path.length,
      cost: target.cost
    });

    cityRoadDegree[target.city.id] = Math.min(255, cityRoadDegree[target.city.id] + 1);
    if (fromCityId != null) {
      cityRoadDegree[fromCityId] = Math.min(255, cityRoadDegree[fromCityId] + 1);
    }

    markRoadUsage(path, roadUsage);
    for (const cell of path) {
      sourceCells.add(cell);
      const touchedCity = cityByCell.get(cell);
      if (touchedCity && cityIdSet.has(touchedCity.id)) {
        connectedCityIds.add(touchedCity.id);
      }
    }

    idleIterations = 0;
  }
}

function collectRoadSearchSources(sourceCells, cityByCell, connectedCityIds, cityRoadDegree) {
  const sources = [];
  for (const cell of sourceCells) {
    const city = cityByCell.get(cell);
    if (city && connectedCityIds.has(city.id) && cityRoadDegree[city.id] >= MAX_ROADS_PER_CITY) {
      continue;
    }
    sources.push(cell);
  }
  return sources;
}

function pickNextPendingCity(cities, cityIds, connectedCityIds, cityRoadDegree, distances) {
  let best = null;

  for (const cityId of cityIds) {
    if (connectedCityIds.has(cityId)) {
      continue;
    }
    if (cityRoadDegree[cityId] >= MAX_ROADS_PER_CITY) {
      continue;
    }

    const city = cities[cityId];
    const cost = distances[city.cell];
    if (!Number.isFinite(cost)) {
      continue;
    }

    const score = cost - city.score * 0.35;
    if (!best || score < best.score) {
      best = { city, cost, score };
    }
  }

  return best;
}

function groupCityIdsByLandComponent(cities, landComponentByCell) {
  const cityIdsByLandComponent = new Map();

  for (const city of cities) {
    const componentId = landComponentByCell[city.cell];
    if (componentId < 0) {
      continue;
    }
    if (!cityIdsByLandComponent.has(componentId)) {
      cityIdsByLandComponent.set(componentId, []);
    }
    cityIdsByLandComponent.get(componentId).push(city.id);
  }

  return cityIdsByLandComponent;
}

function buildRoadBaseCost(size, isLand, lakeIdByCell, biome, elevation, mountainField) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = BIOME_TRAVEL_COST[biome[index]] ?? 1.2;
    const slopePenalty = elevation[index] * 0.55;
    const mountainPenalty =
      mountainField[index] * 1.9 + Math.max(0, mountainField[index] - 0.74) * 2.4;
    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

function pickRoadHub(cities, allowedCityIds) {
  const allowedCities = cities.filter((city) => allowedCityIds.has(city.id));
  if (allowedCities.length === 0) {
    return null;
  }

  let best = null;
  const center = allowedCities.reduce(
    (acc, city) => {
      acc.x += city.x;
      acc.y += city.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  center.x /= Math.max(1, allowedCities.length);
  center.y /= Math.max(1, allowedCities.length);

  for (const city of allowedCities) {
    const centrality = distance(city.x, city.y, center.x, center.y);
    const value = city.score * 1.2 - centrality * 0.04;
    if (!best || value > best.value) {
      best = { city, value };
    }
  }

  return best.city;
}

function buildSeaRoutes({ cities, roads, terrain, climate }) {
  const { width, height, isLand } = terrain;
  const { biome } = climate;
  const cityByCell = buildCityByCell(cities);
  const landComponentByCell = buildLandComponents(width, height, isLand);
  const harborByCityId = buildHarborMap(cities, width, height, isLand, biome);
  const seaRoutes = [];

  for (let iteration = 0; iteration < Math.max(0, cities.length * 2); iteration += 1) {
    const activeNetwork = buildRoadNetwork({ cities, roads: [...roads, ...seaRoutes], width });
    const connectedComponents = activeNetwork.components.filter((component) => component.cityIds.length > 0);
    if (connectedComponents.length <= 1) {
      break;
    }

    const bestCandidate = findBestSeaRouteByRadiusSteps({
      components: connectedComponents,
      cities,
      harborByCityId,
      landComponentByCell,
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
  width,
  height,
  isLand,
  biome
}) {
  const radiusSteps = [40, 60, 84, 112, 150, 220, 320, 460, Number.POSITIVE_INFINITY];
  for (const maxCityDistance of radiusSteps) {
    const candidate = findBestSeaRouteCandidate({
      components,
      cities,
      harborByCityId,
      landComponentByCell,
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
        if (sourceHarbor == null) {
          continue;
        }

        for (const toCity of portCitiesB) {
          const targetHarbor = harborByCityId.get(toCity.id);
          const targetLandComponent = landComponentByCell[toCity.cell];
          if (targetHarbor == null || sourceLandComponent === targetLandComponent) {
            continue;
          }

          const cityDistance = distance(fromCity.x, fromCity.y, toCity.x, toCity.y);
          if (Number.isFinite(maxCityDistance) && cityDistance > maxCityDistance) {
            continue;
          }

          const waterPath =
            buildDirectSeaLane(sourceHarbor, targetHarbor, width, height, isLand, biome) ||
            buildSeaLane(sourceHarbor, targetHarbor, width, height, isLand, biome);
          if (!waterPath) {
            continue;
          }

          const detourPenalty = Math.max(0, waterPath.length - cityDistance);
          const score =
            waterPath.length * 1.12 +
            cityDistance * 0.46 +
            detourPenalty * 0.32 -
            (fromCity.score + toCity.score) * 0.04;

          if (!best || score < best.score) {
            best = { fromCity, toCity, waterPath, score };
          }
        }
      }
    }
  }

  return best;
}

function getComponentPortCities(component, cities, harborByCityId) {
  const coastal = component.cityIds
    .map((cityId) => cities[cityId])
    .filter((city) => city.coastal && harborByCityId.has(city.id));
  if (coastal.length > 0) {
    return coastal;
  }

  return component.cityIds
    .map((cityId) => cities[cityId])
    .filter((city) => harborByCityId.has(city.id));
}

function materializeSeaRoute({ city, candidate, waterPath, cityByCell }) {
  if (!waterPath || waterPath.length < 2) {
    return null;
  }

  const cells = dedupeCells([city.cell, ...waterPath, candidate.cell]);
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
      city.coastal ? 4 : 16
    );
    if (harbor != null) {
      harborByCityId.set(city.id, harbor);
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

function buildCityByCell(cities) {
  return new Map(cities.map((city) => [city.cell, city]));
}

function findConnectedCityOnPath(path, cityByCell, connectedCityIds, cityRoadDegree) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const city = cityByCell.get(path[index]);
    if (city && connectedCityIds.has(city.id) && cityRoadDegree[city.id] < MAX_ROADS_PER_CITY) {
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

function runRoadSearch({ width, height, size, isLand, lakeIdByCell, riverStrength, roadUsage, baseCost, sources }) {
  const distanceField = new Float32Array(size);
  distanceField.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(size);
  previous.fill(-1);
  const heap = new MinHeap();

  for (const source of sources) {
    if (!Number.isFinite(baseCost[source])) {
      continue;
    }
    if (distanceField[source] <= 0) {
      continue;
    }
    distanceField[source] = 0;
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
