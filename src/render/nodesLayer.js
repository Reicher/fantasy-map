import { drawNodeMarkerGlyph } from "./nodeGlyph.js?v=20260411a";

const MAP_NODE_ICON_LIFT = 3.3;

export function drawNodes(ctx, nodes, viewport, options = {}) {
  const validIds = new Set(options.validNodeIds ?? []);
  const visibleIds = new Set(
    options.visibleNodeIds ??
      options.validNodeIds ??
      [],
  );
  const unknownIds = new Set(options.unknownNodeIds ?? []);
  const hoveredId = options.hoveredNodeId ?? null;
  const pressedId = options.pressedNodeId ?? null;
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

    const marker = unknownIds.has(node.id) ? "unknown" : node.marker;
    drawNodeMarkerGlyph(ctx, point.x, point.y, marker, {
      scale: symbolScale,
      highlighted,
      hovered,
      pressed,
      iconLift: MAP_NODE_ICON_LIFT * symbolScale,
    });
  }
}

export function drawPlayerMarker(ctx, playerStart, viewport) {
  if (!playerStart) {
    return;
  }

  const point = viewport.worldToCanvas(playerStart.x, playerStart.y);

  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = "rgba(82, 8, 8, 0.32)";
  ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "#f03737";
  ctx.arc(point.x, point.y, 8.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 244, 244, 0.98)";
  ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawNodeTargetHalo(ctx, x, y, scale, hovered, pressed) {
  const expanded = hovered || pressed;
  const haloCenterY = y - 0.45 * scale;
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
