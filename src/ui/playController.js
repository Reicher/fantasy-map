import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import { createViewport } from "../render/renderer.js?v=20260409a";
import { findPlayablePoiAtWorldPoint } from "../game/playQueries.js?v=20260409b";
import { advanceTimeOfDayHours } from "../game/timeOfDay.js";
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
    const hoveredPoiId = state.playState.travel
      ? null
      : findPlayablePoiAtEvent(event);

    if (hoveredPoiId != null) {
      const pois = state.currentWorld.pointsOfInterest ?? state.currentWorld.cities;
      const poi = pois[hoveredPoiId];
      showHoverHit(
        {
          title: getPoiTitle(poi),
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
        state.playState.hoveredPoiId != null ||
        state.playState.pressedPoiId != null
      ) {
        state.playState = {
          ...state.playState,
          hoveredPoiId: null,
          pressedPoiId: null,
          hoveredCityId: null,
          pressedCityId: null,
        };
        renderPlayWorld();
      }
      playCanvas.style.cursor = "default";
      return;
    }

    if (hoveredPoiId === state.playState.hoveredPoiId) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredPoiId,
      hoveredCityId: hoveredPoiId,
      pressedPoiId:
        state.playState.pressedPoiId &&
        state.playState.pressedPoiId === hoveredPoiId
          ? state.playState.pressedPoiId
          : null,
      pressedCityId:
        state.playState.pressedPoiId &&
        state.playState.pressedPoiId === hoveredPoiId
          ? state.playState.pressedPoiId
          : null,
    };
    playCanvas.style.cursor = hoveredPoiId != null ? "pointer" : "default";
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

    const pressedPoiId = findPlayablePoiAtEvent(event);
    if (pressedPoiId == null) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredPoiId: pressedPoiId,
      hoveredCityId: pressedPoiId,
      pressedPoiId,
      pressedCityId: pressedPoiId,
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

    const targetPoiId = findPlayablePoiAtEvent(event);
    const shouldTravel =
      targetPoiId != null && targetPoiId === state.playState.pressedPoiId;
    state.playState = {
      ...state.playState,
      pressedPoiId: null,
      pressedCityId: null,
      hoveredPoiId: targetPoiId,
      hoveredCityId: targetPoiId,
    };

    if (shouldTravel) {
      const nextPlayState = beginTravel(
        state.playState,
        targetPoiId,
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
      hoveredPoiId: null,
      pressedPoiId: null,
      hoveredCityId: null,
      pressedCityId: null,
    };
    renderPlayWorld();
  });

  return {
    ensureAnimation,
    stopAnimation,
  };

  function findPlayablePoiAtEvent(event) {
    const validPoiIds = new Set(getValidTargetIds(state.playState));
    if (validPoiIds.size === 0) {
      return null;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    return findPlayablePoiAtWorldPoint(
      state.currentWorld,
      state.playState,
      validPoiIds,
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
      const isJourney = state.playState?.viewMode === "journey";
      const isTraveling = Boolean(state.playState?.travel);

      if (isTraveling) {
        state.playState = {
          ...state.playState,
          timeOfDayHours: advanceTimeOfDayHours(
            state.playState?.timeOfDayHours,
            delta,
          ),
        };
      }

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
