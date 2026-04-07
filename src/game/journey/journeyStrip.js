import { BIOME_INFO } from "../../config.js";
import {
  normalizeBiomeKey,
  getBiomeLayerColor,
  buildSilhouetteTopEdge,
} from "./journeyStyle.js";

// ---------------------------------------------------------------------------
// Fixed offsets for parallel sampling lines (world-space units).
// These are HARDCODED and must not depend on travel length, zoom, or scale.
// ---------------------------------------------------------------------------
const MID_OFFSET_WORLD = 20;
const FAR_OFFSET_WORLD = 40;

// Pixels per world unit – the canonical scroll mapping.
// One world unit of travel = this many pixels of strip scrolling.
const PX_PER_WORLD = 140;

// How many world-units to extend the strip before and after the route.
const ROUTE_EXTENSION_WORLD = 4;

// Must match PLAYER_X_FRAC in journeyScene.js so extension math is consistent.
const PLAYER_X_FRAC = 0.22;

// Transition blend zone in pixels
const BLEND_ZONE_PX = 48;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full precomputed journey strip for a given travel.
 *
 * @param {object} travel      – playState.travel (has startCityId, targetCityId,
 *                               points, segmentLengths, totalLength, biomeBandSegments)
 * @param {object} world       – full world object
 * @param {number} viewW       – canvas viewport width in pixels
 * @param {number} viewH       – canvas viewport height in pixels
 * @returns {JourneyStrip}
 */
export function buildJourneyStrip(travel, world, viewW, viewH) {
  if (!travel) {
    return createEmptyStrip();
  }

  // --- 1. Compute pixel geometry ----------------------------------------

  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;

  // Extension buffers: sized so every parallax layer fills the full screen
  // at both the start (progress=0) and end (progress=total) of the journey.
  //
  // For a layer with speed s, the leftmost strip pixel it shows at start is:
  //   layerStripLeft = scrollX_start * s - playerX
  //   scrollX_start  = extBeforePx + playerX - viewW/2
  //
  // For canvasX(stripX=0) ≤ 0 (strip covers the screen's left edge):
  //   layerStripLeft ≥ 0
  //   → extBeforePx ≥ playerX*(1/s - 1) + viewW/2
  // The slowest layer (far, s=FAR_SPEED) sets the maximum requirement.
  //
  // For extAfterPx, the fastest layer (foreground, s=FG_SPEED) sets the
  // maximum requirement. At end, its rightmost visible strip pixel is:
  //   rightStripX = scrollX_end * FG_SPEED - playerX + viewW
  // Need totalStripPx ≥ rightStripX, which gives:
  //   extAfterPx ≥ (FG_SPEED-1)*(extBeforePx + routePx + playerX) + viewW*(1 - FG_SPEED/2)
  const FAR_SPEED = 0.34; // must match PARALLAX_SPEED.far
  const FG_SPEED = 1.6; // must match PARALLAX_SPEED.foreground
  const playerX = viewW * PLAYER_X_FRAC;

  const minExtBefore =
    Math.ceil(playerX * (1 / FAR_SPEED - 1) + viewW / 2) + 32;
  const extBeforePx = Math.max(
    ROUTE_EXTENSION_WORLD * PX_PER_WORLD,
    minExtBefore,
  );

  const minExtAfter =
    Math.ceil(
      (FG_SPEED - 1) * (extBeforePx + routePx + playerX) +
        viewW * (1 - FG_SPEED / 2),
    ) + 32;
  const extAfterPx = Math.max(
    ROUTE_EXTENSION_WORLD * PX_PER_WORLD,
    minExtAfter,
  );

  // Total strip pixel width
  const totalStripPx = Math.ceil(extBeforePx + routePx + extAfterPx);

  // POI marker positions on the strip (in strip-local pixel coords)
  // Start marker sits at extBeforePx (beginning of the route on the strip).
  // Dest  marker sits at extBeforePx + routePx (end of the route).
  const startMarkerStripX = extBeforePx;
  const destMarkerStripX = extBeforePx + routePx;

  // --- 2. Vertical composition ------------------------------------------
  //
  //  0 ────────────────────────────── viewH
  //  sky (top 66%)
  //  groundTopY = 0.67 * viewH   ← upper edge of ground strip / base of silhouettes
  //  groundH    = viewH - groundTopY
  //  ground fills lower 33%
  //
  // Layer bands (all placed above groundTopY):
  //  foreground : groundTopY-20 … groundTopY (appears in front of player, overlaps slightly)
  //  near1      : groundTopY-80 … groundTopY-10
  //  near2      : groundTopY-130 … groundTopY-40
  //  mid        : groundTopY-200 … groundTopY-80
  //  far        : groundTopY-280 … groundTopY-140

  const groundTopY = Math.round(viewH * 0.67);
  const groundBottomY = viewH;

  const layers = {
    ground: { topY: groundTopY, bottomY: groundBottomY },
    foreground: { topY: Math.round(viewH * 0.8), bottomY: groundBottomY },
    near1: { topY: groundTopY - 80, bottomY: groundTopY },
    near2: { topY: groundTopY - 130, bottomY: groundTopY },
    mid: { topY: groundTopY - 200, bottomY: groundTopY },
    far: { topY: groundTopY - 280, bottomY: groundTopY },
  };

  // --- 3. Sample biome segments for each layer --------------------------

  const nearSegments = buildNearSegments(
    travel,
    world,
    extBeforePx,
    extAfterPx,
  );
  const midSegments = buildOffsetSegments(
    travel,
    world,
    extBeforePx,
    extAfterPx,
    MID_OFFSET_WORLD,
  );
  const farSegments = buildOffsetSegments(
    travel,
    world,
    extBeforePx,
    extAfterPx,
    FAR_OFFSET_WORLD,
  );

  // --- 4. Build silhouette segment data for each layer ------------------
  //  Each segment carries: { biomeKey, color, stripX, stripWidth, topEdgeSamples }

  const groundSegs = buildLayerSegments(nearSegments, "ground", totalStripPx);
  const fgSegs = buildLayerSegments(nearSegments, "foreground", totalStripPx);
  const near1Segs = buildLayerSegments(nearSegments, "near1", totalStripPx);
  const near2Segs = buildLayerSegments(nearSegments, "near2", totalStripPx);
  const midSegs = buildLayerSegments(midSegments, "mid", totalStripPx);
  const farSegs = buildLayerSegments(farSegments, "far", totalStripPx);

  return {
    totalStripPx,
    extBeforePx,
    routePx,
    pxPerWorld: PX_PER_WORLD,
    startMarkerStripX,
    destMarkerStripX,
    layers,
    layerSegments: {
      ground: groundSegs,
      foreground: fgSegs,
      near1: near1Segs,
      near2: near2Segs,
      mid: midSegs,
      far: farSegs,
    },
    blendZonePx: BLEND_ZONE_PX,
    viewW,
    viewH,
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
export function extendStripWithTravel(strip, travel, viewW, viewH) {
  const FG_SPEED = 1.6; // must match PARALLAX_SPEED.foreground
  const playerX = viewW * PLAYER_X_FRAC;

  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;

  const newStartX = strip.destMarkerStripX;
  const newDestX = newStartX + routePx;

  // extAfterPx: cover the fastest layer (foreground) at arrival.
  // Same formula as buildJourneyStrip, using newDestX as the dest marker.
  const minExtAfter =
    Math.ceil(
      (FG_SPEED - 1) * (newDestX + playerX) + viewW * (1 - FG_SPEED / 2),
    ) + 32;
  const extAfterPx = Math.max(
    ROUTE_EXTENSION_WORLD * PX_PER_WORLD,
    minExtAfter,
  );

  // Raw biome segment arrays from travel
  const rawNear =
    travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];
  const rawMid = travel.biomeBandSegments?.mid?.segments?.length
    ? travel.biomeBandSegments.mid.segments
    : rawNear;
  const rawFar = travel.biomeBandSegments?.far?.segments?.length
    ? travel.biomeBandSegments.far.segments
    : rawNear;

  const nearPx = expandFromStartX(
    rawNear,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
  );
  const midPx = expandFromStartX(
    rawMid,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
  );
  const farPx = expandFromStartX(
    rawFar,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
  );

  appendLayerSegs(strip.layerSegments.ground, nearPx, "ground");
  appendLayerSegs(strip.layerSegments.foreground, nearPx, "foreground");
  appendLayerSegs(strip.layerSegments.near1, nearPx, "near1");
  appendLayerSegs(strip.layerSegments.near2, nearPx, "near2");
  appendLayerSegs(strip.layerSegments.mid, midPx, "mid");
  appendLayerSegs(strip.layerSegments.far, farPx, "far");

  strip.startMarkerStripX = newStartX;
  strip.destMarkerStripX = newDestX;
  strip.totalStripPx = Math.ceil(newDestX + extAfterPx);

  return strip;
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

  return result;
}

// Append fully-built layer segments (with color + silhouette) onto an array.
function appendLayerSegs(target, pixelSegs, layerDepth) {
  for (const seg of pixelSegs) {
    const biomeKey = seg.biomeKey ?? "plains";
    target.push({
      biomeKey,
      color: getBiomeLayerColor(biomeKey, layerDepth),
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
    });
  }
}

// ---------------------------------------------------------------------------
// ground = 1.0 (reference). Foreground moves faster.
// ---------------------------------------------------------------------------
export const PARALLAX_SPEED = {
  ground: 1.0,
  foreground: 1.6,
  near1: 0.9,
  near2: 0.75,
  mid: 0.56,
  far: 0.34,
};

// ---------------------------------------------------------------------------
// Biome sampling helpers
// ---------------------------------------------------------------------------

function buildNearSegments(travel, world, extBeforePx, extAfterPx) {
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

function buildOffsetSegments(
  travel,
  world,
  extBeforePx,
  extAfterPx,
  offsetWorld,
) {
  // Use mid/far band from travel when it matches the offset
  const isMid = Math.abs(offsetWorld - 20) < 0.01;
  const isFar = Math.abs(offsetWorld - 40) < 0.01;

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

  return result;
}

/**
 * For each pixel-space segment, pre-compute the silhouette top-edge sample
 * array and the fill color for the given layer.
 */
function buildLayerSegments(pixelSegments, layerDepth, totalStripPx) {
  return pixelSegments.map((seg) => {
    const biomeKey = seg.biomeKey ?? "plains";
    const color = getBiomeLayerColor(biomeKey, layerDepth);
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
      color,
      stripX: seg.stripX,
      stripWidth: seg.stripWidth,
      topEdgeSamples,
    };
  });
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
    layerSegments: {
      ground: [],
      foreground: [],
      near1: [],
      near2: [],
      mid: [],
      far: [],
    },
    blendZonePx: BLEND_ZONE_PX,
    viewW: 0,
    viewH: 0,
  };
}
