import { BIOME_KEYS } from "../config.js";
import { createRng } from "../random.js";
import { clamp, distance } from "../utils.js";
import {
  describePoi,
  generatePoiName,
  pickPoiMarker,
} from "../poi/poiModel.js";

export function buildFeatureCatalog(world) {
  const roadDegreeByCityId = buildRoadDegreeByCityId(
    world.network,
    world.cities.length,
  );
  const maxRoadDegree = Math.max(1, ...roadDegreeByCityId);
  const networkMetrics = buildCityNetworkMetrics(
    world,
    roadDegreeByCityId,
    maxRoadDegree,
  );
  const markerRng = createRng(`${world.params.seed}::poi-markers`);
  const nameRng = createRng(`${world.params.seed}::poi-names`);
  const preferenceWeights = buildPoiPreferenceWeights(world.params);

  const cityPointsOfInterest = world.cities.map((city) => {
    const roadDegree = roadDegreeByCityId[city.id] ?? 0;
    const networkSignals = getCityPoiNetworkSignals(city.id, networkMetrics);
    const suitability = evaluatePoiSuitability(
      city,
      world,
      roadDegree,
      maxRoadDegree,
      networkSignals,
    );
    const marker =
      city.marker ??
      pickPoiMarker(markerRng.fork(`marker-${city.id}`), {
        roadDegree,
        maxRoadDegree,
        allowSignpost: false,
        isEndpoint: suitability.isEndpoint,
        settlementSuitability: suitability.settlement,
        crashSuitability: suitability.crashSite,
        signpostSuitability: suitability.signpost,
        transitScore: suitability.transitScore,
        corridorScore: suitability.corridorScore,
        preferenceWeights,
      });
    const poiName = generatePoiName(nameRng.fork(`poi-${city.id}`), marker);
    const poiDescriptor = describePoi({ marker, roadDegree });
    const enrichedCity = {
      ...city,
      name: poiName,
      roadDegree,
      marker: poiDescriptor.marker,
      kind: poiDescriptor.kind,
      poiSubtitle: poiDescriptor.subtitle,
      poiDetail: poiDescriptor.detail,
    };

    // Renderer, gameplay tooltips and inspector all read world.cities directly.
    world.cities[city.id] = enrichedCity;
    return enrichedCity;
  });
  const dedicatedSignposts = buildDedicatedSignpostPois(
    world,
    cityPointsOfInterest,
  );
  const pointsOfInterest = [...cityPointsOfInterest, ...dedicatedSignposts];

  return {
    pointsOfInterest,
    lakes: world.hydrology.lakes.map((lake) => ({ ...lake })),
    rivers: world.hydrology.rivers.map((river) => ({ ...river })),
    biomeRegions: world.regions.biomeRegions.map((region) => ({ ...region })),
    mountainRegions: world.regions.mountainRegions.map((region) => ({ ...region })),
    roads: world.roads.roads.map((road) => ({ ...road })),
    indices: {
      lakeIdByCell: world.hydrology.lakeIdByCell,
      biomeRegionId: world.regions.biomeRegionId,
      mountainRegionId: world.regions.mountainRegionId
    }
  };
}

function buildRoadDegreeByCityId(network, cityCount) {
  const degrees = new Array(cityCount).fill(0);
  if (!network?.nodes?.length || !network?.adjacencyByNodeId) {
    return degrees;
  }

  for (const node of network.nodes) {
    if (node?.type !== "city" || node.cityId == null || node.cityId < 0) {
      continue;
    }
    const adjacency = network.adjacencyByNodeId.get(node.id) ?? [];
    degrees[node.cityId] = adjacency.length;
  }

  return degrees;
}

function buildPoiPreferenceWeights(params = {}) {
  const settlement = clamp(Number(params.poiSettlementWeight ?? 62), 0, 100) / 50;
  const crashSite = clamp(Number(params.poiCrashSiteWeight ?? 28), 0, 100) / 50;
  const signpost = clamp(Number(params.poiSignpostWeight ?? 24), 0, 100) / 50;

  return {
    settlement: Math.max(0, settlement),
    "crash-site": Math.max(0, crashSite),
    signpost: Math.max(0, signpost),
  };
}

function buildCityNetworkMetrics(world, roadDegreeByCityId, maxRoadDegree) {
  const cityCount = world.cities.length;
  const transitScoreByCityId = new Float32Array(cityCount);
  const corridorScoreByCityId = new Float32Array(cityCount);
  const junctionScoreByCityId = new Float32Array(cityCount);
  const network = world.network;

  if (
    !network?.nodes?.length ||
    !network?.links?.length ||
    !network?.adjacencyByNodeId
  ) {
    return {
      transitScoreByCityId,
      corridorScoreByCityId,
      junctionScoreByCityId,
    };
  }

  const cityNodeIdByCityId = new Int32Array(cityCount);
  cityNodeIdByCityId.fill(-1);
  const cityNodeIds = [];

  for (const node of network.nodes) {
    if (node?.type !== "city" || node.cityId == null || node.cityId < 0) {
      continue;
    }
    cityNodeIdByCityId[node.cityId] = node.id;
    cityNodeIds.push(node.id);
  }

  if (cityNodeIds.length >= 3) {
    const transitCountByCityId = new Float32Array(cityCount);

    for (let sourceIndex = 0; sourceIndex < cityNodeIds.length; sourceIndex += 1) {
      const sourceNodeId = cityNodeIds[sourceIndex];
      const { distanceByNodeId, previousByNodeId } = runNodeDijkstra(
        network,
        sourceNodeId,
      );

      for (
        let targetIndex = sourceIndex + 1;
        targetIndex < cityNodeIds.length;
        targetIndex += 1
      ) {
        const targetNodeId = cityNodeIds[targetIndex];
        if (!Number.isFinite(distanceByNodeId[targetNodeId])) {
          continue;
        }

        const pathNodeIds = reconstructNodePath(targetNodeId, previousByNodeId);
        if (pathNodeIds.length < 3 || pathNodeIds[0] !== sourceNodeId) {
          continue;
        }

        for (
          let pathIndex = 1;
          pathIndex < pathNodeIds.length - 1;
          pathIndex += 1
        ) {
          const node = network.nodes[pathNodeIds[pathIndex]];
          if (node?.type !== "city" || node.cityId == null || node.cityId < 0) {
            continue;
          }
          transitCountByCityId[node.cityId] += 1;
        }
      }
    }

    const maxTransit = Math.max(1, ...transitCountByCityId);
    for (let cityId = 0; cityId < cityCount; cityId += 1) {
      const normalized = transitCountByCityId[cityId] / maxTransit;
      transitScoreByCityId[cityId] = clamp(Math.pow(normalized, 0.72), 0, 1);
    }
  }

  for (let cityId = 0; cityId < cityCount; cityId += 1) {
    if (roadDegreeByCityId[cityId] !== 2) {
      continue;
    }
    const nodeId = cityNodeIdByCityId[cityId];
    if (nodeId < 0) {
      continue;
    }

    const adjacency = network.adjacencyByNodeId.get(nodeId) ?? [];
    if (adjacency.length < 2) {
      continue;
    }

    const edgeA = adjacency[0];
    const edgeB = adjacency[1];
    const node = network.nodes[nodeId];
    const neighborA = network.nodes[edgeA.nodeId];
    const neighborB = network.nodes[edgeB.nodeId];
    if (!neighborA || !neighborB) {
      continue;
    }

    const vectorAX = neighborA.x - node.x;
    const vectorAY = neighborA.y - node.y;
    const vectorBX = neighborB.x - node.x;
    const vectorBY = neighborB.y - node.y;
    const vectorALength = Math.hypot(vectorAX, vectorAY);
    const vectorBLength = Math.hypot(vectorBX, vectorBY);
    if (vectorALength <= 0.001 || vectorBLength <= 0.001) {
      continue;
    }

    const dot = vectorAX * vectorBX + vectorAY * vectorBY;
    const cosine = clamp(dot / (vectorALength * vectorBLength), -1, 1);
    const angle = (Math.acos(cosine) * 180) / Math.PI;
    const straightness = clamp((angle - 110) / 70, 0, 1);
    const edgeLengthA = getNodeEdgeLength(network, edgeA.linkId);
    const edgeLengthB = getNodeEdgeLength(network, edgeB.linkId);
    const span = clamp((Math.min(edgeLengthA, edgeLengthB) - 4) / 16, 0, 1);

    corridorScoreByCityId[cityId] = clamp(
      straightness * 0.72 + span * 0.28,
      0,
      1,
    );
  }

  for (let cityId = 0; cityId < cityCount; cityId += 1) {
    const roadDegree = roadDegreeByCityId[cityId] ?? 0;
    const degreeScore = clamp(roadDegree / Math.max(1, maxRoadDegree), 0, 1);
    const transit = transitScoreByCityId[cityId] ?? 0;
    const corridor = corridorScoreByCityId[cityId] ?? 0;
    const junctionBias = roadDegree >= 3 ? 0.18 : roadDegree === 2 ? 0.05 : 0;

    junctionScoreByCityId[cityId] = clamp(
      degreeScore * 0.62 + transit * 0.5 + corridor * 0.24 + junctionBias,
      0,
      1,
    );
  }

  return {
    transitScoreByCityId,
    corridorScoreByCityId,
    junctionScoreByCityId,
  };
}

function runNodeDijkstra(network, sourceNodeId) {
  const nodeCount = network.nodes.length;
  const distanceByNodeId = new Float64Array(nodeCount);
  distanceByNodeId.fill(Number.POSITIVE_INFINITY);
  const previousByNodeId = new Int32Array(nodeCount);
  previousByNodeId.fill(-1);
  const visited = new Uint8Array(nodeCount);
  distanceByNodeId[sourceNodeId] = 0;

  for (let step = 0; step < nodeCount; step += 1) {
    let currentNodeId = -1;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
      if (visited[nodeId]) {
        continue;
      }
      const candidateDistance = distanceByNodeId[nodeId];
      if (candidateDistance < currentDistance) {
        currentDistance = candidateDistance;
        currentNodeId = nodeId;
      }
    }

    if (currentNodeId < 0 || !Number.isFinite(currentDistance)) {
      break;
    }
    visited[currentNodeId] = 1;

    for (const edge of network.adjacencyByNodeId.get(currentNodeId) ?? []) {
      if (visited[edge.nodeId]) {
        continue;
      }
      const edgeLength = getNodeEdgeLength(network, edge.linkId);
      const nextDistance = currentDistance + edgeLength;
      if (nextDistance + 1e-6 >= distanceByNodeId[edge.nodeId]) {
        continue;
      }
      distanceByNodeId[edge.nodeId] = nextDistance;
      previousByNodeId[edge.nodeId] = currentNodeId;
    }
  }

  return {
    distanceByNodeId,
    previousByNodeId,
  };
}

function reconstructNodePath(targetNodeId, previousByNodeId) {
  const path = [targetNodeId];
  let currentNodeId = targetNodeId;

  while (previousByNodeId[currentNodeId] >= 0) {
    currentNodeId = previousByNodeId[currentNodeId];
    path.push(currentNodeId);
  }

  return path.reverse();
}

function getNodeEdgeLength(network, linkId) {
  const link = network.links[linkId];
  if (!link) {
    return 1;
  }
  return Math.max(1, Number(link.length) || 1);
}

function getCityPoiNetworkSignals(cityId, metrics) {
  return {
    transitScore: metrics.transitScoreByCityId[cityId] ?? 0,
    corridorScore: metrics.corridorScoreByCityId[cityId] ?? 0,
    junctionScore: metrics.junctionScoreByCityId[cityId] ?? 0,
  };
}

function buildDedicatedSignpostPois(world, cityPois) {
  const network = world.network;
  if (!network?.nodes?.length || !network?.adjacencyByNodeId) {
    return [];
  }

  const signpostWeight = clamp(
    Number(world.params?.poiSignpostWeight ?? 24),
    0,
    100,
  );
  const signpostBias = signpostWeight / 100;
  if (signpostBias <= 0.01) {
    return [];
  }

  const candidates = [];
  for (const node of network.nodes) {
    if (node?.type !== "junction" || node.cell == null || node.cell < 0) {
      continue;
    }

    const adjacency = network.adjacencyByNodeId.get(node.id) ?? [];
    const degree = adjacency.length;
    if (degree < 3) {
      continue;
    }

    let totalEdgeLength = 0;
    let maxEdgeLength = 0;
    for (const edge of adjacency) {
      const edgeLength = getNodeEdgeLength(network, edge.linkId);
      totalEdgeLength += edgeLength;
      maxEdgeLength = Math.max(maxEdgeLength, edgeLength);
    }
    const meanEdgeLength = totalEdgeLength / Math.max(1, adjacency.length);
    const nearestCityDistance = getNearestCityDistance(node, cityPois);
    if (nearestCityDistance < 2.9) {
      continue;
    }
    const nearestCityNeighborSpan = getNearestCityNeighborSpan(
      network,
      adjacency,
    );
    if (Number.isFinite(nearestCityNeighborSpan) && nearestCityNeighborSpan < 4.2) {
      continue;
    }
    const centrality = getSignpostJunctionCentralityScore(
      network,
      node,
      adjacency,
    );
    if (centrality < 0.24) {
      continue;
    }
    const settlementSeparation = getSignpostSettlementSeparationScore(
      nearestCityDistance,
    );

    const score =
      (degree - 2) * 1.3 +
      meanEdgeLength * 0.08 +
      maxEdgeLength * 0.05 +
      centrality * 1.18 +
      settlementSeparation * 0.8 +
      clamp((nearestCityDistance - 3.1) / 10, 0, 1) * 0.18;

    candidates.push({
      node,
      degree,
      score,
    });
  }

  if (!candidates.length) {
    return [];
  }

  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-6) {
      return b.score - a.score;
    }
    return b.degree - a.degree;
  });

  const cityCount = cityPois.length;
  const target = clamp(
    Math.round(cityCount * signpostBias * 0.5),
    signpostBias >= 0.16 ? 1 : 0,
    Math.min(candidates.length, Math.max(2, Math.round(cityCount * 0.45))),
  );
  if (target <= 0) {
    return [];
  }

  const selected = [];
  const minSpacing = clamp(Math.round(10 - signpostBias * 5), 4, 10);
  for (const candidate of candidates) {
    if (selected.length >= target) {
      break;
    }
    if (
      selected.some(
        (entry) =>
          distance(
            entry.node.x,
            entry.node.y,
            candidate.node.x,
            candidate.node.y,
          ) < minSpacing,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }

  if (selected.length < target) {
    for (const candidate of candidates) {
      if (selected.length >= target) {
        break;
      }
      if (selected.some((entry) => entry.node.id === candidate.node.id)) {
        continue;
      }
      selected.push(candidate);
    }
  }

  const baseId = world.cities.length;
  return selected.map((entry, index) => {
    const descriptor = describePoi({
      marker: "signpost",
      roadDegree: entry.degree,
    });
    return {
      id: baseId + index,
      cell: entry.node.cell,
      x: entry.node.x,
      y: entry.node.y,
      name: "",
      marker: descriptor.marker,
      kind: descriptor.kind,
      roadDegree: entry.degree,
      poiSubtitle: descriptor.subtitle,
      poiDetail: descriptor.detail,
      score: clamp(entry.score / 8, 0, 1),
      coastal: false,
      river: false,
    };
  });
}

function getNearestCityDistance(node, cityPois) {
  let best = Number.POSITIVE_INFINITY;
  for (const city of cityPois) {
    const d = distance(node.x, node.y, city.x, city.y);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

function getSignpostSettlementSeparationScore(distanceToSettlement) {
  if (!Number.isFinite(distanceToSettlement)) {
    return 0;
  }

  // Prefer signposts to sit a bit away from settlements while still near
  // meaningful road junctions.
  const softMin = 2.1;
  const preferred = 4.8;
  const saturated = 8.5;

  if (distanceToSettlement <= softMin) {
    return 0;
  }
  if (distanceToSettlement >= saturated) {
    return 1;
  }
  if (distanceToSettlement <= preferred) {
    return clamp((distanceToSettlement - softMin) / (preferred - softMin), 0, 1) * 0.86;
  }
  return 0.86 + clamp((distanceToSettlement - preferred) / (saturated - preferred), 0, 1) * 0.14;
}

function getNearestCityNeighborSpan(network, adjacency) {
  let best = Number.POSITIVE_INFINITY;
  for (const edge of adjacency ?? []) {
    const neighbor = network.nodes[edge.nodeId];
    if (!neighbor || neighbor.type !== "city") {
      continue;
    }
    const span = Math.max(1, getNodeEdgeLength(network, edge.linkId));
    if (span < best) {
      best = span;
    }
  }
  return best;
}

function getSignpostJunctionCentralityScore(network, node, adjacency) {
  if (!adjacency?.length) {
    return 0;
  }

  let minSpan = Number.POSITIVE_INFINITY;
  let maxSpan = 0;
  let totalSpan = 0;
  let minCityNeighborSpan = Number.POSITIVE_INFINITY;
  let centroidX = 0;
  let centroidY = 0;
  let neighborCount = 0;

  for (const edge of adjacency) {
    const span = Math.max(1, getNodeEdgeLength(network, edge.linkId));
    minSpan = Math.min(minSpan, span);
    maxSpan = Math.max(maxSpan, span);
    totalSpan += span;

    const neighbor = network.nodes[edge.nodeId];
    if (!neighbor) {
      continue;
    }
    centroidX += neighbor.x;
    centroidY += neighbor.y;
    neighborCount += 1;

    if (neighbor.type === "city") {
      minCityNeighborSpan = Math.min(minCityNeighborSpan, span);
    }
  }

  if (neighborCount <= 0 || !Number.isFinite(minSpan) || maxSpan <= 0) {
    return 0;
  }

  const meanSpan = totalSpan / Math.max(1, adjacency.length);
  const balanceScore = clamp(minSpan / maxSpan, 0, 1);
  const minSpanScore = clamp((minSpan - 2.4) / 8.4, 0, 1);
  const cityNeighborClearance = Number.isFinite(minCityNeighborSpan)
    ? clamp((minCityNeighborSpan - 3.2) / 8.8, 0, 1)
    : 0.74;
  const centroidOffset = distance(
    node.x,
    node.y,
    centroidX / neighborCount,
    centroidY / neighborCount,
  );
  const centroidScore = clamp(
    1 - centroidOffset / Math.max(3, meanSpan * 0.52),
    0,
    1,
  );

  return clamp(
    balanceScore * 0.34 +
      minSpanScore * 0.28 +
      cityNeighborClearance * 0.22 +
      centroidScore * 0.16,
    0,
    1,
  );
}

function evaluatePoiSuitability(
  city,
  world,
  roadDegree,
  maxRoadDegree,
  networkSignals = {},
) {
  const cell = city.cell;
  const elevation = world.terrain.elevation[cell] ?? 0;
  const mountainField = world.terrain.mountainField[cell] ?? 0;
  const waterDistance = world.hydrology.waterDistance?.[cell] ?? 8;
  const riverStrength = world.hydrology.riverStrength?.[cell] ?? 0;
  const moisture = world.climate.moisture?.[cell] ?? 0.5;
  const biome = world.climate.biome?.[cell] ?? BIOME_KEYS.PLAINS;
  const hubness = clamp(roadDegree / Math.max(1, maxRoadDegree), 0, 1);
  const transitScore = clamp(Number(networkSignals.transitScore ?? 0), 0, 1);
  const corridorScore = clamp(Number(networkSignals.corridorScore ?? 0), 0, 1);
  const junctionScore = clamp(Number(networkSignals.junctionScore ?? 0), 0, 1);
  const waterAccess = clamp(1 - waterDistance / 8, 0, 1);
  const flatness = clamp(1 - elevation * 1.15, 0, 1);
  const ruggedness = clamp(mountainField * 0.9 + elevation * 0.65, 0, 1);
  const dryness = clamp(1 - moisture, 0, 1);
  const isEndpoint = roadDegree <= 1;
  const isDegreeTwoCorridor = roadDegree === 2;

  const settlement = clamp(
    0.24 +
      waterAccess * 0.34 +
      flatness * 0.24 +
      (city.coastal ? 0.13 : 0) +
      (city.river ? 0.12 : 0) +
      clamp(riverStrength / 2.6, 0, 0.11) +
      getBiomeSettlementBias(biome) +
      clamp(city.score, 0, 1) * 0.1 -
      ruggedness * 0.26 -
      transitScore * 0.12 -
      junctionScore * 0.16 +
      (isEndpoint ? 0.15 : 0),
    0,
    1,
  );

  const crashSite = clamp(
    0.08 +
      ruggedness * 0.3 +
      dryness * 0.15 +
      (1 - waterAccess) * 0.11 +
      getBiomeCrashBias(biome) -
      (city.coastal ? 0.09 : 0) -
      (city.river ? 0.1 : 0) +
      (isDegreeTwoCorridor ? 0.34 : roadDegree >= 3 ? 0.08 : 0) +
      transitScore * 0.14 +
      corridorScore * 0.22 -
      (roadDegree >= 4 ? 0.22 : 0) -
      (isEndpoint ? 0.24 : 0),
    0,
    1,
  );

  let signpost = 0;
  if (!isEndpoint) {
    const degreeBias =
      roadDegree >= 4 ? 0.62 : roadDegree === 3 ? 0.42 : roadDegree === 2 ? 0.08 : 0;
    signpost = clamp(
      0.04 +
        degreeBias +
        junctionScore * 0.52 +
        transitScore * 0.72 +
        corridorScore * 0.09 +
        hubness * 0.15 -
        ruggedness * 0.06 -
        waterAccess * 0.03,
      0,
      1,
    );

    if (roadDegree <= 2 && transitScore < 0.52) {
      signpost *= 0.22;
    }
  }

  return {
    isEndpoint,
    settlement,
    crashSite,
    signpost,
    transitScore,
    corridorScore,
  };
}

function getBiomeSettlementBias(biome) {
  switch (biome) {
    case BIOME_KEYS.PLAINS:
      return 0.18;
    case BIOME_KEYS.FOREST:
      return 0.12;
    case BIOME_KEYS.RAINFOREST:
      return 0.04;
    case BIOME_KEYS.HIGHLANDS:
      return -0.05;
    case BIOME_KEYS.DESERT:
      return -0.16;
    case BIOME_KEYS.TUNDRA:
      return -0.13;
    case BIOME_KEYS.MOUNTAIN:
      return -0.28;
    default:
      return 0;
  }
}

function getBiomeCrashBias(biome) {
  switch (biome) {
    case BIOME_KEYS.MOUNTAIN:
      return 0.2;
    case BIOME_KEYS.HIGHLANDS:
      return 0.12;
    case BIOME_KEYS.DESERT:
      return 0.1;
    case BIOME_KEYS.TUNDRA:
      return 0.08;
    case BIOME_KEYS.RAINFOREST:
      return 0.05;
    case BIOME_KEYS.PLAINS:
      return -0.05;
    default:
      return 0;
  }
}
