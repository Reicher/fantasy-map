const SEA_RIPPLE_BASE_SPACING = 170;
const SEA_IDLE_PX_PER_MS = 0.018;

export function createJourneySeaTrack(seaTrack) {
  const state = {
    ripples: [],
    nextRippleId: 0,
    lastDriftTimestamp: 0
  };

  return {
    hasRipples,
    refill,
    ensureCoverage,
    advance,
    stopAtRest,
    drift,
    reset,
    getCount
  };

  function hasRipples() {
    return state.ripples.length > 0;
  }

  function refill(seaWidth, coverageBuffer) {
    state.ripples = [];
    state.nextRippleId = 0;
    seaTrack?.replaceChildren();
    let x = 34;
    while (x < seaWidth + coverageBuffer) {
      const ripple = createRipple(x);
      state.ripples.push(ripple);
      x += ripple.spacing;
    }
    renderRipples();
  }

  function ensureCoverage(seaWidth, coverageBuffer) {
    if (!seaTrack) {
      return;
    }

    let rightEdge = state.ripples.length
      ? Math.max(...state.ripples.map((ripple) => ripple.x + ripple.spacing))
      : 32;
    let guard = 0;

    while (rightEdge < seaWidth + coverageBuffer && guard < 32) {
      const ripple = createRipple(rightEdge);
      state.ripples.push(ripple);
      rightEdge += ripple.spacing;
      guard += 1;
    }
  }

  function advance(distance, seaWidth, coverageBuffer) {
    for (const ripple of state.ripples) {
      ripple.x -= distance;
    }

    while (state.ripples.length && state.ripples[0].x + state.ripples[0].width < -18) {
      const ripple = state.ripples.shift();
      ripple?.element.remove();
    }

    ensureCoverage(seaWidth, coverageBuffer);
    renderRipples();
  }

  function stopAtRest(seaWidth, coverageBuffer) {
    ensureCoverage(seaWidth, coverageBuffer);
    renderRipples();
  }

  function drift(timestamp, seaWidth, coverageBuffer, speedScale = 1) {
    if (!state.lastDriftTimestamp) {
      state.lastDriftTimestamp = timestamp;
      ensureCoverage(seaWidth, coverageBuffer);
      renderRipples();
      return;
    }

    const deltaMs = Math.max(0, timestamp - state.lastDriftTimestamp);
    state.lastDriftTimestamp = timestamp;
    if (deltaMs <= 0.0001) {
      return;
    }

    advance(deltaMs * SEA_IDLE_PX_PER_MS * speedScale, seaWidth, coverageBuffer);
  }

  function reset() {
    state.ripples = [];
    state.nextRippleId = 0;
    state.lastDriftTimestamp = 0;
    seaTrack?.replaceChildren();
  }

  function getCount() {
    return state.ripples.length;
  }

  function createRipple(x) {
    const id = state.nextRippleId;
    state.nextRippleId += 1;
    const width = 10 + hash01(`ripple:${id}:width`) * 14;
    const y = 12 + hash01(`ripple:${id}:y`) * Math.max(10, (seaTrack?.clientHeight || 80) * 0.52);
    const spacing = SEA_RIPPLE_BASE_SPACING + hash01(`ripple:${id}:spacing`) * 120;
    const element = document.createElement("span");
    element.className = "play-sea-ripple";
    element.style.left = "0";
    element.style.top = `${y.toFixed(1)}px`;
    element.style.width = `${width.toFixed(1)}px`;
    element.style.opacity = `${0.28 + hash01(`ripple:${id}:alpha`) * 0.26}`;
    seaTrack?.append(element);

    return {
      id,
      x,
      width,
      spacing,
      element
    };
  }

  function renderRipples() {
    for (const ripple of state.ripples) {
      ripple.element.style.transform = `translateX(${Math.round(ripple.x)}px)`;
    }
  }
}

function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 100000) / 100000;
}
