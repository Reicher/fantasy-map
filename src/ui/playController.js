import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import { createViewport } from "../render/renderer.js?v=20260408l";
import { findPlayableCityAtWorldPoint } from "../game/playQueries.js?v=20260408a";
import { getPoiTitle } from "../poi/poiModel.js";

export function createPlayController({
  playCanvas,
  tooltip,
  state,
  profiler,
  renderPlayWorld,
  createPlayCamera,
  beginTravel,
  advanceTravel,
  getValidTargetIds,
  inspectWorldAt,
  clearHover,
  showHoverHit,
}) {
  let lastRenderedAt = 0;

  playCanvas.addEventListener("pointermove", (event) => {
    if (
      state.currentMode !== "play" ||
      !state.currentWorld ||
      !state.playState ||
      state.playState.viewMode !== "map"
    ) {
      return;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    const hoveredCityId = state.playState.travel
      ? null
      : findPlayableCityAtEvent(event);

    if (hoveredCityId != null) {
      const city = state.currentWorld.cities[hoveredCityId];
      showHoverHit(
        {
          title: getPoiTitle(city),
        },
        tooltip,
        event.clientX,
        event.clientY,
      );
    } else if (state.playMapOptions?.showHoverInspector) {
      const hit = inspectWorldAt(
        state.currentWorld,
        worldPoint.x,
        worldPoint.y,
        {
          canvasX,
          canvasY,
          viewport,
        },
      );
      if (hit) {
        showHoverHit(hit, tooltip, event.clientX, event.clientY);
      } else {
        clearHover(tooltip);
      }
    } else {
      clearHover(tooltip);
    }

    if (state.playState.travel) {
      if (
        state.playState.hoveredCityId != null ||
        state.playState.pressedCityId != null
      ) {
        state.playState = {
          ...state.playState,
          hoveredCityId: null,
          pressedCityId: null,
        };
        renderPlayWorld();
      }
      playCanvas.style.cursor = "default";
      return;
    }

    if (hoveredCityId === state.playState.hoveredCityId) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredCityId,
      pressedCityId:
        state.playState.pressedCityId &&
        state.playState.pressedCityId === hoveredCityId
          ? state.playState.pressedCityId
          : null,
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
      pressedCityId,
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
    const shouldTravel =
      targetCityId != null && targetCityId === state.playState.pressedCityId;
    state.playState = {
      ...state.playState,
      pressedCityId: null,
      hoveredCityId: targetCityId,
    };

    if (shouldTravel) {
      const nextPlayState = beginTravel(
        state.playState,
        targetCityId,
        state.currentWorld,
      );
      state.playState = {
        ...nextPlayState,
        viewMode: "journey",
      };
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
    clearHover(tooltip);
    state.playState = {
      ...state.playState,
      hoveredCityId: null,
      pressedCityId: null,
    };
    renderPlayWorld();
  });

  return {
    ensureAnimation,
    stopAnimation,
  };

  function findPlayableCityAtEvent(event) {
    const validCityIds = new Set(getValidTargetIds(state.playState));
    if (validCityIds.size === 0) {
      return null;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    return findPlayableCityAtWorldPoint(
      state.currentWorld,
      state.playState,
      validCityIds,
      worldPoint.x,
      worldPoint.y,
    );
  }

  function ensureAnimation() {
    const shouldAnimate =
      state.currentMode === "play" &&
      (state.playState?.travel || state.playState?.viewMode === "journey");
    if (state.playAnimationFrame != null || !shouldAnimate) {
      return;
    }

    state.lastTravelTick = performance.now();
    const step = (timestamp) => {
      state.playAnimationFrame = null;
      const shouldKeepAnimating =
        state.currentMode === "play" &&
        (state.playState?.travel || state.playState?.viewMode === "journey");
      if (!shouldKeepAnimating) {
        return;
      }

      profiler.frame(timestamp);

      const delta = timestamp - state.lastTravelTick;
      state.lastTravelTick = timestamp;
      if (state.playState?.travel) {
        state.playState = profiler.measure("advance-travel", () =>
          advanceTravel(state.playState, state.currentWorld, delta),
        );
        profiler.count("travel-ticks");
      }
      profiler.setSnapshot({
        viewMode: state.playState?.viewMode ?? "unknown",
        traveling: state.playState?.travel ? "yes" : "no",
      });
      const isJourney = state.playState?.viewMode === "journey";
      const shouldRenderMapFrame =
        !isJourney &&
        (timestamp - lastRenderedAt >= 66 || !state.playState.travel);

      if (isJourney || shouldRenderMapFrame) {
        renderPlayWorld();
        lastRenderedAt = timestamp;
      }

      if (state.playState.travel || isJourney) {
        state.playAnimationFrame = requestAnimationFrame(step);
      } else if (!isJourney) {
        renderPlayWorld();
        lastRenderedAt = timestamp;
      }
    };

    state.playAnimationFrame = requestAnimationFrame(step);
  }

  function stopAnimation() {
    if (state.playAnimationFrame != null) {
      cancelAnimationFrame(state.playAnimationFrame);
      state.playAnimationFrame = null;
    }
    lastRenderedAt = 0;
  }
}
