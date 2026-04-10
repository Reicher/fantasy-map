import { PARALLAX_SPEED } from "./journeyStrip.js";
import {
  drawJourneyTreeOnCanvas,
  drawNodeMarkerOnCanvas,
} from "./journeyStyle.js";
import {
  clamp01,
  lerpRgb,
  rgbCssFromArray,
  tintRgbWithSky,
} from "./journeySceneMath.js";

const NODE_MARKER_SCALE = 1.35;
const SETTLEMENT_VISUAL_HEIGHT_PX = 472;
const ABANDONED_VISUAL_HEIGHT_PX = 216;
const SETTLEMENT_UPWARD_OFFSET_PX = 30;
const ABANDONED_UPWARD_OFFSET_PX = 13;
const SIGNPOST_VISUAL_HEIGHT_PX = 104;
const SIGNPOST_UPWARD_OFFSET_PX = 18;

const LAYER_HAZE = {
  far: 0.42,
  mid: 0.2,
  near2: 0.07,
  near1: 0,
  foreground: 0,
};

export function drawGroundLayer(ctx, strip, scrollX, playerX, viewW) {
  const speed = PARALLAX_SPEED.ground;
  const layerStripLeft = scrollX * speed - playerX;
  const { topY, bottomY } = strip.layers.ground;
  const layerH = bottomY - topY;

  for (const segment of strip.layerSegments.ground) {
    const canvasX = segment.stripX - layerStripLeft;
    if (canvasX + segment.stripWidth < 0 || canvasX > viewW) continue;
    ctx.fillStyle = segment.color;
    ctx.fillRect(
      Math.floor(canvasX),
      topY,
      Math.ceil(segment.stripWidth) + 1,
      layerH,
    );
  }

  const segments = strip.layerSegments.ground;
  const blendZonePx = strip.blendZonePx ?? 48;
  const halfBlend = blendZonePx / 2;
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const a = segments[index];
    const b = segments[index + 1];
    if (!a.colorRgb || !b.colorRgb || a.biomeKey === b.biomeKey) continue;
    const seamCanvasX = a.stripX + a.stripWidth - layerStripLeft;
    if (seamCanvasX + halfBlend < 0 || seamCanvasX - halfBlend > viewW) continue;
    const [ar, ag, ab] = a.colorRgb;
    const [br, bg, bb] = b.colorRgb;
    const grad = ctx.createLinearGradient(
      seamCanvasX - halfBlend,
      0,
      seamCanvasX + halfBlend,
      0,
    );
    grad.addColorStop(0, `rgb(${ar},${ag},${ab})`);
    grad.addColorStop(1, `rgb(${br},${bg},${bb})`);
    ctx.fillStyle = grad;
    ctx.fillRect(
      Math.floor(seamCanvasX - halfBlend),
      topY,
      Math.ceil(blendZonePx) + 1,
      layerH,
    );
  }
}

export function drawSilhouetteLayer(
  ctx,
  strip,
  layerName,
  scrollX,
  playerX,
  viewW,
  skyHazeRgb,
) {
  const segments = strip.layerSegments[layerName];
  if (!segments?.length) return;

  const speed = PARALLAX_SPEED[layerName] ?? 1.0;
  const layerStripLeft = scrollX * speed - playerX;
  const band = strip.layers[layerName];
  if (!band) return;

  const { topY, bottomY } = band;
  const layerH = bottomY - topY;

  for (const segment of segments) {
    const samples = segment.topEdgeSamples;
    if (!samples) continue;
    const canvasX = segment.stripX - layerStripLeft;
    if (canvasX + segment.stripWidth < 0 || canvasX > viewW) continue;

    const width = samples.length;
    const haze = LAYER_HAZE[layerName] ?? 0;

    const drawPx = Math.ceil(segment.stripWidth);
    ctx.beginPath();
    ctx.moveTo(canvasX, bottomY);
    for (let i = 0; i < width && i <= drawPx; i += 1) {
      ctx.lineTo(canvasX + i, topY + samples[i] * layerH);
    }
    ctx.lineTo(canvasX + segment.stripWidth, bottomY);
    ctx.closePath();
    if (segment.isBlend && segment.colorA && segment.colorB && haze > 0) {
      ctx.save();
      ctx.clip();
      const slices = Math.max(2, Math.ceil(segment.stripWidth));
      const topA = tintRgbWithSky(segment.colorA, haze, skyHazeRgb);
      const topB = tintRgbWithSky(segment.colorB, haze, skyHazeRgb);
      for (let slice = 0; slice < slices; slice += 1) {
        const t0 = slice / slices;
        const t1 = (slice + 1) / slices;
        const tm = (slice + 0.5) / slices;
        const topColor = lerpRgb(topA, topB, tm);
        const bottomColor = lerpRgb(segment.colorA, segment.colorB, tm);
        const vGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
        vGrad.addColorStop(0, rgbCssFromArray(topColor));
        vGrad.addColorStop(1, rgbCssFromArray(bottomColor));
        ctx.fillStyle = vGrad;
        const x0 = canvasX + segment.stripWidth * t0;
        const w = Math.max(1, segment.stripWidth * (t1 - t0) + 0.75);
        ctx.fillRect(x0, topY, w, layerH + 1);
      }
      ctx.restore();
      continue;
    }

    let fillStyle;
    if (segment.isBlend && segment.colorA && segment.colorB) {
      const hGrad = ctx.createLinearGradient(
        canvasX,
        0,
        canvasX + segment.stripWidth,
        0,
      );
      hGrad.addColorStop(
        0,
        `rgb(${segment.colorA[0]},${segment.colorA[1]},${segment.colorA[2]})`,
      );
      hGrad.addColorStop(
        1,
        `rgb(${segment.colorB[0]},${segment.colorB[1]},${segment.colorB[2]})`,
      );
      fillStyle = hGrad;
    } else if (haze > 0 && segment.colorRgb) {
      const topColor = tintRgbWithSky(segment.colorRgb, haze, skyHazeRgb);
      const vGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
      vGrad.addColorStop(0, rgbCssFromArray(topColor));
      vGrad.addColorStop(1, segment.color);
      fillStyle = vGrad;
    } else {
      fillStyle = segment.color;
    }
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
}

export function drawGroundDetails(ctx, strip, scrollX, playerX, viewW) {
  const details = strip.groundDetails;
  if (!details?.length) return;
  const band = strip.layers.ground;
  if (!band) return;
  const layerH = Math.max(1, band.bottomY - band.topY);
  const topInsetPx = 2;
  const bottomInsetPx = 2;
  const usableY = Math.max(1, layerH - topInsetPx - bottomInsetPx);
  const layerStripLeft = scrollX * PARALLAX_SPEED.ground - playerX;

  for (const detail of details) {
    const canvasX = detail.stripX - layerStripLeft;
    if (canvasX < -24 || canvasX > viewW + 24) continue;
    const verticalFrac = clamp01(
      Number.isFinite(detail.verticalFrac) ? detail.verticalFrac : 0.5,
    );
    drawGroundDetailGlyph(
      ctx,
      canvasX,
      band.topY + topInsetPx + verticalFrac * usableY,
      detail,
    );
  }
}

export function drawGroundTrees(ctx, strip, scrollX, playerX, viewW) {
  const trees = strip.groundTrees;
  if (!trees?.length) return;
  const band = strip.layers.ground;
  if (!band) return;
  const layerH = Math.max(1, band.bottomY - band.topY);
  const topFifthHeight = Math.max(8, layerH * 0.2 - 2);
  const layerStripLeft = scrollX * PARALLAX_SPEED.ground - playerX;

  for (const tree of trees) {
    const canvasX = tree.stripX - layerStripLeft;
    if (canvasX < -120 || canvasX > viewW + 120) continue;
    const rootOffsetFrac = clamp01(
      Number.isFinite(tree.rootOffsetFrac) ? tree.rootOffsetFrac : 0.5,
    );
    const rootY = band.topY + 1 + rootOffsetFrac * topFifthHeight;
    drawJourneyTreeOnCanvas(ctx, canvasX, rootY, {
      treeFamily: tree.treeFamily,
      variantIndex: tree.variantIndex,
      heightPx: tree.heightPx,
      upwardOffsetPx: tree.upwardOffsetPx ?? 0,
    });
  }
}

export function drawForegroundCanopyTrees(
  ctx,
  strip,
  scrollX,
  playerX,
  viewW,
  viewH,
) {
  const trees = strip.foregroundTrees;
  if (!trees?.length) return;
  const layerStripLeft = scrollX * PARALLAX_SPEED.ground - playerX;

  for (const tree of trees) {
    const canvasX = tree.stripX - layerStripLeft;
    if (canvasX < -180 || canvasX > viewW + 180) continue;
    const sinkFrac = clamp01(
      Number.isFinite(tree.sinkFrac) ? tree.sinkFrac : 0.32,
    );
    const sinkPx = Math.max(8, tree.heightPx * sinkFrac);
    const rootY = viewH + sinkPx;
    drawJourneyTreeOnCanvas(ctx, canvasX, rootY, {
      treeFamily: tree.treeFamily,
      variantIndex: tree.variantIndex,
      heightPx: tree.heightPx,
      upwardOffsetPx: tree.upwardOffsetPx ?? 0,
    });
  }
}

export function drawNodeMarkers({
  ctx,
  strip,
  scrollX,
  playerX,
  groundTopY,
  playerFeetY,
  viewH,
  activeTravel,
  world,
}) {
  if (!activeTravel) {
    return {
      startMarkerCanvasX: null,
      destMarkerCanvasX: null,
    };
  }

  const speed = PARALLAX_SPEED.ground;
  const layerStripLeft = scrollX * speed - playerX;
  const markerY = groundTopY + Math.round((viewH - groundTopY) * 0.15);
  const nodes = world?.features?.nodes ?? [];

  const startCanvasX = strip.startMarkerStripX - layerStripLeft;
  const destCanvasX = strip.destMarkerStripX - layerStripLeft;
  const startNodeId = activeTravel?.startNodeId ?? null;
  const destNodeId = activeTravel?.targetNodeId ?? null;
  const startNode = startNodeId == null ? null : (nodes[startNodeId] ?? null);
  const destNode = destNodeId == null ? null : (nodes[destNodeId] ?? null);
  const startMarker = startNode?.marker ?? "settlement";
  const destMarker = destNode?.marker ?? "settlement";
  const startSignpost = startMarker === "signpost";
  const destSignpost = destMarker === "signpost";

  drawNodeMarkerOnCanvas(ctx, startCanvasX, markerY, {
    marker: startMarker,
    scale: NODE_MARKER_SCALE,
    highlighted: false,
    groundY: playerFeetY,
    variantSeed: startNode?.id ?? startNodeId ?? "start",
    minVisualHeightPx: startSignpost
      ? SIGNPOST_VISUAL_HEIGHT_PX
      : startMarker === "abandoned"
        ? ABANDONED_VISUAL_HEIGHT_PX
        : SETTLEMENT_VISUAL_HEIGHT_PX,
    verticalOffsetPx: startSignpost
      ? SIGNPOST_UPWARD_OFFSET_PX
      : startMarker === "abandoned"
        ? ABANDONED_UPWARD_OFFSET_PX
        : SETTLEMENT_UPWARD_OFFSET_PX,
  });
  drawNodeMarkerOnCanvas(ctx, destCanvasX, markerY, {
    marker: destMarker,
    scale: NODE_MARKER_SCALE,
    highlighted: true,
    groundY: playerFeetY,
    variantSeed: destNode?.id ?? destNodeId ?? "dest",
    minVisualHeightPx: destSignpost
      ? SIGNPOST_VISUAL_HEIGHT_PX
      : destMarker === "abandoned"
        ? ABANDONED_VISUAL_HEIGHT_PX
        : SETTLEMENT_VISUAL_HEIGHT_PX,
    verticalOffsetPx: destSignpost
      ? SIGNPOST_UPWARD_OFFSET_PX
      : destMarker === "abandoned"
        ? ABANDONED_UPWARD_OFFSET_PX
        : SETTLEMENT_UPWARD_OFFSET_PX,
  });

  return {
    startMarkerCanvasX: startCanvasX,
    destMarkerCanvasX: destCanvasX,
  };
}

export function drawTreeDecorationsForLayer(
  ctx,
  strip,
  layerName,
  scrollX,
  playerX,
  viewW,
) {
  const trees = strip.treeDecorations?.[layerName];
  if (!trees?.length) return;

  const speed = PARALLAX_SPEED[layerName] ?? 1.0;
  const layerStripLeft = scrollX * speed - playerX;
  const band = strip.layers[layerName];
  if (!band) return;

  const layerH = band.bottomY - band.topY;

  for (const tree of trees) {
    const canvasX = tree.stripX - layerStripLeft;
    if (canvasX < -96 || canvasX > viewW + 96) continue;
    if (!tree.topEdgeSamples?.length) continue;

    const sampleIndex = Math.max(
      0,
      Math.min(
        tree.topEdgeSamples.length - 1,
        Math.round(tree.stripX - tree.segmentStripX),
      ),
    );
    const topEdgeY = band.topY + tree.topEdgeSamples[sampleIndex] * layerH;
    const rootOffsetFrac = clamp01(
      Number.isFinite(tree.rootOffsetFrac)
        ? tree.rootOffsetFrac
        : layerName === "near2"
          ? 0.1
          : 0.16,
    );
    const desiredRootY = topEdgeY + rootOffsetFrac * layerH;
    const minRootY = band.topY + 1;
    const maxRootY = band.bottomY - 8;
    const treeGroundY = Math.min(maxRootY, Math.max(minRootY, desiredRootY));

    drawJourneyTreeOnCanvas(ctx, canvasX, treeGroundY, {
      treeFamily: tree.treeFamily,
      variantIndex: tree.variantIndex,
      heightPx: tree.heightPx,
      upwardOffsetPx: tree.upwardOffsetPx,
    });
  }
}

export function drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH) {
  const DEBUG_LAYER_COLOR = {
    far: "rgba(255, 106, 148, 0.85)",
    mid: "rgba(255, 196,  84, 0.85)",
    near2: "rgba( 80, 220,  80, 0.85)",
    near1: "rgba( 80, 200, 255, 0.85)",
    ground: "rgba(255, 255, 255, 0.60)",
    foreground: "rgba(255, 220, 100, 0.60)",
  };

  ctx.save();
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";

  for (const [layerName, debugColor] of Object.entries(DEBUG_LAYER_COLOR)) {
    const speed = PARALLAX_SPEED[layerName] ?? 1.0;
    const layerStripLeft = scrollX * speed - playerX;
    const band = strip.layers[layerName];
    const segments = strip.layerSegments[layerName];
    if (!band || !segments?.length) continue;

    const { topY, bottomY } = band;

    ctx.strokeStyle = debugColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    for (const segment of segments) {
      if (segment.isBlend) continue;
      const cx = Math.round(segment.stripX - layerStripLeft) + 0.5;
      if (cx < -4 || cx > viewW + 4) continue;

      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(cx, bottomY);
      ctx.stroke();

      if (cx > 2 && cx < viewW - 4) {
        ctx.fillStyle = debugColor;
        ctx.fillText(segment.biomeKey ?? "?", cx + 2, topY + 2);
      }
    }
  }

  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.40)";
  const groundSpeed = PARALLAX_SPEED.ground;
  const groundStripLeft = scrollX * groundSpeed - playerX;

  for (const [label, stripX] of [
    ["start", strip.startMarkerStripX],
    ["dest", strip.destMarkerStripX],
  ]) {
    const cx = Math.round(stripX - groundStripLeft) + 0.5;
    if (cx < -4 || cx > viewW + 4) continue;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, viewH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.font = "10px monospace";
    ctx.textBaseline = "top";
    ctx.fillText(label, cx + 3, 4);
    ctx.setLineDash([6, 5]);
  }

  ctx.restore();
}

function drawGroundDetailGlyph(ctx, x, y, detail) {
  const scale = Math.max(0.65, Number(detail.scale ?? 1));
  const motif = detail.motif;
  const isSnow = Boolean(detail.isSnow);
  ctx.save();
  switch (motif) {
    case "tuft":
    case "frost-tuft": {
      ctx.strokeStyle =
        motif === "frost-tuft"
          ? "rgba(223,230,236,0.92)"
          : "rgba(70,98,56,0.86)";
      ctx.lineWidth = Math.max(1, 1.05 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 2.6 * scale, y);
      ctx.lineTo(x - 0.8 * scale, y - 4.8 * scale);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 6.1 * scale);
      ctx.moveTo(x + 2.6 * scale, y);
      ctx.lineTo(x + 0.9 * scale, y - 4.5 * scale);
      ctx.stroke();
      break;
    }
    case "stone":
    case "pebble": {
      ctx.fillStyle = isSnow
        ? "rgba(178,179,182,0.8)"
        : "rgba(118,108,96,0.78)";
      const rx = (motif === "pebble" ? 1.8 : 2.7) * scale;
      const ry = (motif === "pebble" ? 1.2 : 1.9) * scale;
      ctx.beginPath();
      ctx.ellipse(x, y - ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "stick":
    case "drift": {
      ctx.strokeStyle =
        motif === "drift" ? "rgba(132,98,64,0.7)" : "rgba(98,74,52,0.76)";
      ctx.lineWidth = Math.max(1, 1.2 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 3 * scale, y - 0.8 * scale);
      ctx.lineTo(x + 3.2 * scale, y - 1.8 * scale);
      ctx.stroke();
      break;
    }
    case "leaf": {
      ctx.fillStyle = "rgba(82,114,62,0.75)";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y - 1.5 * scale,
        2.4 * scale,
        1.6 * scale,
        -0.25,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }
    case "flower": {
      ctx.fillStyle = "rgba(241,216,124,0.84)";
      ctx.beginPath();
      ctx.arc(x, y - 2.2 * scale, 1.4 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "snow-dune": {
      ctx.fillStyle = "rgba(244,245,247,0.88)";
      ctx.beginPath();
      ctx.ellipse(x, y - 0.9 * scale, 4.2 * scale, 2.1 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "sand-dune": {
      ctx.fillStyle = "rgba(209,182,126,0.76)";
      ctx.beginPath();
      ctx.ellipse(x, y - 1 * scale, 4.1 * scale, 2.0 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "foam": {
      ctx.strokeStyle = "rgba(234,241,247,0.68)";
      ctx.lineWidth = Math.max(1, 1.2 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 3.2 * scale, y - 1.4 * scale);
      ctx.lineTo(x + 3.2 * scale, y - 1.4 * scale);
      ctx.stroke();
      break;
    }
    default:
      ctx.fillStyle = isSnow
        ? "rgba(188,190,194,0.7)"
        : "rgba(92,104,82,0.72)";
      ctx.fillRect(
        Math.round(x - scale),
        Math.round(y - scale),
        Math.max(1, Math.round(2 * scale)),
        Math.max(1, Math.round(2 * scale)),
      );
      break;
  }
  ctx.restore();
}
