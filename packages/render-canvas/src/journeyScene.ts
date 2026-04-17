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
} from "./journey/journeyStrip";
import { drawPlayerFigure } from "./journey/journeyStyle";
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
} from "./journey/journeyLayerRenderers";
import {
  createSkyState,
  drawNightVeil,
  drawOceanHorizon,
  drawSky,
} from "./journey/journeySky";
import {
  createIdlePreviewTravel,
  travelKey,
} from "./journey/journeySceneHelpers";

interface JourneyUpdateOptions {
  showSnow?: boolean;
  world?: unknown;
  debug?: boolean;
}

// Player's fixed horizontal position (fraction of canvas width)
const PLAYER_X_FRAC = 0.22;

// Player's feet vertical position (fraction of canvas height).
// Should sit slightly below the ground top edge.
const PLAYER_FEET_Y_FRAC = 0.83;
const IDLE_CLOUD_DRIFT_HOURS_PER_REAL_SECOND = 0.035;
const CAMPFIRE_FLICKER_FRAME_MS = 140;
const CAMPFIRE_FLICKER_SCALE_BY_FRAME = [0.84, 1.08, 0.92];

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
    idleCloudDriftHours: 0,
    lastUpdateTimestampMs: null,
    cachedW: 0,
    cachedH: 0,
    idleKey: null,
    presentationSnapshot: {
      viewW: 0,
      viewH: 0,
      startMarkerCanvasX: null,
      destMarkerCanvasX: null,
    },
    nightVeilCanvas: null,
    nightVeilCtx: null,
  };

  return {
    update,
    reset,
    getDebugSnapshot,
    getPresentationSnapshot,
  };

  function update(playState, options: JourneyUpdateOptions = {}) {
    if (!canvas) return;

    const viewW = canvas.width;
    const viewH = canvas.height;
    const isTraveling = Boolean(
      playState?.travel && !playState?.isTravelPaused && !playState?.rest,
    );
    const isResting = Boolean(playState?.rest);
    const isHunting = Boolean(playState?.hunt);
    const shouldAdvanceWorldTime = isTraveling || isResting || isHunting;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const previousUpdateTimestampMs =
      state.lastUpdateTimestampMs == null ? nowMs : state.lastUpdateTimestampMs;
    const deltaMs = Math.min(250, Math.max(0, nowMs - previousUpdateTimestampMs));
    state.lastUpdateTimestampMs = nowMs;
    if (!shouldAdvanceWorldTime && deltaMs > 0) {
      state.idleCloudDriftHours +=
        (deltaMs / 1000) * IDLE_CLOUD_DRIFT_HOURS_PER_REAL_SECOND;
    }
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

    // Extending from an idle-preview strip can leak its local coastline noise
    // into the first real journey leg, so only extend a confirmed travel chain.
    const canExtendFromExistingStrip = canExtendTravelStrip(
      state,
      playState?.travel,
    );

    if (nextKey !== null && nextKey !== state.travelKey) {
      if (canExtendFromExistingStrip) {
        extendStripWithTravel(state.strip, playState.travel, viewW, viewH, {
          showSnow,
        });
      } else {
        state.strip = buildJourneyStrip(playState.travel, viewW, viewH, {
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
    state.idleCloudDriftHours = 0;
    state.lastUpdateTimestampMs = null;
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
    const elapsedWorldHours = Number.isFinite(playState?.renderElapsedWorldHours)
      ? Math.max(0, playState.renderElapsedWorldHours)
      : Number.isFinite(playState?.journeyElapsedHours)
        ? Math.max(0, playState.journeyElapsedHours)
        : Number.isFinite(playState?.hungerElapsedHours)
          ? Math.max(0, playState.hungerElapsedHours)
          : 0;
    const renderTimeOfDayHours = Number.isFinite(playState?.renderTimeOfDayHours)
      ? playState.renderTimeOfDayHours
      : playState?.timeOfDayHours;
    const skyState = createSkyState(renderTimeOfDayHours, viewW, viewH, {
      elapsedHours: elapsedWorldHours,
      cloudDriftHours: elapsedWorldHours + state.idleCloudDriftHours,
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
    drawTreeDecorationsForLayer(ctx, strip, "far", scrollX, playerX, viewW);
    drawSilhouetteLayer(ctx, strip, "mid", scrollX, playerX, viewW, skyHazeRgb);
    drawTreeDecorationsForLayer(ctx, strip, "mid", scrollX, playerX, viewW);
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
    drawNightVeilWithCampfireCutout(
      ctx,
      state,
      viewW,
      viewH,
      skyState,
      markerSnapshot.settlementLightAnchors ?? [],
    );

    if (debug) {
      drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH);
    }
  }
}

function drawNightVeilWithCampfireCutout(
  ctx,
  sceneState,
  viewW,
  viewH,
  skyState,
  anchors,
) {
  const overlay = ensureNightVeilOverlay(sceneState, viewW, viewH);
  if (!overlay) {
    drawNightVeil(ctx, viewW, viewH, skyState);
    return;
  }

  overlay.clearRect(0, 0, viewW, viewH);
  drawNightVeil(overlay, viewW, viewH, skyState);
  carveCampfireVisibilityInVeil(overlay, anchors, skyState);
  ctx.drawImage(sceneState.nightVeilCanvas, 0, 0);
}

function carveCampfireVisibilityInVeil(overlayCtx, anchors, skyState) {
  if (!anchors?.length) return;
  const nightFactor = clamp01(
    (Number(skyState?.night) || 0) * 1.2 +
      (Number(skyState?.twilight) || 0) * 0.32 -
      (Number(skyState?.daylight) || 0) * 0.2,
  );
  if (nightFactor <= 0.01) return;

  const nowMs =
    typeof performance !== "undefined" && Number.isFinite(performance.now())
      ? performance.now()
      : Date.now();
  const frameIndex =
    Math.floor(Math.max(0, nowMs) / CAMPFIRE_FLICKER_FRAME_MS) %
    CAMPFIRE_FLICKER_SCALE_BY_FRAME.length;
  const frameScale =
    CAMPFIRE_FLICKER_SCALE_BY_FRAME[frameIndex] ??
    CAMPFIRE_FLICKER_SCALE_BY_FRAME[0];
  const jitter = 0.9 + 0.1 * Math.sin(nowMs / 95);
  const flickerScale = frameScale * jitter;

  const innerCutAlpha = 0.5 + nightFactor * 0.56;
  const outerCutAlpha = 0.26 + nightFactor * 0.4;
  const innerRadius = (56 + nightFactor * 38) * flickerScale;
  const outerRadius = (126 + nightFactor * 96) * flickerScale;

  overlayCtx.save();
  overlayCtx.globalCompositeOperation = "destination-out";

  for (const anchor of anchors) {
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
      continue;
    }

    const outerCut = overlayCtx.createRadialGradient(
      anchor.x,
      anchor.y,
      0,
      anchor.x,
      anchor.y,
      outerRadius,
    );
    outerCut.addColorStop(0, `rgba(0, 0, 0, ${outerCutAlpha})`);
    outerCut.addColorStop(0.58, `rgba(0, 0, 0, ${outerCutAlpha * 0.56})`);
    outerCut.addColorStop(1, "rgba(0, 0, 0, 0)");
    overlayCtx.fillStyle = outerCut;
    overlayCtx.beginPath();
    overlayCtx.arc(anchor.x, anchor.y, outerRadius, 0, Math.PI * 2);
    overlayCtx.fill();

    const innerCut = overlayCtx.createRadialGradient(
      anchor.x,
      anchor.y,
      0,
      anchor.x,
      anchor.y,
      innerRadius,
    );
    innerCut.addColorStop(0, `rgba(0, 0, 0, ${innerCutAlpha})`);
    innerCut.addColorStop(0.52, `rgba(0, 0, 0, ${innerCutAlpha * 0.62})`);
    innerCut.addColorStop(1, "rgba(0, 0, 0, 0)");
    overlayCtx.fillStyle = innerCut;
    overlayCtx.beginPath();
    overlayCtx.arc(anchor.x, anchor.y, innerRadius, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  overlayCtx.restore();
}

function ensureNightVeilOverlay(sceneState, viewW, viewH) {
  if (typeof document === "undefined") return null;
  if (!sceneState.nightVeilCanvas) {
    const overlayCanvas = document.createElement("canvas");
    const overlayCtx = overlayCanvas.getContext("2d");
    if (!overlayCtx) return null;
    sceneState.nightVeilCanvas = overlayCanvas;
    sceneState.nightVeilCtx = overlayCtx;
  }
  if (
    sceneState.nightVeilCanvas.width !== viewW ||
    sceneState.nightVeilCanvas.height !== viewH
  ) {
    sceneState.nightVeilCanvas.width = viewW;
    sceneState.nightVeilCanvas.height = viewH;
  }
  return sceneState.nightVeilCtx;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
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

function canExtendTravelStrip(state, nextTravel) {
  if (!state?.strip || !nextTravel || state.idleKey != null) {
    return false;
  }
  if (!state.lastTravel || state.travelKey == null) {
    return false;
  }
  const previousTargetNodeId = state.lastTravel.targetNodeId;
  const nextStartNodeId = nextTravel.startNodeId;
  if (previousTargetNodeId == null || nextStartNodeId == null) {
    return false;
  }
  if (previousTargetNodeId !== nextStartNodeId) {
    return false;
  }

  // Rebuild when crossing between sea and land route types to avoid seam
  // artifacts during coastline transitions (especially sea-route landings).
  if (
    isSeaRouteType(state.lastTravel.routeType) !==
    isSeaRouteType(nextTravel.routeType)
  ) {
    return false;
  }

  return true;
}

function isSeaRouteType(routeType) {
  return routeType === "sea-route";
}
