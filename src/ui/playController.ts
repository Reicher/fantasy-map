import { RENDER_HEIGHT, RENDER_WIDTH } from "../config";
import { createViewport } from "../render/renderer";
import { findPlayableNodeAtWorldPoint } from "../game/playQueries";
import {
  applyHourlyHunger,
  advanceHunt,
  applyHourlyTravelStamina,
  advanceRest,
  finalizeHourlySurvival,
} from "../game/travel";
import { isNodeDiscovered } from "../game/travel/selectors";
import { getElapsedTimeOfDayHours, normalizeTimeOfDayHours } from "../game/timeOfDay";
import { getNodeTitle } from "../node/model";
import type { PlayControllerDeps } from "../types/runtime";
import type { PlayRunStats, PlayState, PlayTravelState } from "../types/play";
import type { World } from "../types/world";

const KILOMETERS_PER_CELL = 1;
interface MapPanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  dragging: boolean;
}

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
}: PlayControllerDeps) {
  let lastRenderedAt = 0;
  const MAP_PAN_START_THRESHOLD_PX = 6;
  let pendingWorldHours = 0;
  let mapPanState: MapPanState | null = null;

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
        const distanceLabel = getNeighborDistanceLabel(
          state.playState,
          hoveredNodeId,
        );
        showHoverHit(
          {
            title,
            subtitle: distanceLabel,
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
      !state.currentWorld ||
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

  function findPlayableNodeAtEvent(event: PointerEvent): number | null {
    if (!state.currentWorld || !state.playState) {
      return null;
    }
    const validNodeIds = new Set(
      (getValidTargetIds(state.playState) as number[]).filter(
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
    const step = (timestamp: number): void => {
      state.playAnimationFrame = null;
      const shouldKeepAnimating =
        state.currentMode === "play" &&
        Boolean(state.currentWorld) &&
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
      const { shouldAdvanceWorldTime } = getWorldTimeActivity(state.playState);

      if (shouldAdvanceWorldTime) {
        pendingWorldHours += getElapsedTimeOfDayHours(delta);
        const wholeHours = Math.floor(pendingWorldHours + 1e-9);
        if (wholeHours > 0 && state.currentWorld) {
          const advanceResult = advanceWholeWorldHours(
            state.playState,
            state.currentWorld,
            wholeHours,
          );
          state.playState = advanceResult.playState;
          pendingWorldHours = Math.max(0, pendingWorldHours - wholeHours);
          if (advanceResult.halted) {
            // Remaining frame time belongs to post-action idle state and should
            // not convert into gameplay hours.
            pendingWorldHours = 0;
          }
        }
      }

      if (
        state.playState?.travel &&
        !state.playState?.gameOver &&
        !state.playState?.isTravelPaused &&
        !state.playState?.rest
      ) {
        const activeWorld = state.currentWorld as World | null;
        if (!activeWorld) {
          renderPlayWorld();
          lastRenderedAt = timestamp;
          return;
        }
        const previousTravel = state.playState.travel;
        state.playState = profiler.measure("advance-travel", () =>
          advanceTravel(state.playState, activeWorld, delta),
        );
        const distanceDelta = getTraveledDistanceDelta(
          previousTravel,
          state.playState?.travel,
        );
        if (distanceDelta > 0 && state.playState) {
          const runStats = normalizeRunStats(state.playState.runStats);
          state.playState = {
            ...state.playState,
            runStats: {
              ...runStats,
              distanceTraveled: runStats.distanceTraveled + distanceDelta,
            },
          };
        }
        profiler.count("travel-ticks");
      }
      syncVisualWorldClock(state.playState, pendingWorldHours);
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
    pendingWorldHours = 0;
    lastRenderedAt = 0;
  }

  function getWorldTimeActivity(playState: PlayState | null) {
    const hasTravel = Boolean(playState?.travel);
    const isTravelPaused = Boolean(playState?.isTravelPaused);
    const isResting = Boolean(playState?.rest);
    const isHunting = Boolean(playState?.hunt);
    const isTraveling = hasTravel && !isTravelPaused && !isResting && !isHunting;
    return {
      isTraveling,
      isResting,
      isHunting,
      shouldAdvanceWorldTime: isTraveling || isResting || isHunting,
    };
  }

  function syncVisualWorldClock(
    playState: PlayState | null,
    fractionalHours: number,
  ): void {
    if (!playState) {
      return;
    }
    const clampedFractionalHours = Number.isFinite(fractionalHours)
      ? Math.max(0, fractionalHours)
      : 0;
    const baseTimeOfDayHours = Number.isFinite(playState.timeOfDayHours)
      ? playState.timeOfDayHours
      : 0;
    const baseElapsedWorldHours = Number.isFinite(playState.journeyElapsedHours)
      ? Math.max(0, playState.journeyElapsedHours)
      : Number.isFinite(playState.hungerElapsedHours)
        ? Math.max(0, playState.hungerElapsedHours)
        : 0;
    playState.renderTimeOfDayHours = normalizeTimeOfDayHours(
      baseTimeOfDayHours + clampedFractionalHours,
    );
    playState.renderElapsedWorldHours =
      baseElapsedWorldHours + clampedFractionalHours;
  }

  function advanceWholeWorldHours(
    playState: PlayState | null,
    world: World,
    hoursToAdvance: number,
  ): { playState: PlayState | null; halted: boolean } {
    let nextState = playState;
    let processedHours = 0;

    while (processedHours < hoursToAdvance) {
      const activity = getWorldTimeActivity(nextState);
      if (!activity.shouldAdvanceWorldTime) {
        return {
          playState: nextState,
          halted: true,
        };
      }

      const currentJourneyElapsedHours = Number.isFinite(
        nextState?.journeyElapsedHours,
      )
        ? Math.max(0, nextState.journeyElapsedHours)
        : 0;
      const runStats = normalizeRunStats(nextState?.runStats);
      nextState = {
        ...nextState,
        timeOfDayHours: normalizeTimeOfDayHours(
          (nextState?.timeOfDayHours ?? 0) + 1,
        ),
        journeyElapsedHours: currentJourneyElapsedHours + 1,
        runStats: {
          ...runStats,
          travelHours: runStats.travelHours + (activity.isTraveling ? 1 : 0),
          huntHours: runStats.huntHours + (activity.isHunting ? 1 : 0),
          restHours: runStats.restHours + (activity.isResting ? 1 : 0),
        },
      };

      nextState = applyHourlyHunger(nextState, 1);
      if (activity.isTraveling) {
        nextState = applyHourlyTravelStamina(nextState, 1);
      }
      if (activity.isResting) {
        nextState = advanceRest(nextState, 1);
      }
      if (activity.isHunting) {
        nextState = advanceHunt(nextState, world, 1);
      }
      nextState = finalizeHourlySurvival(nextState);

      processedHours += 1;
      if (nextState?.gameOver) {
        return {
          playState: nextState,
          halted: true,
        };
      }
    }

    return {
      playState: nextState,
      halted: false,
    };
  }

  function panPlayMapByClientDelta(deltaClientX: number, deltaClientY: number): void {
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

  function getNeighborDistanceLabel(
    playState: PlayState | null,
    nodeId: number | null,
  ): string {
    const currentNodeId = playState?.currentNodeId;
    if (currentNodeId == null || nodeId == null) {
      return "";
    }
    const path = playState?.graph?.get(currentNodeId)?.get(nodeId) ?? null;
    const distance = measurePathDistance(path?.points);
    if (!Number.isFinite(distance) || distance <= 0) {
      return "";
    }
    return `Avstånd: ${formatDistanceWithUnit(distance)}`;
  }

  function measurePathDistance(
    points: Array<{ x?: number; y?: number }> | undefined,
  ): number | null {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (
        !Number.isFinite(from?.x) ||
        !Number.isFinite(from?.y) ||
        !Number.isFinite(to?.x) ||
        !Number.isFinite(to?.y)
      ) {
        continue;
      }
      total += Math.hypot(to.x - from.x, to.y - from.y);
    }
    return Number.isFinite(total) ? total : null;
  }

  function formatDistanceWithUnit(distance: number): string {
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    const distanceKm = safeDistance * KILOMETERS_PER_CELL;
    return `${distanceKm.toLocaleString("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    })} km`;
  }

  function normalizeRunStats(stats: PlayRunStats | null | undefined): Required<PlayRunStats> {
    return {
      meatEaten: normalizeWholeNumber(stats?.meatEaten),
      travelHours: normalizeWholeNumber(stats?.travelHours),
      huntHours: normalizeWholeNumber(stats?.huntHours),
      restHours: normalizeWholeNumber(stats?.restHours),
      distanceTraveled: normalizeNonNegative(stats?.distanceTraveled),
    };
  }

  function normalizeWholeNumber(value: number | undefined) {
    return Math.floor(normalizeNonNegative(value));
  }

  function normalizeNonNegative(value: number | undefined): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, value);
  }

  function getTraveledDistanceDelta(
    previousTravel: PlayTravelState | null | undefined,
    nextTravel: PlayTravelState | null | undefined,
  ): number {
    const previousProgress = Number.isFinite(previousTravel?.progress)
      ? previousTravel.progress
      : 0;
    if (nextTravel) {
      const nextProgress = Number.isFinite(nextTravel.progress)
        ? nextTravel.progress
        : previousProgress;
      return Math.max(0, nextProgress - previousProgress);
    }
    const totalLength = Number.isFinite(previousTravel?.totalLength)
      ? previousTravel.totalLength
      : previousProgress;
    return Math.max(0, totalLength - previousProgress);
  }
}
