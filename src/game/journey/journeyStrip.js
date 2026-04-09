import { BIOME_INFO } from "../../config.js";
import {
  normalizeBiomeKey,
  getBiomeLayerColorRgb,
  buildSilhouetteTopEdge,
  sampleSilhouetteAtX,
  rgbToCss,
} from "./journeyStyle.js?v=20260409o";

// ---------------------------------------------------------------------------
// Fixed offsets for parallel sampling lines (world-space units).
// These are HARDCODED and must not depend on travel length, zoom, or scale.
// ---------------------------------------------------------------------------
const MID_OFFSET_WORLD = 5;
const FAR_OFFSET_WORLD = 10;

// Pixels per world unit – the canonical scroll mapping.
// One world unit of travel = this many pixels of strip scrolling.
const PX_PER_WORLD = 140;

// How many world-units to extend the strip before and after the route.
const ROUTE_EXTENSION_WORLD = 4;

// Must match PLAYER_X_FRAC in journeyScene.js so extension math is consistent.
const PLAYER_X_FRAC = 0.22;

// Transition blend zone in pixels
const BLEND_ZONE_PX = 48;
const TREE_BLOCKED_BIOMES = new Set(["ocean", "lake"]);
const TREE_ALLOWED_BIOMES = new Set([
  "forest",
  "rainforest",
  "highlands",
  "tundra",
  "desert",
  "plains",
]);
const FOREGROUND_SUPPRESSED_BIOMES = new Set([
  "forest",
  "rainforest",
  "tundra",
]);
const FOREGROUND_TREE_ALLOWED_BIOMES = new Set([
  ...FOREGROUND_SUPPRESSED_BIOMES,
  "desert",
  "plains",
]);
const PINE_TEMPERATE_VARIANT_COUNT = 3;
const PINE_SNOW_VARIANT_START = 3;
const PINE_SNOW_VARIANT_COUNT = 2;
const DEAD_TREE_VARIANT_COUNT = 3;
const CACTUS_VARIANT_COUNT = 2;
const PLAINS_TUFT_VARIANT_COUNT = 4;
const DEAD_TREE_CHANCE_BY_BIOME = Object.freeze({
  ocean: 0,
  lake: 0,
  plains: 0.02,
  forest: 0.04,
  rainforest: 0.02,
  desert: 0,
  tundra: 0.38,
  highlands: 0.22,
  mountain: 0.14,
});
const DEFAULT_TREE_SPAWN_TUNING = Object.freeze({
  segmentChance: 1,
  countScale: 1,
  maxCount: Number.POSITIVE_INFINITY,
});
const DESERT_TREE_SPAWN_TUNING_BY_LAYER = Object.freeze({
  ground: Object.freeze({
    segmentChance: 1,
    countScale: 0.56,
    maxCount: 5,
  }),
  near1: Object.freeze({
    segmentChance: 1,
    countScale: 0.44,
    maxCount: 4,
  }),
  near2: Object.freeze({
    segmentChance: 1,
    countScale: 0.34,
    maxCount: 3,
  }),
  foreground: Object.freeze({
    segmentChance: 1,
    countScale: 0.32,
    maxCount: 4,
  }),
});
const PLAINS_TREE_SPAWN_TUNING_BY_LAYER = Object.freeze({
  ground: Object.freeze({
    segmentChance: 1,
    countScale: 0.76,
    maxCount: 6,
  }),
  near1: Object.freeze({
    segmentChance: 1,
    countScale: 0.62,
    maxCount: 5,
  }),
  near2: Object.freeze({
    segmentChance: 1,
    countScale: 0.52,
    maxCount: 4,
  }),
  foreground: Object.freeze({
    segmentChance: 1,
    countScale: 0.46,
    maxCount: 5,
  }),
});
const TREE_LAYER_CONFIG = {
  near2: {
    minSpacingPx: 72,
    maxSpacingPx: 124,
    minHeightPx: 88,
    maxHeightPx: 126,
    minUpwardOffsetPx: 0,
    maxUpwardOffsetPx: 1,
    minRootOffsetFrac: 0.04,
    maxRootOffsetFrac: 0.16,
  },
  near1: {
    minSpacingPx: 60,
    maxSpacingPx: 102,
    minHeightPx: 112,
    maxHeightPx: 154,
    minUpwardOffsetPx: 0,
    maxUpwardOffsetPx: 1,
    minRootOffsetFrac: 0.08,
    maxRootOffsetFrac: 0.24,
  },
};
const GROUND_TREE_CONFIG = {
  minSpacingPx: 168,
  maxSpacingPx: 252,
  minHeightPx: 150,
  maxHeightPx: 210,
  edgePaddingPx: 14,
  maxPerSegment: 6,
  minSegmentWidthPx: 84,
  minRootOffsetFrac: 0.06,
  maxRootOffsetFrac: 0.94,
};
const FOREGROUND_TREE_CONFIG = {
  minSpacingPx: 116,
  maxSpacingPx: 182,
  minHeightPx: 238,
  maxHeightPx: 322,
  edgePaddingPx: 12,
  minSegmentWidthPx: 72,
  maxPerSegment: 7,
  minSinkFrac: 0.24,
  maxSinkFrac: 0.42,
};
const POI_DECORATION_EXCLUSION_RADIUS_BY_LAYER = Object.freeze({
  ground: 158,
  groundDetails: 172,
  foreground: 228,
  near1: 104,
  near2: 90,
});
const DETAIL_THEME_BY_BIOME = {
  forest: ["tuft", "stone", "stick", "tuft"],
  rainforest: ["tuft", "tuft", "stone", "leaf"],
  highlands: ["tuft", "stone", "pebble", "stone"],
  plains: ["tuft", "stone", "flower", "tuft"],
  desert: ["sand-dune", "pebble", "stone", "sand-dune"],
  tundra: ["frost-tuft", "stone", "snow-dune", "pebble"],
  mountain: ["stone", "pebble", "stone", "frost-tuft"],
  ocean: ["foam", "drift", "foam", "pebble"],
  lake: ["foam", "drift", "pebble", "foam"],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full precomputed journey strip for a given travel.
 *
 * @param {object} travel      – playState.travel (has startNodeId, targetNodeId,
 *                               points, segmentLengths, totalLength, biomeBandSegments)
 * @param {number} viewW       – canvas viewport width in pixels
 * @param {number} viewH       – canvas viewport height in pixels
 * @returns {JourneyStrip}
 */
export function buildJourneyStrip(travel, viewW, viewH, options = {}) {
  if (!travel) {
    return createEmptyStrip();
  }

  // --- 1. Compute pixel geometry ----------------------------------------

  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;

  // Extension buffers: sized so every parallax layer fills the full screen
  // at both the start (progress=0) and end (progress=total) of the journey.
  //
  // extBeforePx: slowest layer (far, s=FAR_SPEED) must cover the left screen
  //   edge at the journey start:
  //   extBeforePx ≥ playerX*(1/FAR_SPEED − 1) + viewW/2
  //
  // extAfterPx: with segment-scaling, the slowest layer also sets the upper
  //   bound for post-extension.  At arrival the far layer's right visible
  //   pixel is viewW/FAR_SPEED ahead in ground coords:
  //   extAfterPx ≥ playerX*(1 − 1/FAR_SPEED) + viewW*(1/FAR_SPEED − 0.5)
  const FAR_SPEED = 0.26; // must match PARALLAX_SPEED.far
  const playerX = viewW * PLAYER_X_FRAC;

  const minExtBefore =
    Math.ceil(playerX * (1 / FAR_SPEED - 1) + viewW / 2) + 32;
  const extBeforePx = Math.max(
    ROUTE_EXTENSION_WORLD * PX_PER_WORLD,
    minExtBefore,
  );

  // After segment scaling the slowest layer (far, s=FAR_SPEED) demands the
  // most post-extension.  At arrival its rightmost visible layer-space pixel
  // lies viewW/FAR_SPEED ahead in ground coords; subtracting what the layer
  // already covers gives:
  //   extAfterPx ≥ playerX*(1 − 1/FAR_SPEED) + viewW*(1/FAR_SPEED − 0.5)
  // The foreground (fastest, s>1) needs only ~0.17*viewW — far less.
  const minExtAfter =
    Math.ceil(playerX * (1 - 1 / FAR_SPEED) + viewW * (1 / FAR_SPEED - 0.5)) +
    32;
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
  //  sky gradient (static): 0 → groundTopY
  //  groundTopY = 0.67 * viewH   ← upper edge of ground / base of silhouettes
  //  ground fills lower 33%
  //
  // The four background silhouette layers (far, mid, near2, near1) are
  // distributed as equal slices between silhouetteZoneTop and groundTopY.
  // Each layer's bottomY extends 2px past groundTopY so that sub-pixel
  // anti-aliasing never leaves a gap at the ground line.

  const groundTopY = Math.round(viewH * 0.67);
  const groundBottomY = viewH;

  const silhouetteZoneTop = Math.round(viewH * 0.42);
  const silhouetteZoneH = groundTopY - silhouetteZoneTop;
  const sliceH = Math.round(silhouetteZoneH / 4);

  const near1Top = groundTopY - sliceH;
  const near2Top = groundTopY - sliceH * 2;
  const midTop = groundTopY - sliceH * 3;
  const farTop = silhouetteZoneTop;

  const SILHOUETTE_BOTTOM = groundTopY + 2; // 2px overlap so ground covers the anti-aliased edge

  const layers = {
    ground: { topY: groundTopY, bottomY: groundBottomY },
    foreground: { topY: Math.round(viewH * 0.8), bottomY: groundBottomY },
    // All background silhouette layers share the same bottomY so that each
    // layer's polygon fills from its own top edge all the way down to the
    // ground line. Layers are drawn back-to-front (far → near1), so each
    // closer layer's polygon naturally occludes the ones behind it.
    near1: { topY: near1Top, bottomY: SILHOUETTE_BOTTOM },
    near2: { topY: near2Top, bottomY: SILHOUETTE_BOTTOM },
    mid: { topY: midTop, bottomY: SILHOUETTE_BOTTOM },
    far: { topY: farTop, bottomY: SILHOUETTE_BOTTOM },
  };

  // --- 3. Sample biome segments for each layer --------------------------

  const showSnow = options.showSnow !== false;
  const nearSegments = buildNearSegments(
    travel,
    extBeforePx,
    extAfterPx,
    showSnow,
  );
  const midSegments = buildOffsetSegments(
    travel,
    extBeforePx,
    extAfterPx,
    MID_OFFSET_WORLD,
    showSnow,
  );
  const farSegments = buildOffsetSegments(
    travel,
    extBeforePx,
    extAfterPx,
    FAR_OFFSET_WORLD,
    showSnow,
  );

  // --- 4. Build silhouette segment data for each layer ------------------
  //  Each segment carries: { biomeKey, color, stripX, stripWidth, topEdgeSamples }
  //
  //  Each non-ground layer's strip coordinates are SCALED by the layer's
  //  parallax speed.  This ensures that every biome transition appears at
  //  the same screen position at the same travel progress regardless of speed.
  //
  //  Render formula in journeyScene:
  //    canvasX = stripX - (scrollX * speed - playerX)
  //  With stripX = groundStripX * speed:
  //    canvasX = speed * (groundStripX - scrollX) + playerX
  //  → at any progress the layer transition aligns with the ground transition.

  const groundSegs = buildLayerSegments(nearSegments, "ground");
  const fgSegs = buildLayerSegments(
    scaleSegments(nearSegments, PARALLAX_SPEED.foreground),
    "foreground",
  );
  const near1Segs = buildLayerSegments(
    scaleSegments(nearSegments, PARALLAX_SPEED.near1),
    "near1",
  );
  const near2Segs = buildLayerSegments(
    scaleSegments(nearSegments, PARALLAX_SPEED.near2),
    "near2",
  );
  const midSegs = buildLayerSegments(
    scaleSegments(midSegments, PARALLAX_SPEED.mid),
    "mid",
  );
  const farSegs = buildLayerSegments(
    scaleSegments(farSegments, PARALLAX_SPEED.far),
    "far",
  );

  const strip = {
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
  strip.treeDecorations = buildTreeDecorations(strip);
  strip.groundTrees = buildGroundTrees(strip.layerSegments.ground, strip);
  strip.groundDetails = buildGroundDetails(strip.layerSegments.ground, strip);
  strip.foregroundTrees = buildForegroundTrees(
    strip.layerSegments.ground,
    strip,
  );
  return strip;
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
export function extendStripWithTravel(
  strip,
  travel,
  viewW,
  viewH,
  options = {},
) {
  const FAR_SPEED = 0.26; // must match PARALLAX_SPEED.far — slowest layer drives post-ext size
  const playerX = viewW * PLAYER_X_FRAC;

  const routeWorldLength = travel.totalLength ?? 0;
  const routePx = routeWorldLength * PX_PER_WORLD;

  const newStartX = strip.destMarkerStripX;
  const newDestX = newStartX + routePx;

  // extAfterPx: cover the slowest layer (far) at arrival — same formula as
  // buildJourneyStrip.  Critically, this does NOT depend on newDestX; the
  // old FG_SPEED-based formula grew linearly with strip length, producing
  // huge unnecessary allocations on each subsequent journey.
  const minExtAfter =
    Math.ceil(playerX * (1 - 1 / FAR_SPEED) + viewW * (1 / FAR_SPEED - 0.5)) +
    32;
  const extAfterPx = Math.max(
    ROUTE_EXTENSION_WORLD * PX_PER_WORLD,
    minExtAfter,
  );
  const showSnow = options.showSnow !== false;

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
    showSnow,
  );
  const midPx = expandFromStartX(
    rawMid,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
    showSnow,
  );
  const farPx = expandFromStartX(
    rawFar,
    newStartX,
    routeWorldLength,
    routePx,
    extAfterPx,
    showSnow,
  );

  // Truncate the old post-extension from every layer before appending the
  // new trip's segments.  Each layer's post-extension starts at
  // destMarkerStripX * speed in layer-space — exactly where the new route
  // also starts — so without this step the two would be double-drawn.
  const cutGround = strip.destMarkerStripX;
  truncateLayerAtX(strip.layerSegments.ground, cutGround);
  truncateLayerAtX(
    strip.layerSegments.foreground,
    cutGround * PARALLAX_SPEED.foreground,
  );
  truncateLayerAtX(strip.layerSegments.near1, cutGround * PARALLAX_SPEED.near1);
  truncateLayerAtX(strip.layerSegments.near2, cutGround * PARALLAX_SPEED.near2);
  truncateLayerAtX(strip.layerSegments.mid, cutGround * PARALLAX_SPEED.mid);
  truncateLayerAtX(strip.layerSegments.far, cutGround * PARALLAX_SPEED.far);

  appendLayerSegs(strip.layerSegments.ground, nearPx, "ground", 1.0);
  appendLayerSegs(
    strip.layerSegments.foreground,
    nearPx,
    "foreground",
    PARALLAX_SPEED.foreground,
  );
  appendLayerSegs(
    strip.layerSegments.near1,
    nearPx,
    "near1",
    PARALLAX_SPEED.near1,
  );
  appendLayerSegs(
    strip.layerSegments.near2,
    nearPx,
    "near2",
    PARALLAX_SPEED.near2,
  );
  appendLayerSegs(strip.layerSegments.mid, midPx, "mid", PARALLAX_SPEED.mid);
  appendLayerSegs(strip.layerSegments.far, farPx, "far", PARALLAX_SPEED.far);

  strip.startMarkerStripX = newStartX;
  strip.destMarkerStripX = newDestX;
  strip.totalStripPx = Math.ceil(newDestX + extAfterPx);
  strip.treeDecorations = buildTreeDecorations(strip);
  strip.groundTrees = buildGroundTrees(strip.layerSegments.ground, strip);
  strip.groundDetails = buildGroundDetails(strip.layerSegments.ground, strip);
  strip.foregroundTrees = buildForegroundTrees(
    strip.layerSegments.ground,
    strip,
  );

  return strip;
}

// Build pixel-space segments starting from startX (no before-extension).
function expandFromStartX(
  rawSegs,
  startX,
  totalWorldLength,
  routePx,
  extAfterPx,
  showSnow = true,
) {
  const result = [];
  const firstBiome = normalizeBiomeKey(rawSegs[0]?.biome) ?? "plains";
  const firstSnow = showSnow && Boolean(rawSegs[0]?.isSnow);
  const lastBiome =
    normalizeBiomeKey(rawSegs[rawSegs.length - 1]?.biome) ?? firstBiome;
  const lastSnow = showSnow && Boolean(rawSegs[rawSegs.length - 1]?.isSnow);
  let cursor = startX;

  if (rawSegs.length && totalWorldLength > 0.0001) {
    for (const seg of rawSegs) {
      const biomeKey = normalizeBiomeKey(seg.biome) ?? firstBiome;
      const px = Math.max(1, (seg.distance / totalWorldLength) * routePx);
      result.push({
        biomeKey,
        isSnow: showSnow && Boolean(seg.isSnow),
        stripX: cursor,
        stripWidth: px,
      });
      cursor += px;
    }
  } else {
    result.push({
      biomeKey: firstBiome,
      isSnow: firstSnow,
      stripX: cursor,
      stripWidth: Math.max(1, routePx),
    });
    cursor += Math.max(1, routePx);
  }

  if (extAfterPx > 0) {
    result.push({
      biomeKey: lastBiome,
      isSnow: lastSnow,
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
    const colorRgb = getBiomeLayerColorRgb(biomeKey, layerDepth, {
      isSnow: Boolean(seg.isSnow),
    });
    return {
      biomeKey,
      isSnow: Boolean(seg.isSnow),
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

  if (layerDepth === "foreground") {
    applyForegroundSuppression(newSegs);
  }

  if (layerDepth !== "ground" && layerDepth !== "foreground") {
    newSegs = injectBlendSeams(newSegs, layerDepth);
  }

  // Merge the strip-boundary pair if the last existing segment and the first
  // new segment share the same biome (neither being a blend transition).
  if (target.length > 0 && newSegs.length > 0) {
    const last = target[target.length - 1];
    const first = newSegs[0];
    if (
      !last.isBlend &&
      !first.isBlend &&
      last.biomeKey === first.biomeKey &&
      Boolean(last.isSnow) === Boolean(first.isSnow)
    ) {
      if (first.topEdgeSamples && last.topEdgeSamples) {
        const merged = new Float32Array(
          last.topEdgeSamples.length + first.topEdgeSamples.length,
        );
        merged.set(last.topEdgeSamples);
        merged.set(first.topEdgeSamples, last.topEdgeSamples.length);
        last.topEdgeSamples = merged;
      }
      last.stripWidth += first.stripWidth;
      newSegs = newSegs.slice(1);
    }
  }

  for (const s of newSegs) {
    target.push(s);
  }

  if (layerDepth === "foreground") {
    applyForegroundSuppression(target);
  }
}

// ---------------------------------------------------------------------------
// ground = 1.0 (reference). Foreground moves faster.
// ---------------------------------------------------------------------------
export const PARALLAX_SPEED = {
  ground: 1.0,
  foreground: 1.72,
  near1: 0.86,
  near2: 0.68,
  mid: 0.46,
  far: 0.26,
};

function buildTreeDecorations(strip) {
  return {
    near2: buildLayerTreeDecorations(strip.layerSegments.near2, "near2", strip),
    near1: buildLayerTreeDecorations(strip.layerSegments.near1, "near1", strip),
  };
}

function buildGroundTrees(groundSegments, strip = null) {
  if (!groundSegments?.length) return [];
  const poiExclusionZones = createPoiDecorationExclusionZones(strip, "ground");
  const trees = [];

  for (const segment of groundSegments) {
    if (!segment || segment.isBlend) continue;
    if (!segment.biomeKey || !TREE_ALLOWED_BIOMES.has(segment.biomeKey))
      continue;
    if (segment.stripWidth < GROUND_TREE_CONFIG.minSegmentWidthPx) continue;

    const rng = createSeededRng(
      hashString(
        `ground-tree:${segment.biomeKey}:${Number(segment.isSnow) ? 1 : 0}:${Math.round(segment.stripX)}:${Math.round(segment.stripWidth)}`,
      ),
    );
    const segStart =
      segment.stripX + GROUND_TREE_CONFIG.edgePaddingPx + rng() * 16;
    const segEnd =
      segment.stripX + segment.stripWidth - GROUND_TREE_CONFIG.edgePaddingPx;
    const usableWidth = Math.max(0, segEnd - segStart);
    if (usableWidth < 36) continue;

    const avgSpacing =
      (GROUND_TREE_CONFIG.minSpacingPx + GROUND_TREE_CONFIG.maxSpacingPx) * 0.5;
    const roughCount = Math.round(usableWidth / avgSpacing);
    const baseCount = Math.max(
      1,
      Math.min(
        GROUND_TREE_CONFIG.maxPerSegment,
        roughCount + (rng() < 0.7 ? 1 : 0),
      ),
    );
    const count = computeTreeSpawnCountForSegment(
      baseCount,
      segment.biomeKey,
      "ground",
      rng,
    );
    if (count <= 0) continue;

    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.2 + rng() * 0.6) / count;
      const jitter = (rng() - 0.5) * avgSpacing * 0.2;
      const stripX = Math.max(
        segStart,
        Math.min(segEnd, segStart + usableWidth * t + jitter),
      );
      if (isInsidePoiDecorationExclusionZone(stripX, poiExclusionZones))
        continue;
      const treeVisual = pickTreeVisualForBiome(
        segment.biomeKey,
        segment.isSnow,
        rng(),
      );
      trees.push({
        stripX,
        treeFamily: treeVisual.treeFamily,
        variantIndex: treeVisual.variantIndex,
        heightPx: lerp(
          GROUND_TREE_CONFIG.minHeightPx,
          GROUND_TREE_CONFIG.maxHeightPx,
          rng(),
        ),
        upwardOffsetPx: 0,
        rootOffsetFrac: lerp(
          GROUND_TREE_CONFIG.minRootOffsetFrac,
          GROUND_TREE_CONFIG.maxRootOffsetFrac,
          rng(),
        ),
      });
    }
  }

  return trees;
}

function buildGroundDetails(groundSegments, strip = null) {
  if (!groundSegments?.length) return [];
  const poiExclusionZones = createPoiDecorationExclusionZones(
    strip,
    "groundDetails",
  );
  const details = [];

  for (const segment of groundSegments) {
    if (!segment || segment.isBlend) continue;
    if (!segment.biomeKey || segment.stripWidth < 20) continue;

    const rng = createSeededRng(
      hashString(
        `ground-detail:${segment.biomeKey}:${Number(segment.isSnow) ? 1 : 0}:${Math.round(segment.stripX)}:${Math.round(segment.stripWidth)}`,
      ),
    );
    const segStart = segment.stripX + 5 + rng() * 6;
    const segEnd = segment.stripX + segment.stripWidth - 5;
    const usableWidth = Math.max(0, segEnd - segStart);
    if (usableWidth < 4) continue;

    const { minSpacingPx, maxSpacingPx } = getGroundDetailSpacing(
      segment.biomeKey,
      segment.isSnow,
    );
    const avgSpacing = (minSpacingPx + maxSpacingPx) * 0.5;
    const count = Math.max(1, Math.round(usableWidth / avgSpacing));
    const motifs = getGroundDetailMotifs(segment.biomeKey, segment.isSnow);

    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.08 + rng() * 0.84) / count;
      const jitter = (rng() - 0.5) * avgSpacing * 0.24;
      const stripX = Math.max(
        segStart,
        Math.min(segEnd, segStart + usableWidth * t + jitter),
      );
      if (isInsidePoiDecorationExclusionZone(stripX, poiExclusionZones))
        continue;
      details.push({
        stripX,
        biomeKey: segment.biomeKey,
        isSnow: Boolean(segment.isSnow),
        motif: motifs[Math.floor(rng() * motifs.length)],
        scale: lerp(0.72, 1.28, rng()),
        verticalFrac: lerp(0.04, 0.96, rng()),
      });
    }
  }

  return details;
}

function buildForegroundTrees(groundSegments, strip = null) {
  if (!groundSegments?.length) return [];
  const poiExclusionZones = createPoiDecorationExclusionZones(
    strip,
    "foreground",
  );
  const trees = [];

  for (const segment of groundSegments) {
    if (!segment || segment.isBlend) continue;
    if (
      !segment.biomeKey ||
      !FOREGROUND_TREE_ALLOWED_BIOMES.has(segment.biomeKey)
    )
      continue;
    if (segment.stripWidth < FOREGROUND_TREE_CONFIG.minSegmentWidthPx) continue;

    const rng = createSeededRng(
      hashString(
        `foreground-tree:${segment.biomeKey}:${Number(segment.isSnow) ? 1 : 0}:${Math.round(segment.stripX)}:${Math.round(segment.stripWidth)}`,
      ),
    );
    const segStart =
      segment.stripX + FOREGROUND_TREE_CONFIG.edgePaddingPx + rng() * 12;
    const segEnd =
      segment.stripX +
      segment.stripWidth -
      FOREGROUND_TREE_CONFIG.edgePaddingPx;
    const usableWidth = Math.max(0, segEnd - segStart);
    if (usableWidth < 24) continue;

    const avgSpacing =
      (FOREGROUND_TREE_CONFIG.minSpacingPx +
        FOREGROUND_TREE_CONFIG.maxSpacingPx) *
      0.5;
    const roughCount = Math.round(usableWidth / avgSpacing);
    const baseCount = Math.max(
      1,
      Math.min(
        FOREGROUND_TREE_CONFIG.maxPerSegment,
        roughCount + (rng() < 0.62 ? 1 : 0),
      ),
    );
    const count = computeTreeSpawnCountForSegment(
      baseCount,
      segment.biomeKey,
      "foreground",
      rng,
    );
    if (count <= 0) continue;

    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.1 + rng() * 0.8) / count;
      const jitter = (rng() - 0.5) * avgSpacing * 0.22;
      const stripX = Math.max(
        segStart,
        Math.min(segEnd, segStart + usableWidth * t + jitter),
      );
      if (isInsidePoiDecorationExclusionZone(stripX, poiExclusionZones))
        continue;
      const treeVisual = pickTreeVisualForBiome(
        segment.biomeKey,
        segment.isSnow,
        rng(),
      );
      trees.push({
        stripX,
        treeFamily: treeVisual.treeFamily,
        variantIndex: treeVisual.variantIndex,
        heightPx: lerp(
          FOREGROUND_TREE_CONFIG.minHeightPx,
          FOREGROUND_TREE_CONFIG.maxHeightPx,
          rng(),
        ),
        upwardOffsetPx: 0,
        sinkFrac: lerp(
          FOREGROUND_TREE_CONFIG.minSinkFrac,
          FOREGROUND_TREE_CONFIG.maxSinkFrac,
          rng(),
        ),
      });
    }
  }

  return trees;
}

function buildLayerTreeDecorations(layerSegments, layerName, strip = null) {
  const config = TREE_LAYER_CONFIG[layerName];
  if (!config || !layerSegments?.length) return [];
  const poiExclusionZones = createPoiDecorationExclusionZones(strip, layerName);

  const trees = [];
  for (const segment of layerSegments) {
    if (!segment || segment.isBlend || !segment.topEdgeSamples) continue;
    if (!segment.biomeKey || TREE_BLOCKED_BIOMES.has(segment.biomeKey))
      continue;
    if (!TREE_ALLOWED_BIOMES.has(segment.biomeKey)) continue;
    if (segment.stripWidth < 16) continue;

    const rng = createSeededRng(
      hashString(
        `${layerName}:${segment.biomeKey}:${Number(segment.isSnow) ? 1 : 0}:${Math.round(segment.stripX)}:${Math.round(segment.stripWidth)}`,
      ),
    );
    const segStart = segment.stripX + 5 + rng() * 8;
    const segEnd = segment.stripX + segment.stripWidth - 5;
    const usableWidth = Math.max(0, segEnd - segStart);
    if (usableWidth < 4) continue;
    const avgSpacing = (config.minSpacingPx + config.maxSpacingPx) * 0.5;
    const baseCount = Math.max(1, Math.round(usableWidth / avgSpacing));
    const targetCount = computeTreeSpawnCountForSegment(
      baseCount,
      segment.biomeKey,
      layerName,
      rng,
    );
    if (targetCount <= 0) continue;

    for (let i = 0; i < targetCount; i += 1) {
      const t = (i + 0.15 + rng() * 0.7) / targetCount;
      const jitter = (rng() - 0.5) * avgSpacing * 0.2;
      const cursor = Math.max(
        segStart,
        Math.min(segEnd, segStart + usableWidth * t + jitter),
      );
      if (isInsidePoiDecorationExclusionZone(cursor, poiExclusionZones))
        continue;
      const treeVisual = pickTreeVisualForBiome(
        segment.biomeKey,
        segment.isSnow,
        rng(),
      );
      trees.push({
        stripX: cursor,
        treeFamily: treeVisual.treeFamily,
        variantIndex: treeVisual.variantIndex,
        heightPx: lerp(config.minHeightPx, config.maxHeightPx, rng()),
        upwardOffsetPx: lerp(
          config.minUpwardOffsetPx,
          config.maxUpwardOffsetPx,
          rng(),
        ),
        rootOffsetFrac: lerp(
          config.minRootOffsetFrac,
          config.maxRootOffsetFrac,
          rng(),
        ),
        segmentStripX: segment.stripX,
        topEdgeSamples: segment.topEdgeSamples,
      });
    }
  }
  return trees;
}

function pickTreeVisualForBiome(biomeKey, isSnow, roll = 0) {
  const normalizedRoll = clamp01(roll);
  if (biomeKey === "plains") {
    return {
      treeFamily: "tuft",
      variantIndex: Math.min(
        PLAINS_TUFT_VARIANT_COUNT - 1,
        Math.floor(normalizedRoll * PLAINS_TUFT_VARIANT_COUNT),
      ),
    };
  }
  if (biomeKey === "desert") {
    return {
      treeFamily: "cactus",
      variantIndex: Math.min(
        CACTUS_VARIANT_COUNT - 1,
        Math.floor(normalizedRoll * CACTUS_VARIANT_COUNT),
      ),
    };
  }
  const deadChance = getDeadTreeChanceForBiome(biomeKey);
  if (deadChance > 0 && normalizedRoll < deadChance) {
    const deadRoll = deadChance >= 1 ? 0 : normalizedRoll / deadChance;
    return {
      treeFamily: "dead",
      variantIndex: Math.min(
        DEAD_TREE_VARIANT_COUNT - 1,
        Math.floor(deadRoll * DEAD_TREE_VARIANT_COUNT),
      ),
    };
  }

  const pineRoll =
    deadChance >= 1
      ? 0
      : (normalizedRoll - deadChance) / Math.max(1e-6, 1 - deadChance);
  if (isSnow) {
    return {
      treeFamily: "pine",
      variantIndex:
        PINE_SNOW_VARIANT_START +
        Math.min(
          PINE_SNOW_VARIANT_COUNT - 1,
          Math.floor(pineRoll * PINE_SNOW_VARIANT_COUNT),
        ),
    };
  }
  return {
    treeFamily: "pine",
    variantIndex: Math.min(
      PINE_TEMPERATE_VARIANT_COUNT - 1,
      Math.floor(pineRoll * PINE_TEMPERATE_VARIANT_COUNT),
    ),
  };
}

function getDeadTreeChanceForBiome(biomeKey) {
  return clamp01(DEAD_TREE_CHANCE_BY_BIOME[biomeKey] ?? 0);
}

function computeTreeSpawnCountForSegment(baseCount, biomeKey, layerName, rng) {
  const tuning = getTreeSpawnTuningForBiome(layerName, biomeKey);
  if (tuning.segmentChance < 1 && rng() > tuning.segmentChance) {
    return 0;
  }
  if (tuning.countScale === 1) return baseCount;

  const scaledCount = Math.max(0, baseCount * tuning.countScale);
  let count = Math.floor(scaledCount);
  const fraction = scaledCount - count;
  if (fraction > 0 && rng() < fraction) {
    count += 1;
  }
  if (Number.isFinite(tuning.maxCount)) {
    count = Math.min(count, tuning.maxCount);
  }
  return count;
}

function getTreeSpawnTuningForBiome(layerName, biomeKey) {
  if (biomeKey === "desert") {
    return (
      DESERT_TREE_SPAWN_TUNING_BY_LAYER[layerName] ?? DEFAULT_TREE_SPAWN_TUNING
    );
  }
  if (biomeKey === "plains") {
    return (
      PLAINS_TREE_SPAWN_TUNING_BY_LAYER[layerName] ?? DEFAULT_TREE_SPAWN_TUNING
    );
  }
  return DEFAULT_TREE_SPAWN_TUNING;
}

function getGroundDetailSpacing(biomeKey, isSnow) {
  if (isSnow) {
    return { minSpacingPx: 34, maxSpacingPx: 60 };
  }
  switch (biomeKey) {
    case "forest":
    case "rainforest":
    case "highlands":
    case "plains":
      return { minSpacingPx: 28, maxSpacingPx: 52 };
    case "desert":
      return { minSpacingPx: 30, maxSpacingPx: 56 };
    case "mountain":
    case "tundra":
      return { minSpacingPx: 34, maxSpacingPx: 62 };
    case "ocean":
    case "lake":
      return { minSpacingPx: 42, maxSpacingPx: 74 };
    default:
      return { minSpacingPx: 32, maxSpacingPx: 58 };
  }
}

function getGroundDetailMotifs(biomeKey, isSnow) {
  if (isSnow) {
    return ["snow-dune", "snow-dune", "pebble", "frost-tuft"];
  }
  return DETAIL_THEME_BY_BIOME[biomeKey] ?? ["tuft", "stone", "pebble", "tuft"];
}

function createPoiDecorationExclusionZones(strip, layerName) {
  if (!strip) return [];
  const baseRadius = POI_DECORATION_EXCLUSION_RADIUS_BY_LAYER[layerName] ?? 0;
  if (baseRadius <= 0) return [];
  const speed = PARALLAX_SPEED[layerName] ?? 1;
  const startX = Number(strip.startMarkerStripX);
  const destX = Number(strip.destMarkerStripX);
  const zones = [];
  if (Number.isFinite(startX)) {
    zones.push({
      centerX: startX * speed,
      radius: baseRadius * speed,
    });
  }
  if (Number.isFinite(destX)) {
    zones.push({
      centerX: destX * speed,
      radius: baseRadius * speed,
    });
  }
  return zones;
}

function isInsidePoiDecorationExclusionZone(stripX, zones) {
  if (!zones?.length || !Number.isFinite(stripX)) return false;
  for (const zone of zones) {
    if (!zone) continue;
    const centerX = Number(zone.centerX);
    const radius = Math.max(0, Number(zone.radius));
    if (!Number.isFinite(centerX) || !Number.isFinite(radius)) continue;
    if (Math.abs(stripX - centerX) <= radius) {
      return true;
    }
  }
  return false;
}

function createSeededRng(initialSeed) {
  let state = initialSeed | 0 || 1;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = state >>> 0;
    return value / 4294967296;
  };
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

function buildNearSegments(travel, extBeforePx, extAfterPx, showSnow = true) {
  // Use the near biome band from travel if available, otherwise fall back to
  // sampling the straight start→dest line directly.
  const rawSegs =
    travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];

  return expandSegmentsToPx(
    rawSegs,
    extBeforePx,
    extAfterPx,
    travel.totalLength ?? 0,
    showSnow,
  );
}

function buildOffsetSegments(
  travel,
  extBeforePx,
  extAfterPx,
  offsetWorld,
  showSnow = true,
) {
  // Use mid/far band from travel when it matches the offset.
  // These constants must match TRAVEL_BIOME_BANDS in travel.js (mid:5, far:10).
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
    showSnow,
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
    if (
      cur.biomeKey === prev.biomeKey &&
      Boolean(cur.isSnow) === Boolean(prev.isSnow)
    ) {
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
  showSnow = true,
) {
  const result = [];
  const firstBiome = normalizeBiomeKey(rawSegs[0]?.biome) ?? "plains";
  const firstSnow = showSnow && Boolean(rawSegs[0]?.isSnow);
  const lastBiome =
    normalizeBiomeKey(rawSegs[rawSegs.length - 1]?.biome) ?? firstBiome;
  const lastSnow = showSnow && Boolean(rawSegs[rawSegs.length - 1]?.isSnow);

  // Pre-extension
  if (extBeforePx > 0) {
    result.push({
      biomeKey: firstBiome,
      isSnow: firstSnow,
      stripX: 0,
      stripWidth: extBeforePx,
    });
  }

  // Route segments scaled to pixels
  let cursor = extBeforePx;
  const routePx = totalWorldLength * PX_PER_WORLD;

  if (rawSegs.length && totalWorldLength > 0.0001) {
    for (const seg of rawSegs) {
      const biomeKey = normalizeBiomeKey(seg.biome) ?? firstBiome;
      const px = Math.max(1, (seg.distance / totalWorldLength) * routePx);
      result.push({
        biomeKey,
        isSnow: showSnow && Boolean(seg.isSnow),
        stripX: cursor,
        stripWidth: px,
      });
      cursor += px;
    }
  } else {
    // No segment data – fill with fallback
    result.push({
      biomeKey: firstBiome,
      isSnow: firstSnow,
      stripX: cursor,
      stripWidth: Math.max(1, routePx),
    });
    cursor += Math.max(1, routePx);
  }

  // Post-extension
  if (extAfterPx > 0) {
    result.push({
      biomeKey: lastBiome,
      isSnow: lastSnow,
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
      (seg.biomeKey !== next.biomeKey ||
        Boolean(seg.isSnow) !== Boolean(next.isSnow)) &&
      seg.topEdgeSamples !== null &&
      next.topEdgeSamples !== null;

    if (canBlend) {
      // Scale the blend zone down to fit inside both flanking segments.
      // Minimum 1px per side so we always attempt a transition rather than
      // leaving a hard seam when a segment is narrow.
      const halfBz = Math.max(
        1,
        Math.min(
          Math.round(BLEND_ZONE_PX / 2),
          Math.floor(seg.stripWidth / 2) - 1,
          Math.floor(next.stripWidth / 2) - 1,
        ),
      );
      const BZ = halfBz * 2;

      const origSeamX = seg.stripX + seg.stripWidth;
      const blendStartX = origSeamX - halfBz;

      // Trim right edge of A
      seg.stripWidth -= halfBz;
      seg.topEdgeSamples = seg.topEdgeSamples.slice(
        0,
        Math.ceil(seg.stripWidth) + 1,
      );

      // Build blend samples: BZ+1 points covering [blendStartX .. blendStartX+BZ].
      // The last point sits exactly on next.stripX (after trimming B below), so the
      // blend's final height matches B's first sample perfectly – no gap.
      // Smoothstep on t avoids a visible kink where the two wave functions meet.
      const blendSamples = new Float32Array(BZ + 1);
      for (let bx = 0; bx <= BZ; bx++) {
        const tLin = bx / BZ;
        const t = tLin * tLin * (3 - 2 * tLin); // smoothstep
        blendSamples[bx] =
          sampleSilhouetteAtX(seg.biomeKey, blendStartX + bx, layerDepth) *
            (1 - t) +
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

/**
 * For each pixel-space segment, pre-compute the silhouette top-edge sample
 * array and the fill color for the given layer.
 */
function buildLayerSegments(pixelSegments, layerDepth) {
  let segs = pixelSegments.map((seg) => {
    const biomeKey = seg.biomeKey ?? "plains";
    const colorRgb = getBiomeLayerColorRgb(biomeKey, layerDepth, {
      isSnow: Boolean(seg.isSnow),
    });
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
      isSnow: Boolean(seg.isSnow),
      color: rgbToCss(colorRgb),
      colorRgb,
      stripX: seg.stripX,
      stripWidth: seg.stripWidth,
      topEdgeSamples,
    };
  });

  if (layerDepth === "foreground") {
    applyForegroundSuppression(segs);
  }

  if (layerDepth !== "ground" && layerDepth !== "foreground") {
    segs = injectBlendSeams(segs, layerDepth);
  }

  return segs;
}

function applyForegroundSuppression(segments) {
  if (!segments?.length) return;
  const taperPx = 68;

  for (let index = 0; index < segments.length; index += 1) {
    const seg = segments[index];
    if (!seg || !seg.topEdgeSamples?.length) continue;
    const biomeKey = seg.biomeKey ?? "";
    const isSuppressed = FOREGROUND_SUPPRESSED_BIOMES.has(biomeKey);
    const prevBiome = segments[index - 1]?.biomeKey ?? "";
    const nextBiome = segments[index + 1]?.biomeKey ?? "";
    const leftSuppressed = FOREGROUND_SUPPRESSED_BIOMES.has(prevBiome);
    const rightSuppressed = FOREGROUND_SUPPRESSED_BIOMES.has(nextBiome);

    if (isSuppressed) {
      seg.topEdgeSamples.fill(1);
      continue;
    }

    const sampleCount = seg.topEdgeSamples.length;
    const fadeCount = Math.max(
      1,
      Math.min(sampleCount - 1, Math.round(Math.min(taperPx, seg.stripWidth))),
    );
    if (fadeCount <= 1) continue;

    if (leftSuppressed) {
      for (let i = 0; i < fadeCount; i += 1) {
        const t = i / (fadeCount - 1);
        const w = (1 - t) * (1 - t);
        seg.topEdgeSamples[i] = lerp(seg.topEdgeSamples[i], 1, w);
      }
    }
    if (rightSuppressed) {
      for (let i = 0; i < fadeCount; i += 1) {
        const t = i / (fadeCount - 1);
        const w = (1 - t) * (1 - t);
        const sampleIndex = sampleCount - 1 - i;
        seg.topEdgeSamples[sampleIndex] = lerp(
          seg.topEdgeSamples[sampleIndex],
          1,
          w,
        );
      }
    }
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
    treeDecorations: {
      near2: [],
      near1: [],
    },
    groundTrees: [],
    groundDetails: [],
    foregroundTrees: [],
    blendZonePx: BLEND_ZONE_PX,
    viewW: 0,
    viewH: 0,
  };
}
