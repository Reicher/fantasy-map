import { createViewport } from "../render/renderer.js?v=20260401ad";
import { findPlayableCityAtWorldPoint } from "../game/playQueries.js?v=20260401a";

export function createPlayController({
  playCanvas,
  state,
  renderPlayWorld,
  createPlayCamera,
  beginTravel,
  advanceTravel,
  getValidTargetIds
}) {
  playCanvas.addEventListener("pointermove", (event) => {
    if (
      state.currentMode !== "play" ||
      !state.currentWorld ||
      !state.playState ||
      state.playState.viewMode !== "map"
    ) {
      return;
    }

    if (state.playState.travel) {
      if (state.playState.hoveredCityId != null || state.playState.pressedCityId != null) {
        state.playState = {
          ...state.playState,
          hoveredCityId: null,
          pressedCityId: null
        };
        renderPlayWorld();
      }
      playCanvas.style.cursor = "default";
      return;
    }

    const hoveredCityId = findPlayableCityAtEvent(event);
    if (hoveredCityId === state.playState.hoveredCityId) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredCityId,
      pressedCityId:
        state.playState.pressedCityId && state.playState.pressedCityId === hoveredCityId
          ? state.playState.pressedCityId
          : null
    };
    playCanvas.style.cursor = hoveredCityId != null ? "pointer" : "default";
    renderPlayWorld();
  });

  playCanvas.addEventListener("pointerdown", (event) => {
    if (
      state.currentMode !== "play" ||
      event.button !== 0 ||
      !state.playState ||
      state.playState.viewMode !== "map" ||
      state.playState.travel
    ) {
      return;
    }

    const pressedCityId = findPlayableCityAtEvent(event);
    if (pressedCityId == null) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredCityId: pressedCityId,
      pressedCityId
    };
    renderPlayWorld();
  });

  playCanvas.addEventListener("pointerup", (event) => {
    if (
      state.currentMode !== "play" ||
      !state.playState ||
      state.playState.viewMode !== "map" ||
      state.playState.travel
    ) {
      return;
    }

    const targetCityId = findPlayableCityAtEvent(event);
    const shouldTravel = targetCityId != null && targetCityId === state.playState.pressedCityId;
    state.playState = {
      ...state.playState,
      pressedCityId: null,
      hoveredCityId: targetCityId
    };

    if (shouldTravel) {
      state.playState = beginTravel(state.playState, targetCityId);
      ensureAnimation();
      playCanvas.style.cursor = "default";
    }

    renderPlayWorld();
  });

  playCanvas.addEventListener("pointerleave", () => {
    if (!state.playState) {
      return;
    }

    playCanvas.style.cursor = "default";
    state.playState = {
      ...state.playState,
      hoveredCityId: null,
      pressedCityId: null
    };
    renderPlayWorld();
  });

  return {
    ensureAnimation,
    stopAnimation
  };

  function findPlayableCityAtEvent(event) {
    const validCityIds = new Set(getValidTargetIds(state.playState));
    if (validCityIds.size === 0) {
      return null;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * playCanvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * playCanvas.height;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    return findPlayableCityAtWorldPoint(
      state.currentWorld,
      state.playState,
      validCityIds,
      worldPoint.x,
      worldPoint.y
    );
  }

  function ensureAnimation() {
    if (state.playAnimationFrame != null || !state.playState?.travel) {
      return;
    }

    state.lastTravelTick = performance.now();
    const step = (timestamp) => {
      state.playAnimationFrame = null;
      if (state.currentMode !== "play" || !state.playState?.travel) {
        return;
      }

      const delta = timestamp - state.lastTravelTick;
      state.lastTravelTick = timestamp;
      state.playState = advanceTravel(state.playState, state.currentWorld, delta);
      renderPlayWorld();

      if (state.playState.travel) {
        state.playAnimationFrame = requestAnimationFrame(step);
      }
    };

    state.playAnimationFrame = requestAnimationFrame(step);
  }

  function stopAnimation() {
    if (state.playAnimationFrame != null) {
      cancelAnimationFrame(state.playAnimationFrame);
      state.playAnimationFrame = null;
    }
  }
}
