import { createJourneyGroundTrack } from "./journey/journeyGroundTrack.js";
import { createJourneySeaTrack } from "./journey/journeySeaTrack.js";
import { normalizeBiomeKey } from "./journey/journeyStyle.js";

const COVERAGE_BUFFER = 240;
const GROUND_ACTIVE_TRAVEL_BUFFER = 18;
const GROUND_MIN_BIOME_COMMIT_DISTANCE = 22;
const SCROLL_PX_PER_WORLD = 126;
const SEA_SCROLL_MULTIPLIER = 0.16;
const FALLBACK_SCROLL_SPEED = 0.16;
const ARRIVAL_MARKER_START_OFFSET = 84;
const ARRIVAL_MARKER_TARGET_RATIO = 0.5;
const ARRIVAL_MARKER_EXIT_OFFSET = 42;
const DEPARTURE_MARKER_BOOTSTRAP_PROGRESS = 0.02;

export function createJourneyScene({ track, seaTrack, player, poiMarker }) {
  const groundTrack = createJourneyGroundTrack(track);
  const seaRippleTrack = createJourneySeaTrack(seaTrack);
  const state = {
    lastTravelProgress: null,
    lastTravelTimestamp: 0,
    lastGroundSpeed: FALLBACK_SCROLL_SPEED,
    lastBiomeKey: null,
    lastRouteType: null,
    travelGroundBiomeKey: null,
    pendingGroundBiomeKey: null,
    pendingGroundBiomeDistance: 0,
    arrivalMarker: {
      mode: "hidden",
      x: 0,
      biomeKey: null,
      lastTimestamp: 0
    }
  };

  return {
    update,
    reset,
    getDebugSnapshot
  };

  function update(playState, biomeKey) {
    if (!track) {
      return;
    }

    const trackWidth = Math.max(track.clientWidth || 0, 640);
    const trackHeight = track.clientHeight || 240;
    const seaWidth = Math.max(seaTrack?.clientWidth || 0, 640);
    const rawBiomeKey = normalizeBiomeKey(biomeKey) ?? state.lastBiomeKey ?? "plains";
    const isSeaTravel = playState?.travel?.routeType === "sea-route";
    const didArriveFromSea = !playState?.travel && state.lastRouteType === "sea-route";
    const didArriveFromLand =
      !playState?.travel && state.lastRouteType && state.lastRouteType !== "sea-route";
    const currentGroundBiomeKey = playState?.travel
      ? resolveGroundBiomeKey(rawBiomeKey, 0)
      : rawBiomeKey;
    const activeGroundBiomeKey = isSeaTravel ? "ocean" : currentGroundBiomeKey;
    const showLandLayers = !isSeaTravel;

    groundTrack.setVisible(showLandLayers);
    groundTrack.setSeaMode(false);
    syncPlayer({
      isMoving: Boolean(
        playState?.travel ||
          state.arrivalMarker.mode === "arriving" ||
          state.arrivalMarker.mode === "departing"
      ),
      isSeaTravel
    });

    if (!groundTrack.hasStrips()) {
      groundTrack.refill(trackWidth, activeGroundBiomeKey, trackHeight, COVERAGE_BUFFER);
    }
    if (seaTrack && !seaRippleTrack.hasRipples()) {
      seaRippleTrack.refill(seaWidth, COVERAGE_BUFFER);
    }

    if (!playState?.travel) {
      stopAtRest({
        currentGroundBiomeKey,
        didArriveFromLand,
        didArriveFromSea,
        seaWidth,
        showLandLayers,
        trackHeight,
        trackWidth,
        timestamp: performance.now()
      });
      state.lastBiomeKey = currentGroundBiomeKey;
      return;
    }

    const isStartingTravel = state.lastTravelProgress == null;
    state.lastRouteType = playState.travel.routeType ?? null;
    if (isStartingTravel) {
      state.lastTravelProgress = playState.travel.progress ?? 0;
      state.lastTravelTimestamp = performance.now();
      state.travelGroundBiomeKey = isSeaTravel ? "ocean" : rawBiomeKey;
      state.pendingGroundBiomeKey = null;
      state.pendingGroundBiomeDistance = 0;
    }

    const delta = consumeTravelDelta(playState.travel.progress ?? 0);
    const travelGroundBiomeKey = resolveGroundBiomeKey(rawBiomeKey, delta.distance);
    const activeTravelGroundBiomeKey = isSeaTravel ? "ocean" : travelGroundBiomeKey;

    if (
      !isSeaTravel &&
      isStartingTravel &&
      state.arrivalMarker.mode === "hidden" &&
      (playState.travel.progress ?? 0) <= DEPARTURE_MARKER_BOOTSTRAP_PROGRESS
    ) {
      settleArrivalMarker(trackWidth, activeTravelGroundBiomeKey);
    }

    if (isSeaTravel) {
      clearArrivalMarker();
    } else if (state.arrivalMarker.mode === "settled") {
      startDepartureMarker(trackWidth, activeTravelGroundBiomeKey, performance.now());
    }

    if (delta.distance > 0.0001) {
      state.lastGroundSpeed = Math.max(0.04, delta.distance / delta.ms);
      if (showLandLayers) {
        groundTrack.advance(
          delta.distance,
          trackWidth,
          activeTravelGroundBiomeKey,
          trackHeight,
          GROUND_ACTIVE_TRAVEL_BUFFER
        );
      }
      seaRippleTrack.drift(performance.now(), seaWidth, COVERAGE_BUFFER, 0.5);
      seaRippleTrack.advance(delta.distance * SEA_SCROLL_MULTIPLIER, seaWidth, COVERAGE_BUFFER);
      if (showLandLayers && state.arrivalMarker.mode === "departing") {
        advanceDepartureMarker(delta.distance, trackWidth);
      }
    } else {
      if (showLandLayers) {
        groundTrack.stopAtBiome(
          trackWidth,
          activeTravelGroundBiomeKey,
          trackHeight,
          GROUND_ACTIVE_TRAVEL_BUFFER
        );
      }
      seaRippleTrack.drift(performance.now(), seaWidth, COVERAGE_BUFFER, 0.5);
    }

    syncArrivalMarker(trackWidth);
    state.lastBiomeKey = travelGroundBiomeKey;
  }

  function stopAtRest({
    currentGroundBiomeKey,
    didArriveFromLand,
    didArriveFromSea,
    seaWidth,
    showLandLayers,
    trackHeight,
    trackWidth,
    timestamp
  }) {
    const wasTraveling = state.lastTravelProgress != null;
    state.lastTravelProgress = null;
    state.lastTravelTimestamp = 0;
    state.travelGroundBiomeKey = currentGroundBiomeKey;
    state.pendingGroundBiomeKey = null;
    state.pendingGroundBiomeDistance = 0;

    if (showLandLayers && didArriveFromSea) {
      groundTrack.syncAllToBiome(currentGroundBiomeKey, trackHeight);
      groundTrack.stopAtBiome(trackWidth, currentGroundBiomeKey, trackHeight, COVERAGE_BUFFER);
    } else if (showLandLayers && !wasTraveling && state.arrivalMarker.mode !== "arriving") {
      groundTrack.stopAtBiome(trackWidth, currentGroundBiomeKey, trackHeight, COVERAGE_BUFFER);
    } else if (showLandLayers && didArriveFromLand) {
      groundTrack.setVisible(true);
    }

    if (wasTraveling && showLandLayers) {
      startArrivalMarker(trackWidth, currentGroundBiomeKey, timestamp);
    }

    state.lastRouteType = null;

    if (state.arrivalMarker.mode === "arriving" && showLandLayers) {
      advanceArrivalMarker({
        biomeKey: currentGroundBiomeKey,
        seaWidth,
        timestamp,
        trackHeight,
        trackWidth
      });
      return;
    }

    if (showLandLayers && state.arrivalMarker.mode === "hidden") {
      settleArrivalMarker(trackWidth, currentGroundBiomeKey);
    }

    seaRippleTrack.drift(timestamp, seaWidth, COVERAGE_BUFFER, 0.5);
    syncArrivalMarker(trackWidth);
  }

  function consumeTravelDelta(currentProgress) {
    const now = performance.now();
    const deltaProgress = Math.max(0, currentProgress - (state.lastTravelProgress ?? currentProgress));
    const deltaMs = Math.max(1, now - (state.lastTravelTimestamp || now));
    state.lastTravelProgress = currentProgress;
    state.lastTravelTimestamp = now;
    return {
      progress: deltaProgress,
      ms: deltaMs,
      distance: deltaProgress * SCROLL_PX_PER_WORLD
    };
  }

  function resolveGroundBiomeKey(rawBiomeKey, distance) {
    return resolveTrackedBiome({
      normalizedBiomeKey: normalizeBiomeKey(rawBiomeKey) ?? "plains",
      distance,
      stateKey: "travelGroundBiomeKey",
      pendingKey: "pendingGroundBiomeKey",
      pendingDistanceKey: "pendingGroundBiomeDistance",
      commitDistance: GROUND_MIN_BIOME_COMMIT_DISTANCE
    });
  }

  function resolveTrackedBiome({
    normalizedBiomeKey,
    distance,
    stateKey,
    pendingKey,
    pendingDistanceKey,
    commitDistance
  }) {
    if (!state[stateKey]) {
      state[stateKey] = normalizedBiomeKey;
      state[pendingKey] = null;
      state[pendingDistanceKey] = 0;
      return normalizedBiomeKey;
    }

    if (normalizedBiomeKey === state[stateKey]) {
      state[pendingKey] = null;
      state[pendingDistanceKey] = 0;
      return state[stateKey];
    }

    if (state[pendingKey] !== normalizedBiomeKey) {
      state[pendingKey] = normalizedBiomeKey;
      state[pendingDistanceKey] = distance;
      return state[stateKey];
    }

    state[pendingDistanceKey] += distance;
    if (state[pendingDistanceKey] >= commitDistance) {
      state[stateKey] = normalizedBiomeKey;
      state[pendingKey] = null;
      state[pendingDistanceKey] = 0;
    }

    return state[stateKey];
  }

  function reset() {
    state.lastTravelProgress = null;
    state.lastTravelTimestamp = 0;
    state.lastGroundSpeed = FALLBACK_SCROLL_SPEED;
    state.lastBiomeKey = null;
    state.lastRouteType = null;
    state.travelGroundBiomeKey = null;
    state.pendingGroundBiomeKey = null;
    state.pendingGroundBiomeDistance = 0;
    clearArrivalMarker();
    groundTrack.reset();
    seaRippleTrack.reset();
    syncPlayer({
      isMoving: false,
      isSeaTravel: false
    });
  }

  function getDebugSnapshot() {
    return {
      strips: groundTrack.getCount(),
      ripples: seaRippleTrack.getCount(),
      groundBiome: state.travelGroundBiomeKey ?? "-",
      pendingGroundBiome: state.pendingGroundBiomeKey ?? "-",
      arrivalMarker: state.arrivalMarker.mode
    };
  }

  function startArrivalMarker(trackWidth, biomeKey, timestamp) {
    state.arrivalMarker.mode = "arriving";
    state.arrivalMarker.x = trackWidth + ARRIVAL_MARKER_START_OFFSET;
    state.arrivalMarker.biomeKey = biomeKey;
    state.arrivalMarker.lastTimestamp = timestamp;
    syncArrivalMarker(trackWidth);
  }

  function advanceArrivalMarker({ biomeKey, seaWidth, timestamp, trackHeight, trackWidth }) {
    const targetX = trackWidth * ARRIVAL_MARKER_TARGET_RATIO;
    const deltaMs = Math.max(0, timestamp - (state.arrivalMarker.lastTimestamp || timestamp));
    state.arrivalMarker.lastTimestamp = timestamp;

    const distance = Math.min(
      Math.max(0, state.arrivalMarker.x - targetX),
      Math.max(FALLBACK_SCROLL_SPEED, state.lastGroundSpeed) * Math.max(1, deltaMs)
    );

    if (distance > 0.0001) {
      groundTrack.advance(
        distance,
        trackWidth,
        biomeKey,
        trackHeight,
        GROUND_ACTIVE_TRAVEL_BUFFER
      );
      seaRippleTrack.drift(timestamp, seaWidth, COVERAGE_BUFFER, 0.5);
      seaRippleTrack.advance(distance * SEA_SCROLL_MULTIPLIER, seaWidth, COVERAGE_BUFFER);
      state.arrivalMarker.x = Math.max(targetX, state.arrivalMarker.x - distance);
    } else {
      seaRippleTrack.drift(timestamp, seaWidth, COVERAGE_BUFFER, 0.5);
      state.arrivalMarker.x = targetX;
    }

    if (state.arrivalMarker.x <= targetX + 0.5) {
      settleArrivalMarker(trackWidth, biomeKey);
    }

    syncArrivalMarker(trackWidth);
  }

  function startDepartureMarker(trackWidth, biomeKey, timestamp) {
    state.arrivalMarker.mode = "departing";
    state.arrivalMarker.x = trackWidth * ARRIVAL_MARKER_TARGET_RATIO;
    state.arrivalMarker.biomeKey = biomeKey;
    state.arrivalMarker.lastTimestamp = timestamp;
  }

  function advanceDepartureMarker(distance, trackWidth) {
    state.arrivalMarker.x -= distance;
    if (state.arrivalMarker.x < -ARRIVAL_MARKER_EXIT_OFFSET) {
      clearArrivalMarker();
      return;
    }
    syncArrivalMarker(trackWidth);
  }

  function settleArrivalMarker(trackWidth, biomeKey) {
    state.arrivalMarker.mode = "settled";
    state.arrivalMarker.x = trackWidth * ARRIVAL_MARKER_TARGET_RATIO;
    state.arrivalMarker.biomeKey = biomeKey;
    state.arrivalMarker.lastTimestamp = 0;
  }

  function clearArrivalMarker() {
    state.arrivalMarker.mode = "hidden";
    state.arrivalMarker.x = 0;
    state.arrivalMarker.biomeKey = null;
    state.arrivalMarker.lastTimestamp = 0;
    syncArrivalMarker(0);
  }

  function syncArrivalMarker(trackWidth) {
    if (!poiMarker) {
      return;
    }

    if (state.arrivalMarker.mode === "hidden") {
      poiMarker.hidden = true;
      return;
    }

    poiMarker.hidden = false;
    poiMarker.style.transform = `translateX(${state.arrivalMarker.x.toFixed(3)}px)`;
  }

  function syncPlayer({ isMoving, isSeaTravel }) {
    if (!player) {
      return;
    }

    player.dataset.moving = isMoving ? "true" : "false";
    player.dataset.sea = isSeaTravel ? "true" : "false";
  }
}
