export function drawCities(ctx, cities, viewport, options = {}) {
  const validCityIds = new Set(options.validCityIds ?? []);
  const hoveredCityId = options.hoveredCityId ?? null;
  const pressedCityId = options.pressedCityId ?? null;
  const symbolScale = getCityZoomScale(viewport);

  for (const city of cities) {
    const point = viewport.worldToCanvas(city.x, city.y);

    if (validCityIds.has(city.id)) {
      ctx.beginPath();
      ctx.fillStyle =
        city.id === pressedCityId
          ? "rgba(214, 156, 68, 0.95)"
          : city.id === hoveredCityId
            ? "rgba(233, 191, 108, 0.88)"
            : "rgba(247, 237, 206, 0.74)";
      ctx.arc(
        point.x,
        point.y,
        (city.id === hoveredCityId || city.id === pressedCityId ? 8.5 : 6.7) * symbolScale,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    drawCityGlyph(ctx, point.x, point.y, symbolScale);
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

function drawCityGlyph(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.fillStyle = "#f4ebd6";
  ctx.strokeStyle = "#3a2d1d";
  ctx.lineWidth = Math.max(0.9, 1 * scale);

  ctx.beginPath();
  ctx.moveTo(x - 4.4 * scale, y + 2.6 * scale);
  ctx.lineTo(x - 4.4 * scale, y - 0.8 * scale);
  ctx.lineTo(x, y - 4.6 * scale);
  ctx.lineTo(x + 4.4 * scale, y - 0.8 * scale);
  ctx.lineTo(x + 4.4 * scale, y + 2.6 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 1.1 * scale, y + 2.6 * scale);
  ctx.lineTo(x - 1.1 * scale, y + 0.4 * scale);
  ctx.lineTo(x + 1.1 * scale, y + 0.4 * scale);
  ctx.lineTo(x + 1.1 * scale, y + 2.6 * scale);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 2.8 * scale, y - 0.2 * scale);
  ctx.lineTo(x - 2.8 * scale, y - 4.8 * scale);
  ctx.lineTo(x - 1.9 * scale, y - 4.8 * scale);
  ctx.lineTo(x - 1.9 * scale, y - 0.7 * scale);
  ctx.stroke();

  ctx.restore();
}

function getCityZoomScale(viewport) {
  return Math.max(1, Math.min(3.6, viewport.zoom));
}
