import { PARALLAX_SPEED } from "./journeyStrip";
import {
  drawJourneyTreeOnCanvas,
  drawNodeMarkerOnCanvas,
} from "./journeyStyle";
import {
  clamp01,
  lerpRgb,
  rgbCssFromArray,
  tintRgbWithSky,
} from "./journeySceneMath";

const NODE_MARKER_SCALE = 1.35;
const SETTLEMENT_VISUAL_HEIGHT_PX = 472;
const ABANDONED_VISUAL_HEIGHT_PX = 216;
const SETTLEMENT_UPWARD_OFFSET_PX = 30;
const ABANDONED_UPWARD_OFFSET_PX = 13;
const SIGNPOST_VISUAL_HEIGHT_PX = 104;
const SIGNPOST_UPWARD_OFFSET_PX = 18;
const DEST_MARKER_RENDER_LAG_PX = 24;
const DEST_MARKER_REVEAL_PROGRESS = 0.08;
const WATER_BIOMES = new Set(["ocean", "lake"]);

const LAYER_HAZE = {
  far: 0.42,
  mid: 0.2,
  near2: 0.07,
  near1: 0,
  foreground: 0,
};
const TREE_DECOR_RENDER_CONFIG = Object.freeze({
  far: Object.freeze({
    cullPaddingPx: 64,
    defaultRootOffsetFrac: 0.08,
    preferFallback: true,
    alpha: 0.74,
  }),
  mid: Object.freeze({
    cullPaddingPx: 78,
    defaultRootOffsetFrac: 0.1,
    preferFallback: true,
    alpha: 0.82,
  }),
  near2: Object.freeze({
    cullPaddingPx: 96,
    defaultRootOffsetFrac: 0.1,
    preferFallback: false,
    alpha: 1,
  }),
  near1: Object.freeze({
    cullPaddingPx: 104,
    defaultRootOffsetFrac: 0.16,
    preferFallback: false,
    alpha: 1,
  }),
});
const LAYER_TOP_RIM = Object.freeze({
  far: Object.freeze({ lineWidthPx: 1.1, alpha: 0.36, haze: 0.52, lift: 0.34 }),
  mid: Object.freeze({ lineWidthPx: 1.15, alpha: 0.41, haze: 0.46, lift: 0.36 }),
  near2: Object.freeze({ lineWidthPx: 1.22, alpha: 0.44, haze: 0.36, lift: 0.38 }),
  near1: Object.freeze({ lineWidthPx: 1.28, alpha: 0.48, haze: 0.28, lift: 0.4 }),
});

export function drawGroundLayer(ctx, strip, scrollX, playerX, viewW) {
  const speed = PARALLAX_SPEED.ground;
  const layerStripLeft = scrollX * speed - playerX;
  const { topY, bottomY } = strip.layers.ground;
  const layerH = bottomY - topY;
  const segments = strip.layerSegments.ground;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (isWaterBiome(segment.biomeKey)) continue;
    const canvasX = segment.stripX - layerStripLeft;
    if (canvasX + segment.stripWidth < 0 || canvasX > viewW) continue;
    drawGroundLandSegment(ctx, {
      leftX: Math.floor(canvasX),
      rightX: Math.floor(canvasX) + Math.ceil(segment.stripWidth) + 1,
      topY,
      bottomY,
      color: segment.color,
      leftWater: isWaterBiome(segments[index - 1]?.biomeKey),
      rightWater: isWaterBiome(segments[index + 1]?.biomeKey),
    });
  }

  const blendZonePx = strip.blendZonePx ?? 48;
  const halfBlend = blendZonePx / 2;
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const a = segments[index];
    const b = segments[index + 1];
    if (!a.colorRgb || !b.colorRgb) continue;
    if (
      a.biomeKey === b.biomeKey &&
      Boolean(a.isSnow) === Boolean(b.isSnow)
    ) {
      continue;
    }
    if (isWaterBiome(a.biomeKey) || isWaterBiome(b.biomeKey)) continue;
    if (isWaterLandGroundBoundary(a.biomeKey, b.biomeKey)) continue;
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

function isWaterLandGroundBoundary(aBiomeKey, bBiomeKey) {
  const aIsWater = WATER_BIOMES.has(aBiomeKey);
  const bIsWater = WATER_BIOMES.has(bBiomeKey);
  return aIsWater !== bIsWater;
}

function isWaterBiome(biomeKey) {
  return WATER_BIOMES.has(biomeKey);
}

function drawGroundLandSegment(
  ctx,
  { leftX, rightX, topY, bottomY, color, leftWater, rightWater },
) {
  const width = Math.max(1, rightX - leftX);
  const layerH = Math.max(1, bottomY - topY);
  const centerY = topY + layerH * 0.5;
  // Water cut-in must match ground height: full diameter == layer height.
  const baseRadius = layerH * 0.5;
  let leftRadius = leftWater ? baseRadius : 0;
  let rightRadius = rightWater ? baseRadius : 0;
  const totalRadius = leftRadius + rightRadius;
  // Safety clamp only when both sides are carved and the segment is too narrow.
  const maxTotalRadius = width * 0.9;
  if (leftRadius > 0 && rightRadius > 0 && totalRadius > maxTotalRadius) {
    const scale = maxTotalRadius / totalRadius;
    leftRadius *= scale;
    rightRadius *= scale;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(leftX, topY);
  ctx.lineTo(rightX, topY);
  if (rightRadius > 0.01) {
    // Water on the right: carve a concave half-circle into the land edge.
    ctx.arc(rightX, centerY, rightRadius, -Math.PI / 2, Math.PI / 2, true);
  } else {
    ctx.lineTo(rightX, bottomY);
  }
  ctx.lineTo(leftX, bottomY);
  if (leftRadius > 0.01) {
    // Water on the left: mirrored concave half-circle.
    ctx.arc(leftX, centerY, leftRadius, Math.PI / 2, -Math.PI / 2, true);
  } else {
    ctx.lineTo(leftX, topY);
  }
  ctx.closePath();
  ctx.fill();
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
    if (isWaterSilhouetteSegment(segment)) continue;
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

    drawSilhouetteTopRim(
      ctx,
      segment,
      layerName,
      canvasX,
      topY,
      layerH,
      skyHazeRgb,
    );
  }
}

function isWaterSilhouetteSegment(segment) {
  if (!segment) {
    return false;
  }
  if (segment.isBlend) {
    return (
      isWaterBiome(segment.biomeKeyA) ||
      isWaterBiome(segment.biomeKeyB)
    );
  }
  return isWaterBiome(segment.biomeKey);
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

export function drawDepartureFoothold(
  ctx,
  strip,
  scrollX,
  playerX,
  groundTopY,
  playerFeetY,
  travelProgressWorld,
) {
  if (!strip?.layerSegments?.ground?.length) return;
  if (!Number.isFinite(travelProgressWorld)) return;

  const fadeDistanceWorld = 2.4;
  const fadeT = clamp01(travelProgressWorld / fadeDistanceWorld);
  if (fadeT >= 1) return;

  const playerStripX = scrollX;
  const underfoot = findGroundSegmentAtStripX(
    strip.layerSegments.ground,
    playerStripX,
  );
  if (!underfoot || !isWaterBiome(underfoot.biomeKey)) return;

  const nearbyLand = findNearestLandSegment(strip.layerSegments.ground, playerStripX);
  const baseRgb = nearbyLand?.colorRgb ?? [152, 132, 102];
  const litRgb = lerpRgb(baseRgb, [210, 182, 136], 0.24);
  const shadowRgb = lerpRgb(baseRgb, [78, 66, 52], 0.4);
  const alpha = (1 - fadeT) * 0.64;

  const width = 78 + (1 - fadeT) * 24;
  const height = Math.max(12, (playerFeetY - groundTopY) * 0.24);
  const centerX = playerX - 6;
  const topY = groundTopY + Math.max(7, (playerFeetY - groundTopY) * 0.2);

  ctx.save();
  ctx.fillStyle = `rgba(${Math.round(shadowRgb[0])}, ${Math.round(shadowRgb[1])}, ${Math.round(shadowRgb[2])}, ${alpha * 0.52})`;
  ctx.beginPath();
  ctx.moveTo(centerX - width * 0.54, topY + height * 0.75);
  ctx.quadraticCurveTo(centerX - width * 0.26, topY - height * 0.12, centerX, topY + height * 0.12);
  ctx.quadraticCurveTo(centerX + width * 0.27, topY + height * 0.28, centerX + width * 0.56, topY + height * 0.8);
  ctx.lineTo(centerX + width * 0.56, topY + height * 1.32);
  ctx.lineTo(centerX - width * 0.54, topY + height * 1.32);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = `rgba(${Math.round(litRgb[0])}, ${Math.round(litRgb[1])}, ${Math.round(litRgb[2])}, ${alpha * 0.62})`;
  ctx.beginPath();
  ctx.moveTo(centerX - width * 0.46, topY + height * 0.76);
  ctx.quadraticCurveTo(centerX - width * 0.18, topY + height * 0.1, centerX + width * 0.1, topY + height * 0.26);
  ctx.quadraticCurveTo(centerX + width * 0.3, topY + height * 0.4, centerX + width * 0.46, topY + height * 0.83);
  ctx.lineTo(centerX + width * 0.46, topY + height * 1.13);
  ctx.lineTo(centerX - width * 0.46, topY + height * 1.13);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
  travelProgress,
  travelTotalLength,
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
  const baseDestCanvasX = strip.destMarkerStripX - layerStripLeft;
  const isTraveling =
    Number.isFinite(travelProgress) &&
    Number.isFinite(travelTotalLength) &&
    travelTotalLength > 0;
  const progressRatio = isTraveling
    ? clamp01(travelProgress / travelTotalLength)
    : 1;
  const showDestMarker =
    (activeTravel?.routeType !== "idle-preview") &&
    (!isTraveling || progressRatio >= DEST_MARKER_REVEAL_PROGRESS);
  const travelLagPx = isTraveling
    ? DEST_MARKER_RENDER_LAG_PX * (1 - progressRatio)
    : 0;
  const destCanvasX = isTraveling
    ? baseDestCanvasX + travelLagPx
    : baseDestCanvasX;
  const startNodeId = activeTravel?.startNodeId ?? null;
  const destNodeId = activeTravel?.targetNodeId ?? null;
  const startNode = startNodeId == null ? null : (nodes[startNodeId] ?? null);
  const destNode = destNodeId == null ? null : (nodes[destNodeId] ?? null);
  const startMarker = startNode?.marker ?? "settlement";
  const destMarker = destNode?.marker ?? "settlement";
  const startSignpost = startMarker === "signpost";
  const destSignpost = destMarker === "signpost";
  const startRenderStripX = startCanvasX + layerStripLeft;
  const destRenderStripX = destCanvasX + layerStripLeft;

  drawNodeLandSockel(
    ctx,
    strip,
    startRenderStripX,
    startCanvasX,
    groundTopY,
    playerFeetY,
  );
  if (showDestMarker) {
    drawNodeLandSockel(
      ctx,
      strip,
      destRenderStripX,
      destCanvasX,
      groundTopY,
      playerFeetY,
    );
  }

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
  if (showDestMarker) {
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
  }

  return {
    startMarkerCanvasX: startCanvasX,
    destMarkerCanvasX: showDestMarker ? destCanvasX : null,
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
  const renderConfig =
    TREE_DECOR_RENDER_CONFIG[layerName] ?? TREE_DECOR_RENDER_CONFIG.near2;

  const speed = PARALLAX_SPEED[layerName] ?? 1.0;
  const layerStripLeft = scrollX * speed - playerX;
  const band = strip.layers[layerName];
  if (!band) return;

  const layerH = band.bottomY - band.topY;
  const cullPaddingPx = Math.max(0, Number(renderConfig.cullPaddingPx ?? 96));
  const defaultRootOffsetFrac = clamp01(
    Number(renderConfig.defaultRootOffsetFrac ?? 0.12),
  );
  const treeAlpha = clamp01(Number(renderConfig.alpha ?? 1));

  for (const tree of trees) {
    const canvasX = tree.stripX - layerStripLeft;
    if (canvasX < -cullPaddingPx || canvasX > viewW + cullPaddingPx) continue;

    const topEdgeSample = resolveTreeTopEdgeSample(tree);
    const topEdgeY = band.topY + clamp01(topEdgeSample) * layerH;
    const rootOffsetFrac = clamp01(
      Number.isFinite(tree.rootOffsetFrac)
        ? tree.rootOffsetFrac
        : defaultRootOffsetFrac,
    );
    const downwardOffsetPx = Math.max(
      0,
      Number.isFinite(tree.downwardOffsetPx) ? tree.downwardOffsetPx : 0,
    );
    const desiredRootY =
      topEdgeY + rootOffsetFrac * layerH + downwardOffsetPx;
    const minRootY = band.topY + 1;
    const maxRootY = band.bottomY - 8;
    const treeGroundY = Math.min(maxRootY, Math.max(minRootY, desiredRootY));

    drawJourneyTreeOnCanvas(ctx, canvasX, treeGroundY, {
      treeFamily: tree.treeFamily,
      variantIndex: tree.variantIndex,
      heightPx: tree.heightPx,
      upwardOffsetPx: tree.upwardOffsetPx,
      preferFallback: Boolean(renderConfig.preferFallback),
      alpha: treeAlpha,
    });
  }
}

function resolveTreeTopEdgeSample(tree) {
  if (Number.isFinite(tree?.topEdgeSample)) {
    return tree.topEdgeSample;
  }
  if (!tree?.topEdgeSamples?.length) {
    return 1;
  }
  const sampleIndex = Math.max(
    0,
    Math.min(
      tree.topEdgeSamples.length - 1,
      Math.round((tree.stripX ?? 0) - (tree.segmentStripX ?? tree.stripX ?? 0)),
    ),
  );
  return tree.topEdgeSamples[sampleIndex] ?? 1;
}

function drawSilhouetteTopRim(
  ctx,
  segment,
  layerName,
  canvasX,
  topY,
  layerH,
  skyHazeRgb,
) {
  const config = LAYER_TOP_RIM[layerName];
  if (!config || !segment?.topEdgeSamples?.length) return;

  const samples = segment.topEdgeSamples;
  const drawPx = Math.ceil(segment.stripWidth);
  const colorRgb = resolveSilhouetteSegmentBaseColor(segment);
  const hazedColor = tintRgbWithSky(colorRgb, config.haze, skyHazeRgb);
  const rimColor = lerpRgb(hazedColor, [255, 255, 255], config.lift);

  ctx.save();
  ctx.strokeStyle = `rgba(${Math.round(rimColor[0])}, ${Math.round(rimColor[1])}, ${Math.round(rimColor[2])}, ${config.alpha})`;
  ctx.lineWidth = config.lineWidthPx;
  ctx.beginPath();
  ctx.moveTo(canvasX, topY + samples[0] * layerH);
  for (let index = 1; index < samples.length && index <= drawPx; index += 1) {
    ctx.lineTo(canvasX + index, topY + samples[index] * layerH);
  }
  ctx.stroke();
  ctx.restore();
}

function resolveSilhouetteSegmentBaseColor(segment) {
  if (segment?.colorRgb?.length === 3) {
    return segment.colorRgb;
  }
  if (segment?.isBlend && segment.colorA && segment.colorB) {
    return lerpRgb(segment.colorA, segment.colorB, 0.5);
  }
  return [128, 128, 128];
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
    case "branch": {
      ctx.strokeStyle = "rgba(96,71,48,0.8)";
      ctx.lineWidth = Math.max(1, 1.15 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 3.2 * scale, y - 1.3 * scale);
      ctx.lineTo(x + 3.4 * scale, y - 2.1 * scale);
      ctx.moveTo(x - 0.2 * scale, y - 1.7 * scale);
      ctx.lineTo(x - 1.7 * scale, y - 4.2 * scale);
      ctx.moveTo(x + 1.3 * scale, y - 1.95 * scale);
      ctx.lineTo(x + 2.8 * scale, y - 3.9 * scale);
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
    case "grass-clump": {
      ctx.strokeStyle = "rgba(78,109,62,0.84)";
      ctx.lineWidth = Math.max(1, 1.05 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 3 * scale, y);
      ctx.lineTo(x - 1.8 * scale, y - 4.8 * scale);
      ctx.moveTo(x - 1 * scale, y);
      ctx.lineTo(x - 0.3 * scale, y - 6.2 * scale);
      ctx.moveTo(x + 0.6 * scale, y);
      ctx.lineTo(x + 0.8 * scale, y - 6.1 * scale);
      ctx.moveTo(x + 2.4 * scale, y);
      ctx.lineTo(x + 1.7 * scale, y - 4.9 * scale);
      ctx.stroke();
      break;
    }
    case "flower": {
      ctx.fillStyle = "rgba(241,216,124,0.84)";
      ctx.beginPath();
      ctx.arc(x, y - 2.2 * scale, 1.4 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "scree": {
      ctx.fillStyle = isSnow
        ? "rgba(188,192,198,0.76)"
        : "rgba(112,104,96,0.78)";
      ctx.beginPath();
      ctx.ellipse(x - 2.1 * scale, y - 0.8 * scale, 1.4 * scale, 1.0 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x, y - 1.2 * scale, 1.7 * scale, 1.1 * scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 2.2 * scale, y - 0.6 * scale, 1.5 * scale, 1.0 * scale, 0, 0, Math.PI * 2);
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
    case "dune-ripple": {
      ctx.strokeStyle = "rgba(182,152,102,0.72)";
      ctx.lineWidth = Math.max(1, 1.05 * scale);
      for (let i = 0; i < 3; i += 1) {
        const yy = y - (1.9 - i * 1.25) * scale;
        ctx.beginPath();
        ctx.moveTo(x - 3.2 * scale, yy);
        ctx.quadraticCurveTo(x, yy - 1.1 * scale, x + 3.2 * scale, yy);
        ctx.stroke();
      }
      break;
    }
    case "ice-shard": {
      ctx.fillStyle = "rgba(210,229,246,0.82)";
      ctx.beginPath();
      ctx.moveTo(x - 1.2 * scale, y - 0.6 * scale);
      ctx.lineTo(x + 0.2 * scale, y - 5.8 * scale);
      ctx.lineTo(x + 1.5 * scale, y - 0.4 * scale);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "reed": {
      ctx.strokeStyle = "rgba(116,141,102,0.82)";
      ctx.lineWidth = Math.max(1, 1.0 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 1.8 * scale, y);
      ctx.lineTo(x - 1.8 * scale, y - 6.2 * scale);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 7.4 * scale);
      ctx.moveTo(x + 1.9 * scale, y);
      ctx.lineTo(x + 1.9 * scale, y - 5.8 * scale);
      ctx.stroke();
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
    case "wave-ripple": {
      ctx.strokeStyle = "rgba(226,238,247,0.72)";
      ctx.lineWidth = Math.max(1, 1.1 * scale);
      ctx.beginPath();
      ctx.moveTo(x - 4 * scale, y - 1.5 * scale);
      ctx.quadraticCurveTo(x - 2.1 * scale, y - 3.2 * scale, x, y - 1.5 * scale);
      ctx.quadraticCurveTo(x + 2.1 * scale, y + 0.2 * scale, x + 4 * scale, y - 1.5 * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 3.1 * scale, y + 0.25 * scale);
      ctx.quadraticCurveTo(x - 1.4 * scale, y - 1.05 * scale, x + 0.3 * scale, y + 0.2 * scale);
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

function findGroundSegmentAtStripX(segments, stripX) {
  if (!segments?.length || !Number.isFinite(stripX)) return null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment.isBlend) continue;
    const start = segment.stripX;
    const end = segment.stripX + segment.stripWidth;
    const isLast = index === segments.length - 1;
    if (stripX >= start && (stripX < end || (isLast && stripX <= end))) {
      return segment;
    }
  }
  if (stripX < segments[0].stripX) return segments[0];
  return segments[segments.length - 1];
}

function findNearestLandSegment(segments, stripX) {
  if (!segments?.length || !Number.isFinite(stripX)) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    if (!segment || segment.isBlend || isWaterBiome(segment.biomeKey)) continue;
    const center = segment.stripX + segment.stripWidth * 0.5;
    const distance = Math.abs(center - stripX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = segment;
    }
  }
  return best;
}

function drawNodeLandSockel(
  ctx,
  strip,
  markerStripX,
  markerCanvasX,
  groundTopY,
  playerFeetY,
) {
  if (!strip?.layerSegments?.ground?.length) return;
  if (!Number.isFinite(markerStripX) || !Number.isFinite(markerCanvasX)) return;

  const groundSegments = strip.layerSegments.ground;
  const underfoot = findGroundSegmentAtStripX(groundSegments, markerStripX);
  if (!underfoot || !isWaterBiome(underfoot.biomeKey)) return;

  const nearbyLand = findNearestLandSegment(groundSegments, markerStripX);
  const baseRgb = nearbyLand?.colorRgb ?? [152, 132, 102];
  const litRgb = lerpRgb(baseRgb, [212, 188, 146], 0.28);
  const shadowRgb = lerpRgb(baseRgb, [78, 64, 48], 0.4);

  const width = 96;
  const height = Math.max(14, (playerFeetY - groundTopY) * 0.24);
  const topY = groundTopY + Math.max(6, (playerFeetY - groundTopY) * 0.18);

  ctx.save();
  ctx.fillStyle = `rgba(${Math.round(shadowRgb[0])}, ${Math.round(shadowRgb[1])}, ${Math.round(shadowRgb[2])}, 0.58)`;
  ctx.beginPath();
  ctx.ellipse(
    markerCanvasX,
    topY + height * 0.95,
    width * 0.52,
    height * 0.58,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.fillStyle = `rgba(${Math.round(litRgb[0])}, ${Math.round(litRgb[1])}, ${Math.round(litRgb[2])}, 0.7)`;
  ctx.beginPath();
  ctx.ellipse(
    markerCanvasX,
    topY + height * 0.88,
    width * 0.42,
    height * 0.44,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
