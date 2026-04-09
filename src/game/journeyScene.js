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
} from "./journey/journeyStrip.js?v=20260409q";
import { buildTravelBiomeBandSegments } from "./travel.js?v=20260409c";
import {
  drawPoiMarkerOnCanvas,
  drawJourneyTreeOnCanvas,
  drawPlayerFigure,
} from "./journey/journeyStyle.js?v=20260409l";
import {
  DEFAULT_TIME_OF_DAY_HOURS,
  normalizeTimeOfDayHours,
} from "./timeOfDay.js";

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

const POI_MARKER_SCALE = 1.35;
const PLAYER_VISUAL_HEIGHT_PX = 55;
const SIGNPOST_VISUAL_HEIGHT_PX = 104;
const SIGNPOST_UPWARD_OFFSET_PX = 18;
const IDLE_PREVIEW_POINT_COUNT = 14;
const IDLE_PREVIEW_SPAN_MIN = 14;
const IDLE_PREVIEW_SPAN_MAX = 34;
const GROUND_TOP_FRAC = 0.67;
const OCEAN_HORIZON_TOP_FRAC = 0.45;

// Sky colour presets used by the time-of-day interpolator.
const DAY_SKY_TOP_RGB = [140, 197, 236];
const DAY_SKY_BOTTOM_RGB = [210, 228, 240];
const TWILIGHT_SKY_TOP_RGB = [79, 109, 171];
const TWILIGHT_SKY_BOTTOM_RGB = [246, 170, 120];
const NIGHT_SKY_TOP_RGB = [14, 24, 48];
const NIGHT_SKY_BOTTOM_RGB = [49, 70, 104];

// Atmospheric haze per silhouette layer: how much the top of each layer
// fades toward the sky horizon colour. 0 = none, 1 = full sky colour.
const LAYER_HAZE = { far: 0.42, mid: 0.20, near2: 0.07, near1: 0, foreground: 0 };
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ canvas: HTMLCanvasElement, getWorld?: () => object | null }} options
 */
export function createJourneyScene({ canvas, getWorld = () => null }) {
  const ctx = canvas ? canvas.getContext("2d") : null;
  const state = {
    strip: null,
    travelKey: null,
    lastTravel: null,
    lastShowSnow: true,
    lastScrollX: 0,
    walkFrame: 0,
    lastWalkToggle: 0,
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

  return { update, reset, getDebugSnapshot, getPresentationSnapshot };

  // -------------------------------------------------------------------------

  function update(playState, options = {}) {
    if (!canvas) return;

    const viewW = canvas.width;
    const viewH = canvas.height;
    const isTraveling = Boolean(playState?.travel);
    const showSnow = options.showSnow !== false;
    const worldSnapshot = options.world ?? getWorld();

    // Rebuild strip only when a new travel starts (key changes to a non-null value).
    // When travel ends (key → null) we keep the existing strip so the scene
    // stays visible at the destination until the next trip.
    const nextKey = travelKey(playState?.travel);
    const dimensionsChanged =
      state.cachedW !== viewW || state.cachedH !== viewH;
    const snowModeChanged = state.lastShowSnow !== showSnow;
    const idlePreviewTravel =
      nextKey === null && !state.lastTravel
        ? createIdlePreviewTravel(worldSnapshot, playState)
        : null;
    const idleKey = idlePreviewTravel?.__journeyIdleKey ?? null;

    if (nextKey !== null && nextKey !== state.travelKey) {
      if (state.strip === null) {
        // First journey – build full strip including the home-position extension before start
        state.strip = buildJourneyStrip(playState.travel, viewW, viewH, {
          showSnow,
        });
        printStripSummary(state.strip, "New strip");
      } else {
        // Subsequent journey – extend the existing strip seamlessly from the current dest
        extendStripWithTravel(state.strip, playState.travel, viewW, viewH, {
          showSnow,
        });
        printStripSummary(state.strip, "Extended strip");
      }
      state.lastTravel = playState.travel;
      state.travelKey = nextKey;
      state.idleKey = null;
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
    } else if (
      idlePreviewTravel &&
      (
        state.strip === null ||
        dimensionsChanged ||
        snowModeChanged ||
        state.idleKey !== idleKey
      )
    ) {
      state.strip = buildJourneyStrip(idlePreviewTravel, viewW, viewH, {
        showSnow,
      });
      state.idleKey = idleKey;
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
      printStripSummary(state.strip, "Idle preview strip");
    } else if (dimensionsChanged || snowModeChanged) {
      // Canvas resized or snow mode changed – rebuild with the same travel data if we have it.
      if (state.lastTravel) {
        state.strip = buildJourneyStrip(state.lastTravel, viewW, viewH, {
          showSnow,
        });
        printStripSummary(
          state.strip,
          snowModeChanged ? "Rebuilt strip (snow mode)" : "Rebuilt strip (resize)",
        );
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
    state.lastShowSnow = true;
    state.lastScrollX = 0;
    state.walkFrame = 0;
    state.lastWalkToggle = 0;
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
    const s = state.strip;
    return {
      built: s ? "yes" : "no",
      totalStripPx: s?.totalStripPx ?? 0,
      routePx: s?.routePx ?? 0,
      groundSegs: s?.layerSegments?.ground?.length ?? 0,
    };
  }

  function getPresentationSnapshot() {
    return { ...state.presentationSnapshot };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderFrame(
    playState,
    viewW,
    viewH,
    isTraveling,
    debug = false,
    world = null,
  ) {
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
      if (state.lastTravel) {
        scrollX = strip.destMarkerStripX + playerX - markerAnchorX;
      } else {
        scrollX =
          strip.startMarkerStripX +
          strip.routePx * 0.45 +
          playerX -
          markerAnchorX;
      }
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
    const skyState = createSkyState(playState?.timeOfDayHours, viewW, viewH);
    const skyHazeRgb = skyState.horizonRgb;

    // 1. Sky (fully static)
    drawSky(ctx, viewW, viewH, skyState);

    // 2. Ocean horizon (fully static – behind all silhouette layers).
    // Tall terrain in the far layer (mountains, forest, highlands) naturally
    // paints over this; flat terrain (plains, ocean biome) lets it show through.
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

    // Helper: compute the canvas x for a strip-local pixel at a given parallax speed
    // canvasX = (stripX - scrollX * speed) + playerX
    //         = stripX - (scrollX * speed - playerX)
    // So layerStripLeft = scrollX * speed - playerX
    // and canvasX = stripX - layerStripLeft

    // 3. Far (slowest)
    drawSilhouetteLayer(ctx, strip, "far", scrollX, playerX, viewW, skyHazeRgb);

    // 4. Mid
    drawSilhouetteLayer(ctx, strip, "mid", scrollX, playerX, viewW, skyHazeRgb);

    // 5. Near2
    drawSilhouetteLayer(ctx, strip, "near2", scrollX, playerX, viewW, skyHazeRgb);
    drawTreeDecorationsForLayer(ctx, strip, "near2", scrollX, playerX, viewW);

    // 6. Near1
    drawSilhouetteLayer(ctx, strip, "near1", scrollX, playerX, viewW, skyHazeRgb);
    drawTreeDecorationsForLayer(ctx, strip, "near1", scrollX, playerX, viewW);

    // 7. Ground (flat solid bands, ground speed = 1.0)
    drawGroundLayer(ctx, strip, scrollX, playerX, viewW);
    drawGroundDetails(ctx, strip, scrollX, playerX, viewW);
    drawGroundTrees(ctx, strip, scrollX, playerX, viewW);

    // 8. POI markers – behind the player but above all background layers
    const markerSnapshot = drawPoiMarkers(
      ctx,
      strip,
      scrollX,
      playerX,
      groundTopY,
      playerFeetY,
      viewH,
      playState,
      world,
    );
    state.presentationSnapshot = {
      viewW,
      viewH,
      startMarkerCanvasX: markerSnapshot.startMarkerCanvasX,
      destMarkerCanvasX: markerSnapshot.destMarkerCanvasX,
    };

    // 9. Player (fixed – behind foreground so foreground overlaps lower body)
    drawPlayerFigure(
      ctx,
      playerX,
      playerFeetY,
      isTraveling ? state.walkFrame : 0,
    );

    // 10. Foreground sprite layer (fastest – in front of player and POI markers)
    // No polygon fill here; only sprite props (trees/cacti/etc.) should swish past.
    drawForegroundCanopyTrees(ctx, strip, scrollX, playerX, viewW, viewH);
    drawNightVeil(ctx, viewW, viewH, skyState);

    // 11. Debug overlay (segment boundaries) – only when enabled
    if (debug) {
      drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH);
    }
  }

  // -------------------------------------------------------------------------
  // Layer drawing
  // -------------------------------------------------------------------------

  function drawSky(ctx, viewW, viewH, skyState) {
    const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.78);
    grad.addColorStop(0, rgbCssFromArray(skyState.topRgb));
    grad.addColorStop(0.62, rgbCssFromArray(skyState.middleRgb));
    grad.addColorStop(1, rgbCssFromArray(skyState.bottomRgb));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);

    drawSun(ctx, skyState);
    drawMoon(ctx, skyState);
  }

  /**
   * Static ocean/horizon band that fills the entire silhouette zone.
   * All parallax silhouette layers paint over it, so tall biomes (mountains,
   * forest, highlands) in the far layer naturally mask it while flat biomes
   * (plains, desert, ocean) let it show through near the horizon.
   */
  function drawOceanHorizon(ctx, viewW, viewH, skyState) {
    // Keep ocean base aligned with ground top, but drop the visible horizon
    // slightly to place the sea lower in frame.
    const top = Math.round(viewH * OCEAN_HORIZON_TOP_FRAC);
    const bottom = Math.round(viewH * GROUND_TOP_FRAC);
    const h = bottom - top;
    const horizon = skyState.horizonRgb;
    const daylight = skyState.daylight;
    const night = skyState.night;
    const twilight = skyState.twilight;
    const nearHorizon = lerpRgb(horizon, [183, 208, 230], daylight * 0.5);
    const midOcean = lerpRgb([55, 86, 125], [96, 152, 188], daylight);
    const deepOcean = lerpRgb([38, 62, 96], [63, 114, 155], daylight);
    const floorOcean = lerpRgb([28, 46, 76], [50, 100, 144], daylight);

    // Main ocean gradient: airy horizon haze at top → deep ocean blue at bottom
    const ocean = ctx.createLinearGradient(0, top, 0, bottom);
    ocean.addColorStop(0.00, rgbCssFromArray(horizon)); // flush with sky horizon
    ocean.addColorStop(0.12, rgbCssFromArray(nearHorizon)); // pale ocean near horizon
    ocean.addColorStop(0.38, rgbCssFromArray(midOcean)); // mid ocean
    ocean.addColorStop(0.70, rgbCssFromArray(deepOcean)); // deeper ocean
    ocean.addColorStop(1.00, rgbCssFromArray(floorOcean)); // darkest – bottom of zone
    ctx.fillStyle = ocean;
    ctx.fillRect(0, top, viewW, h);

    // Thin specular glare line just below the sky/ocean seam
    const glareY = top + Math.round(h * 0.10);
    const glare = ctx.createLinearGradient(0, glareY - 1, 0, glareY + 3);
    glare.addColorStop(0,   'rgba(255, 255, 255, 0)');
    glare.addColorStop(0.4, `rgba(255, 255, 255, ${0.11 + daylight * 0.2 + twilight * 0.1 - night * 0.07})`);
    glare.addColorStop(1,   'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glare;
    ctx.fillRect(0, glareY - 1, viewW, 4);
  }

  function drawGroundLayer(ctx, strip, scrollX, playerX, viewW) {
    const speed = PARALLAX_SPEED.ground;
    const layerStripLeft = scrollX * speed - playerX;
    const { topY, bottomY } = strip.layers.ground;
    const layerH = bottomY - topY;

    // 1. Solid fills
    for (const seg of strip.layerSegments.ground) {
      const canvasX = seg.stripX - layerStripLeft;
      if (canvasX + seg.stripWidth < 0 || canvasX > viewW) continue;
      ctx.fillStyle = seg.color;
      ctx.fillRect(Math.floor(canvasX), topY, Math.ceil(seg.stripWidth) + 1, layerH);
    }

    // 2. Colour-blend gradient at each biome boundary
    const segs = strip.layerSegments.ground;
    const bz = strip.blendZonePx ?? 48;
    const half = bz / 2;
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i];
      const b = segs[i + 1];
      if (!a.colorRgb || !b.colorRgb || a.biomeKey === b.biomeKey) continue;
      const seamCanvasX = a.stripX + a.stripWidth - layerStripLeft;
      if (seamCanvasX + half < 0 || seamCanvasX - half > viewW) continue;
      const [ar, ag, ab] = a.colorRgb;
      const [br, bg, bb] = b.colorRgb;
      const grad = ctx.createLinearGradient(
        seamCanvasX - half,
        0,
        seamCanvasX + half,
        0,
      );
      grad.addColorStop(0, `rgb(${ar},${ag},${ab})`);
      grad.addColorStop(1, `rgb(${br},${bg},${bb})`);
      ctx.fillStyle = grad;
      ctx.fillRect(
        Math.floor(seamCanvasX - half),
        topY,
        Math.ceil(bz) + 1,
        layerH,
      );
    }
  }

  function drawSilhouetteLayer(
    ctx,
    strip,
    layerName,
    scrollX,
    playerX,
    viewW,
    skyHazeRgb,
  ) {
    const segs = strip.layerSegments[layerName];
    if (!segs?.length) return;

    const speed = PARALLAX_SPEED[layerName] ?? 1.0;
    const layerStripLeft = scrollX * speed - playerX;
    const band = strip.layers[layerName];
    if (!band) return;

    const { topY, bottomY } = band;
    const layerH = bottomY - topY;

    for (const seg of segs) {
      const samples = seg.topEdgeSamples;
      if (!samples) continue;
      const canvasX = seg.stripX - layerStripLeft;
      if (canvasX + seg.stripWidth < 0 || canvasX > viewW) continue;

      const width = samples.length;

      const haze = LAYER_HAZE[layerName] ?? 0;

      // Silhouette polygon. Samples are 1px apart in strip space.
      // canvasX is a float — sub-pixel left edge gives smooth scrolling.
      // We clamp the loop to Math.ceil(stripWidth) so we never overshoot
      // into the adjacent segment's pixel column. Close the bottom at
      // canvasX + stripWidth (exact float, no +1 rounding overshoot).
      const drawPx = Math.ceil(seg.stripWidth); // max pixels to trace
      ctx.beginPath();
      ctx.moveTo(canvasX, bottomY);
      for (let i = 0; i < width && i <= drawPx; i++) {
        ctx.lineTo(canvasX + i, topY + samples[i] * layerH);
      }
      ctx.lineTo(canvasX + seg.stripWidth, bottomY);
      ctx.closePath();
      if (seg.isBlend && seg.colorA && seg.colorB && haze > 0) {
        // Blend segments need both horizontal biome interpolation and vertical haze.
        // Paint in thin clipped strips to avoid hard boundaries in far/mid layers.
        ctx.save();
        ctx.clip();
        const slices = Math.max(2, Math.ceil(seg.stripWidth));
        const topA = tintRgbWithSky(seg.colorA, haze, skyHazeRgb);
        const topB = tintRgbWithSky(seg.colorB, haze, skyHazeRgb);
        for (let slice = 0; slice < slices; slice += 1) {
          const t0 = slice / slices;
          const t1 = (slice + 1) / slices;
          const tm = (slice + 0.5) / slices;
          const topColor = lerpRgb(topA, topB, tm);
          const bottomColor = lerpRgb(seg.colorA, seg.colorB, tm);
          const vGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
          vGrad.addColorStop(0, rgbCssFromArray(topColor));
          vGrad.addColorStop(1, rgbCssFromArray(bottomColor));
          ctx.fillStyle = vGrad;
          const x0 = canvasX + seg.stripWidth * t0;
          const w = Math.max(1, seg.stripWidth * (t1 - t0) + 0.75);
          ctx.fillRect(x0, topY, w, layerH + 1);
        }
        ctx.restore();
        continue;
      }

      let fillStyle;
      if (seg.isBlend && seg.colorA && seg.colorB) {
        const hGrad = ctx.createLinearGradient(canvasX, 0, canvasX + seg.stripWidth, 0);
        hGrad.addColorStop(0, `rgb(${seg.colorA[0]},${seg.colorA[1]},${seg.colorA[2]})`);
        hGrad.addColorStop(1, `rgb(${seg.colorB[0]},${seg.colorB[1]},${seg.colorB[2]})`);
        fillStyle = hGrad;
      } else if (haze > 0 && seg.colorRgb) {
        const topColor = tintRgbWithSky(seg.colorRgb, haze, skyHazeRgb);
        const vGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
        vGrad.addColorStop(0, rgbCssFromArray(topColor));
        vGrad.addColorStop(1, seg.color);
        fillStyle = vGrad;
      } else {
        fillStyle = seg.color;
      }
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
  }

  function drawGroundDetails(ctx, strip, scrollX, playerX, viewW) {
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

  function drawGroundTrees(ctx, strip, scrollX, playerX, viewW) {
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

  function drawGroundDetailGlyph(ctx, x, y, detail) {
    const s = Math.max(0.65, Number(detail.scale ?? 1));
    const motif = detail.motif;
    const isSnow = Boolean(detail.isSnow);
    ctx.save();
    switch (motif) {
      case "tuft":
      case "frost-tuft": {
        ctx.strokeStyle = motif === "frost-tuft" ? "rgba(223,230,236,0.92)" : "rgba(70,98,56,0.86)";
        ctx.lineWidth = Math.max(1, 1.05 * s);
        ctx.beginPath();
        ctx.moveTo(x - 2.6 * s, y);
        ctx.lineTo(x - 0.8 * s, y - 4.8 * s);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 6.1 * s);
        ctx.moveTo(x + 2.6 * s, y);
        ctx.lineTo(x + 0.9 * s, y - 4.5 * s);
        ctx.stroke();
        break;
      }
      case "stone":
      case "pebble": {
        ctx.fillStyle = isSnow ? "rgba(178,179,182,0.8)" : "rgba(118,108,96,0.78)";
        const rx = (motif === "pebble" ? 1.8 : 2.7) * s;
        const ry = (motif === "pebble" ? 1.2 : 1.9) * s;
        ctx.beginPath();
        ctx.ellipse(x, y - ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "stick":
      case "drift": {
        ctx.strokeStyle = motif === "drift" ? "rgba(132,98,64,0.7)" : "rgba(98,74,52,0.76)";
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.beginPath();
        ctx.moveTo(x - 3 * s, y - 0.8 * s);
        ctx.lineTo(x + 3.2 * s, y - 1.8 * s);
        ctx.stroke();
        break;
      }
      case "leaf": {
        ctx.fillStyle = "rgba(82,114,62,0.75)";
        ctx.beginPath();
        ctx.ellipse(x, y - 1.5 * s, 2.4 * s, 1.6 * s, -0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "flower": {
        ctx.fillStyle = "rgba(241,216,124,0.84)";
        ctx.beginPath();
        ctx.arc(x, y - 2.2 * s, 1.4 * s, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "snow-dune": {
        ctx.fillStyle = "rgba(244,245,247,0.88)";
        ctx.beginPath();
        ctx.ellipse(x, y - 0.9 * s, 4.2 * s, 2.1 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "sand-dune": {
        ctx.fillStyle = "rgba(209,182,126,0.76)";
        ctx.beginPath();
        ctx.ellipse(x, y - 1 * s, 4.1 * s, 2.0 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "foam": {
        ctx.strokeStyle = "rgba(234,241,247,0.68)";
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.beginPath();
        ctx.moveTo(x - 3.2 * s, y - 1.4 * s);
        ctx.lineTo(x + 3.2 * s, y - 1.4 * s);
        ctx.stroke();
        break;
      }
      default:
        ctx.fillStyle = isSnow ? "rgba(188,190,194,0.7)" : "rgba(92,104,82,0.72)";
        ctx.fillRect(Math.round(x - s), Math.round(y - s), Math.max(1, Math.round(2 * s)), Math.max(1, Math.round(2 * s)));
        break;
    }
    ctx.restore();
  }

  function drawForegroundCanopyTrees(
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

  function drawPoiMarkers(
    ctx,
    strip,
    scrollX,
    playerX,
    groundTopY,
    playerFeetY,
    viewH,
    playState,
    world,
  ) {
    const activeTravel = playState?.travel ?? state.lastTravel;
    if (!activeTravel) return;

    const speed = PARALLAX_SPEED.ground;
    const layerStripLeft = scrollX * speed - playerX;
    const markerY = groundTopY + Math.round((viewH - groundTopY) * 0.15);

    const startCanvasX = strip.startMarkerStripX - layerStripLeft;
    const destCanvasX = strip.destMarkerStripX - layerStripLeft;
    const startMarker =
      world?.cities?.[activeTravel?.startCityId ?? -1]?.marker ?? "settlement";
    const destMarker =
      world?.cities?.[activeTravel?.targetCityId ?? -1]?.marker ?? "settlement";
    const startSignpost = startMarker === "signpost";
    const destSignpost = destMarker === "signpost";

    drawPoiMarkerOnCanvas(ctx, startCanvasX, markerY, {
      marker: startMarker,
      scale: POI_MARKER_SCALE,
      highlighted: false,
      groundY: playerFeetY,
      minVisualHeightPx: startSignpost
        ? SIGNPOST_VISUAL_HEIGHT_PX
        : PLAYER_VISUAL_HEIGHT_PX,
      verticalOffsetPx: startSignpost ? SIGNPOST_UPWARD_OFFSET_PX : 0,
    });
    drawPoiMarkerOnCanvas(ctx, destCanvasX, markerY, {
      marker: destMarker,
      scale: POI_MARKER_SCALE,
      highlighted: true,
      groundY: playerFeetY,
      minVisualHeightPx: destSignpost
        ? SIGNPOST_VISUAL_HEIGHT_PX
        : PLAYER_VISUAL_HEIGHT_PX,
      verticalOffsetPx: destSignpost ? SIGNPOST_UPWARD_OFFSET_PX : 0,
    });

    return {
      startMarkerCanvasX: startCanvasX,
      destMarkerCanvasX: destCanvasX,
    };
  }

  function drawTreeDecorationsForLayer(
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
      const treeGroundY = Math.min(
        maxRootY,
        Math.max(minRootY, desiredRootY),
      );

      drawJourneyTreeOnCanvas(ctx, canvasX, treeGroundY, {
        treeFamily: tree.treeFamily,
        variantIndex: tree.variantIndex,
        heightPx: tree.heightPx,
        upwardOffsetPx: tree.upwardOffsetPx,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Debug overlay – segment boundaries drawn on the journey canvas
  // -------------------------------------------------------------------------

  function drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH) {
    // Colour assigned to each layer for debug tick lines
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
      const segs = strip.layerSegments[layerName];
      if (!band || !segs?.length) continue;

      const { topY, bottomY } = band;

      ctx.strokeStyle = debugColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);

      for (const seg of segs) {
        if (seg.isBlend) continue; // blend zones have no hard boundary
        const cx = Math.round(seg.stripX - layerStripLeft) + 0.5;
        if (cx < -4 || cx > viewW + 4) continue;

        // Vertical tick line at left edge of this segment
        ctx.beginPath();
        ctx.moveTo(cx, topY);
        ctx.lineTo(cx, bottomY);
        ctx.stroke();

        // Biome label inside the band
        if (cx > 2 && cx < viewW - 4) {
          ctx.fillStyle = debugColor;
          ctx.fillText(seg.biomeKey ?? "?", cx + 2, topY + 2);
        }
      }
    }

    // Horizontal reference lines at POI marker strip positions
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.40)";
    const gSpeed = PARALLAX_SPEED.ground;
    const gStripLeft = scrollX * gSpeed - playerX;

    for (const [label, stripX] of [
      ["start", strip.startMarkerStripX],
      ["dest", strip.destMarkerStripX],
    ]) {
      const cx = Math.round(stripX - gStripLeft) + 0.5;
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
}

// ---------------------------------------------------------------------------
// Strip summary – printed once per strip build/extend
// ---------------------------------------------------------------------------

function printStripSummary(strip, label) {
  const layerOrder = ["ground", "near1", "near2", "mid", "far", "foreground"];
  console.group(
    `[Journey] ${label} — route ${Math.round(strip.routePx)}px, total ${strip.totalStripPx}px`,
  );
  for (const layerName of layerOrder) {
    const segs = strip.layerSegments[layerName];
    if (!segs?.length) continue;
    const parts = segs
      .filter((s) => !s.isBlend)
      .map((s) => `${s.biomeKey ?? "?"} ${Math.round(s.stripWidth)}px`);
    console.log(`  ${layerName.padEnd(11)}  ${parts.join(", ")}`);
  }
  console.groupEnd();
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

function createIdlePreviewTravel(world, playState) {
  const pos = playState?.position;
  if (!pos) return null;

  const hasTerrain =
    Boolean(world?.terrain?.width) &&
    Boolean(world?.terrain?.height) &&
    Boolean(world?.climate?.biome);

  const minX = 0;
  const minY = 0;
  const maxX = hasTerrain ? world.terrain.width - 1 : 4096;
  const maxY = hasTerrain ? world.terrain.height - 1 : 4096;
  const centerX = clampValue(Number(pos.x) || 0, minX, maxX);
  const centerY = clampValue(Number(pos.y) || 0, minY, maxY);

  const span = hasTerrain
    ? clampValue(world.terrain.width * 0.08, IDLE_PREVIEW_SPAN_MIN, IDLE_PREVIEW_SPAN_MAX)
    : 22;
  const wobble = clampValue(span * 0.08, 0.9, 2.6);
  const startX = clampValue(centerX - span * 0.55, minX, maxX);
  const endX = clampValue(centerX + span * 0.55, minX, maxX);

  const points = [];
  for (let index = 0; index <= IDLE_PREVIEW_POINT_COUNT; index += 1) {
    const t = index / IDLE_PREVIEW_POINT_COUNT;
    const x = startX + (endX - startX) * t;
    const waveA = Math.sin(t * Math.PI * 2);
    const waveB = Math.sin(t * Math.PI * 5 + 0.9);
    const y = clampValue(
      centerY + waveA * wobble * 0.4 + waveB * wobble * 0.16,
      minY,
      maxY,
    );
    points.push({ x, y });
  }

  const segmentLengths = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const length = Math.hypot(next.x - prev.x, next.y - prev.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  const biomeBandSegments = hasTerrain
    ? buildTravelBiomeBandSegments(world, points)
    : createEmptyBiomeBands();

  const cityId = playState?.currentCityId ?? null;
  return {
    startCityId: cityId,
    targetCityId: cityId,
    routeType: "idle-preview",
    points,
    segmentLengths,
    totalLength: Math.max(1, totalLength),
    progress: 0,
    biomeBandSegments,
    biomeSegments: biomeBandSegments.near?.segments ?? [],
    __journeyIdleKey: [
      Math.round(centerX),
      Math.round(centerY),
      hasTerrain ? `${world.terrain.width}x${world.terrain.height}` : "no-terrain",
    ].join(":"),
  };
}

function createEmptyBiomeBands() {
  return {
    near: { name: "near", offsetDistance: 0, segments: [] },
    mid: { name: "mid", offsetDistance: 5, segments: [] },
    far: { name: "far", offsetDistance: 10, segments: [] },
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampValue(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function tintRgbWithSky(rgb, haze, skyRgb = DAY_SKY_BOTTOM_RGB) {
  const [r, g, b] = rgb;
  const [skyR, skyG, skyB] = skyRgb;
  return [
    r * (1 - haze) + skyR * haze,
    g * (1 - haze) + skyG * haze,
    b * (1 - haze) + skyB * haze,
  ];
}

function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgbCssFromArray(rgb) {
  return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}

function createSkyState(timeOfDayHours, viewW, viewH) {
  const hour = normalizeTimeOfDayHours(
    Number.isFinite(timeOfDayHours) ? timeOfDayHours : DEFAULT_TIME_OF_DAY_HOURS,
  );
  const horizonY = Math.round(viewH * GROUND_TOP_FRAC);
  const orbitCenterX = viewW / 2;
  const orbitRadiusX = Math.max(80, viewW * 0.5 - Math.max(18, viewW * 0.02));
  const orbitRadiusY = Math.max(64, horizonY - Math.max(54, viewH * 0.065));
  const angle = ((hour - 12) / 24) * TAU - Math.PI / 2;
  const sunPos = {
    x: orbitCenterX + Math.cos(angle) * orbitRadiusX,
    y: horizonY + Math.sin(angle) * orbitRadiusY,
  };
  const moonAngle = angle + Math.PI;
  const moonPos = {
    x: orbitCenterX + Math.cos(moonAngle) * orbitRadiusX,
    y: horizonY + Math.sin(moonAngle) * orbitRadiusY,
  };
  const sunAltitude = clampValue(
    (horizonY - sunPos.y) / orbitRadiusY,
    -1,
    1,
  );
  const moonAltitude = clampValue(
    (horizonY - moonPos.y) / orbitRadiusY,
    -1,
    1,
  );
  const daylight = clamp01((sunAltitude + 0.16) / 1.16);
  const night = 1 - daylight;
  const twilight = clamp01(1 - Math.abs(sunAltitude) * 2.4);
  const twilightTopWeight = twilight * (0.3 + night * 0.15);
  const twilightBottomWeight = twilight * (0.62 + night * 0.2);
  const baseTop = lerpRgb(NIGHT_SKY_TOP_RGB, DAY_SKY_TOP_RGB, daylight);
  const baseBottom = lerpRgb(NIGHT_SKY_BOTTOM_RGB, DAY_SKY_BOTTOM_RGB, daylight);
  const topRgb = lerpRgb(baseTop, TWILIGHT_SKY_TOP_RGB, twilightTopWeight);
  const bottomRgb = lerpRgb(
    baseBottom,
    TWILIGHT_SKY_BOTTOM_RGB,
    twilightBottomWeight,
  );
  const middleRgb = lerpRgb(topRgb, bottomRgb, 0.5);
  const horizonRgb = lerpRgb(
    bottomRgb,
    [248, 206, 150],
    twilight * (0.34 + daylight * 0.16),
  );
  const sunVisible = clamp01((sunAltitude + 0.18) / 0.48);
  const moonVisible = clamp01((moonAltitude + 0.2) / 0.54) * (0.35 + night * 0.72);

  return {
    hour,
    daylight,
    night,
    twilight,
    horizonY,
    topRgb,
    middleRgb,
    bottomRgb,
    horizonRgb,
    sun: {
      ...sunPos,
      visible: sunVisible,
      radius: Math.max(14, viewH * 0.024),
    },
    moon: {
      ...moonPos,
      visible: moonVisible,
      radius: Math.max(10, viewH * 0.017),
    },
  };
}

function drawSun(ctx, skyState) {
  const sun = skyState.sun;
  if (sun.visible <= 0.001) return;
  const glowRadius = sun.radius * (3.4 + skyState.twilight * 0.8);
  const glow = ctx.createRadialGradient(
    sun.x,
    sun.y,
    0,
    sun.x,
    sun.y,
    glowRadius,
  );
  glow.addColorStop(
    0,
    `rgba(255, 246, 208, ${0.5 * sun.visible + 0.2 * skyState.daylight})`,
  );
  glow.addColorStop(0.5, `rgba(255, 198, 128, ${0.35 * sun.visible})`);
  glow.addColorStop(1, "rgba(255, 182, 102, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 242, 201, ${0.72 + sun.visible * 0.22})`;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.radius, 0, TAU);
  ctx.fill();
}

function drawMoon(ctx, skyState) {
  const moon = skyState.moon;
  if (moon.visible <= 0.001) return;
  const glowRadius = moon.radius * 3.1;
  const glow = ctx.createRadialGradient(
    moon.x,
    moon.y,
    0,
    moon.x,
    moon.y,
    glowRadius,
  );
  glow.addColorStop(0, `rgba(237, 244, 255, ${0.18 + moon.visible * 0.3})`);
  glow.addColorStop(1, "rgba(215, 231, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `rgba(235, 243, 255, ${0.44 + moon.visible * 0.5})`;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radius, 0, TAU);
  ctx.fill();
}

function drawNightVeil(ctx, viewW, viewH, skyState) {
  const alpha = clamp01(skyState.night * 0.46 + skyState.twilight * 0.08);
  if (alpha <= 0.01) return;
  const veil = ctx.createLinearGradient(0, 0, 0, viewH);
  veil.addColorStop(0, `rgba(6, 11, 24, ${alpha * 0.72})`);
  veil.addColorStop(1, `rgba(8, 14, 26, ${alpha})`);
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, viewW, viewH);
}
