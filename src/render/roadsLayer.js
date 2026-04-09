export function drawRoads(ctx, geometry, viewport) {
  const roads = geometry?.roads ?? [];
  if (roads.length === 0) {
    return;
  }
  const lockedPointKeys = collectLockedRoadPointKeys(roads);
  const zoomScale = getRoadZoomScale(viewport);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
    const road = roads[roadIndex];
    const worldPointKeys = road.points.map((point) => roadPointKey(point));
    const points = road.points.map((point) => viewport.worldToCanvas(point.x - 0.5, point.y - 0.5));
    if (points.length < 2) {
      continue;
    }

    const wobblePoints = getRoadWobblePoints(
      points,
      worldPointKeys,
      lockedPointKeys,
      roadIndex,
      (road.type === "sea-route" ? 0.44 : 0.52) * zoomScale
    );

    if (road.type === "sea-route") {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(233, 244, 249, 0.62)";
      ctx.lineWidth = 3.1 * zoomScale;
      strokeSmoothPath(ctx, wobblePoints);

      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(122, 176, 198, 0.96)";
      ctx.lineWidth = 1.55 * zoomScale;
      strokeSmoothPath(ctx, wobblePoints);
      continue;
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(145, 92, 76, 0.26)";
    ctx.lineWidth = 2.35 * zoomScale;
    strokeSmoothPath(ctx, wobblePoints);

    ctx.setLineDash(getRoadDashPattern(roadIndex, zoomScale));
    ctx.strokeStyle = "rgba(122, 61, 53, 0.86)";
    ctx.lineWidth = 1.75 * zoomScale;
    strokeSmoothPath(ctx, wobblePoints);
  }

  ctx.restore();
}

function strokeSmoothPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const midpointX = (points[index].x + points[index + 1].x) * 0.5;
    const midpointY = (points[index].y + points[index + 1].y) * 0.5;
    ctx.quadraticCurveTo(points[index].x, points[index].y, midpointX, midpointY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function getRoadWobblePoints(
  points,
  worldPointKeys,
  lockedPointKeys,
  roadIndex,
  wobble,
) {
  return points.map((point, index) => {
    const key = worldPointKeys[index];
    if (
      index === 0 ||
      index === points.length - 1 ||
      (key != null && lockedPointKeys.has(key))
    ) {
      return { x: point.x, y: point.y };
    }

    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const normalX = -tangentY / length;
    const normalY = tangentX / length;
    const jitter = (roadNoise(roadIndex, index) - 0.5) * 2 * wobble;

    return {
      x: point.x + normalX * jitter,
      y: point.y + normalY * jitter
    };
  });
}

function collectLockedRoadPointKeys(roads) {
  const usageByKey = new Map();
  for (const road of roads) {
    for (const point of road.points ?? []) {
      const key = roadPointKey(point);
      usageByKey.set(key, (usageByKey.get(key) ?? 0) + 1);
    }
  }

  const locked = new Set();
  for (const [key, count] of usageByKey.entries()) {
    if (count >= 2) {
      locked.add(key);
    }
  }
  return locked;
}

function roadPointKey(point) {
  return `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`;
}

function getRoadDashPattern(roadIndex, zoomScale) {
  const noise = roadNoise(roadIndex, 91);
  return [
    (6.8 + noise * 2.6) * zoomScale,
    (8.2 + roadNoise(roadIndex, 137) * 3.5) * zoomScale,
  ];
}

function roadNoise(roadIndex, pointIndex) {
  const value = Math.sin((roadIndex + 1) * 127.1 + pointIndex * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function getRoadZoomScale(viewport) {
  return Math.max(1, Math.min(4.2, viewport?.zoom ?? 1));
}
