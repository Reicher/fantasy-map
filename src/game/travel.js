const TRAVEL_SPEED = 3.75;

export function createPlayState(world) {
  const currentCityId = world.playerStart?.cityId ?? world.cities[0]?.id ?? null;
  const currentCity = currentCityId == null ? null : world.cities[currentCityId];
  const lastRegionId =
    currentCity && currentCity.cell != null ? regionIdAtCell(world, currentCity.cell) : null;

  return {
    graph: world.travelGraph,
    viewMode: "map",
    currentCityId,
    position: currentCity ? { x: currentCity.x, y: currentCity.y } : null,
    lastRegionId,
    hoveredCityId: null,
    pressedCityId: null,
    travel: null
  };
}

export function getValidTargetIds(playState) {
  if (!playState) {
    return [];
  }

  if (playState.travel) {
    return [];
  }

  return [...(playState.graph.get(playState.currentCityId)?.keys() ?? [])];
}

export function beginTravel(playState, targetCityId) {
  if (!playState) {
    return playState;
  }

  if (playState.travel) {
    return playState;
  }

  const path = playState.graph.get(playState.currentCityId)?.get(targetCityId);
  if (!path) {
    return playState;
  }

  return {
    ...playState,
    travel: createTravel(playState.currentCityId, targetCityId, path.points, path.routeType),
    hoveredCityId: null,
    pressedCityId: null
  };
}

export function advanceTravel(playState, world, deltaMs) {
  if (!playState?.travel || !playState.position) {
    return playState;
  }

  const nextProgress = Math.min(
    playState.travel.totalLength,
    playState.travel.progress + (deltaMs / 1000) * TRAVEL_SPEED
  );
  const sample = samplePath(playState.travel.points, playState.travel.segmentLengths, nextProgress);
  const sampledRegionId = regionIdAtPosition(world, sample.point);
  const lastRegionId = sampledRegionId ?? playState.lastRegionId ?? null;

  if (nextProgress >= playState.travel.totalLength - 0.0001) {
    const city = world.cities[playState.travel.targetCityId];
    return {
      ...playState,
      currentCityId: playState.travel.targetCityId,
      position: city ? { x: city.x, y: city.y } : sample.point,
      lastRegionId:
        city && city.cell != null ? regionIdAtCell(world, city.cell) ?? lastRegionId : lastRegionId,
      travel: null
    };
  }

  return {
    ...playState,
    position: sample.point,
    lastRegionId,
    travel: {
      ...playState.travel,
      progress: nextProgress
    }
  };
}

function createTravel(startCityId, targetCityId, points, routeType = "road") {
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
    startCityId,
    targetCityId,
    routeType,
    points: normalizedPoints,
    segmentLengths,
    totalLength,
    progress: 0
  };
}

function samplePath(points, segmentLengths, distance) {
  if (points.length <= 1) {
    return {
      point: points[0] ?? { x: 0, y: 0 },
      segmentIndex: 0,
      segmentT: 0
    };
  }

  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (distance <= traversed + segmentLength || index === segmentLengths.length - 1) {
      const local = segmentLength <= 0 ? 0 : (distance - traversed) / segmentLength;
      const t = Math.max(0, Math.min(1, local));
      const start = points[index];
      const end = points[index + 1];
      return {
        point: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t
        },
        segmentIndex: index,
        segmentT: t
      };
    }
    traversed += segmentLength;
  }

  return {
    point: points[points.length - 1],
    segmentIndex: segmentLengths.length - 1,
    segmentT: 1
  };
}

function dedupePoints(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.0001 && Math.abs(previous.y - point.y) < 0.0001) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

function regionIdAtPosition(world, position) {
  if (!world || !position) {
    return null;
  }

  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  if (x < 0 || y < 0 || x >= world.terrain.width || y >= world.terrain.height) {
    return null;
  }

  return regionIdAtCell(world, y * world.terrain.width + x);
}

function regionIdAtCell(world, cell) {
  if (cell == null || cell < 0) {
    return null;
  }

  const regionId = world.features.indices.biomeRegionId[cell];
  return regionId == null || regionId < 0 ? null : regionId;
}
