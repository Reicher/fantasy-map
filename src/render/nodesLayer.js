import { drawNodeMarkerGlyph } from "./nodeGlyph.js?v=20260409a";

export function drawNodes(ctx, nodes, viewport, options = {}) {
  const validIds = new Set(options.validNodeIds ?? options.validPoiIds ?? []);
  const visibleIds = new Set(
    options.visibleNodeIds ??
      options.visiblePoiIds ??
      options.validNodeIds ??
      options.validPoiIds ??
      [],
  );
  const hoveredId = options.hoveredNodeId ?? options.hoveredPoiId ?? null;
  const pressedId = options.pressedNodeId ?? options.pressedPoiId ?? null;
  const onlyValid = options.onlyValid === true;
  const symbolScale = getNodeZoomScale(viewport);

  for (const node of nodes) {
    if (onlyValid && !visibleIds.has(node.id)) {
      continue;
    }

    const point = viewport.worldToCanvas(node.x, node.y);
    const hovered = node.id === hoveredId;
    const pressed = node.id === pressedId;
    const highlighted = validIds.has(node.id);

    if (highlighted) {
      drawNodeTargetHalo(ctx, point.x, point.y, symbolScale, hovered, pressed);
    }

    drawNodeMarkerGlyph(ctx, point.x, point.y, node.marker, {
      scale: symbolScale,
      highlighted,
      hovered,
      pressed,
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

function drawNodeTargetHalo(ctx, x, y, scale, hovered, pressed) {
  const expanded = hovered || pressed;
  const haloCenterY = y - 1.6 * scale;
  const radiusX = (expanded ? 16.2 : 14.0) * scale;
  const radiusY = (expanded ? 10.9 : 9.4) * scale;

  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = pressed
    ? "rgba(207, 139, 86, 0.3)"
    : hovered
      ? "rgba(216, 155, 102, 0.28)"
      : "rgba(175, 110, 77, 0.22)";
  ctx.ellipse(x, haloCenterY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = expanded
    ? "rgba(250, 226, 184, 0.72)"
    : "rgba(234, 202, 154, 0.54)";
  ctx.lineWidth = Math.max(1.2, 1.35 * scale);
  ctx.ellipse(
    x,
    haloCenterY,
    radiusX * 0.71,
    radiusY * 0.71,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
}

function getNodeZoomScale(viewport) {
  return Math.max(2.1, Math.min(6.2, viewport.zoom * 1.32));
}
