import {
  buildVisibleRoadOverlay,
  createPlayState,
  getDiscoveredNodeIds,
  getValidTargetIds,
  getVisibleNodeIds,
  reducePlayState,
  sampleTravelBiomeBandPoints,
  type TravelActionEvent,
} from "@fardvag/game-core";
import {
  createJourneyScene,
  renderPlayWorldDynamic,
  renderPlayWorldStatic,
} from "@fardvag/render-canvas";
import { inspectWorldAt } from "../inspector";
import {
  clampEditorCamera,
  createPlayCamera as buildPlayCamera,
} from "./cameraState";
import { clearHover, showHoverHit } from "./hoverPanel";
import { createMapAtlasCacheManager } from "./mapAtlasCache";
import { createPlayController } from "./playController";
import { createPlaySubViewController } from "./playSubView";
import {
  createTransitionController,
  waitForNextPaintIfActive,
} from "./viewState";
import type { PlaySessionDeps, RenderOptions } from "@fardvag/shared/types/runtime";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

export function createPlaySession({ refs, state, syncModeUi }: PlaySessionDeps) {
  const playModeTransition = createTransitionController();
  const playMapCache = createMapAtlasCacheManager({
    canvas: refs.playCanvas,
    getWorld: () => state.currentWorld,
    getCameraState: createPlayCamera,
    renderStaticScene: renderPlayWorldStatic,
    getStaticKey(renderOptions: RenderOptions = {}) {
      return `snow:${renderOptions.showSnow ? 1 : 0}`;
    },
  });

  const journeyScene = createJourneyScene({
    canvas: refs.playJourneyCanvas,
    getWorld: () => state.currentWorld,
  });

  const playController = createPlayController({
    playCanvas: refs.playCanvas,
    tooltip: refs.playTooltip,
    state,
    profiler: state.playProfiler,
    renderPlayWorld,
    createPlayCamera,
    getValidTargetIds,
    inspectWorldAt,
    clearHover,
    showHoverHit,
  });

  const playSubView = createPlaySubViewController({
    refs,
    state,
    journeyScene,
    profiler: state.playProfiler,
  });

  return {
    createInitialPlayState,
    renderPlayWorld,
    ensureAnimation: playController.ensureAnimation,
    setPlayViewMode,
    updatePlaySubView,
    toggleTravelPause,
    startRest,
    startHunt,
    cancelTimedAction,
    dismissActionResult,
    dismissActionDialog,
    encounterGreet,
    encounterAttack,
    encounterFlee,
    enterPlayMode,
    stopAnimation: playController.stopAnimation,
    resetJourney: journeyScene.reset,
  };

  function createInitialPlayState(world: World): PlayState {
    const playState = createPlayState(world);
    state.playMapCamera = buildPlayCamera(world, playState, 2);
    return state.currentMode === "play"
      ? {
          ...playState,
          viewMode: "journey" as const,
        }
      : playState;
  }

  function renderPlayWorld() {
    if (!state.currentWorld || !state.playState) {
      return;
    }

    if (state.playState.viewMode === "map") {
      state.playProfiler.measure("play-map-render", () => {
        const validNodeIds = getValidTargetIds(state.playState) as number[];
        const discoveredNodeIds = getDiscoveredNodeIds(state.playState) as number[];
        const discoveredNodeIdSet = new Set(discoveredNodeIds);
        const visibleNodeIds = getVisibleNodeIds(state.playState) as number[];
        const unknownNodeIds = visibleNodeIds.filter(
          (nodeId) => !discoveredNodeIdSet.has(nodeId),
        );
        const visibleRoads = buildVisibleRoadOverlay(
          state.playState.graph,
          visibleNodeIds,
        );
        const renderOptions: RenderOptions = {
          showSnow: state.renderOptions.showSnow,
          showBiomeLabels: state.playMapOptions.showBiomeLabels,
          showNodeLabels: state.playMapOptions.showNodeLabels,
          visibleNodeIds,
          nodeLabelVisibleNodeIds: discoveredNodeIds,
          discoveredCells: state.playState.discoveredCells,
          cameraState: createPlayCamera(),
          playerStart: state.playState.position,
          roadOverlay: {
            roads: visibleRoads,
          },
          fogOfWar: {
            enabled: true,
            playState: state.playState,
          },
          nodeOverlay: {
            validNodeIds,
            visibleNodeIds,
            unknownNodeIds,
            nodeLabelVisibleNodeIds: discoveredNodeIds,
            onlyValid: true,
            hoveredNodeId: state.playState.hoveredNodeId,
            pressedNodeId: state.playState.pressedNodeId,
          },
          travelDebug:
            state.playMapOptions.debugTravelSampling && state.playState.travel
              ? {
                  enabled: true,
                  samples: sampleTravelBiomeBandPoints(state.playState.travel),
                }
              : { enabled: false },
        };

        if (playMapCache.ensure(renderOptions)) {
          state.playProfiler.count("play-cache-miss");
        } else {
          state.playProfiler.count("play-cache-hit");
        }

        const ctx = refs.playCanvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, refs.playCanvas.width, refs.playCanvas.height);
        playMapCache.draw(renderOptions.cameraState);
        renderPlayWorldDynamic(
          refs.playCanvas,
          state.currentWorld,
          renderOptions,
        );
      });
    }

    updatePlaySubView();
  }

  function setPlayViewMode(mode: "map" | "journey") {
    if (!state.playState || (mode !== "map" && mode !== "journey")) {
      return;
    }

    if (mode === "map" && state.currentWorld) {
      const previousCamera =
        state.playMapCamera ?? buildPlayCamera(state.currentWorld, state.playState, 2);
      const targetX = Number(state.playState?.position?.x);
      const targetY = Number(state.playState?.position?.y);
      state.playMapCamera = clampEditorCamera(state.currentWorld, {
        ...previousCamera,
        centerX: Number.isFinite(targetX) ? targetX : previousCamera.centerX,
        centerY: Number.isFinite(targetY) ? targetY : previousCamera.centerY,
      });
    }

    state.playState = {
      ...state.playState,
      viewMode: mode,
      hoveredNodeId: mode === "map" ? state.playState.hoveredNodeId : null,
      pressedNodeId: null,
    };

    if (mode === "journey") {
      playController.ensureAnimation();
    }
    renderPlayWorld();
  }

  function updatePlaySubView() {
    playSubView.update(state.currentWorld, state.playState);
  }

  function toggleTravelPause() {
    return dispatchTravelAction(
      { type: "TOGGLE_TRAVEL_PAUSE" },
      { ensureAnimation: true },
    );
  }

  function startRest(hours: number) {
    return dispatchTravelAction(
      { type: "START_REST", hours },
      { ensureAnimation: true },
    );
  }

  function startHunt(hours: number) {
    return dispatchTravelAction(
      { type: "START_HUNT", hours },
      { ensureAnimation: true },
    );
  }

  function cancelTimedAction() {
    return dispatchTravelAction(
      { type: "CANCEL_TIMED_ACTION" },
      { ensureAnimation: true },
    );
  }

  function dismissActionDialog() {
    return dispatchTravelAction({ type: "DISMISS_MANUAL_TRAVEL_PAUSE" });
  }

  function dismissActionResult() {
    return dispatchTravelAction({ type: "DISMISS_HUNT_RESULT" });
  }

  function encounterGreet() {
    return dispatchTravelAction({ type: "ENCOUNTER_GREET" });
  }

  function encounterAttack() {
    return dispatchTravelAction({ type: "ENCOUNTER_ATTACK" });
  }

  function encounterFlee() {
    return dispatchTravelAction({ type: "ENCOUNTER_FLEE" });
  }

  async function enterPlayMode() {
    if (!state.currentWorld || !state.playState) {
      return;
    }
    void requestLandscapeOrientationLock();

    const transitionId = playModeTransition.begin();
    state.currentMode = "play";
    state.playLoading = true;
    state.editorLoading = false;
    state.dragState = null;
    if (state.playState) {
      state.playState = {
        ...state.playState,
        viewMode: "journey",
        hoveredNodeId: null,
        pressedNodeId: null,
      };
    }
    playSubView.reset();
    clearHover(refs.playTooltip);
    syncModeUi();

    if (
      !(await waitForNextPaintIfActive(playModeTransition, transitionId, 1))
    ) {
      return;
    }

    renderPlayWorld();
    playController.ensureAnimation();

    if (
      !(await waitForNextPaintIfActive(playModeTransition, transitionId, 1))
    ) {
      return;
    }

    state.playLoading = false;
    syncModeUi();

    if (
      !(await waitForNextPaintIfActive(playModeTransition, transitionId, 1))
    ) {
      return;
    }

    renderPlayWorld();
  }

  function createPlayCamera() {
    const fallbackCamera = buildPlayCamera(state.currentWorld, state.playState, 2);
    const nextCamera = state.playMapCamera ?? fallbackCamera;
    const clamped = clampEditorCamera(state.currentWorld, nextCamera);
    state.playMapCamera = clamped;
    return clamped;
  }

  function dispatchTravelAction(
    event: TravelActionEvent,
    options: { ensureAnimation?: boolean } = {},
  ): boolean {
    if (!state.playState || state.playState.gameOver) {
      return false;
    }
    const nextPlayState = reducePlayState(
      state.playState,
      {
        type: "TRAVEL_ACTION",
        action: event,
      },
      {
        world: state.currentWorld,
      },
    );
    if (!nextPlayState || nextPlayState === state.playState) {
      return false;
    }
    state.playState = nextPlayState;
    if (options.ensureAnimation) {
      playController.ensureAnimation();
    }
    renderPlayWorld();
    return true;
  }
}

async function requestLandscapeOrientationLock() {
  const orientation = window.screen?.orientation;
  if (!orientation || typeof orientation.lock !== "function") {
    return;
  }
  try {
    await orientation.lock("landscape");
  } catch {
    // Ignore unsupported/denied orientation lock attempts.
  }
}
