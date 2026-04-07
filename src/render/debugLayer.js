export function drawTravelDebugOverlay(ctx, viewport, debug) {
  if (!debug?.samples) {
    return;
  }

  const nearPoint = debug.samples.near?.point;
  const palette = {
    near: { fill: "rgba(255,255,255,0.96)", stroke: "rgba(20,22,25,0.98)", radius: 5 },
    mid: { fill: "rgba(255,196,84,0.98)", stroke: "rgba(92,57,13,0.98)", radius: 5 },
    far: { fill: "rgba(255,106,148,0.98)", stroke: "rgba(92,22,43,0.98)", radius: 5 }
  };

  for (const bandName of ["far", "mid", "near"]) {
    const sample = debug.samples[bandName];
    if (!sample?.point) {
      continue;
    }

    const canvasPoint = viewport.worldToCanvas(sample.point.x, sample.point.y);
    const style = palette[bandName];

    if (nearPoint && bandName !== "near") {
      const nearCanvasPoint = viewport.worldToCanvas(nearPoint.x, nearPoint.y);
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(nearCanvasPoint.x, nearCanvasPoint.y);
      ctx.lineTo(canvasPoint.x, canvasPoint.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, style.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
