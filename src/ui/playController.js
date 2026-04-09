import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import { createViewport } from "../render/renderer.js?v=20260409d";
import { findPlayableNodeAtWorldPoint } from "../game/playQueries.js?v=20260409e";
import { advanceTimeOfDayHours } from "../game/timeOfDay.js";
import { getNodeTitle } from "../nodeModel.js";

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
    const hoveredNodeId = state.playState.travel
      ? null
      : findPlayableNodeAtEvent(event);

    if (hoveredNodeId != null) {
      const nodes =
        state.currentWorld.features?.pointsOfInterest ??
        state.currentWorld.cities;
      const node = nodes[hoveredNodeId];
      if (node) {
        showHoverHit(
          {
            title: getNodeTitle(node),
          },
          tooltip,
          event.clientX,
          event.clientY,
        );
      } else {
        clearHover(tooltip);
      }
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
        state.playState.hoveredNodeId != null ||
        state.playState.pressedNodeId != null
      ) {
        state.playState = {
          ...state.playState,
          hoveredNodeId: null,
          pressedNodeId: null,
        };
        renderPlayWorld();
      }
      playCanvas.style.cursor = "default";
      return;
    }

    if (hoveredNodeId === state.playState.hoveredNodeId) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredNodeId,
      pressedNodeId:
        state.playState.pressedNodeId &&
        state.playState.pressedNodeId === hoveredNodeId
          ? state.playState.pressedNodeId
          : null,
    };
    playCanvas.style.cursor = hoveredNodeId != null ? "pointer" : "default";
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

    const pressedNodeId = findPlayableNodeAtEvent(event);
    if (pressedNodeId == null) {
      return;
    }

    state.playState = {
      ...state.playState,
      hoveredNodeId: pressedNodeId,
      pressedNodeId,
    };
    renderPlayWorld();
  });

  playCanvas.addEventListener("pointerup", (event) => {
    if (
      state.currentMode !== "play" ||
      event.button !== 0 ||
      !state.playState ||
      state.playState.viewMode !== "map" ||
      state.playState.travel
    ) {
      return;
    }

    const targetNodeId = findPlayableNodeAtEvent(event);
    const shouldTravel =
      targetNodeId != null && targetNodeId === state.playState.pressedNodeId;
    state.playState = {
      ...state.playState,
      pressedNodeId: null,
      hoveredNodeId: targetNodeId,
    };

    if (shouldTravel) {
      const nextPlayState = beginTravel(
        state.playState,
        targetNodeId,
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
      hoveredNodeId: null,
      pressedNodeId: null,
    };
    renderPlayWorld();
  });

  return {
    ensureAnimation,
    stopAnimation,
  };

  function findPlayableNodeAtEvent(event) {
    const validNodeIds = new Set(
      getValidTargetIds(state.playState, state.currentWorld).filter(
        (nodeId) => nodeId != null,
      ),
    );
    if (validNodeIds.size === 0) {
      return null;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    return findPlayableNodeAtWorldPoint(
      state.currentWorld,
      validNodeIds,
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
