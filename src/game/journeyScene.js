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
 *   – Both POI markers are part of the strip and scroll with it.
 *   – No per-frame terrain generation; no special-case arrival logic.
 */

import {
  buildJourneyStrip,
  extendStripWithTravel,
  PARALLAX_SPEED,
} from "./journey/journeyStrip.js";
import {
  buildSilhouettePolygon,
  drawPoiMarkerOnCanvas,
  drawPlayerFigure,
} from "./journey/journeyStyle.js";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// Player's fixed horizontal position (fraction of canvas width)
const PLAYER_X_FRAC = 0.22;

// Player's feet vertical position (fraction of canvas height).
// Should sit slightly below the ground top edge.
const PLAYER_FEET_Y_FRAC = 0.8;

// Walk animation frame toggle interval
const WALK_FRAME_MS = 220;

// POI marker sizes
const POI_OUTER_R = 7;
const POI_INNER_R = 3.2;

// Sky gradient
const SKY_TOP = "rgb(169, 212, 238)";
const SKY_BTM = "rgb(148, 198, 230)";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ canvas: HTMLCanvasElement }} options
 */
export function createJourneyScene({ canvas }) {
  const state = {
    strip: null,
    travelKey: null,
    lastTravel: null,
    lastScrollX: 0,
    walkFrame: 0,
    lastWalkToggle: 0,
    cachedW: 0,
    cachedH: 0,
  };

  return { update, reset, getDebugSnapshot };

  // -------------------------------------------------------------------------

  function update(playState) {
    if (!canvas) return;

    const viewW = canvas.width;
    const viewH = canvas.height;
    const isTraveling = Boolean(playState?.travel);

    // Rebuild strip only when a new travel starts (key changes to a non-null value).
    // When travel ends (key → null) we keep the existing strip so the scene
    // stays visible at the destination until the next trip.
    const nextKey = travelKey(playState?.travel);
    const dimensionsChanged =
      state.cachedW !== viewW || state.cachedH !== viewH;

    if (nextKey !== null && nextKey !== state.travelKey) {
      if (state.strip === null) {
        // First journey – build full strip including the home-position extension before start
        state.strip = buildJourneyStrip(playState.travel, null, viewW, viewH);
      } else {
        // Subsequent journey – extend the existing strip seamlessly from the current dest
        extendStripWithTravel(state.strip, playState.travel, viewW, viewH);
      }
      state.lastTravel = playState.travel;
      state.travelKey = nextKey;
      state.cachedW = viewW;
      state.cachedH = viewH;
    } else if (dimensionsChanged) {
      // Canvas resized – rebuild with the same travel data if we have it
      if (state.lastTravel) {
        state.strip = buildJourneyStrip(state.lastTravel, null, viewW, viewH);
      }
      state.cachedW = viewW;
      state.cachedH = viewH;
    }

    renderFrame(playState, viewW, viewH, isTraveling);
  }

  function reset() {
    state.strip = null;
    state.travelKey = null;
    state.lastTravel = null;
    state.lastScrollX = 0;
    state.walkFrame = 0;
    state.lastWalkToggle = 0;
    state.cachedW = 0;
    state.cachedH = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function getDebugSnapshot() {
    const s = state.strip;
    return {
      built: s ? "yes" : "no",
      totalStripPx: s?.totalStripPx ?? 0,
      routePx: s?.routePx ?? 0,
      groundSegs: s?.layerSegments?.ground?.length ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderFrame(playState, viewW, viewH, isTraveling) {
    const ctx = canvas.getContext("2d");
    const strip = state.strip;
    const playerX = Math.round(viewW * PLAYER_X_FRAC);
    const playerFeetY = Math.round(viewH * PLAYER_FEET_Y_FRAC);

    // POI markers are anchored to screen center (viewW/2).
    // At progress=0 the start marker is centered; at progress=total the dest marker is centered.
    // The formula is: scrollX = startMarkerStripX + progress*pxPerWorld + playerX - viewW/2
    // which gives: markerCanvasX = markerStripX - scrollX + playerX = viewW/2  at the right progress.
    const markerAnchorX = viewW / 2;

    // Compute scroll position.
    // While traveling: advance with progress.
    // After arrival (strip present, no travel): lock at destination marker.
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
      scrollX = strip.destMarkerStripX + playerX - markerAnchorX;
      state.lastScrollX = scrollX;
    }

    // Walk animation
    const now = performance.now();
    if (isTraveling && now - state.lastWalkToggle > WALK_FRAME_MS) {
      state.walkFrame ^= 1;
      state.lastWalkToggle = now;
    }

    // Clear
    ctx.clearRect(0, 0, viewW, viewH);

    // 1. Sky (fully static)
    drawSky(ctx, viewW, viewH);

    if (!strip) return;

    const groundTopY = strip.layers.ground.topY;

    // Helper: compute the canvas x for a strip-local pixel at a given parallax speed
    // canvasX = (stripX - scrollX * speed) + playerX
    //         = stripX - (scrollX * speed - playerX)
    // So layerStripLeft = scrollX * speed - playerX
    // and canvasX = stripX - layerStripLeft

    // 2. Far (slowest)
    drawSilhouetteLayer(ctx, strip, "far", scrollX, playerX, viewW);

    // 3. Mid
    drawSilhouetteLayer(ctx, strip, "mid", scrollX, playerX, viewW);

    // 4. Near2
    drawSilhouetteLayer(ctx, strip, "near2", scrollX, playerX, viewW);

    // 5. Near1
    drawSilhouetteLayer(ctx, strip, "near1", scrollX, playerX, viewW);

    // 6. Ground (flat solid bands, ground speed = 1.0)
    drawGroundLayer(ctx, strip, scrollX, playerX, viewW);

    // 7. Player (fixed – behind foreground so foreground overlaps lower body)
    if (strip) {
      drawPlayerFigure(
        ctx,
        playerX,
        playerFeetY,
        isTraveling ? state.walkFrame : 0,
      );
    }

    // 8. Foreground (fastest – in front of player)
    drawSilhouetteLayer(ctx, strip, "foreground", scrollX, playerX, viewW);

    // 9. POI markers last – always on top of all layers
    drawPoiMarkers(ctx, strip, scrollX, playerX, groundTopY);
  }

  // -------------------------------------------------------------------------
  // Layer drawing
  // -------------------------------------------------------------------------

  function drawSky(ctx, viewW, viewH) {
    const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.68);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(1, SKY_BTM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  function drawGroundLayer(ctx, strip, scrollX, playerX, viewW) {
    const speed = PARALLAX_SPEED.ground;
    const layerStripLeft = scrollX * speed - playerX;
    const { topY, bottomY } = strip.layers.ground;
    const layerH = bottomY - topY;

    for (const seg of strip.layerSegments.ground) {
      const canvasX = seg.stripX - layerStripLeft;
      if (canvasX + seg.stripWidth < 0 || canvasX > viewW) continue;
      ctx.fillStyle = seg.color;
      ctx.fillRect(
        Math.floor(canvasX),
        topY,
        Math.ceil(seg.stripWidth) + 1,
        layerH,
      );
    }
  }

  function drawSilhouetteLayer(ctx, strip, layerName, scrollX, playerX, viewW) {
    const segs = strip.layerSegments[layerName];
    if (!segs?.length) return;

    const speed = PARALLAX_SPEED[layerName] ?? 1.0;
    const layerStripLeft = scrollX * speed - playerX;
    const band = strip.layers[layerName];
    if (!band) return;

    const { topY, bottomY } = band;

    for (const seg of segs) {
      if (!seg.topEdgeSamples) continue;
      const canvasX = seg.stripX - layerStripLeft;
      if (canvasX + seg.stripWidth < 0 || canvasX > viewW) continue;

      const points = buildSilhouettePolygon(
        seg.topEdgeSamples,
        canvasX,
        topY,
        bottomY,
      );
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
    }
  }

  function drawPoiMarkers(ctx, strip, scrollX, playerX, groundTopY) {
    const speed = PARALLAX_SPEED.ground;
    const layerStripLeft = scrollX * speed - playerX;
    const markerY = groundTopY + POI_OUTER_R + 2;

    const startCanvasX = strip.startMarkerStripX - layerStripLeft;
    const destCanvasX = strip.destMarkerStripX - layerStripLeft;

    drawPoiMarkerOnCanvas(ctx, startCanvasX, markerY, POI_OUTER_R, POI_INNER_R);
    drawPoiMarkerOnCanvas(ctx, destCanvasX, markerY, POI_OUTER_R, POI_INNER_R);
  }
}

// ---------------------------------------------------------------------------

function travelKey(travel) {
  if (!travel) return null;
  return [
    travel.startCityId ?? "-",
    travel.targetCityId ?? "-",
    (travel.totalLength ?? 0).toFixed(2),
    travel.biomeSegments?.length ?? 0,
    travel.biomeBandSegments?.near?.segments?.length ?? 0,
  ].join(":");
}
