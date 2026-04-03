import { buildDecorations, getStripColors, normalizeBiomeKey } from "./journeyStyle.js";

const DEFAULT_SEGMENT_WIDTH = 180;
const MAX_SEGMENT_WIDTH = 260;
const MIN_DECOR_REFRESH_DELTA = 42;
const MIN_TRANSITION_STRIP_WIDTH = 28;

export function createJourneyGroundTrack(track) {
  const state = {
    strips: [],
    nextStripId: 0
  };

  return {
    hasStrips,
    refill,
    ensureCoverage,
    advance,
    stopAtBiome,
    syncAllToBiome,
    setVisible,
    setSeaMode,
    reset,
    getCount
  };

  function hasStrips() {
    return state.strips.length > 0;
  }

  function refill(trackWidth, biomeKey, trackHeight, buffer) {
    state.strips = [];
    state.nextStripId = 0;
    if (track) {
      track.replaceChildren();
    }

    let x = 0;
    while (x < trackWidth + buffer) {
      const width = Math.min(DEFAULT_SEGMENT_WIDTH, trackWidth + buffer - x);
      const strip = createStrip(biomeKey, x, width, trackHeight);
      state.strips.push(strip);
      x += strip.width;
    }
    renderStrips();
  }

  function ensureCoverage(trackWidth, buffer, fillBiomeKey, trackHeight, fallbackBiomeKey = "plains") {
    let rightEdge = state.strips.length
      ? Math.max(...state.strips.map((strip) => strip.x + strip.width))
      : 0;
    let guard = 0;

    while (rightEdge < trackWidth + buffer && guard < 32) {
      const tailBiomeKey =
        fillBiomeKey
        ?? state.strips[state.strips.length - 1]?.biomeKey
        ?? fallbackBiomeKey;
      const fillWidth = Math.min(DEFAULT_SEGMENT_WIDTH, trackWidth + buffer - rightEdge);
      appendBiomeDistance(tailBiomeKey, fillWidth, trackHeight);
      rightEdge = state.strips.length
        ? Math.max(...state.strips.map((strip) => strip.x + strip.width))
        : 0;
      guard += 1;
    }
  }

  function advance(distance, trackWidth, biomeKey, trackHeight, buffer) {
    trimRightOverflow(trackWidth + buffer, trackHeight);
    for (const strip of state.strips) {
      strip.x -= distance;
    }
    paintTraveledDistance(trackWidth, biomeKey, distance, trackHeight, buffer);
    trimExitedStrips();
    ensureCoverage(trackWidth, buffer, biomeKey, trackHeight, biomeKey);
    renderStrips();
  }

  function stopAtBiome(trackWidth, biomeKey, trackHeight, buffer) {
    trimExitedStrips();
    ensureCoverage(trackWidth, buffer, biomeKey, trackHeight, biomeKey);
    renderStrips();
  }

  function syncAllToBiome(biomeKey, trackHeight) {
    for (const strip of state.strips) {
      applyStripBiome(strip, biomeKey, trackHeight);
    }
  }

  function setVisible(visible) {
    if (track) {
      track.hidden = !visible;
    }
  }

  function setSeaMode(enabled) {
    track?.classList.toggle("play-ground-track--sea", enabled);
  }

  function reset() {
    state.strips = [];
    state.nextStripId = 0;
    if (track) {
      track.classList.remove("play-ground-track--sea");
      track.hidden = false;
      track.replaceChildren();
    }
  }

  function getCount() {
    return state.strips.length;
  }

  function trimExitedStrips() {
    while (state.strips.length && state.strips[0].x + state.strips[0].width < -8) {
      const strip = state.strips.shift();
      strip?.element.remove();
    }
  }

  function paintTraveledDistance(trackWidth, biomeKey, distance, trackHeight, buffer) {
    let remaining = distance;

    while (remaining > 0.0001) {
      const chunk = Math.min(MAX_SEGMENT_WIDTH, remaining);
      appendBiomeDistance(biomeKey, chunk, trackHeight);
      remaining -= chunk;
    }

    normalizeRightEdges(trackWidth, buffer, biomeKey, trackHeight);
  }

  function appendBiomeDistance(biomeKey, distance, trackHeight) {
    let remaining = distance;

    while (remaining > 0.0001) {
      const tail = state.strips[state.strips.length - 1];
      const previous = state.strips[state.strips.length - 2];

      if (tail && tail.biomeKey !== biomeKey && tail.width < MIN_TRANSITION_STRIP_WIDTH) {
        if (previous && previous.biomeKey === biomeKey) {
          previous.width += tail.width;
          setStripWidth(previous);
          if ((previous.width - previous.decoratedWidth) >= MIN_DECOR_REFRESH_DELTA) {
            rebuildDecorations(previous, trackHeight);
          }
          state.strips.pop();
          tail.element.remove();
          continue;
        }

        applyStripBiome(tail, biomeKey, trackHeight);
      }

      if (tail && tail.biomeKey === biomeKey && tail.width < MAX_SEGMENT_WIDTH) {
        const extension = Math.min(remaining, MAX_SEGMENT_WIDTH - tail.width);
        tail.width += extension;
        setStripWidth(tail);
        if (tail.biomeKey !== "ocean" && (tail.width - tail.decoratedWidth) >= MIN_DECOR_REFRESH_DELTA) {
          rebuildDecorations(tail, trackHeight);
        }
        remaining -= extension;
        continue;
      }

      const startX = tail ? tail.x + tail.width : 0;
      const strip = createStrip(biomeKey, startX, Math.min(remaining, MAX_SEGMENT_WIDTH), trackHeight);
      state.strips.push(strip);
      remaining -= strip.width;
    }
  }

  function normalizeRightEdges(trackWidth, buffer, tailBiomeKey, trackHeight) {
    if (!state.strips.length) {
      return;
    }

    let cursor = state.strips[0].x;
    for (const strip of state.strips) {
      strip.x = cursor;
      cursor += strip.width;
    }

    const rightEdge = cursor;
    const minimumRightEdge = trackWidth + buffer;
    if (rightEdge < minimumRightEdge) {
      appendBiomeDistance(
        tailBiomeKey ?? state.strips[state.strips.length - 1]?.biomeKey ?? "plains",
        minimumRightEdge - rightEdge,
        trackHeight
      );
    }
  }

  function trimRightOverflow(maxRightEdge, trackHeight) {
    while (state.strips.length) {
      const tail = state.strips[state.strips.length - 1];
      const tailRight = tail.x + tail.width;
      if (tail.x >= maxRightEdge) {
        state.strips.pop();
        tail.element.remove();
        continue;
      }
      if (tailRight > maxRightEdge) {
        tail.width = Math.max(12, maxRightEdge - tail.x);
        setStripWidth(tail);
        if (tail.biomeKey !== "ocean" && (tail.width - tail.decoratedWidth) >= MIN_DECOR_REFRESH_DELTA) {
          rebuildDecorations(tail, trackHeight);
        }
      }
      break;
    }
  }

  function createStrip(biomeKey, x, width, trackHeight) {
    const id = state.nextStripId;
    state.nextStripId += 1;
    const normalizedBiomeKey = normalizeBiomeKey(biomeKey);
    const colors = getStripColors(normalizedBiomeKey);
    const element = document.createElement("div");
    element.className = "play-ground-strip";
    applyStripVisuals(element, normalizedBiomeKey, colors);

    const strip = {
      id,
      biomeKey: normalizedBiomeKey,
      x,
      width,
      decoratedWidth: width,
      element
    };

    setStripWidth(strip);
    if (normalizedBiomeKey !== "ocean") {
      rebuildDecorations(strip, trackHeight);
    }

    track?.append(element);
    return strip;
  }

  function rebuildDecorations(strip, trackHeight) {
    strip.element.replaceChildren();
    const decoration = buildDecorations(strip.id, strip.biomeKey, strip.width, trackHeight);
    for (const item of decoration) {
      strip.element.append(item);
    }
    strip.decoratedWidth = strip.width;
  }

  function applyStripBiome(strip, biomeKey, trackHeight) {
    const normalizedBiomeKey = normalizeBiomeKey(biomeKey);
    if (!normalizedBiomeKey || strip.biomeKey === normalizedBiomeKey) {
      return;
    }

    strip.biomeKey = normalizedBiomeKey;
    const colors = getStripColors(normalizedBiomeKey);
    applyStripVisuals(strip.element, normalizedBiomeKey, colors);
    if (normalizedBiomeKey === "ocean") {
      strip.element.replaceChildren();
      strip.decoratedWidth = strip.width;
      return;
    }

    rebuildDecorations(strip, trackHeight);
  }

  function setStripWidth(strip) {
    strip.element.style.width = `${Math.max(1, strip.width).toFixed(3)}px`;
  }

  function applyStripVisuals(element, biomeKey, colors) {
    element.style.setProperty("--strip-light", colors.light);
    element.style.setProperty("--strip-base", colors.base);
    element.style.setProperty("--strip-deep", colors.deep);
    element.style.setProperty("--strip-stone", colors.stone);
    element.style.setProperty("--strip-tuft", colors.tuft);
    element.classList.toggle("play-ground-strip--sea", biomeKey === "ocean");
  }

  function renderStrips() {
    for (const strip of state.strips) {
      strip.element.style.transform = `translateX(${strip.x.toFixed(3)}px)`;
    }
  }
}
