import { getStripColors, normalizeBiomeKey } from "./journeyStyle.js";

const PLAYER_ANCHOR_X = 232;
const MIN_STRIP_WIDTH = 36;
const SIDE_FILL_WIDTH = 520;

export function createJourneyNearTrack(track) {
  const state = {
    travelKey: null,
    trackWidth: 0,
    routeWidth: 0,
    routeStretch: 1,
    strips: [],
    currentBiome: null,
    lastScrollX: 0,
    markerTrackX: null,
    markerVisible: false
  };

  return {
    sync,
    syncIdle,
    freeze,
    reset,
    getCount,
    getCurrentBiome,
    getPoiMarkerState
  };

  function sync(travel, trackWidth, scrollPxPerWorld) {
    if (!track || !travel) {
      return;
    }

    const safeTrackWidth = Math.max(1, trackWidth || track.clientWidth || 0);
    const nextTravelKey = getTravelKey(travel);
    if (state.travelKey !== nextTravelKey || state.trackWidth !== safeTrackWidth) {
      rebuild(travel, safeTrackWidth, scrollPxPerWorld);
    }

    const progressPx = (travel.progress ?? 0) * scrollPxPerWorld * state.routeStretch;
    state.lastScrollX = PLAYER_ANCHOR_X - progressPx;
    state.currentBiome = getBiomeAtProgress(travel);
    track.hidden = false;
    track.style.display = "block";
    track.style.transform = `translateX(${state.lastScrollX.toFixed(3)}px)`;
  }

  function freeze() {
    if (!track || !state.strips.length) {
      return;
    }

    track.hidden = false;
    track.style.display = "block";
    track.style.transform = `translateX(${state.lastScrollX.toFixed(3)}px)`;
  }

  function syncIdle(biomeKey, trackWidth) {
    if (!track) {
      return;
    }

    const normalizedBiomeKey = normalizeBiomeKey(biomeKey) ?? "plains";
    const safeTrackWidth = Math.max(1, trackWidth || track.clientWidth || 0);
    const idleKey = `idle:${normalizedBiomeKey}:${safeTrackWidth}`;
    if (state.travelKey !== idleKey) {
      state.travelKey = idleKey;
      state.trackWidth = safeTrackWidth;
      state.routeWidth = 0;
      state.routeStretch = 1;
      state.strips = [];
      state.currentBiome = normalizedBiomeKey;
      state.lastScrollX = 0;
      state.markerTrackX = null;
      state.markerVisible = false;
      track.replaceChildren();

      if (normalizedBiomeKey !== "ocean") {
        appendStrip(normalizedBiomeKey, 0, safeTrackWidth + SIDE_FILL_WIDTH);
      }

      track.style.left = "0px";
      track.style.right = "auto";
      track.style.width = `${(safeTrackWidth + SIDE_FILL_WIDTH).toFixed(3)}px`;
    }

    track.hidden = false;
    track.style.display = "block";
    track.style.transform = "translateX(0)";
  }

  function reset() {
    state.travelKey = null;
    state.trackWidth = 0;
    state.routeWidth = 0;
    state.routeStretch = 1;
    state.strips = [];
    state.currentBiome = null;
    state.lastScrollX = 0;
    state.markerTrackX = null;
    state.markerVisible = false;
    if (track) {
      track.hidden = true;
      track.style.display = "none";
      track.style.width = "";
      track.style.right = "";
      track.style.transform = "translateX(0)";
      track.replaceChildren();
    }
  }

  function getCount() {
    return state.strips.length;
  }

  function getCurrentBiome() {
    return state.currentBiome ?? "-";
  }

  function getPoiMarkerState() {
    return {
      visible: state.markerVisible && state.markerTrackX != null,
      x: state.markerTrackX == null ? null : state.lastScrollX + state.markerTrackX
    };
  }

  function rebuild(travel, trackWidth, scrollPxPerWorld) {
    state.travelKey = getTravelKey(travel);
    state.trackWidth = trackWidth;
    state.routeWidth = (travel.totalLength ?? 0) * scrollPxPerWorld;
    state.routeStretch = getRouteStretchFactor(state.routeWidth, trackWidth);
    state.strips = [];
    state.currentBiome = getBiomeAtProgress(travel);
    state.markerTrackX = null;
    state.markerVisible = false;
    track.replaceChildren();

    const nearSegments = travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];
    const firstBiome = normalizeBiomeKey(nearSegments[0]?.biome) ?? "plains";
    const lastBiome = normalizeBiomeKey(nearSegments[nearSegments.length - 1]?.biome) ?? firstBiome;
    const landingOffset = Math.max(0, trackWidth * 0.5 - PLAYER_ANCHOR_X);
    const hasVisibleGround = nearSegments.some((segment) => normalizeBiomeKey(segment.biome) !== "ocean");

    let cursor = -SIDE_FILL_WIDTH;
    appendStrip(firstBiome, cursor, SIDE_FILL_WIDTH);
    cursor = 0;

    for (const segment of nearSegments) {
      const biomeKey = normalizeBiomeKey(segment.biome) ?? firstBiome;
      const width = Math.max(
        MIN_STRIP_WIDTH,
        (segment.distance ?? 0) * scrollPxPerWorld * state.routeStretch
      );
      appendStrip(biomeKey, cursor, width);
      cursor += width;
    }

    if (landingOffset > 0) {
      const landingBiome = hasVisibleGround ? lastBiome : "ocean";
      appendStrip(landingBiome, cursor, landingOffset);
      cursor += landingOffset;
    }

    state.markerTrackX = cursor;
    state.markerVisible = hasVisibleGround;

    const totalWidth = Math.max(trackWidth, cursor + SIDE_FILL_WIDTH);
    track.style.left = "0px";
    track.style.right = "auto";
    track.style.width = `${totalWidth.toFixed(3)}px`;
  }

  function appendStrip(biomeKey, x, width) {
    const colors = getStripColors(biomeKey);
    const element = document.createElement("div");
    element.className = "play-ground-strip play-ground-strip--flat";
    element.style.left = `${x.toFixed(3)}px`;
    element.style.width = `${Math.max(1, width).toFixed(3)}px`;
    element.style.setProperty("--strip-base", colors.base);
    element.classList.toggle("play-ground-strip--sea", biomeKey === "ocean");
    track.append(element);
    state.strips.push({ biomeKey, x, width, element });
  }

  function getTravelKey(travel) {
    return [
      travel.startCityId ?? "-",
      travel.targetCityId ?? "-",
      (travel.totalLength ?? 0).toFixed(3),
      travel.biomeBandSegments?.near?.segments?.length ?? travel.biomeSegments?.length ?? 0
    ].join(":");
  }

  function getBiomeAtProgress(travel) {
    const segments = travel.biomeBandSegments?.near?.segments ?? travel.biomeSegments ?? [];
    if (!segments.length) {
      return "plains";
    }

    let traversed = 0;
    const progress = Math.max(0, Math.min(travel.totalLength ?? 0, travel.progress ?? 0));
    for (const segment of segments) {
      traversed += segment.distance ?? 0;
      if (progress <= traversed + 0.0001) {
        return normalizeBiomeKey(segment.biome) ?? "plains";
      }
    }

    return normalizeBiomeKey(segments[segments.length - 1]?.biome) ?? "plains";
  }

  function getRouteStretchFactor(routeWidth, trackWidth) {
    if (routeWidth <= 0.0001) {
      return 1;
    }

    const requiredDisplayWidth = routeWidth + trackWidth;
    return requiredDisplayWidth / routeWidth;
  }
}
