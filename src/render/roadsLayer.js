export function drawRoads(ctx, geometry, viewport) {
  const roads = geometry?.roads ?? [];
  if (roads.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const road of roads) {
    const points = road.points.map((point) => viewport.worldToCanvas(point.x - 0.5, point.y - 0.5));
    if (points.length < 2) {
      continue;
    }

    if (road.type === "sea-route") {
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(233, 244, 249, 0.72)";
      ctx.lineWidth = 2.8;
      strokeSmoothPath(ctx, points);

      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(122, 176, 198, 0.96)";
      ctx.lineWidth = 1.55;
      strokeSmoothPath(ctx, points);
      continue;
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(240, 231, 205, 0.72)";
    ctx.lineWidth = 3.2;
    strokeSmoothPath(ctx, points);

    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = "rgba(90, 67, 39, 0.9)";
    ctx.lineWidth = 1.5;
    strokeSmoothPath(ctx, points);
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
