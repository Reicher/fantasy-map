export function drawCities(ctx, cities, viewport, options = {}) {
  const validCityIds = new Set(options.validCityIds ?? []);
  const hoveredCityId = options.hoveredCityId ?? null;
  const pressedCityId = options.pressedCityId ?? null;

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
      ctx.arc(point.x, point.y, city.id === hoveredCityId || city.id === pressedCityId ? 8.5 : 6.7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.fillStyle = "#f4ebd6";
    ctx.arc(point.x, point.y, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#3a2d1d";
    ctx.arc(point.x, point.y, 2.3, 0, Math.PI * 2);
    ctx.fill();
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
