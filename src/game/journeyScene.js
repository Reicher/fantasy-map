import { createJourneyNearTrack } from "./journey/journeyNearTrack.js";
import { createJourneySeaTrack } from "./journey/journeySeaTrack.js";
import { TRAVEL_SPEED } from "./travel.js?v=20260404e";

const COVERAGE_BUFFER = 240;
const SCROLL_PX_PER_WORLD = 126;
const SEA_SCROLL_MULTIPLIER = 0.16;
const SEA_TRAVEL_PX_PER_MS = (TRAVEL_SPEED * SCROLL_PX_PER_WORLD * SEA_SCROLL_MULTIPLIER) / 1000;

export function createJourneyScene({ track, seaTrack, player, poiMarker }) {
  const nearTrack = createJourneyNearTrack(track);
  const seaRippleTrack = createJourneySeaTrack(seaTrack);
  const state = {
    lastTravelProgress: null,
    lastTravelTimestamp: 0
  };

  return {
    update,
    reset,
    getDebugSnapshot
  };

  function update(playState, biomeKey = null) {
    const timestamp = performance.now();
    const seaWidth = Math.max(seaTrack?.clientWidth || 0, 640);
    const trackViewportWidth = Math.max(
      track?.parentElement?.clientWidth || track?.offsetParent?.clientWidth || track?.clientWidth || 0,
      640
    );
    const isTraveling = Boolean(playState?.travel);

    syncPlayer(isTraveling);

    if (seaTrack && !seaRippleTrack.hasRipples()) {
      seaRippleTrack.refill(seaWidth, COVERAGE_BUFFER);
    }

    if (!isTraveling) {
      state.lastTravelProgress = null;
      state.lastTravelTimestamp = 0;
      nearTrack.syncIdle(biomeKey, trackViewportWidth);
      syncPoiMarker();
      seaRippleTrack.drift(timestamp, seaWidth, COVERAGE_BUFFER, 0.5);
      return;
    }

    const delta = consumeTravelDelta(playState.travel.progress ?? 0, timestamp);
    nearTrack.sync(playState.travel, trackViewportWidth, SCROLL_PX_PER_WORLD);
    syncPoiMarker();
    seaRippleTrack.drift(timestamp, seaWidth, COVERAGE_BUFFER, 0.5);
    if (delta.ms > 0.0001) {
      seaRippleTrack.advance(
        Math.max(delta.distance * SEA_SCROLL_MULTIPLIER, delta.ms * SEA_TRAVEL_PX_PER_MS),
        seaWidth,
        COVERAGE_BUFFER
      );
    }
  }

  function reset() {
    state.lastTravelProgress = null;
    state.lastTravelTimestamp = 0;
    nearTrack.reset();
    hidePoiMarker();
    seaRippleTrack.reset();
    syncPlayer(false);
  }

  function getDebugSnapshot() {
    return {
      strips: nearTrack.getCount(),
      ripples: seaRippleTrack.getCount(),
      groundBiome: nearTrack.getCurrentBiome(),
      pendingGroundBiome: "-",
      arrivalMarker: "hidden"
    };
  }

  function consumeTravelDelta(currentProgress, timestamp) {
    if (state.lastTravelProgress == null) {
      state.lastTravelProgress = currentProgress;
      state.lastTravelTimestamp = timestamp;
      return {
        progress: 0,
        ms: 0,
        distance: 0
      };
    }

    const deltaProgress = Math.max(0, currentProgress - state.lastTravelProgress);
    const deltaMs = Math.max(0, timestamp - state.lastTravelTimestamp);
    state.lastTravelProgress = currentProgress;
    state.lastTravelTimestamp = timestamp;
    return {
      progress: deltaProgress,
      ms: deltaMs,
      distance: deltaProgress * SCROLL_PX_PER_WORLD
    };
  }

  function hidePoiMarker() {
    if (!poiMarker) {
      return;
    }

    poiMarker.hidden = true;
    poiMarker.style.display = "none";
  }

  function syncPoiMarker() {
    if (!poiMarker) {
      return;
    }

    const marker = nearTrack.getPoiMarkerState();
    if (!marker.visible || marker.x == null) {
      hidePoiMarker();
      return;
    }

    poiMarker.hidden = false;
    poiMarker.style.display = "block";
    poiMarker.style.transform = `translateX(${marker.x.toFixed(3)}px)`;
  }

  function syncPlayer(isMoving) {
    if (!player) {
      return;
    }

    player.dataset.moving = isMoving ? "true" : "false";
    player.dataset.sea = "false";
  }
}
