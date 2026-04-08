import {
  normalizeBiomeKey,
  getBiomeLayerColorRgb,
  buildSilhouetteTopEdge,
  sampleSilhouetteAtX,
  rgbToCss,
} from "./journeyStyle.js";
import {
  JOURNEY_LAYOUT,
  PARALLAX_SPEED,
  PLAYER_X_FRAC,
  TRAVEL_BIOME_BANDS,
} from "./journeyConstants.js";

// ---------------------------------------------------------------------------
// Fixed offsets for parallel sampling lines (world-space units).
// These are HARDCODED and must not depend on travel length, zoom, or scale.
// ---------------------------------------------------------------------------
const MID_OFFSET_WORLD = TRAVEL_BIOME_BANDS.mid;
const FAR_OFFSET_WORLD = TRAVEL_BIOME_BANDS.far;

// Pixels per world unit – the canonical scroll mapping.
// One world unit of travel = this many pixels of strip scrolling.
const PX_PER_WORLD = 140;

// How many world-units to extend the strip before and after the route.
const ROUTE_EXTENSION_WORLD = 4;

// Transition blend zone in pixels
const BLEND_ZONE_PX = 48;
const EXTENSION_PADDING_PX = 32;

const LAYER_APPEND_PLAN = [
  { layerName: "ground", sourceBand: "near" },
  { layerName: "foreground", sourceBand: "near" },
  { layerName: "near1", sourceBand: "near" },
  { layerName: "near2", sourceBand: "near" },
  { layerName: "mid", sourceBand: "mid" },
  { layerName: "far", sourceBand: "far" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full precomputed journey strip for a given travel.
 *
 * @param {object} travel      – playState.travel (has startCityId, targetCityId,
 *                               points, segmentLengths, totalLength, biomeBandSegments)
 * @param {number} viewW       – canvas viewport width in pixels
 * @param {number} viewH       – canvas viewport height in pixels
 * @returns {JourneyStrip}
 */
export function buildJourneyStrip(travel, viewW, viewH) {
  if (!travel) {
    return createEmptyStrip();
  }

  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;
  const { extBeforePx, extAfterPx } = computeExtensionBounds(viewW);
  const totalStripPx = Math.ceil(extBeforePx + routePx + extAfterPx);

  const startMarkerStripX = extBeforePx;
  const destMarkerStripX = extBeforePx + routePx;

  const layers = buildLayerBands(viewH);
  const pixelBands = buildPixelBandsForFullRoute(
    travel,
    extBeforePx,
    extAfterPx,
  );
  const layerSegments = buildAllLayerSegments(pixelBands);

  return {
    totalStripPx,
    extBeforePx,
    routePx,
    pxPerWorld: PX_PER_WORLD,
    startMarkerStripX,
    destMarkerStripX,
    layers,
    layerSegments,
    blendZonePx: BLEND_ZONE_PX,
  };
}

// ---------------------------------------------------------------------------
// Extend an existing strip in-place with a new journey leg.
// All new segments are appended to the right of the current destMarkerStripX.
// The camera scrollX is continuous – no discontinuity at the seam.
// ---------------------------------------------------------------------------

/**
 * Append segments for a new travel onto an already-built strip.
 * Mutates the strip in-place and returns it.
 */
export function extendStripWithTravel(strip, travel, viewW) {
  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;
  const { extAfterPx } = computeExtensionBounds(viewW);

  const newStartX = strip.destMarkerStripX;
  const newDestX = newStartX + routePx;

  const pixelBands = buildPixelBandsFromStart(
    travel,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
  );
  appendPixelBandsToStrip(strip, pixelBands);

  strip.startMarkerStripX = newStartX;
  strip.destMarkerStripX = newDestX;
  strip.totalStripPx = Math.ceil(newDestX + extAfterPx);

  return strip;
}

function computeExtensionBounds(viewW) {
  const farSpeed = PARALLAX_SPEED.far;
  const playerX = viewW * PLAYER_X_FRAC;
  const minRouteExtension = ROUTE_EXTENSION_WORLD * PX_PER_WORLD;

  const minExtBefore =
    Math.ceil(playerX * (1 / farSpeed - 1) + viewW / 2) +
    EXTENSION_PADDING_PX;
  const minExtAfter =
    Math.ceil(
      playerX * (1 - 1 / farSpeed) + viewW * (1 / farSpeed - 0.5),
    ) + EXTENSION_PADDING_PX;

  return {
    extBeforePx: Math.max(minRouteExtension, minExtBefore),
    extAfterPx: Math.max(minRouteExtension, minExtAfter),
  };
}

function buildLayerBands(viewH) {
  const groundTopY = Math.round(viewH * JOURNEY_LAYOUT.groundTopFrac);
  const groundBottomY = viewH;
  const silhouetteZoneTop = Math.round(
    viewH * JOURNEY_LAYOUT.silhouetteZoneTopFrac,
  );
  const silhouetteZoneH = groundTopY - silhouetteZoneTop;
  const sliceH = Math.round(silhouetteZoneH / 4);
  const near1Top = groundTopY - sliceH;
  const near2Top = groundTopY - sliceH * 2;
  const midTop = groundTopY - sliceH * 3;
  const farTop = silhouetteZoneTop;
  const silhouetteBottom =
    groundTopY + JOURNEY_LAYOUT.silhouetteBottomOverlapPx;

  return {
    ground: { topY: groundTopY, bottomY: groundBottomY },
    foreground: {
      topY: Math.round(viewH * JOURNEY_LAYOUT.foregroundTopFrac),
      bottomY: groundBottomY,
    },
    near1: { topY: near1Top, bottomY: silhouetteBottom },
    near2: { topY: near2Top, bottomY: silhouetteBottom },
    mid: { topY: midTop, bottomY: silhouetteBottom },
    far: { topY: farTop, bottomY: silhouetteBottom },
  };
}

function buildPixelBandsForFullRoute(travel, extBeforePx, extAfterPx) {
  return {
    near: buildNearSegments(travel, extBeforePx, extAfterPx),
    mid: buildOffsetSegments(travel, extBeforePx, extAfterPx, MID_OFFSET_WORLD),
    far: buildOffsetSegments(travel, extBeforePx, extAfterPx, FAR_OFFSET_WORLD),
  };
}

function buildPixelBandsFromStart(
  travel,
  startX,
  totalWorldLength,
  routePx,
  extAfterPx,
) {
  return {
    near: expandFromStartX(
      getRawBandSegments(travel, "near"),
      startX,
      totalWorldLength,
      routePx,
      extAfterPx,
    ),
    mid: expandFromStartX(
      getRawBandSegments(travel, "mid"),
      startX,
      totalWorldLength,
      routePx,
      extAfterPx,
    ),
    far: expandFromStartX(
      getRawBandSegments(travel, "far"),
      startX,
      totalWorldLength,
      routePx,
      extAfterPx,
    ),
  };
}

function getRawBandSegments(travel, bandName) {
  const nearSegs =
    travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];
  if (bandName === "mid") {
    return travel.biomeBandSegments?.mid?.segments?.length
      ? travel.biomeBandSegments.mid.segments
      : nearSegs;
  }
  if (bandName === "far") {
    return travel.biomeBandSegments?.far?.segments?.length
      ? travel.biomeBandSegments.far.segments
      : nearSegs;
  }
  return nearSegs;
}

function buildAllLayerSegments(pixelBands) {
  const layerSegments = {};
  for (const plan of LAYER_APPEND_PLAN) {
    const sourceBand = pixelBands[plan.sourceBand] ?? [];
    const layerSpeed = getLayerSpeed(plan.layerName);
    const scaledSegs =
      layerSpeed === 1 ? sourceBand : scaleSegments(sourceBand, layerSpeed);
    layerSegments[plan.layerName] = buildLayerSegments(
      scaledSegs,
      plan.layerName,
    );
  }
  return layerSegments;
}

function appendPixelBandsToStrip(strip, pixelBands) {
  const cutGround = strip.destMarkerStripX;

  for (const plan of LAYER_APPEND_PLAN) {
    const cutX = cutGround * getLayerSpeed(plan.layerName);
    truncateLayerAtX(strip.layerSegments[plan.layerName], cutX);
  }

  for (const plan of LAYER_APPEND_PLAN) {
    const sourceBand = pixelBands[plan.sourceBand] ?? [];
    appendLayerSegs(
      strip.layerSegments[plan.layerName],
      sourceBand,
      plan.layerName,
      getLayerSpeed(plan.layerName),
    );
  }
}

function getLayerSpeed(layerName) {
  return PARALLAX_SPEED[layerName] ?? 1.0;
}

// Build pixel-space segments starting from startX (no before-extension).
function expandFromStartX(
  rawSegs,
  startX,
  totalWorldLength,
  routePx,
  extAfterPx,
) {
  const result = [];
  const firstBiome = normalizeBiomeKey(rawSegs[0]?.biome) ?? "plains";
  const lastBiome =
    normalizeBiomeKey(rawSegs[rawSegs.length - 1]?.biome) ?? firstBiome;
  let cursor = startX;

  if (rawSegs.length && totalWorldLength > 0.0001) {
    for (const seg of rawSegs) {
      const biomeKey = normalizeBiomeKey(seg.biome) ?? firstBiome;
      const px = Math.max(1, (seg.distance / totalWorldLength) * routePx);
      result.push({ biomeKey, stripX: cursor, stripWidth: px });
      cursor += px;
    }
  } else {
    result.push({
      biomeKey: firstBiome,
      stripX: cursor,
      stripWidth: Math.max(1, routePx),
    });
    cursor += Math.max(1, routePx);
  }

  if (extAfterPx > 0) {
    result.push({
      biomeKey: lastBiome,
      stripX: cursor,
      stripWidth: extAfterPx,
    });
  }

  return mergeAdjacentSegments(result);
}

// Append fully-built layer segments (with color + silhouette) onto an array.
function appendLayerSegs(target, pixelSegs, layerDepth, speedScale = 1.0) {
  // Scale pixel positions into layer-space so biome transitions stay
  // visually synchronised with ground-speed transitions at all progress values.
  const scaledSegs =
    speedScale !== 1.0 ? scaleSegments(pixelSegs, speedScale) : pixelSegs;

  let newSegs = scaledSegs.map((seg) => {
    const biomeKey = seg.biomeKey ?? "plains";
    const colorRgb = getBiomeLayerColorRgb(biomeKey, layerDepth);
    return {
      biomeKey,
      color: rgbToCss(colorRgb),
      colorRgb,
      stripX: seg.stripX,
      stripWidth: seg.stripWidth,
      topEdgeSamples:
        layerDepth === "ground"
          ? null
          : buildSilhouetteTopEdge(
              biomeKey,
              Math.ceil(seg.stripWidth),
              seg.stripX,
              layerDepth,
            ),
    };
  });

  if (layerDepth !== "ground") {
    newSegs = injectBlendSeams(newSegs, layerDepth);
  }

  // Merge the strip-boundary pair if the last existing segment and the first
  // new segment share the same biome (neither being a blend transition).
  if (target.length > 0 && newSegs.length > 0) {
    const last = target[target.length - 1];
    const first = newSegs[0];
    if (!last.isBlend && !first.isBlend && last.biomeKey === first.biomeKey) {
      if (first.topEdgeSamples && last.topEdgeSamples) {
        const merged = new Float32Array(
          last.topEdgeSamples.length + first.topEdgeSamples.length - 1,
        );
        merged.set(last.topEdgeSamples);
        merged.set(
          first.topEdgeSamples.subarray(1),
          last.topEdgeSamples.length,
        );
        last.topEdgeSamples = merged;
      }
      last.stripWidth += first.stripWidth;
      newSegs = newSegs.slice(1);
    }
  }

  for (const s of newSegs) {
    target.push(s);
  }
}

/**
 * Remove the old post-extension from a layer segment array up to `cutX`.
 *
 * When extending a strip with a new trip, the previous trip's post-extension
 * occupies [destMarkerStripX*speed .. +extAfterPx*speed] in layer-space.
 * The new trip's route ALSO starts at destMarkerStripX*speed, so without
 * truncation both the old post-extension and the new route segments would
 * occupy the same strip range and be double-drawn.
 *
 * Algorithm:
 *  1. Pop any segment whose stripX >= cutX (the post-ext starts exactly here).
 *  2. Trim the last remaining segment if it extends past cutX (handles the
 *     case where route-end and post-ext were merged into one segment).
 */
function truncateLayerAtX(layerSegs, cutX) {
  // Pop segments starting at or after the cut (0.5px tolerance for float drift)
  while (
    layerSegs.length > 0 &&
    layerSegs[layerSegs.length - 1].stripX >= cutX - 0.5
  ) {
    layerSegs.pop();
  }
  // Trim the last segment if it overshoots
  if (layerSegs.length > 0) {
    const last = layerSegs[layerSegs.length - 1];
    if (last.stripX + last.stripWidth > cutX) {
      const newWidth = Math.max(1, cutX - last.stripX);
      if (last.topEdgeSamples) {
        last.topEdgeSamples = last.topEdgeSamples.slice(
          0,
          Math.ceil(newWidth) + 1,
        );
      }
      last.stripWidth = newWidth;
    }
  }
}

/**
 * Return a new segment array with every stripX and stripWidth multiplied by
 * `speed`.  Used so each parallax layer's biome transitions align with the
 * ground layer on screen regardless of parallax speed.
 */
function scaleSegments(segs, speed) {
  if (speed === 1.0) return segs;
  return segs.map((seg) => ({
    ...seg,
    stripX: seg.stripX * speed,
    stripWidth: seg.stripWidth * speed,
  }));
}

// ---------------------------------------------------------------------------
// Biome sampling helpers
// ---------------------------------------------------------------------------

function buildNearSegments(travel, extBeforePx, extAfterPx) {
  // Use the near biome band from travel if available, otherwise fall back to
  // sampling the straight start→dest line directly.
  const rawSegs =
    travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];

  return expandSegmentsToPx(
    rawSegs,
    extBeforePx,
    extAfterPx,
    travel.totalLength ?? 0,
  );
}

function buildOffsetSegments(travel, extBeforePx, extAfterPx, offsetWorld) {
  // Use mid/far band from travel when it matches the shared biome-band offsets.
  const isMid = Math.abs(offsetWorld - MID_OFFSET_WORLD) < 0.01;
  const isFar = Math.abs(offsetWorld - FAR_OFFSET_WORLD) < 0.01;

  let rawSegs;
  if (isMid && travel.biomeBandSegments?.mid?.segments?.length) {
    rawSegs = travel.biomeBandSegments.mid.segments;
  } else if (isFar && travel.biomeBandSegments?.far?.segments?.length) {
    rawSegs = travel.biomeBandSegments.far.segments;
  } else {
    rawSegs =
      travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];
  }

  return expandSegmentsToPx(
    rawSegs,
    extBeforePx,
    extAfterPx,
    travel.totalLength ?? 0,
  );
}

/**
 * Collapse consecutive segments that share the same biome key into one.
 * Keeps the first segment's stripX and sums the widths.
 */
function mergeAdjacentSegments(segs) {
  if (segs.length <= 1) return segs;
  const merged = [{ ...segs[0] }];
  for (let i = 1; i < segs.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = segs[i];
    if (cur.biomeKey === prev.biomeKey) {
      prev.stripWidth += cur.stripWidth;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Convert raw biome segments (which cover only the route) into pixel-space
 * segments covering the full strip (with extension buffers at both ends).
 */
function expandSegmentsToPx(
  rawSegs,
  extBeforePx,
  extAfterPx,
  totalWorldLength,
) {
  const result = [];
  const firstBiome = normalizeBiomeKey(rawSegs[0]?.biome) ?? "plains";
  const lastBiome =
    normalizeBiomeKey(rawSegs[rawSegs.length - 1]?.biome) ?? firstBiome;

  // Pre-extension
  if (extBeforePx > 0) {
    result.push({ biomeKey: firstBiome, stripX: 0, stripWidth: extBeforePx });
  }

  // Route segments scaled to pixels
  let cursor = extBeforePx;
  const routePx = totalWorldLength * PX_PER_WORLD;

  if (rawSegs.length && totalWorldLength > 0.0001) {
    for (const seg of rawSegs) {
      const biomeKey = normalizeBiomeKey(seg.biome) ?? firstBiome;
      const px = Math.max(1, (seg.distance / totalWorldLength) * routePx);
      result.push({ biomeKey, stripX: cursor, stripWidth: px });
      cursor += px;
    }
  } else {
    // No segment data – fill with fallback
    result.push({
      biomeKey: firstBiome,
      stripX: cursor,
      stripWidth: Math.max(1, routePx),
    });
    cursor += Math.max(1, routePx);
  }

  // Post-extension
  if (extAfterPx > 0) {
    result.push({
      biomeKey: lastBiome,
      stripX: cursor,
      stripWidth: extAfterPx,
    });
  }

  return mergeAdjacentSegments(result);
}

/**
 * For each adjacent pair of silhouette segments from different biomes, insert
 * a "blend" segment centred on the seam.  The blend segment carries:
 *   – a cross-faded topEdgeSamples array (lerped between both biome profiles)
 *   – colorA / colorB ([r,g,b] arrays) so the renderer can make a gradient fill
 * The flanking segments are trimmed so nothing overlaps.
 */
function injectBlendSeams(segments, layerDepth) {
  const result = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = i + 1 < segments.length ? segments[i + 1] : null;

    const canBlend =
      next !== null &&
      seg.biomeKey !== null &&
      next.biomeKey !== null &&
      seg.biomeKey !== next.biomeKey &&
      seg.topEdgeSamples !== null &&
      next.topEdgeSamples !== null;

    if (canBlend) {
      // Scale the blend zone down to fit inside both flanking segments while
      // leaving at least 1px of solid segment on each side.
      const halfBz = getBlendHalfWidth(seg.stripWidth, next.stripWidth);
      if (halfBz <= 0) {
        result.push(seg);
        continue;
      }
      const BZ = halfBz * 2;

      const origSeamX = seg.stripX + seg.stripWidth;
      const blendStartX = origSeamX - halfBz;

      // Trim right edge of A
      seg.stripWidth = Math.max(1, seg.stripWidth - halfBz);
      seg.topEdgeSamples = seg.topEdgeSamples.slice(0, Math.ceil(seg.stripWidth) + 1);

      // Build blend samples: BZ+1 points covering [blendStartX .. blendStartX+BZ].
      // The last point sits exactly on next.stripX (after trimming B below), so the
      // blend's final height matches B's first sample perfectly – no gap.
      // Smoothstep on t avoids a visible kink where the two wave functions meet.
      const blendSamples = new Float32Array(BZ + 1);
      for (let bx = 0; bx <= BZ; bx++) {
        const tLin = bx / BZ;
        const t = tLin * tLin * (3 - 2 * tLin); // smoothstep
        blendSamples[bx] =
          sampleSilhouetteAtX(seg.biomeKey, blendStartX + bx, layerDepth) * (1 - t) +
          sampleSilhouetteAtX(next.biomeKey, blendStartX + bx, layerDepth) * t;
      }

      result.push(seg);
      result.push({
        biomeKey: null,
        isBlend: true,
        colorA: seg.colorRgb,
        colorB: next.colorRgb,
        color: null,
        stripX: blendStartX,
        stripWidth: BZ,
        topEdgeSamples: blendSamples,
      });

      // Trim left edge of B and rebuild its samples from the new start position
      next.stripX += halfBz;
      next.stripWidth = Math.max(1, next.stripWidth - halfBz);
      next.topEdgeSamples = buildSilhouetteTopEdge(
        next.biomeKey,
        Math.ceil(next.stripWidth),
        next.stripX,
        layerDepth,
      );
    } else {
      result.push(seg);
    }
  }

  return result;
}

function getBlendHalfWidth(leftWidth, rightWidth) {
  const maxHalf = Math.round(BLEND_ZONE_PX / 2);
  const leftRoom = Math.max(0, Math.floor(leftWidth) - 1);
  const rightRoom = Math.max(0, Math.floor(rightWidth) - 1);
  return Math.min(maxHalf, leftRoom, rightRoom);
}

/**
 * For each pixel-space segment, pre-compute the silhouette top-edge sample
 * array and the fill color for the given layer.
 */
function buildLayerSegments(pixelSegments, layerDepth) {
  let segs = pixelSegments.map((seg) => {
    const biomeKey = seg.biomeKey ?? "plains";
    const colorRgb = getBiomeLayerColorRgb(biomeKey, layerDepth);
    const topEdgeSamples =
      layerDepth === "ground"
        ? null // ground is a flat filled rect – no silhouette needed
        : buildSilhouetteTopEdge(
            biomeKey,
            Math.ceil(seg.stripWidth),
            seg.stripX,
            layerDepth,
          );
    return {
      biomeKey,
      color: rgbToCss(colorRgb),
      colorRgb,
      stripX: seg.stripX,
      stripWidth: seg.stripWidth,
      topEdgeSamples,
    };
  });

  if (layerDepth !== "ground") {
    segs = injectBlendSeams(segs, layerDepth);
  }

  return segs;
}

function createEmptyStrip() {
  return {
    totalStripPx: 0,
    extBeforePx: 0,
    routePx: 0,
    pxPerWorld: PX_PER_WORLD,
    startMarkerStripX: 0,
    destMarkerStripX: 0,
    layers: {},
    layerSegments: createEmptyLayerSegments(),
    blendZonePx: BLEND_ZONE_PX,
  };
}

function createEmptyLayerSegments() {
  return {
    ground: [],
    foreground: [],
    near1: [],
    near2: [],
    mid: [],
    far: [],
  };
}
