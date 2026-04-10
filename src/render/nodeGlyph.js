import { normalizeNodeMarker } from "../nodeModel.js";

export function drawNodeMarkerGlyph(
  ctx,
  x,
  y,
  marker,
  {
    scale = 1,
    highlighted = false,
    hovered = false,
    pressed = false,
    iconLift = null,
  } = {},
) {
  const normalizedMarker = normalizeNodeMarker(marker);
  const expanded = hovered || pressed;
  const glyphScale = (expanded ? 1.14 : 1.02) * Math.max(0.55, scale);
  const iconY = y - (iconLift ?? 7.1 * glyphScale);
  drawNodeIcon(ctx, normalizedMarker, x, iconY, glyphScale, {
    highlighted,
    hovered,
    pressed,
  });
}

function drawNodeIcon(ctx, marker, x, y, scale, state) {
  const iconScale = (state.hovered || state.pressed ? 1.22 : 1.14) * scale;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.strokeStyle = "rgba(12, 10, 10, 0.96)";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.46, 0.34 * iconScale);
  ctx.shadowColor = state.highlighted
    ? "rgba(255, 232, 186, 0.42)"
    : "rgba(56, 44, 36, 0.28)";
  ctx.shadowBlur = Math.max(1.4, 2.1 * iconScale);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(0.15, 0.28 * iconScale);

  switch (marker) {
    case "abandoned":
      drawAbandonedIcon(ctx, x, y, iconScale);
      break;
    case "signpost":
      drawSignpostIcon(ctx, x, y, iconScale);
      break;
    case "settlement":
    default:
      drawSettlementIcon(ctx, x, y, iconScale);
      break;
  }

  ctx.restore();
}

function drawSettlementIcon(ctx, x, y, scale) {
  ctx.beginPath();
  ctx.moveTo(x - 3.35 * scale, y + 2.65 * scale);
  ctx.lineTo(x, y - 3.95 * scale);
  ctx.lineTo(x + 3.35 * scale, y + 2.65 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillRect(x - 0.9 * scale, y + 1.0 * scale, 1.8 * scale, 1.55 * scale);
  ctx.strokeRect(x - 0.9 * scale, y + 1.0 * scale, 1.8 * scale, 1.55 * scale);
}

function drawAbandonedIcon(ctx, x, y, scale) {
  ctx.beginPath();
  ctx.moveTo(x - 3.45 * scale, y - 2.6 * scale);
  ctx.lineTo(x + 3.45 * scale, y + 2.6 * scale);
  ctx.moveTo(x + 3.45 * scale, y - 2.6 * scale);
  ctx.lineTo(x - 3.45 * scale, y + 2.6 * scale);
  ctx.stroke();

  const crateW = 4.9 * scale;
  const crateH = 2.9 * scale;
  const crateX = x - crateW * 0.5;
  const crateY = y + 1.35 * scale;

  ctx.fillRect(crateX, crateY, crateW, crateH);
  ctx.strokeRect(crateX, crateY, crateW, crateH);

  ctx.beginPath();
  ctx.moveTo(crateX + 0.65 * scale, crateY + crateH * 0.5);
  ctx.lineTo(crateX + crateW - 0.65 * scale, crateY + crateH * 0.5);
  ctx.moveTo(crateX + crateW * 0.5, crateY + 0.52 * scale);
  ctx.lineTo(crateX + crateW * 0.5, crateY + crateH - 0.52 * scale);
  ctx.stroke();
}

function drawSignpostIcon(ctx, x, y, scale) {
  // Signpost intentionally keeps its central pole.
  ctx.beginPath();
  ctx.moveTo(x, y + 3.95 * scale);
  ctx.lineTo(x, y - 3.95 * scale);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 0.1 * scale, y - 2.35 * scale);
  ctx.lineTo(x + 3.35 * scale, y - 2.35 * scale);
  ctx.lineTo(x + 4.55 * scale, y - 1.52 * scale);
  ctx.lineTo(x + 3.35 * scale, y - 0.7 * scale);
  ctx.lineTo(x - 0.1 * scale, y - 0.7 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + 0.1 * scale, y + 0.72 * scale);
  ctx.lineTo(x - 3.35 * scale, y + 0.72 * scale);
  ctx.lineTo(x - 4.55 * scale, y + 1.54 * scale);
  ctx.lineTo(x - 3.35 * scale, y + 2.36 * scale);
  ctx.lineTo(x + 0.1 * scale, y + 2.36 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y - 0.2 * scale, Math.max(0.44, 0.55 * scale), 0, Math.PI * 2);
  ctx.fill();
}
