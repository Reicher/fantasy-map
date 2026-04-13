import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import { createViewport } from "../render/renderer.js?v=20260412d";
import { findPlayableNodeAtWorldPoint } from "../game/playQueries.js?v=20260409e";
import {
  applyHourlyHunger,
  advanceHunt,
  applyHourlyTravelStamina,
  advanceRest,
  isNodeDiscovered,
} from "../game/travel.js?v=20260413a";
import { advanceTimeOfDayHours, getElapsedTimeOfDayHours } from "../game/timeOfDay.js";
import { getNodeTitle } from "../node/model.js";

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
  const MAP_PAN_START_THRESHOLD_PX = 6;
  let mapPanState = null;

  playCanvas.addEventListener("pointermove", (event) => {
    if (
      state.currentMode !== "play" ||
      !state.currentWorld ||
      !state.playState ||
      state.playState.gameOver ||
      state.playState.viewMode !== "map"
    ) {
      return;
    }

    if (
      mapPanState &&
      event.pointerId === mapPanState.pointerId
    ) {
      const totalDeltaX = event.clientX - mapPanState.startClientX;
      const totalDeltaY = event.clientY - mapPanState.startClientY;
      if (
        !mapPanState.dragging &&
        Math.hypot(totalDeltaX, totalDeltaY) >= MAP_PAN_START_THRESHOLD_PX
      ) {
        mapPanState.dragging = true;
        clearHover(tooltip);
        state.playState = {
          ...state.playState,
          hoveredNodeId: null,
          pressedNodeId: null,
        };
      }

      if (mapPanState.dragging) {
        const stepDeltaX = event.clientX - mapPanState.lastClientX;
        const stepDeltaY = event.clientY - mapPanState.lastClientY;
        mapPanState.lastClientX = event.clientX;
        mapPanState.lastClientY = event.clientY;
        if (Math.abs(stepDeltaX) > 0.001 || Math.abs(stepDeltaY) > 0.001) {
          panPlayMapByClientDelta(stepDeltaX, stepDeltaY);
          renderPlayWorld();
        }
        playCanvas.style.cursor = "grabbing";
        return;
      }
      mapPanState.lastClientX = event.clientX;
      mapPanState.lastClientY = event.clientY;
    }

    const rect = playCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const viewport = createViewport(state.currentWorld, createPlayCamera());
    const worldPoint = viewport.canvasToWorld(canvasX, canvasY);
    const hoveredNodeId =
      state.playState.travel ? null : findPlayableNodeAtEvent(event);

    if (hoveredNodeId != null) {
      const nodes = state.currentWorld.features?.nodes ?? [];
      const node = nodes[hoveredNodeId];
      if (node) {
        const title = isNodeDiscovered(state.playState, hoveredNodeId)
          ? getNodeTitle(node)
          : "Okänd plats";
        showHoverHit(
          {
            title,
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
      state.playState.gameOver ||
      state.playState.viewMode !== "map"
    ) {
      return;
    }

    const pressedNodeId = state.playState.travel
      ? null
      : findPlayableNodeAtEvent(event);
    mapPanState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      dragging: false,
    };
    try {
      playCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail in some environments; drag still works.
    }

    if (pressedNodeId == null) {
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
      state.playState.gameOver ||
      state.playState.viewMode !== "map"
    ) {
      return;
    }

    const isPanPointer = mapPanState && event.pointerId === mapPanState.pointerId;
    const wasDragging = Boolean(isPanPointer && mapPanState.dragging);
    if (isPanPointer) {
      try {
        playCanvas.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore capture-release failures.
      }
      mapPanState = null;
    }

    if (wasDragging) {
      playCanvas.style.cursor = "default";
      clearHover(tooltip);
      state.playState = {
        ...state.playState,
        hoveredNodeId: null,
        pressedNodeId: null,
      };
      renderPlayWorld();
      return;
    }

    const targetNodeId = state.playState.travel
      ? null
      : findPlayableNodeAtEvent(event);
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

    if (mapPanState?.dragging) {
      return;
    }

    mapPanState = null;
    playCanvas.style.cursor = "default";
    clearHover(tooltip);
    state.playState = {
      ...state.playState,
      hoveredNodeId: null,
      pressedNodeId: null,
    };
    renderPlayWorld();
  });

  playCanvas.addEventListener("pointercancel", () => {
    mapPanState = null;
    playCanvas.style.cursor = "default";
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
    const hasTimedAction = Boolean(state.playState?.rest || state.playState?.hunt);
    const shouldAnimate =
      state.currentMode === "play" &&
      !state.playState?.gameOver &&
      (state.playState?.travel ||
        state.playState?.viewMode === "journey" ||
        hasTimedAction);
    if (state.playAnimationFrame != null || !shouldAnimate) {
      return;
    }

    state.lastTravelTick = performance.now();
    const step = (timestamp) => {
      state.playAnimationFrame = null;
      const shouldKeepAnimating =
        state.currentMode === "play" &&
        !state.playState?.gameOver &&
        (state.playState?.travel ||
          state.playState?.viewMode === "journey" ||
          state.playState?.rest ||
          state.playState?.hunt);
      if (!shouldKeepAnimating) {
        return;
      }

      profiler.frame(timestamp);

      const delta = timestamp - state.lastTravelTick;
      state.lastTravelTick = timestamp;
      const isJourney = state.playState?.viewMode === "journey";
      const hasTravel = Boolean(state.playState?.travel);
      const isTravelPaused = Boolean(state.playState?.isTravelPaused);
      const isResting = Boolean(state.playState?.rest);
      const isHunting = Boolean(state.playState?.hunt);
      const isTraveling = hasTravel && !isTravelPaused && !isResting && !isHunting;
      const shouldAdvanceWorldTime = isTraveling || isResting || isHunting;

      if (shouldAdvanceWorldTime) {
        const elapsedTimeOfDayHours = getElapsedTimeOfDayHours(delta);
        const nextTimeOfDayHours = advanceTimeOfDayHours(
          state.playState?.timeOfDayHours,
          delta,
        );
        const currentJourneyElapsedHours = Number.isFinite(
          state.playState?.journeyElapsedHours,
        )
          ? Math.max(0, state.playState.journeyElapsedHours)
          : 0;
        state.playState = {
          ...state.playState,
          timeOfDayHours: nextTimeOfDayHours,
          journeyElapsedHours: currentJourneyElapsedHours + elapsedTimeOfDayHours,
        };

        state.playState = applyHourlyHunger(
          state.playState,
          elapsedTimeOfDayHours,
        );

        if (!state.playState?.gameOver && isTraveling) {
          state.playState = applyHourlyTravelStamina(
            state.playState,
            elapsedTimeOfDayHours,
          );
        }

        if (!state.playState?.gameOver && isResting) {
          state.playState = advanceRest(state.playState, elapsedTimeOfDayHours);
        }

        if (!state.playState?.gameOver && isHunting) {
          state.playState = advanceHunt(
            state.playState,
            state.currentWorld,
            elapsedTimeOfDayHours,
          );
        }
      }

      if (
        state.playState?.travel &&
        !state.playState?.gameOver &&
        !state.playState?.isTravelPaused &&
        !state.playState?.rest
      ) {
        state.playState = profiler.measure("advance-travel", () =>
          advanceTravel(state.playState, state.currentWorld, delta),
        );
        profiler.count("travel-ticks");
      }
      profiler.setSnapshot({
        viewMode: state.playState?.viewMode ?? "unknown",
        traveling: state.playState?.travel ? "yes" : "no",
        paused: state.playState?.isTravelPaused ? "yes" : "no",
        resting: state.playState?.rest ? "yes" : "no",
        hunting: state.playState?.hunt ? "yes" : "no",
      });
      const shouldRenderMapFrame =
        !isJourney &&
        (timestamp - lastRenderedAt >= 66 || !state.playState.travel);

      if (isJourney || shouldRenderMapFrame) {
        renderPlayWorld();
        lastRenderedAt = timestamp;
      }

      const isGameOver = Boolean(state.playState?.gameOver);
      if (!isGameOver && (state.playState.travel || isJourney)) {
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

  function panPlayMapByClientDelta(deltaClientX, deltaClientY) {
    if (
      !state.currentWorld ||
      !Number.isFinite(deltaClientX) ||
      !Number.isFinite(deltaClientY)
    ) {
      return;
    }

    const rect = playCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const deltaCanvasX = (deltaClientX / rect.width) * RENDER_WIDTH;
    const deltaCanvasY = (deltaClientY / rect.height) * RENDER_HEIGHT;
    const camera = createPlayCamera();
    const viewport = createViewport(state.currentWorld, camera);

    state.playMapCamera = {
      ...camera,
      centerX: camera.centerX - deltaCanvasX / viewport.scaleX,
      centerY: camera.centerY - deltaCanvasY / viewport.scaleY,
    };
  }
}
