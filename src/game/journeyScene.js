/**
 * journeyScene.js
 *
 * Canvas-based precomputed travel-strip journey view.
 *
 * Core mechanic:
 *   – On first update with travel data: buildJourneyStrip() precomputes the
 *     full horizontal strip for all 7 layers.
 *   – Each frame: scrollX = startMarkerStripX + progress * pxPerWorld.
 *     Every layer is drawn at its parallax-adjusted offset so that the player
 *     stays fixed on screen while the strip scrolls beneath them.
 *   – Both Node markers are part of the strip and scroll with it.
 *   – No per-frame terrain generation; no special-case arrival logic.
 */

import {
  buildJourneyStrip,
  extendStripWithTravel,
} from "./journey/journeyStrip.js?v=20260413c";
import { drawPlayerFigure } from "./journey/journeyStyle.js?v=20260412d";
import {
  drawDebugOverlay,
  drawForegroundCanopyTrees,
  drawDepartureFoothold,
  drawGroundDetails,
  drawGroundLayer,
  drawGroundTrees,
  drawNodeMarkers,
  drawSilhouetteLayer,
  drawTreeDecorationsForLayer,
} from "./journey/journeyLayerRenderers.js?v=20260413g";
import {
  createSkyState,
  drawNightVeil,
  drawOceanHorizon,
  drawSky,
} from "./journey/journeySky.js?v=20260413a";
import {
  createIdlePreviewTravel,
  travelKey,
} from "./journey/journeySceneHelpers.js";

// Player's fixed horizontal position (fraction of canvas width)
const PLAYER_X_FRAC = 0.22;

// Player's feet vertical position (fraction of canvas height).
// Should sit slightly below the ground top edge.
const PLAYER_FEET_Y_FRAC = 0.83;

/**
 * @param {{ canvas: HTMLCanvasElement, getWorld?: () => object | null }} options
 */
export function createJourneyScene({ canvas, getWorld = () => null }) {
  const ctx = canvas ? canvas.getContext("2d") : null;
  const state = {
    strip: null,
    travelKey: null,
    lastTravel: null,
    idleTravel: null,
    lastShowSnow: true,
    lastScrollX: 0,
    cachedW: 0,
    cachedH: 0,
    idleKey: null,
    presentationSnapshot: {
      viewW: 0,
      viewH: 0,
      startMarkerCanvasX: null,
      destMarkerCanvasX: null,
    },
  };

  return {
    update,
    reset,
    getDebugSnapshot,
    getPresentationSnapshot,
  };

  function update(playState, options = {}) {
    if (!canvas) return;

    const viewW = canvas.width;
    const viewH = canvas.height;
    const isTraveling = Boolean(
      playState?.travel && !playState?.isTravelPaused && !playState?.rest,
    );
    const showSnow = options.showSnow !== false;
    const worldSnapshot = options.world ?? getWorld();
    const nextKey = travelKey(playState?.travel);
    const dimensionsChanged =
      state.cachedW !== viewW || state.cachedH !== viewH;
    const snowModeChanged = state.lastShowSnow !== showSnow;
    const idlePreviewTravel =
      nextKey === null && !state.lastTravel
        ? createIdlePreviewTravel(worldSnapshot, playState)
        : null;
    const idleKey = idlePreviewTravel?.__journeyIdleKey ?? null;
    state.idleTravel = idlePreviewTravel ?? null;

    if (nextKey !== null && nextKey !== state.travelKey) {
      if (state.strip === null) {
        state.strip = buildJourneyStrip(playState.travel, viewW, viewH, {
          showSnow,
        });
      } else {
        extendStripWithTravel(state.strip, playState.travel, viewW, viewH, {
          showSnow,
        });
      }
      state.lastTravel = playState.travel;
      state.idleTravel = null;
      state.travelKey = nextKey;
      state.idleKey = null;
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
    } else if (
      idlePreviewTravel &&
      (state.strip === null ||
        dimensionsChanged ||
        snowModeChanged ||
        state.idleKey !== idleKey)
    ) {
      state.strip = buildJourneyStrip(idlePreviewTravel, viewW, viewH, {
        showSnow,
      });
      state.idleKey = idleKey;
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
    } else if (dimensionsChanged || snowModeChanged) {
      if (state.lastTravel) {
        state.strip = buildJourneyStrip(state.lastTravel, viewW, viewH, {
          showSnow,
        });
      }
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
    }

    renderFrame(
      playState,
      viewW,
      viewH,
      isTraveling,
      options.debug ?? false,
      worldSnapshot,
    );
  }

  function reset() {
    state.strip = null;
    state.travelKey = null;
    state.lastTravel = null;
    state.idleTravel = null;
    state.lastShowSnow = true;
    state.lastScrollX = 0;
    state.cachedW = 0;
    state.cachedH = 0;
    state.idleKey = null;
    state.presentationSnapshot = {
      viewW: 0,
      viewH: 0,
      startMarkerCanvasX: null,
      destMarkerCanvasX: null,
    };
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function getDebugSnapshot() {
    const strip = state.strip;
    return {
      built: strip ? "yes" : "no",
      totalStripPx: strip?.totalStripPx ?? 0,
      routePx: strip?.routePx ?? 0,
      groundSegs: strip?.layerSegments?.ground?.length ?? 0,
    };
  }

  function getPresentationSnapshot() {
    return { ...state.presentationSnapshot };
  }

  function renderFrame(
    playState,
    viewW,
    viewH,
    isTraveling,
    debug = false,
    world = null,
  ) {
    const strip = state.strip;
    const markerTravel = playState?.travel ?? state.lastTravel ?? state.idleTravel;
    const playerX = Math.round(viewW * PLAYER_X_FRAC);
    const playerFeetY = Math.round(viewH * PLAYER_FEET_Y_FRAC);
    const markerAnchorX = viewW / 2;
    let scrollX = state.lastScrollX;
    if (strip && playState?.travel) {
      const progress = Math.max(
        0,
        Math.min(
          playState.travel.totalLength ?? 0,
          playState.travel.progress ?? 0,
        ),
      );
      scrollX =
        strip.startMarkerStripX +
        progress * strip.pxPerWorld +
        playerX -
        markerAnchorX;
      state.lastScrollX = scrollX;
    } else if (strip) {
      if (state.lastTravel) {
        scrollX = strip.destMarkerStripX + playerX - markerAnchorX;
      } else if (state.idleTravel) {
        // Idle preview is anchored at the local node/departure point so the
        // player consistently stands on land when idle at a node.
        const idleAnchorScrollX =
          strip.startMarkerStripX +
          playerX -
          markerAnchorX;
        scrollX = snapScrollXToNearestLand(strip, idleAnchorScrollX);
      } else {
        scrollX =
          strip.startMarkerStripX +
          strip.routePx * 0.45 +
          playerX -
          markerAnchorX;
      }
      state.lastScrollX = scrollX;
    }

    ctx.clearRect(0, 0, viewW, viewH);
    const skyState = createSkyState(playState?.timeOfDayHours, viewW, viewH, {
      elapsedHours: playState?.journeyElapsedHours ?? playState?.hungerElapsedHours,
      skySeed: world?.params?.seed,
    });
    const skyHazeRgb = skyState.horizonRgb;

    drawSky(ctx, viewW, viewH, skyState);
    drawOceanHorizon(ctx, viewW, viewH, skyState);

    if (!strip) {
      state.presentationSnapshot = {
        viewW,
        viewH,
        startMarkerCanvasX: null,
        destMarkerCanvasX: null,
      };
      return;
    }

    const groundTopY = strip.layers.ground.topY;

    drawSilhouetteLayer(ctx, strip, "far", scrollX, playerX, viewW, skyHazeRgb);
    drawSilhouetteLayer(ctx, strip, "mid", scrollX, playerX, viewW, skyHazeRgb);
    drawSilhouetteLayer(
      ctx,
      strip,
      "near2",
      scrollX,
      playerX,
      viewW,
      skyHazeRgb,
    );
    drawTreeDecorationsForLayer(ctx, strip, "near2", scrollX, playerX, viewW);

    drawSilhouetteLayer(
      ctx,
      strip,
      "near1",
      scrollX,
      playerX,
      viewW,
      skyHazeRgb,
    );
    drawTreeDecorationsForLayer(ctx, strip, "near1", scrollX, playerX, viewW);

    drawGroundLayer(ctx, strip, scrollX, playerX, viewW);
    drawGroundDetails(ctx, strip, scrollX, playerX, viewW);
    drawGroundTrees(ctx, strip, scrollX, playerX, viewW);
    drawDepartureFoothold(
      ctx,
      strip,
      scrollX,
      playerX,
      groundTopY,
      playerFeetY,
      playState?.travel?.progress ?? Number.POSITIVE_INFINITY,
    );

    const markerSnapshot = drawNodeMarkers({
      ctx,
      strip,
      scrollX,
      playerX,
      groundTopY,
      playerFeetY,
      viewH,
      activeTravel: markerTravel,
      travelProgress: playState?.travel?.progress ?? null,
      travelTotalLength: playState?.travel?.totalLength ?? null,
      world,
    });

    state.presentationSnapshot = {
      viewW,
      viewH,
      startMarkerCanvasX: markerSnapshot.startMarkerCanvasX,
      destMarkerCanvasX: markerSnapshot.destMarkerCanvasX,
    };

    drawPlayerFigure(ctx, playerX, playerFeetY, isTraveling);

    drawForegroundCanopyTrees(ctx, strip, scrollX, playerX, viewW, viewH);
    drawNightVeil(ctx, viewW, viewH, skyState);

    if (debug) {
      drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH);
    }
  }
}

function snapScrollXToNearestLand(strip, scrollX) {
  if (!strip?.layerSegments?.ground?.length || !Number.isFinite(scrollX)) {
    return scrollX;
  }
  const segments = strip.layerSegments.ground;
  const underfoot = findGroundSegmentAtStripX(segments, scrollX);
  if (!underfoot || !isWaterBiomeKey(underfoot.biomeKey)) {
    return scrollX;
  }

  let bestCenterX = scrollX;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    if (!segment || segment.isBlend || isWaterBiomeKey(segment.biomeKey)) continue;
    const centerX = segment.stripX + segment.stripWidth * 0.5;
    const distance = Math.abs(centerX - scrollX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCenterX = centerX;
    }
  }
  return bestCenterX;
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

function isWaterBiomeKey(biomeKey) {
  return biomeKey === "ocean" || biomeKey === "lake";
}
