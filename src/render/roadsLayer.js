export function drawRoads(ctx, geometry, viewport) {
  const roads = geometry?.roads ?? [];
  if (roads.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
    const road = roads[roadIndex];
    const points = road.points.map((point) => viewport.worldToCanvas(point.x - 0.5, point.y - 0.5));
    if (points.length < 2) {
      continue;
    }

    const wobblePoints = getRoadWobblePoints(points, roadIndex, road.type === "sea-route" ? 0.55 : 0.7);

    if (road.type === "sea-route") {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(233, 244, 249, 0.62)";
      ctx.lineWidth = 3.1;
      strokeSmoothPath(ctx, wobblePoints);

      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(122, 176, 198, 0.96)";
      ctx.lineWidth = 1.55;
      strokeSmoothPath(ctx, wobblePoints);
      continue;
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(145, 92, 76, 0.26)";
    ctx.lineWidth = 2.35;
    strokeSmoothPath(ctx, wobblePoints);

    ctx.setLineDash(getRoadDashPattern(roadIndex));
    ctx.strokeStyle = "rgba(122, 61, 53, 0.86)";
    ctx.lineWidth = 1.75;
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

function getRoadWobblePoints(points, roadIndex, wobble) {
  return points.map((point, index) => {
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

function getRoadDashPattern(roadIndex) {
  const noise = roadNoise(roadIndex, 91);
  return [6.8 + noise * 2.6, 8.2 + roadNoise(roadIndex, 137) * 3.5];
}

function roadNoise(roadIndex, pointIndex) {
  const value = Math.sin((roadIndex + 1) * 127.1 + pointIndex * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
