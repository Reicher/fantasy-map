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
} from "./journey/journeyStrip.js?v=20260409d";
import {
  drawPoiMarkerOnCanvas,
  drawJourneyTreeOnCanvas,
  drawPlayerFigure,
} from "./journey/journeyStyle.js?v=20260409d";

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
const SIGNPOST_VISUAL_HEIGHT_PX = 84;
const SIGNPOST_UPWARD_OFFSET_PX = 13;

// Sky gradient – lighter at the horizon to reinforce atmospheric depth
const SKY_TOP = "rgb(152, 204, 240)";
const SKY_BTM = "rgb(210, 228, 240)";

// Atmospheric haze per silhouette layer: how much the top of each layer
// fades toward the sky horizon colour. 0 = none, 1 = full sky colour.
const LAYER_HAZE = { far: 0.42, mid: 0.20, near2: 0.07, near1: 0, foreground: 0 };
// RGB decomposition of SKY_BTM – must stay in sync with the value above.
const SKY_HAZE_R = 210;
const SKY_HAZE_G = 228;
const SKY_HAZE_B = 240;

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
  };

  return { update, reset, getDebugSnapshot };

  // -------------------------------------------------------------------------

  function update(playState, options = {}) {
    if (!canvas) return;

    const viewW = canvas.width;
    const viewH = canvas.height;
    const isTraveling = Boolean(playState?.travel);
    const showSnow = options.showSnow !== false;

    // Rebuild strip only when a new travel starts (key changes to a non-null value).
    // When travel ends (key → null) we keep the existing strip so the scene
    // stays visible at the destination until the next trip.
    const nextKey = travelKey(playState?.travel);
    const dimensionsChanged =
      state.cachedW !== viewW || state.cachedH !== viewH;
    const snowModeChanged = state.lastShowSnow !== showSnow;

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
      state.lastShowSnow = showSnow;
      state.cachedW = viewW;
      state.cachedH = viewH;
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
      options.world ?? getWorld(),
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

    // 2. Ocean horizon (fully static – behind all silhouette layers).
    // Tall terrain in the far layer (mountains, forest, highlands) naturally
    // paints over this; flat terrain (plains, ocean biome) lets it show through.
    drawOceanHorizon(ctx, viewW, viewH);

    if (!strip) return;

    const groundTopY = strip.layers.ground.topY;

    // Helper: compute the canvas x for a strip-local pixel at a given parallax speed
    // canvasX = (stripX - scrollX * speed) + playerX
    //         = stripX - (scrollX * speed - playerX)
    // So layerStripLeft = scrollX * speed - playerX
    // and canvasX = stripX - layerStripLeft

    // 3. Far (slowest)
    drawSilhouetteLayer(ctx, strip, "far", scrollX, playerX, viewW);

    // 4. Mid
    drawSilhouetteLayer(ctx, strip, "mid", scrollX, playerX, viewW);

    // 5. Near2
    drawSilhouetteLayer(ctx, strip, "near2", scrollX, playerX, viewW);
    drawTreeDecorationsForLayer(ctx, strip, "near2", scrollX, playerX, viewW);

    // 6. Near1
    drawSilhouetteLayer(ctx, strip, "near1", scrollX, playerX, viewW);
    drawTreeDecorationsForLayer(ctx, strip, "near1", scrollX, playerX, viewW);

    // 7. Ground (flat solid bands, ground speed = 1.0)
    drawGroundLayer(ctx, strip, scrollX, playerX, viewW);

    // 8. POI markers – behind the player but above all background layers
    drawPoiMarkers(
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

    // 9. Player (fixed – behind foreground so foreground overlaps lower body)
    drawPlayerFigure(
      ctx,
      playerX,
      playerFeetY,
      isTraveling ? state.walkFrame : 0,
    );

    // 10. Foreground (fastest – in front of player and POI markers)
    drawSilhouetteLayer(ctx, strip, "foreground", scrollX, playerX, viewW);

    // 11. Debug overlay (segment boundaries) – only when enabled
    if (debug) {
      drawDebugOverlay(ctx, strip, scrollX, playerX, viewW, viewH);
    }
  }

  // -------------------------------------------------------------------------
  // Layer drawing
  // -------------------------------------------------------------------------

  function drawSky(ctx, viewW, viewH) {
    const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.72);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(1, SKY_BTM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  /**
   * Static ocean/horizon band that fills the entire silhouette zone.
   * All parallax silhouette layers paint over it, so tall biomes (mountains,
   * forest, highlands) in the far layer naturally mask it while flat biomes
   * (plains, desert, ocean) let it show through near the horizon.
   */
  function drawOceanHorizon(ctx, viewW, viewH) {
    const top    = Math.round(viewH * 0.42); // matches silhouetteZoneTop in strip
    const bottom = Math.round(viewH * 0.67); // matches groundTopY in strip
    const h = bottom - top;

    // Main ocean gradient: airy horizon haze at top → deep ocean blue at bottom
    const ocean = ctx.createLinearGradient(0, top, 0, bottom);
    ocean.addColorStop(0.00, `rgb(${SKY_HAZE_R}, ${SKY_HAZE_G}, ${SKY_HAZE_B})`); // flush with sky horizon
    ocean.addColorStop(0.12, 'rgb(168, 200, 222)'); // pale ocean near horizon
    ocean.addColorStop(0.38, 'rgb(98,  150, 186)'); // mid ocean
    ocean.addColorStop(0.70, 'rgb(72,  122, 162)'); // deeper ocean
    ocean.addColorStop(1.00, 'rgb(60,  108, 150)'); // darkest – bottom of zone
    ctx.fillStyle = ocean;
    ctx.fillRect(0, top, viewW, h);

    // Thin specular glare line just below the sky/ocean seam
    const glareY = top + Math.round(h * 0.10);
    const glare = ctx.createLinearGradient(0, glareY - 1, 0, glareY + 3);
    glare.addColorStop(0,   'rgba(255, 255, 255, 0)');
    glare.addColorStop(0.4, 'rgba(255, 255, 255, 0.28)');
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

  function drawSilhouetteLayer(ctx, strip, layerName, scrollX, playerX, viewW) {
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

      // Fill style
      const haze = LAYER_HAZE[layerName] ?? 0;
      let fillStyle;
      if (seg.isBlend && seg.colorA && seg.colorB) {
        // Horizontal gradient across the blend zone
        const hGrad = ctx.createLinearGradient(canvasX, 0, canvasX + seg.stripWidth, 0);
        hGrad.addColorStop(0, `rgb(${seg.colorA[0]},${seg.colorA[1]},${seg.colorA[2]})`);
        hGrad.addColorStop(1, `rgb(${seg.colorB[0]},${seg.colorB[1]},${seg.colorB[2]})`);
        fillStyle = hGrad;
      } else if (haze > 0 && seg.colorRgb) {
        const [cr, cg, cb] = seg.colorRgb;
        const vGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
        vGrad.addColorStop(0, `rgb(${Math.round(cr*(1-haze)+SKY_HAZE_R*haze)},${Math.round(cg*(1-haze)+SKY_HAZE_G*haze)},${Math.round(cb*(1-haze)+SKY_HAZE_B*haze)})`);
        vGrad.addColorStop(1, seg.color);
        fillStyle = vGrad;
      } else {
        fillStyle = seg.color;
      }

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
      ctx.fillStyle = fillStyle;
      ctx.fill();
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
    const speed = PARALLAX_SPEED.ground;
    const layerStripLeft = scrollX * speed - playerX;
    const markerY = groundTopY + Math.round((viewH - groundTopY) * 0.15);

    const startCanvasX = strip.startMarkerStripX - layerStripLeft;
    const destCanvasX = strip.destMarkerStripX - layerStripLeft;
    const activeTravel = playState?.travel ?? state.lastTravel;
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
      const treeGroundY = Math.min(
        band.bottomY - 2,
        topEdgeY + layerH * 0.34,
      );

      drawJourneyTreeOnCanvas(ctx, canvasX, treeGroundY, {
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
