import { BIOME_KEYS } from "../config.js";
import { buildRoadNetwork } from "./network.js?v=20260401i";
import { clamp, coordsOf, dedupeCells, distance, forEachNeighbor, indexOf } from "../utils.js";

const DEFAULT_MAX_ROADS_PER_CITY = 5;
const DEFAULT_LAND_NEAREST_NEIGHBORS = 4;
const DEFAULT_LAND_REDUNDANCY_RATIO = 1.75;
const DEFAULT_LAND_EXTRA_LINK_FACTOR = 0;
const DEFAULT_LAND_HOP_BRIDGE_FACTOR = 0.1;
const DEFAULT_LAND_HOP_BRIDGE_MIN_DETOUR_RATIO = 2.1;
const DEFAULT_LAND_HOP_BRIDGE_MAX_DIRECT_TO_DETOUR = 0.72;
const DEFAULT_LAND_HOP_BRIDGE_LOCAL_CHEAP_FACTOR = 1.9;
const DEFAULT_CITY_PROXIMITY_RADIUS = 6;
const DEFAULT_CITY_PROXIMITY_PENALTY = 12;
const DEFAULT_REUSE_ON_ROAD_MULTIPLIER = 0.9;
const DEFAULT_REUSE_TOUCHING_ROAD_MULTIPLIER = 0.96;
const DEFAULT_ROAD_PRESSURE_OFFROAD_PENALTY = 0.3;
const DEFAULT_ROAD_PRESSURE_ONROAD_PENALTY = 0.07;
const ROAD_PRESSURE_SELF = 1;
const ROAD_PRESSURE_NEAR = 0.56;
const ROAD_PRESSURE_MID = 0.18;
const ROAD_SEARCH_HEURISTIC_SCALE = 0.55;
const ROAD_SEARCH_MAX_EXPANSION_FACTOR = 1.6;
const ROAD_INTERSECTION_MIN_SPACING = 5;

const BIOME_TRAVEL_COST = {
  [BIOME_KEYS.OCEAN]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.LAKE]: Number.POSITIVE_INFINITY,
  [BIOME_KEYS.PLAINS]: 0.85,
  [BIOME_KEYS.FOREST]: 1.45,
  [BIOME_KEYS.RAINFOREST]: 2.9,
  [BIOME_KEYS.DESERT]: 1.25,
  [BIOME_KEYS.TUNDRA]: 1.55,
  [BIOME_KEYS.HIGHLANDS]: 2.15,
  [BIOME_KEYS.MOUNTAIN]: 9.5
};

function resolveRoadSettings(params = {}) {
  const shortcut = clamp(Number(params.roadShortcutAggression ?? 50), 0, 100) / 100;
  const reuse = clamp(Number(params.roadReuseBias ?? 50), 0, 100) / 100;
  const cityAvoidance = clamp(Number(params.roadCityAvoidance ?? 50), 0, 100) / 100;
  const shortcutDelta = shortcut - 0.5;
  const reuseDelta = reuse - 0.5;
  const cityAvoidanceDelta = cityAvoidance - 0.5;

  return {
    maxRoadsPerCity: clamp(
      Math.round(Number(params.roadMaxConnectionsPerCity ?? DEFAULT_MAX_ROADS_PER_CITY)),
      2,
      8
    ),
    nearestNeighbors: clamp(
      Math.round(DEFAULT_LAND_NEAREST_NEIGHBORS + shortcutDelta * 8),
      3,
      8
    ),
    redundancyRatio: DEFAULT_LAND_REDUNDANCY_RATIO,
    extraLinkFactor: clamp(
      DEFAULT_LAND_EXTRA_LINK_FACTOR + Math.max(0, shortcut - 0.45) * 0.42,
      0,
      0.24
    ),
    hopBridgeFactor: clamp(
      DEFAULT_LAND_HOP_BRIDGE_FACTOR + shortcutDelta * 0.24,
      0.02,
      0.3
    ),
    hopBridgeMinDetourRatio: clamp(
      DEFAULT_LAND_HOP_BRIDGE_MIN_DETOUR_RATIO - shortcutDelta * 1.2,
      1.35,
      2.8
    ),
    hopBridgeMaxDirectToDetour: clamp(
      DEFAULT_LAND_HOP_BRIDGE_MAX_DIRECT_TO_DETOUR + shortcutDelta * 0.28,
      0.48,
      0.9
    ),
    hopBridgeLocalCheapFactor: clamp(
      DEFAULT_LAND_HOP_BRIDGE_LOCAL_CHEAP_FACTOR + shortcutDelta * 0.9,
      1.2,
      2.6
    ),
    cityProximityRadius: clamp(
      Math.round(DEFAULT_CITY_PROXIMITY_RADIUS + cityAvoidanceDelta * 6),
      2,
      10
    ),
    cityProximityPenalty: clamp(
      DEFAULT_CITY_PROXIMITY_PENALTY + cityAvoidanceDelta * 16,
      2,
      28
    ),
    reuseOnRoadMultiplier: clamp(
      DEFAULT_REUSE_ON_ROAD_MULTIPLIER - reuseDelta * 0.2,
      0.78,
      1
    ),
    reuseTouchingRoadMultiplier: clamp(
      DEFAULT_REUSE_TOUCHING_ROAD_MULTIPLIER - reuseDelta * 0.08,
      0.88,
      1
    ),
    roadPressureOffroadPenalty: clamp(
      DEFAULT_ROAD_PRESSURE_OFFROAD_PENALTY - reuseDelta * 0.15,
      0.14,
      0.44
    ),
    roadPressureOnroadPenalty: clamp(
      DEFAULT_ROAD_PRESSURE_ONROAD_PENALTY - reuseDelta * 0.05,
      0.03,
      0.12
    ),
  };
}

export function generateRoads(world) {
  const { terrain, climate, hydrology, cities } = world;
  const { width, height, size, isLand, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength } = hydrology;
  const roadSettings = resolveRoadSettings(world.params ?? {});

  if (cities.length < 2) {
    return {
      roads: [],
      roadUsage: new Uint16Array(size),
      componentCount: cities.length > 0 ? 1 : 0
    };
  }

  const baseCost = buildRoadBaseCost(size, isLand, lakeIdByCell, biome, mountainField);
  const landComponentByCell = buildLandComponents(width, height, isLand);
  const cityIdsByLandComponent = groupCityIdsByLandComponent(cities, landComponentByCell);
  const cityByCell = buildCityByCell(cities);
  const roadUsage = new Uint16Array(size);
  const roadPressure = new Float32Array(size);
  const cityRoadDegree = new Uint8Array(cities.length);
  const roads = [];

  for (const cityIds of cityIdsByLandComponent.values()) {
    connectCitiesOnLandComponent({
      cities,
      cityIds,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      baseCost,
      roadUsage,
      roadPressure,
      roads,
      cityRoadDegree,
      roadSettings
    });
  }

  const seaRoutes = buildSeaRoutes({
    cities,
    roads,
    terrain,
    climate
  });
  roads.push(...seaRoutes);
  const normalizedRoads = dedupeRoadSegments(
    splitRoadsAtIntersections(roads, cityByCell, size, width)
  );
  const componentCount = buildRoadNetwork({ cities, roads: normalizedRoads, width }).components.filter(
    (component) => component.cityIds.length > 0
  ).length;

  return {
    roads: normalizedRoads,
    roadUsage,
    componentCount
  };
}

function connectCitiesOnLandComponent({
  cities,
  cityIds,
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  baseCost,
  roadUsage,
  roadPressure,
  roads,
  cityRoadDegree,
  roadSettings
}) {
  if (!cityIds || cityIds.length < 2) {
    return;
  }

  const componentCities = cityIds.map((cityId) => cities[cityId]).filter(Boolean);
  const candidateLinks = buildCandidateCityLinks(
    componentCities,
    roadSettings.nearestNeighbors
  );
  if (candidateLinks.length === 0) {
    return;
  }
  const plannedLinks = selectPlannedLandLinks(cityIds, candidateLinks, roadSettings);
  const cityPenalty = buildCityProximityPenaltyField(
    width,
    height,
    size,
    componentCities,
    roadSettings.cityProximityRadius,
    roadSettings.cityProximityPenalty
  );
  const cityCellMask = buildCityCellMask(size, componentCities);
  const connectivity = new DisjointSet(cityIds);
  const failedPlannedLinks = [];

  for (const link of plannedLinks) {
    const added = addLandRoad({
      link,
      cities,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      roadUsage,
      roadPressure,
      baseCost,
      cityPenalty,
      cityCellMask,
      roads,
      cityRoadDegree,
      roadSettings,
      enforceDegreeLimit: true,
      preferRoadReuse: true
    });
    if (added) {
      connectivity.union(link.fromCityId, link.toCityId);
    } else {
      failedPlannedLinks.push(link);
    }
  }

  for (const link of failedPlannedLinks) {
    if (connectivity.find(link.fromCityId) === connectivity.find(link.toCityId)) {
      continue;
    }
    const added = addLandRoad({
      link,
      cities,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      roadUsage,
      roadPressure,
      baseCost,
      cityPenalty,
      cityCellMask,
      roads,
      cityRoadDegree,
      roadSettings,
      enforceDegreeLimit: false,
      preferRoadReuse: false
    });
    if (added) {
      connectivity.union(link.fromCityId, link.toCityId);
    }
  }

  if (connectivity.componentCount <= 1) {
    return;
  }

  const plannedKeys = new Set(plannedLinks.map((link) => makeLinkKey(link.fromCityId, link.toCityId)));
  const fallbackLinks = candidateLinks.filter(
    (link) => !plannedKeys.has(makeLinkKey(link.fromCityId, link.toCityId))
  );
  const recoveryLinks = [...failedPlannedLinks, ...fallbackLinks];

  for (const link of recoveryLinks) {
    if (connectivity.componentCount <= 1) {
      break;
    }
    if (connectivity.find(link.fromCityId) === connectivity.find(link.toCityId)) {
      continue;
    }

    const added = addLandRoad({
      link,
      cities,
      width,
      height,
      size,
      isLand,
      lakeIdByCell,
      riverStrength,
      roadUsage,
      roadPressure,
      baseCost,
      cityPenalty,
      cityCellMask,
      roads,
      cityRoadDegree,
      roadSettings,
      enforceDegreeLimit: false,
      preferRoadReuse: false
    });
    if (added) {
      connectivity.union(link.fromCityId, link.toCityId);
    }
  }
}

function addLandRoad({
  link,
  cities,
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  roadUsage,
  roadPressure,
  baseCost,
  cityPenalty,
  cityCellMask,
  roads,
  cityRoadDegree,
  roadSettings,
  enforceDegreeLimit,
  preferRoadReuse
}) {
  const fromCity = cities[link.fromCityId];
  const toCity = cities[link.toCityId];
  if (!fromCity || !toCity) {
    return false;
  }
  if (
    enforceDegreeLimit &&
    (
      cityRoadDegree[fromCity.id] >= roadSettings.maxRoadsPerCity ||
      cityRoadDegree[toCity.id] >= roadSettings.maxRoadsPerCity
    )
  ) {
    return false;
  }

  const path = findLandPathBetweenCities({
    width,
    height,
    size,
    isLand,
    lakeIdByCell,
    riverStrength,
    roadUsage,
    roadPressure,
    baseCost,
    cityPenalty,
    cityCellMask,
    sourceCell: fromCity.cell,
    targetCell: toCity.cell,
    preferRoadReuse,
    reuseOnRoadMultiplier: roadSettings.reuseOnRoadMultiplier,
    reuseTouchingRoadMultiplier: roadSettings.reuseTouchingRoadMultiplier,
    roadPressureOffroadPenalty: roadSettings.roadPressureOffroadPenalty,
    roadPressureOnroadPenalty: roadSettings.roadPressureOnroadPenalty
  });
  if (!path || path.cells.length < 2) {
    return false;
  }

  roads.push({
    id: roads.length,
    type: "road",
    cityId: toCity.id,
    fromCityId: fromCity.id,
    cells: path.cells,
    length: path.cells.length,
    cost: path.cost
  });
  markRoadUsage(path.cells, roadUsage, roadPressure, width, height);
  cityRoadDegree[fromCity.id] = Math.min(255, cityRoadDegree[fromCity.id] + 1);
  cityRoadDegree[toCity.id] = Math.min(255, cityRoadDegree[toCity.id] + 1);
  return true;
}

function buildCityCellMask(size, cities) {
  const mask = new Uint8Array(size);
  for (const city of cities ?? []) {
    if (city?.cell == null || city.cell < 0 || city.cell >= size) {
      continue;
    }
    mask[city.cell] = 1;
  }
  return mask;
}

function buildCandidateCityLinks(componentCities, nearestNeighborCount = DEFAULT_LAND_NEAREST_NEIGHBORS) {
  if (!componentCities || componentCities.length < 2) {
    return [];
  }

  const cityIds = componentCities.map((city) => city.id);
  const maxNeighbors = Math.max(1, componentCities.length - 1);
  let neighbors = Math.min(nearestNeighborCount, maxNeighbors);
  let links = [];

  while (neighbors <= maxNeighbors) {
    links = collectNearestNeighborLinks(componentCities, neighbors);
    if (isLinkSetConnected(cityIds, links) || neighbors >= maxNeighbors) {
      break;
    }
    neighbors = Math.min(maxNeighbors, neighbors + 2);
  }

  return links.sort((a, b) => {
    if (Math.abs(a.weight - b.weight) > 1e-6) {
      return a.weight - b.weight;
    }
    return a.distance - b.distance;
  });
}

function collectNearestNeighborLinks(componentCities, neighborCount) {
  const links = [];
  const seen = new Set();

  for (const city of componentCities) {
    const nearest = componentCities
      .filter((candidate) => candidate.id !== city.id)
      .map((candidate) => ({
        city: candidate,
        distance: distance(city.x, city.y, candidate.x, candidate.y)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, neighborCount);

    for (const entry of nearest) {
      const a = Math.min(city.id, entry.city.id);
      const b = Math.max(city.id, entry.city.id);
      const key = `${a}:${b}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const cityScoreFactor = 1 - clamp((city.score + entry.city.score) / 420, 0, 0.2);
      links.push({
        fromCityId: a,
        toCityId: b,
        distance: entry.distance,
        weight: entry.distance * cityScoreFactor
      });
    }
  }

  return links;
}

function isLinkSetConnected(cityIds, links) {
  if (cityIds.length <= 1) {
    return true;
  }
  const set = new DisjointSet(cityIds);
  for (const link of links) {
    set.union(link.fromCityId, link.toCityId);
  }
  return set.componentCount <= 1;
}

function selectPlannedLandLinks(cityIds, candidateLinks, roadSettings) {
  const selected = buildMinimumSpanningLinks(cityIds, candidateLinks);
  const selectedKeys = new Set(selected.map((link) => makeLinkKey(link.fromCityId, link.toCityId)));
  const degreeByCityId = new Map(cityIds.map((cityId) => [cityId, 0]));
  const adjacency = new Map(cityIds.map((cityId) => [cityId, []]));
  const nearestDistanceByCity = new Map(cityIds.map((cityId) => [cityId, Number.POSITIVE_INFINITY]));

  for (const link of candidateLinks) {
    nearestDistanceByCity.set(
      link.fromCityId,
      Math.min(nearestDistanceByCity.get(link.fromCityId) ?? Number.POSITIVE_INFINITY, link.distance)
    );
    nearestDistanceByCity.set(
      link.toCityId,
      Math.min(nearestDistanceByCity.get(link.toCityId) ?? Number.POSITIVE_INFINITY, link.distance)
    );
  }

  for (const link of selected) {
    degreeByCityId.set(link.fromCityId, (degreeByCityId.get(link.fromCityId) ?? 0) + 1);
    degreeByCityId.set(link.toCityId, (degreeByCityId.get(link.toCityId) ?? 0) + 1);
    adjacency.get(link.fromCityId).push({ cityId: link.toCityId, cost: link.distance });
    adjacency.get(link.toCityId).push({ cityId: link.fromCityId, cost: link.distance });
  }

  const canUseDegree = (link) =>
    (degreeByCityId.get(link.fromCityId) ?? 0) < roadSettings.maxRoadsPerCity &&
    (degreeByCityId.get(link.toCityId) ?? 0) < roadSettings.maxRoadsPerCity;

  const addSelectedLink = (link) => {
    selected.push(link);
    selectedKeys.add(makeLinkKey(link.fromCityId, link.toCityId));
    degreeByCityId.set(link.fromCityId, (degreeByCityId.get(link.fromCityId) ?? 0) + 1);
    degreeByCityId.set(link.toCityId, (degreeByCityId.get(link.toCityId) ?? 0) + 1);
    adjacency.get(link.fromCityId).push({ cityId: link.toCityId, cost: link.distance });
    adjacency.get(link.toCityId).push({ cityId: link.fromCityId, cost: link.distance });
  };

  const maxExtraLinks = Math.max(0, Math.min(12, Math.round(cityIds.length * roadSettings.extraLinkFactor)));
  let extraCount = 0;
  const extraCandidates = [];

  for (const link of candidateLinks) {
    const linkKey = makeLinkKey(link.fromCityId, link.toCityId);
    if (selectedKeys.has(linkKey)) {
      continue;
    }
    if (!canUseDegree(link)) {
      continue;
    }

    const detourCost = getGraphDistance(adjacency, link.fromCityId, link.toCityId);
    if (Number.isFinite(detourCost) && detourCost <= link.distance * roadSettings.redundancyRatio) {
      continue;
    }
    const detourRatio = Number.isFinite(detourCost)
      ? detourCost / Math.max(link.distance, 0.001)
      : roadSettings.redundancyRatio + 1.4;
    const localReferenceDistance = Math.max(
      nearestDistanceByCity.get(link.fromCityId) ?? Number.POSITIVE_INFINITY,
      nearestDistanceByCity.get(link.toCityId) ?? Number.POSITIVE_INFINITY
    );
    const localCheapness = Number.isFinite(localReferenceDistance)
      ? clamp(localReferenceDistance / Math.max(link.distance, 0.001), 0.35, 2.4)
      : 1;
    extraCandidates.push({
      link,
      score:
        (detourRatio - roadSettings.redundancyRatio) * 2.15 +
        localCheapness * 0.7 -
        link.distance * 0.0028
    });
  }

  extraCandidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-6) {
      return b.score - a.score;
    }
    return a.link.distance - b.link.distance;
  });

  for (const candidate of extraCandidates) {
    if (extraCount >= maxExtraLinks) {
      break;
    }
    const { link } = candidate;
    const linkKey = makeLinkKey(link.fromCityId, link.toCityId);
    if (selectedKeys.has(linkKey) || !canUseDegree(link)) {
      continue;
    }
    const detourCost = getGraphDistance(adjacency, link.fromCityId, link.toCityId);
    if (Number.isFinite(detourCost) && detourCost <= link.distance * roadSettings.redundancyRatio) {
      continue;
    }

    addSelectedLink(link);
    extraCount += 1;
  }

  const maxHopBridgeLinks = Math.max(
    0,
    Math.min(8, Math.round(cityIds.length * roadSettings.hopBridgeFactor))
  );
  let hopBridgeCount = 0;
  const hopCandidates = [];

  for (const link of candidateLinks) {
    const linkKey = makeLinkKey(link.fromCityId, link.toCityId);
    if (selectedKeys.has(linkKey)) {
      continue;
    }
    if (!canUseDegree(link)) {
      continue;
    }

    const detourCost = getGraphDistance(adjacency, link.fromCityId, link.toCityId);
    if (!Number.isFinite(detourCost)) {
      continue;
    }
    const detourRatio = detourCost / Math.max(link.distance, 0.001);
    if (detourRatio < roadSettings.hopBridgeMinDetourRatio) {
      continue;
    }
    const maxDirectDistanceFromDetour = detourCost * roadSettings.hopBridgeMaxDirectToDetour;
    if (link.distance > maxDirectDistanceFromDetour) {
      continue;
    }

    const localReferenceDistance = Math.max(
      nearestDistanceByCity.get(link.fromCityId) ?? Number.POSITIVE_INFINITY,
      nearestDistanceByCity.get(link.toCityId) ?? Number.POSITIVE_INFINITY
    );
    if (!Number.isFinite(localReferenceDistance)) {
      continue;
    }
    if (link.distance > localReferenceDistance * roadSettings.hopBridgeLocalCheapFactor) {
      continue;
    }

    hopCandidates.push({
      link,
      score:
        (detourRatio - roadSettings.hopBridgeMinDetourRatio) * 2.05 +
        clamp(localReferenceDistance / Math.max(link.distance, 0.001), 0.35, 2.8) -
        link.distance * 0.0021
    });
  }

  hopCandidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-6) {
      return b.score - a.score;
    }
    return a.link.distance - b.link.distance;
  });

  for (const candidate of hopCandidates) {
    if (hopBridgeCount >= maxHopBridgeLinks) {
      break;
    }
    const { link } = candidate;
    const linkKey = makeLinkKey(link.fromCityId, link.toCityId);
    if (selectedKeys.has(linkKey) || !canUseDegree(link)) {
      continue;
    }

    const detourCost = getGraphDistance(adjacency, link.fromCityId, link.toCityId);
    if (!Number.isFinite(detourCost)) {
      continue;
    }
    const detourRatio = detourCost / Math.max(link.distance, 0.001);
    if (detourRatio < roadSettings.hopBridgeMinDetourRatio) {
      continue;
    }
    const maxDirectDistanceFromDetour = detourCost * roadSettings.hopBridgeMaxDirectToDetour;
    if (link.distance > maxDirectDistanceFromDetour) {
      continue;
    }

    const localReferenceDistance = Math.max(
      nearestDistanceByCity.get(link.fromCityId) ?? Number.POSITIVE_INFINITY,
      nearestDistanceByCity.get(link.toCityId) ?? Number.POSITIVE_INFINITY
    );
    if (!Number.isFinite(localReferenceDistance)) {
      continue;
    }
    if (link.distance > localReferenceDistance * roadSettings.hopBridgeLocalCheapFactor) {
      continue;
    }

    addSelectedLink(link);
    hopBridgeCount += 1;
  }

  return selected.sort((a, b) => a.distance - b.distance);
}

function buildMinimumSpanningLinks(cityIds, candidateLinks) {
  const disjointSet = new DisjointSet(cityIds);
  const links = [];

  for (const link of candidateLinks) {
    if (!disjointSet.union(link.fromCityId, link.toCityId)) {
      continue;
    }
    links.push(link);
    if (links.length >= cityIds.length - 1) {
      break;
    }
  }

  return links;
}

function getGraphDistance(adjacency, fromCityId, toCityId) {
  if (fromCityId === toCityId) {
    return 0;
  }

  const heap = new MinHeap();
  const best = new Map();
  best.set(fromCityId, 0);
  heap.push(fromCityId, 0);

  while (heap.size > 0) {
    const { index: cityId, priority } = heap.pop();
    const known = best.get(cityId);
    if (known == null || priority > known + 1e-4) {
      continue;
    }
    if (cityId === toCityId) {
      return priority;
    }

    for (const edge of adjacency.get(cityId) ?? []) {
      const nextCost = priority + edge.cost;
      const previousCost = best.get(edge.cityId);
      if (previousCost != null && nextCost >= previousCost - 1e-4) {
        continue;
      }
      best.set(edge.cityId, nextCost);
      heap.push(edge.cityId, nextCost);
    }
  }

  return Number.POSITIVE_INFINITY;
}

function findLandPathBetweenCities({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  roadUsage,
  roadPressure,
  baseCost,
  cityPenalty,
  cityCellMask,
  sourceCell,
  targetCell,
  preferRoadReuse,
  reuseOnRoadMultiplier,
  reuseTouchingRoadMultiplier,
  roadPressureOffroadPenalty,
  roadPressureOnroadPenalty
}) {
  const search = runRoadSearch({
    width,
    height,
    size,
    isLand,
    lakeIdByCell,
    riverStrength,
    roadUsage,
    roadPressure,
    baseCost,
    cityPenalty,
    cityCellMask,
    sources: [sourceCell],
    targetCell,
    endpointCellA: sourceCell,
    endpointCellB: targetCell,
    preferRoadReuse,
    reuseOnRoadMultiplier,
    reuseTouchingRoadMultiplier,
    roadPressureOffroadPenalty,
    roadPressureOnroadPenalty
  });

  const totalCost = search.distance[targetCell];
  if (!Number.isFinite(totalCost)) {
    return null;
  }

  const cells = reconstructPath(targetCell, search.previous).reverse();
  return {
    cells: dedupeCells(cells),
    cost: totalCost
  };
}

function buildCityProximityPenaltyField(width, height, size, cities, radius, maxPenalty) {
  const penaltyField = new Float32Array(size);
  if (!cities?.length || radius <= 0 || maxPenalty <= 0) {
    return penaltyField;
  }

  const radiusSq = radius * radius;
  const searchRadius = Math.ceil(radius);

  for (const city of cities) {
    const [centerX, centerY] = coordsOf(city.cell, width);
    const minX = Math.max(0, centerX - searchRadius);
    const maxX = Math.min(width - 1, centerX + searchRadius);
    const minY = Math.max(0, centerY - searchRadius);
    const maxY = Math.min(height - 1, centerY + searchRadius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) {
          continue;
        }

        const dist = Math.sqrt(distSq);
        const influence = 1 - dist / radius;
        const penalty = maxPenalty * influence * influence;
        const cell = indexOf(x, y, width);
        penaltyField[cell] = Math.max(penaltyField[cell], penalty);
      }
    }
  }

  return penaltyField;
}

function makeLinkKey(a, b) {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

function splitRoadsAtIntersections(roads, cityByCell, size, width) {
  const directionMaskByCell = new Uint16Array(size);
  const directionToBit = (dx, dy) => {
    if (dx === -1 && dy === -1) return 1 << 0;
    if (dx === 0 && dy === -1) return 1 << 1;
    if (dx === 1 && dy === -1) return 1 << 2;
    if (dx === -1 && dy === 0) return 1 << 3;
    if (dx === 1 && dy === 0) return 1 << 4;
    if (dx === -1 && dy === 1) return 1 << 5;
    if (dx === 0 && dy === 1) return 1 << 6;
    if (dx === 1 && dy === 1) return 1 << 7;
    return 0;
  };

  for (const road of roads) {
    if (road.type !== "road" || !road.cells || road.cells.length < 2) {
      continue;
    }

    for (let index = 0; index < road.cells.length - 1; index += 1) {
      const from = road.cells[index];
      const to = road.cells[index + 1];
      const [fromX, fromY] = coordsOf(from, width);
      const [toX, toY] = coordsOf(to, width);
      const dx = clamp(toX - fromX, -1, 1);
      const dy = clamp(toY - fromY, -1, 1);
      const outBit = directionToBit(dx, dy);
      const inBit = directionToBit(-dx, -dy);
      directionMaskByCell[from] |= outBit;
      directionMaskByCell[to] |= inBit;
    }
  }

  const bitCount = (value) => {
    let bits = value;
    let count = 0;
    while (bits > 0) {
      bits &= bits - 1;
      count += 1;
    }
    return count;
  };

  const normalized = [];
  for (const road of roads) {
    if (road.type !== "road" || !road.cells || road.cells.length < 2) {
      normalized.push({ ...road });
      continue;
    }

    const breakpoints = [0];
    let previousIntersection = false;
    for (let index = 1; index < road.cells.length - 1; index += 1) {
      const cell = road.cells[index];
      const isIntersection = bitCount(directionMaskByCell[cell]) >= 3;
      const isCityCell = cityByCell.has(cell);

      if (isCityCell) {
        if (index > breakpoints[breakpoints.length - 1]) {
          breakpoints.push(index);
        }
        previousIntersection = false;
        continue;
      }

      const minSpacing = ROAD_INTERSECTION_MIN_SPACING;
      const lastBreakpoint = breakpoints[breakpoints.length - 1];
      if (isIntersection && !previousIntersection && index - lastBreakpoint >= minSpacing) {
        breakpoints.push(index);
      }
      previousIntersection = isIntersection;
    }
    breakpoints.push(road.cells.length - 1);

    for (let index = 1; index < breakpoints.length; index += 1) {
      const startIndex = breakpoints[index - 1];
      const endIndex = breakpoints[index];
      if (endIndex <= startIndex) {
        continue;
      }

      const cells = dedupeCells(road.cells.slice(startIndex, endIndex + 1));
      if (cells.length < 2) {
        continue;
      }

      const startCity = cityByCell.get(cells[0])?.id ?? null;
      const endCity = cityByCell.get(cells[cells.length - 1])?.id ?? null;
      normalized.push({
        ...road,
        id: -1,
        fromCityId: startCity,
        cityId: endCity,
        cells,
        length: cells.length,
        cost: Number.isFinite(road.cost) && road.length > 0 ? road.cost * (cells.length / road.length) : road.cost
      });
    }
  }

  for (let index = 0; index < normalized.length; index += 1) {
    normalized[index].id = index;
  }

  return normalized;
}

function dedupeRoadSegments(roads) {
  const unique = [];
  const canonicalIndexByPath = new Map();

  for (const road of roads) {
    if (road.type !== "road" || !road.cells || road.cells.length < 2) {
      unique.push({ ...road });
      continue;
    }

    const key = buildCanonicalPathKey(road.cells);
    const existingIndex = canonicalIndexByPath.get(key);
    if (existingIndex == null) {
      canonicalIndexByPath.set(key, unique.length);
      unique.push({ ...road });
      continue;
    }

    const existing = unique[existingIndex];
    const existingCost = Number.isFinite(existing.cost) ? existing.cost : Number.POSITIVE_INFINITY;
    const candidateCost = Number.isFinite(road.cost) ? road.cost : Number.POSITIVE_INFINITY;

    if (candidateCost + 1e-4 < existingCost) {
      unique[existingIndex] = { ...road };
      continue;
    }

    if (existing.fromCityId == null && road.fromCityId != null) {
      existing.fromCityId = road.fromCityId;
    }
    if (existing.cityId == null && road.cityId != null) {
      existing.cityId = road.cityId;
    }
  }

  for (let index = 0; index < unique.length; index += 1) {
    unique[index].id = index;
  }

  return unique;
}

function buildCanonicalPathKey(cells) {
  const forward = cells.join(",");
  const reverse = [...cells].reverse().join(",");
  return forward < reverse ? forward : reverse;
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

function buildRoadBaseCost(size, isLand, lakeIdByCell, biome, mountainField) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = BIOME_TRAVEL_COST[biome[index]] ?? 1.2;
    const mountain = mountainField[index];
    const mountainPenalty =
      mountain * 4.4 +
      Math.pow(Math.max(0, mountain - 0.46), 2) * 22 +
      Math.pow(Math.max(0, mountain - 0.62), 2) * 52 +
      Math.pow(Math.max(0, mountain - 0.79), 3) * 260;
    baseCost[index] = biomeCost + mountainPenalty;
  }

  return baseCost;
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

function findSeaRouteTouchCity(cells, cityByCell, sourceCityId, targetCityId) {
  for (let index = 1; index < cells.length - 1; index += 1) {
    const city = cityByCell.get(cells[index]);
    if (city && city.id !== sourceCityId && city.id !== targetCityId) {
      return city.id;
    }
  }

  return null;
}

function markRoadUsage(path, roadUsage, roadPressure, width, height) {
  for (const cell of path) {
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, 65535);
    if (!roadPressure) {
      continue;
    }

    const [centerX, centerY] = coordsOf(cell, width);
    const minX = Math.max(0, centerX - 2);
    const maxX = Math.min(width - 1, centerX + 2);
    const minY = Math.max(0, centerY - 2);
    const maxY = Math.min(height - 1, centerY + 2);

    roadPressure[cell] += ROAD_PRESSURE_SELF;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distSq = dx * dx + dy * dy;
        if (distSq === 0 || distSq > 4) {
          continue;
        }

        const target = indexOf(x, y, width);
        if (distSq <= 2) {
          roadPressure[target] += ROAD_PRESSURE_NEAR;
        } else {
          roadPressure[target] += ROAD_PRESSURE_MID;
        }
      }
    }
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

function runRoadSearch({
  width,
  height,
  size,
  isLand,
  lakeIdByCell,
  riverStrength,
  roadUsage,
  roadPressure,
  baseCost,
  cityPenalty,
  cityCellMask,
  sources,
  targetCell = null,
  endpointCellA = -1,
  endpointCellB = -1,
  preferRoadReuse = true,
  reuseOnRoadMultiplier = DEFAULT_REUSE_ON_ROAD_MULTIPLIER,
  reuseTouchingRoadMultiplier = DEFAULT_REUSE_TOUCHING_ROAD_MULTIPLIER,
  roadPressureOffroadPenalty = DEFAULT_ROAD_PRESSURE_OFFROAD_PENALTY,
  roadPressureOnroadPenalty = DEFAULT_ROAD_PRESSURE_ONROAD_PENALTY
}) {
  const distanceField = new Float32Array(size);
  distanceField.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(size);
  previous.fill(-1);
  const heap = new MinHeap();
  const maxExpansions = Math.max(4096, Math.floor(size * ROAD_SEARCH_MAX_EXPANSION_FACTOR));
  let expansions = 0;

  let targetX = -1;
  let targetY = -1;
  if (targetCell != null) {
    [targetX, targetY] = coordsOf(targetCell, width);
  }
  const heuristic = (cell) => {
    if (targetCell == null) {
      return 0;
    }
    const [x, y] = coordsOf(cell, width);
    return distance(x, y, targetX, targetY) * ROAD_SEARCH_HEURISTIC_SCALE;
  };

  for (const source of sources) {
    if (!Number.isFinite(baseCost[source])) {
      continue;
    }
    if (distanceField[source] <= 0) {
      continue;
    }
    distanceField[source] = 0;
    heap.push(source, heuristic(source));
  }

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    expansions += 1;
    if (expansions > maxExpansions) {
      break;
    }

    const expectedPriority = distanceField[current] + heuristic(current);
    if (priority > expectedPriority + 1e-4) {
      continue;
    }
    if (targetCell != null && current === targetCell) {
      break;
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
        roadPressure,
        baseCost,
        cityPenalty,
        cityCellMask,
        endpointCellA,
        endpointCellB,
        preferRoadReuse,
        reuseOnRoadMultiplier,
        reuseTouchingRoadMultiplier,
        roadPressureOffroadPenalty,
        roadPressureOnroadPenalty
      );
      if (!Number.isFinite(stepCost)) {
        return;
      }

      const nextCost = distanceField[current] + stepCost;
      if (nextCost < distanceField[neighbor]) {
        distanceField[neighbor] = nextCost;
        previous[neighbor] = current;
        heap.push(neighbor, nextCost + heuristic(neighbor));
      }
    });
  }

  return {
    distance: distanceField,
    previous
  };
}

function computeStepCost(
  current,
  neighbor,
  diagonal,
  isLand,
  lakeIdByCell,
  riverStrength,
  roadUsage,
  roadPressure,
  baseCost,
  cityPenalty,
  cityCellMask,
  endpointCellA,
  endpointCellB,
  preferRoadReuse,
  reuseOnRoadMultiplier,
  reuseTouchingRoadMultiplier,
  roadPressureOffroadPenalty,
  roadPressureOnroadPenalty
) {
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

  const isOnRoad = roadUsage[current] > 0 && roadUsage[neighbor] > 0;
  const isTouchingRoad = roadUsage[current] > 0 || roadUsage[neighbor] > 0;

  if (cityPenalty) {
    const currentIsCity = Boolean(cityCellMask?.[current]);
    const neighborIsCity = Boolean(cityCellMask?.[neighbor]);
    const currentPenalty =
      current === endpointCellA || current === endpointCellB || currentIsCity
        ? 0
        : cityPenalty[current] ?? 0;
    const neighborPenalty =
      neighbor === endpointCellA || neighbor === endpointCellB || neighborIsCity
        ? 0
        : cityPenalty[neighbor] ?? 0;

    let cityPenaltyFactor = 1;
    if (currentIsCity || neighborIsCity) {
      cityPenaltyFactor = 0;
    } else if (isOnRoad) {
      cityPenaltyFactor = 0.38;
    } else if (isTouchingRoad) {
      cityPenaltyFactor = 0.56;
    }
    cost += (currentPenalty + neighborPenalty) * 0.5 * stepLength * cityPenaltyFactor;
  }

  if (roadPressure) {
    const localPressure = (roadPressure[current] + roadPressure[neighbor]) * 0.5;
    if (localPressure > 0) {
      const pressurePenalty = isOnRoad ? roadPressureOnroadPenalty : roadPressureOffroadPenalty;
      cost += localPressure * pressurePenalty * stepLength;
    }
  }

  if (preferRoadReuse) {
    if (isOnRoad) {
      cost *= reuseOnRoadMultiplier;
    } else if (isTouchingRoad) {
      cost *= reuseTouchingRoadMultiplier;
    }
  }

  return cost;
}

class DisjointSet {
  constructor(ids) {
    this.parent = new Map();
    this.rank = new Map();
    this.componentCount = 0;

    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
      this.componentCount += 1;
    }
  }

  find(id) {
    if (!this.parent.has(id)) {
      return null;
    }
    let current = id;
    while (this.parent.get(current) !== current) {
      current = this.parent.get(current);
    }

    let node = id;
    while (this.parent.get(node) !== node) {
      const next = this.parent.get(node);
      this.parent.set(node, current);
      node = next;
    }

    return current;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA == null || rootB == null || rootA === rootB) {
      return false;
    }

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }

    this.componentCount = Math.max(0, this.componentCount - 1);
    return true;
  }
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
