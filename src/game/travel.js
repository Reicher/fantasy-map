import { BIOME_INFO } from "../config.js";
import { dedupePoints } from "../utils.js";
import { regionAtCell, regionAtPosition } from "./playQueries.js";
import { DEFAULT_TIME_OF_DAY_HOURS } from "./timeOfDay.js";

const TRAVEL_SPEED = 3.75;
const TRAVEL_BIOME_BANDS = {
  near: 0,
  mid: 5,
  far: 10,
};

export function createPlayState(world) {
  const currentNodeId =
    world.playerStart?.nodeId ?? world.features?.nodes?.[0]?.id ?? null;
  const currentNode =
    currentNodeId == null ? null : world.features?.nodes?.[currentNodeId];
  const lastRegionId =
    currentNode && currentNode.cell != null
      ? (regionAtCell(world, currentNode.cell)?.id ?? null)
      : null;
  const discoveredCells = new Uint8Array(
    world.terrain.width * world.terrain.height,
  );
  revealAroundPosition(
    world,
    discoveredCells,
    currentNode ? { x: currentNode.x, y: currentNode.y } : null,
  );

  return {
    graph: world.travelGraph,
    viewMode: "map",
    timeOfDayHours: DEFAULT_TIME_OF_DAY_HOURS,
    currentNodeId,
    position: currentNode ? { x: currentNode.x, y: currentNode.y } : null,
    lastRegionId,
    hoveredNodeId: null,
    pressedNodeId: null,
    travel: null,
    discoveredCells,
    fogDirty: true,
  };
}

export function getValidTargetIds(playState) {
  if (!playState) {
    return [];
  }

  if (playState.travel) {
    return [];
  }

  return [...(playState.graph.get(playState.currentNodeId)?.keys() ?? [])];
}

export function beginTravel(playState, targetNodeId, world = null) {
  if (!playState) {
    return playState;
  }

  if (playState.travel) {
    return playState;
  }

  const path = playState.graph.get(playState.currentNodeId)?.get(targetNodeId);
  if (!path) {
    return playState;
  }

  const biomeBandSegments = world
    ? buildTravelBiomeBandSegments(world, path.points)
    : createEmptyTravelBiomeBands();

  return {
    ...playState,
    travel: createTravel(
      playState.currentNodeId,
      targetNodeId,
      path.points,
      path.routeType,
      biomeBandSegments,
    ),
    hoveredNodeId: null,
    pressedNodeId: null,
  };
}

export function advanceTravel(playState, world, deltaMs) {
  if (!playState?.travel || !playState.position) {
    return playState;
  }

  const nextProgress = Math.min(
    playState.travel.totalLength,
    playState.travel.progress + (deltaMs / 1000) * TRAVEL_SPEED,
  );
  const sample = samplePath(
    playState.travel.points,
    playState.travel.segmentLengths,
    nextProgress,
  );
  const sampledRegionId = regionAtPosition(world, sample.point)?.id ?? null;
  const lastRegionId = sampledRegionId ?? playState.lastRegionId ?? null;
  const discoveredCells =
    playState.discoveredCells ??
    new Uint8Array(world.terrain.width * world.terrain.height);
  const revealed = revealAroundPosition(world, discoveredCells, sample.point);

  if (nextProgress >= playState.travel.totalLength - 0.0001) {
    const targetNode = world.features?.nodes?.[playState.travel.targetNodeId];
    const finalPosition = targetNode
      ? { x: targetNode.x, y: targetNode.y }
      : sample.point;
    const finalReveal = revealAroundPosition(
      world,
      discoveredCells,
      finalPosition,
    );
    return {
      ...playState,
      currentNodeId: playState.travel.targetNodeId,
      position: finalPosition,
      lastRegionId:
        targetNode && targetNode.cell != null
          ? (regionAtCell(world, targetNode.cell)?.id ?? lastRegionId)
          : lastRegionId,
      travel: null,
      discoveredCells,
      fogDirty: playState.fogDirty || revealed || finalReveal,
    };
  }

  return {
    ...playState,
    position: sample.point,
    lastRegionId,
    discoveredCells,
    fogDirty: playState.fogDirty || revealed,
    travel: {
      ...playState.travel,
      progress: nextProgress,
    },
  };
}

function createTravel(
  startNodeId,
  targetNodeId,
  points,
  routeType = "road",
  biomeBandSegments = createEmptyTravelBiomeBands(),
) {
  const normalizedPoints = dedupePoints(points);
  const segmentLengths = [];
  let totalLength = 0;

  for (let index = 1; index < normalizedPoints.length; index += 1) {
    const prev = normalizedPoints[index - 1];
    const next = normalizedPoints[index];
    const segmentLength = Math.hypot(next.x - prev.x, next.y - prev.y);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }

  return {
    startNodeId,
    targetNodeId,
    routeType,
    points: normalizedPoints,
    segmentLengths,
    totalLength,
    progress: 0,
    biomeBandSegments,
    biomeSegments: biomeBandSegments.near.segments,
    midDistantBiomeSegments: biomeBandSegments.mid.segments,
    farDistantBiomeSegments: biomeBandSegments.far.segments,
  };
}

function buildOffsetTravelBiomeSegments(
  world,
  points,
  offsetDistance = TRAVEL_BIOME_BANDS.mid,
) {
  const normalizedPoints = dedupePoints(points);
  const offsetPoints = normalizedPoints.map((point, index) =>
    offsetPointLeft(normalizedPoints, index, offsetDistance),
  );
  return buildBiomeSegmentsFromPoints(world, offsetPoints);
}

export function buildTravelBiomeBandSegments(world, points) {
  const normalizedPoints = dedupePoints(points);
  return {
    near: createTravelBiomeBand(
      "near",
      TRAVEL_BIOME_BANDS.near,
      buildBiomeSegmentsFromPoints(world, normalizedPoints),
    ),
    mid: createTravelBiomeBand(
      "mid",
      TRAVEL_BIOME_BANDS.mid,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.mid,
      ),
    ),
    far: createTravelBiomeBand(
      "far",
      TRAVEL_BIOME_BANDS.far,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.far,
      ),
    ),
  };
}

export function sampleTravelBiomeBandPoints(travel) {
  if (!travel?.points?.length) {
    return null;
  }

  const progress = Math.max(
    0,
    Math.min(travel.totalLength ?? 0, travel.progress ?? 0),
  );
  const sample = samplePath(
    travel.points,
    travel.segmentLengths ?? [],
    progress,
  );
  const bands = travel.biomeBandSegments ?? createEmptyTravelBiomeBands();

  return {
    near: createTravelBandPointSample(
      "near",
      bands.near?.offsetDistance ?? 0,
      sample.point,
    ),
    mid: createTravelBandPointSample(
      "mid",
      bands.mid?.offsetDistance ?? TRAVEL_BIOME_BANDS.mid,
      offsetSamplePointLeft(
        travel.points,
        sample,
        bands.mid?.offsetDistance ?? TRAVEL_BIOME_BANDS.mid,
      ),
    ),
    far: createTravelBandPointSample(
      "far",
      bands.far?.offsetDistance ?? TRAVEL_BIOME_BANDS.far,
      offsetSamplePointLeft(
        travel.points,
        sample,
        bands.far?.offsetDistance ?? TRAVEL_BIOME_BANDS.far,
      ),
    ),
  };
}

function buildBiomeSegmentsFromPoints(world, points) {
  if (!world || !points?.length) {
    return [];
  }

  const segments = [];
  let current = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const biomeKey = biomeKeyAtPoint(world, point);
    const biomeInfo = BIOME_INFO[biomeKey] ?? {
      key: "unknown",
      label: "Okänd",
    };
    const nextPoint = points[index + 1];
    const distance = nextPoint
      ? Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y)
      : 0;

    if (!current || current.biome !== biomeInfo.key) {
      current = {
        biome: biomeInfo.key,
        label: biomeInfo.label,
        distance: 0,
      };
      segments.push(current);
    }

    current.distance += distance;
  }

  const totalDistance = segments.reduce(
    (sum, segment) => sum + segment.distance,
    0,
  );
  return segments.map((segment) => ({
    ...segment,
    share: totalDistance > 0 ? segment.distance / totalDistance : 0,
  }));
}

function createTravelBiomeBand(name, offsetDistance, segments) {
  return {
    name,
    offsetDistance,
    segments,
  };
}

function createTravelBandPointSample(name, offsetDistance, point) {
  return {
    name,
    offsetDistance,
    point,
  };
}

function createEmptyTravelBiomeBands() {
  return {
    near: createTravelBiomeBand("near", TRAVEL_BIOME_BANDS.near, []),
    mid: createTravelBiomeBand("mid", TRAVEL_BIOME_BANDS.mid, []),
    far: createTravelBiomeBand("far", TRAVEL_BIOME_BANDS.far, []),
  };
}

function samplePath(points, segmentLengths, distance) {
  if (points.length <= 1) {
    return {
      point: points[0] ?? { x: 0, y: 0 },
      segmentIndex: 0,
      segmentT: 0,
    };
  }

  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (
      distance <= traversed + segmentLength ||
      index === segmentLengths.length - 1
    ) {
      const local =
        segmentLength <= 0 ? 0 : (distance - traversed) / segmentLength;
      const t = Math.max(0, Math.min(1, local));
      const start = points[index];
      const end = points[index + 1];
      return {
        point: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        },
        segmentIndex: index,
        segmentT: t,
      };
    }
    traversed += segmentLength;
  }

  return {
    point: points[points.length - 1],
    segmentIndex: segmentLengths.length - 1,
    segmentT: 1,
  };
}

function offsetPointLeft(points, index, offsetDistance) {
  const current = points[index];
  const previous = points[index - 1] ?? current;
  const next = points[index + 1] ?? current;
  const tangentX = next.x - previous.x;
  const tangentY = next.y - previous.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return { x: current.x, y: current.y };
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;

  return {
    x: current.x + normalX * offsetDistance,
    y: current.y + normalY * offsetDistance,
  };
}

function offsetSamplePointLeft(points, sample, offsetDistance) {
  if (!sample?.point || !points?.length || Math.abs(offsetDistance) <= 0.0001) {
    return sample?.point ?? null;
  }

  const startIndex = Math.max(
    0,
    Math.min(points.length - 1, sample.segmentIndex ?? 0),
  );
  const endIndex = Math.max(0, Math.min(points.length - 1, startIndex + 1));
  const start = points[startIndex] ?? sample.point;
  const end = points[endIndex] ?? sample.point;
  const tangentX = end.x - start.x;
  const tangentY = end.y - start.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return sample.point;
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;
  return {
    x: sample.point.x + normalX * offsetDistance,
    y: sample.point.y + normalY * offsetDistance,
  };
}

function biomeKeyAtPoint(world, position) {
  if (!world || !position) {
    return null;
  }

  const x = Math.max(
    0,
    Math.min(world.terrain.width - 1, Math.floor(position.x)),
  );
  const y = Math.max(
    0,
    Math.min(world.terrain.height - 1, Math.floor(position.y)),
  );
  return world.climate.biome[y * world.terrain.width + x];
}

function revealAroundPosition(world, discoveredCells, position) {
  if (!world || !discoveredCells || !position) {
    return false;
  }

  const baseRadius = Math.max(1, Number(world.params?.fogVisionRadius ?? 18));
  const radius = Math.max(1, Math.round(baseRadius * 1.5));
  const radiusSq = (radius + 0.35) * (radius + 0.35);
  const minX = Math.max(0, Math.floor(position.x - radius));
  const maxX = Math.min(
    world.terrain.width - 1,
    Math.ceil(position.x + radius),
  );
  const minY = Math.max(0, Math.floor(position.y - radius));
  const maxY = Math.min(
    world.terrain.height - 1,
    Math.ceil(position.y + radius),
  );
  let changed = false;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - position.x;
      const dy = y + 0.5 - position.y;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const index = y * world.terrain.width + x;
      if (discoveredCells[index]) {
        continue;
      }
      discoveredCells[index] = 1;
      changed = true;
    }
  }

  return changed;
}
