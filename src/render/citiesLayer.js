export function drawCities(ctx, cities, viewport, options = {}) {
  drawPointsOfInterest(ctx, cities, viewport, options);
}

export function drawPointsOfInterest(ctx, pointsOfInterest, viewport, options = {}) {
  const validIds = new Set(options.validCityIds ?? options.validPoiIds ?? []);
  const visibleIds = new Set(options.visibleCityIds ?? options.visiblePoiIds ?? options.validCityIds ?? options.validPoiIds ?? []);
  const hoveredId = options.hoveredCityId ?? options.hoveredPoiId ?? null;
  const pressedId = options.pressedCityId ?? options.pressedPoiId ?? null;
  const onlyValid = options.onlyValid === true;
  const symbolScale = getPoiZoomScale(viewport);

  for (const poi of pointsOfInterest) {
    if (onlyValid && !visibleIds.has(poi.id)) {
      continue;
    }

    const point = viewport.worldToCanvas(poi.x - 0.5, poi.y - 0.5);

    if (validIds.has(poi.id)) {
      drawPoiTargetHalo(ctx, point.x, point.y, symbolScale, poi.id === hoveredId, poi.id === pressedId);
    }

    drawPoiGlyph(ctx, poi, point.x, point.y, symbolScale, {
      highlighted: validIds.has(poi.id),
      hovered: poi.id === hoveredId,
      pressed: poi.id === pressedId
    });
  }
}

export function drawPlayerMarker(ctx, playerStart, viewport) {
  if (!playerStart) {
    return;
  }

  const point = viewport.worldToCanvas(playerStart.x, playerStart.y);

  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 238, 234, 0.9)";
  ctx.arc(point.x, point.y, 8.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "#b31e1e";
  ctx.arc(point.x, point.y, 5.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPoiTargetHalo(ctx, x, y, scale, hovered, pressed) {
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = pressed
    ? "rgba(206, 135, 89, 0.18)"
    : hovered
      ? "rgba(214, 154, 108, 0.16)"
      : "rgba(171, 104, 81, 0.12)";
  ctx.arc(x, y, (hovered || pressed ? 8.8 : 7.2) * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPoiGlyph(ctx, poi, x, y, scale, state) {
  switch (poi.marker ?? "dot") {
    case "dot":
    default:
      drawPoiDot(ctx, x, y, scale, state);
      break;
  }
}

function drawPoiDot(ctx, x, y, scale, state) {
  const outerRadius = (state.hovered || state.pressed ? 4.5 : 3.9) * scale;
  const innerRadius = (state.hovered || state.pressed ? 2.15 : 1.85) * scale;

  ctx.save();

  ctx.beginPath();
  ctx.fillStyle = "rgba(247, 239, 218, 0.96)";
  ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = state.pressed
    ? "rgba(121, 48, 39, 0.98)"
    : state.hovered
      ? "rgba(104, 47, 39, 0.96)"
      : "rgba(72, 43, 31, 0.94)";
  ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = "rgba(70, 48, 33, 0.9)";
  ctx.lineWidth = Math.max(0.9, 1.05 * scale);
  ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function getPoiZoomScale(viewport) {
  return Math.max(1, Math.min(3.6, viewport.zoom));
}
