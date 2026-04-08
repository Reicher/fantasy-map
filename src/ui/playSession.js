import {
  advanceTravel,
  beginTravel,
  createPlayState,
  getValidTargetIds,
  sampleTravelBiomeBandPoints,
} from "../game/travel.js?v=20260408a";
import { createJourneyScene } from "../game/journeyScene.js?v=20260408a";
import { renderPlayWorldDynamic } from "../render/renderer.js?v=20260408b";
import { inspectWorldAt } from "../inspector.js?v=20260402h";
import { createPlayCamera as buildPlayCamera } from "./cameraState.js?v=20260407a";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260403b";
import { createPlayMapCacheManager } from "./playMapCache.js?v=20260408c";
import { createPlayController } from "./playController.js?v=20260408b";
import { createPlaySubViewController } from "./playSubView.js?v=20260403b";
import { waitForNextPaint } from "./viewState.js?v=20260403a";

export function createPlaySession({ refs, state, syncModeUi }) {
  let playModeTransitionId = 0;
  const playMapCache = createPlayMapCacheManager({
    playCanvas: refs.playCanvas,
    getWorld: () => state.currentWorld,
    getCameraState: createPlayCamera,
  });

  const journeyScene = createJourneyScene({
    canvas: refs.playJourneyCanvas,
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
          viewMode: "map",
        }
      : playState;
  }

  function renderPlayWorld() {
    if (!state.currentWorld || !state.playState) {
      return;
    }

    if (state.playState.viewMode === "map") {
      state.playProfiler.measure("play-map-render", () => {
        const validCityIds = getValidTargetIds(state.playState);
        const visibleCityIds = getVisibleCityIds(
          state.currentWorld,
          state.playState,
          validCityIds,
        );
        const renderOptions = {
          showSnow: state.renderOptions.showSnow,
          showBiomeLabels: state.playMapOptions.showBiomeLabels,
          showCityLabels: state.playMapOptions.showCityLabels,
          cityLabelIds: visibleCityIds,
          discoveredCells: state.playState.discoveredCells,
          cameraState: createPlayCamera(),
          playerStart: state.playState.position,
          fogOfWar: {
            enabled: true,
            playState: state.playState,
            radiusCells: state.currentWorld.params?.fogVisionRadius ?? 18,
          },
          cityOverlay: {
            validCityIds,
            visibleCityIds,
            onlyValid: true,
            hoveredCityId: state.playState.hoveredCityId,
            pressedCityId: state.playState.pressedCityId,
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
      hoveredCityId: mode === "map" ? state.playState.hoveredCityId : null,
      pressedCityId: null,
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

    const transitionId = ++playModeTransitionId;
    state.currentMode = "play";
    state.playLoading = true;
    state.editorLoading = false;
    state.dragState = null;
    if (state.playState) {
      state.playState = {
        ...state.playState,
        viewMode: "map",
        hoveredCityId: null,
        pressedCityId: null,
      };
    }
    playSubView.reset();
    clearHover(refs.playTooltip);
    syncModeUi();

    await waitForNextPaint(1);
    if (transitionId !== playModeTransitionId) {
      return;
    }

    renderPlayWorld();
    playController.ensureAnimation();

    await waitForNextPaint(1);
    if (transitionId !== playModeTransitionId) {
      return;
    }

    state.playLoading = false;
    syncModeUi();

    await waitForNextPaint(1);
    if (transitionId !== playModeTransitionId) {
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

  function getVisibleCityIds(world, playState, validCityIds) {
    const visibleIds = new Set(validCityIds);

    if (playState?.currentCityId != null) {
      visibleIds.add(playState.currentCityId);
    }

    const discoveredCells = playState?.discoveredCells;
    if (!world || !discoveredCells) {
      return Array.from(visibleIds);
    }

    for (const city of world.cities ?? []) {
      if (!city) {
        continue;
      }
      const x = Math.max(
        0,
        Math.min(world.terrain.width - 1, Math.floor(city.x)),
      );
      const y = Math.max(
        0,
        Math.min(world.terrain.height - 1, Math.floor(city.y)),
      );
      if (discoveredCells[y * world.terrain.width + x]) {
        visibleIds.add(city.id);
      }
    }

    return Array.from(visibleIds);
  }
}
