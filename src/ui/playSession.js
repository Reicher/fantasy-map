import {
  advanceTravel,
  beginTravel,
  createPlayState,
  getValidTargetIds,
  sampleTravelBiomeBandPoints,
} from "../game/travel.js?v=20260411a";
import { createJourneyScene } from "../game/journeyScene.js?v=20260411c";
import {
  renderPlayWorldDynamic,
  renderPlayWorldStatic,
} from "../render/renderer.js?v=20260411c";
import { inspectWorldAt } from "../inspector.js?v=20260408b";
import { createPlayCamera as buildPlayCamera } from "./cameraState.js?v=20260407a";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260408a";
import { createMapAtlasCacheManager } from "./mapAtlasCache.js?v=20260408h";
import { createPlayController } from "./playController.js?v=20260409e";
import { createPlaySubViewController } from "./playSubView.js?v=20260411i";
import {
  createTransitionController,
  waitForNextPaintIfActive,
} from "./viewState.js?v=20260403a";

export function createPlaySession({ refs, state, syncModeUi }) {
  const playModeTransition = createTransitionController();
  const playMapCache = createMapAtlasCacheManager({
    canvas: refs.playCanvas,
    getWorld: () => state.currentWorld,
    getCameraState: createPlayCamera,
    renderStaticScene: renderPlayWorldStatic,
    getStaticKey(renderOptions = {}) {
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
    beginTravel,
    advanceTravel,
    getValidTargetIds,
    inspectWorldAt,
    clearHover,
    showHoverHit,
  });

  const playSubView = createPlaySubViewController({
    refs,
    state,
    journeyScene,
    clearHover,
    profiler: state.playProfiler,
  });

  return {
    createInitialPlayState,
    renderPlayWorld,
    setPlayViewMode,
    updatePlaySubView,
    enterPlayMode,
    stopAnimation: playController.stopAnimation,
    resetJourney: journeyScene.reset,
  };

  function createInitialPlayState(world) {
    const playState = createPlayState(world);
    return state.currentMode === "play"
      ? {
          ...playState,
          viewMode: "journey",
        }
      : playState;
  }

  function renderPlayWorld() {
    if (!state.currentWorld || !state.playState) {
      return;
    }

    if (state.playState.viewMode === "map") {
      state.playProfiler.measure("play-map-render", () => {
        const validNodeIds = getValidTargetIds(
          state.playState,
          state.currentWorld,
        );
        const visibleNodeIds = getVisibleNodeIds(
          state.currentWorld,
          state.playState,
          validNodeIds,
        );
        const renderOptions = {
          showSnow: state.renderOptions.showSnow,
          showBiomeLabels: state.playMapOptions.showBiomeLabels,
          showNodeLabels: state.playMapOptions.showNodeLabels,
          visibleNodeIds,
          discoveredCells: state.playState.discoveredCells,
          cameraState: createPlayCamera(),
          playerStart: state.playState.position,
          fogOfWar: {
            enabled: true,
            playState: state.playState,
            radiusCells: state.currentWorld.params.fogVisionRadius,
          },
          nodeOverlay: {
            validNodeIds,
            visibleNodeIds,
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

  function setPlayViewMode(mode) {
    if (!state.playState || (mode !== "map" && mode !== "journey")) {
      return;
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

  async function enterPlayMode() {
    if (!state.currentWorld || !state.playState) {
      return;
    }

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
    return buildPlayCamera(
      state.currentWorld,
      state.playState,
      state.playZoom ?? 1,
    );
  }

  function getVisibleNodeIds(world, playState, validNodeIds) {
    const visibleIds = new Set(validNodeIds);
    const currentId = playState?.currentNodeId;
    if (currentId != null) {
      visibleIds.add(currentId);
    }

    const discoveredCells = playState?.discoveredCells;
    if (!world || !discoveredCells) {
      return Array.from(visibleIds);
    }

    const nodes = world.features?.nodes ?? [];
    for (const node of nodes) {
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        continue;
      }
      const x = Math.max(
        0,
        Math.min(world.terrain.width - 1, Math.floor(node.x)),
      );
      const y = Math.max(
        0,
        Math.min(world.terrain.height - 1, Math.floor(node.y)),
      );
      if (discoveredCells[y * world.terrain.width + x] && node.id != null) {
        visibleIds.add(node.id);
      }
    }

    return Array.from(visibleIds);
  }
}
