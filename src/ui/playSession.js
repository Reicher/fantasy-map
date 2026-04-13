import {
  advanceTravel,
  beginHunt,
  beginRest,
  beginTravel,
  cancelRest as cancelRestState,
  cancelHunt as cancelHuntState,
  createPlayState,
  getDiscoveredNodeIds,
  getVisibleNodeIds,
  getValidTargetIds,
  sampleTravelBiomeBandPoints,
  toggleTravelPause as toggleTravelPauseState,
} from "../game/travel.js?v=20260413b";
import { createJourneyScene } from "../game/journeyScene.js?v=20260413h";
import {
  renderPlayWorldDynamic,
  renderPlayWorldStatic,
} from "../render/renderer.js?v=20260412e";
import { inspectWorldAt } from "../inspector.js?v=20260408b";
import {
  clampEditorCamera,
  createPlayCamera as buildPlayCamera,
} from "./cameraState.js?v=20260407a";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260408a";
import { createMapAtlasCacheManager } from "./mapAtlasCache.js?v=20260408h";
import { createPlayController } from "./playController.js?v=20260413a";
import { createPlaySubViewController } from "./playSubView.js?v=20260413a";
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
      return [
        `snow:${renderOptions.showSnow ? 1 : 0}`,
        `roads:${buildRoadOverlaySignature(renderOptions.roadOverlay)}`,
      ].join("|");
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
    profiler: state.playProfiler,
  });

  return {
    createInitialPlayState,
    renderPlayWorld,
    setPlayViewMode,
    updatePlaySubView,
    toggleTravelPause,
    startRest,
    startHunt,
    cancelTimedAction,
    dismissActionResult,
    dismissActionDialog,
    enterPlayMode,
    stopAnimation: playController.stopAnimation,
    resetJourney: journeyScene.reset,
  };

  function createInitialPlayState(world) {
    const playState = createPlayState(world);
    state.playMapCamera = buildPlayCamera(world, playState, 2);
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
        const discoveredNodeIds = getDiscoveredNodeIds(state.playState);
        const discoveredNodeIdSet = new Set(discoveredNodeIds);
        const visibleNodeIds = getVisibleNodeIds(state.playState);
        const unknownNodeIds = visibleNodeIds.filter(
          (nodeId) => !discoveredNodeIdSet.has(nodeId),
        );
        const visibleRoads = getVisibleRoads(state.playState, visibleNodeIds);
        const renderOptions = {
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
            radiusCells: state.currentWorld.params.fogVisionRadius,
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

  function setPlayViewMode(mode) {
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
    if (!state.playState?.travel || state.playState?.gameOver) {
      return false;
    }
    state.playState = toggleTravelPauseState(state.playState);
    playController.ensureAnimation();
    renderPlayWorld();
    return true;
  }

  function startRest(hours) {
    if (!state.playState || state.playState.gameOver) {
      return false;
    }
    const nextPlayState = beginRest(state.playState, hours);
    if (nextPlayState === state.playState) {
      return false;
    }
    state.playState = nextPlayState;
    playController.ensureAnimation();
    renderPlayWorld();
    return true;
  }

  function startHunt(hours) {
    if (!state.playState || state.playState.gameOver || !state.currentWorld) {
      return false;
    }
    const nextPlayState = beginHunt(state.playState, state.currentWorld, hours);
    if (nextPlayState === state.playState) {
      return false;
    }
    state.playState = nextPlayState;
    playController.ensureAnimation();
    renderPlayWorld();
    return true;
  }

  function cancelTimedAction() {
    if (!state.playState || state.playState.gameOver || !state.currentWorld) {
      return false;
    }
    const nextPlayState = state.playState.hunt
      ? cancelHuntState(state.playState, state.currentWorld)
      : state.playState.rest
        ? cancelRestState(state.playState)
        : state.playState;
    if (nextPlayState === state.playState) {
      return false;
    }
    state.playState = nextPlayState;
    playController.ensureAnimation();
    renderPlayWorld();
    return true;
  }

  function dismissActionDialog() {
    if (!state.playState || state.playState.gameOver) {
      return false;
    }
    if (state.playState.rest || state.playState.hunt || state.playState.pendingRestChoice) {
      return false;
    }
    if (
      !state.playState.travel ||
      !state.playState.isTravelPaused ||
      state.playState.travelPauseReason !== "manual"
    ) {
      return false;
    }
    state.playState = toggleTravelPauseState(state.playState);
    renderPlayWorld();
    return true;
  }

  function dismissActionResult() {
    if (!state.playState || state.playState.gameOver) {
      return false;
    }
    const feedback = state.playState.latestHuntFeedback;
    if (feedback?.type !== "result") {
      return false;
    }
    state.playState = {
      ...state.playState,
      latestHuntFeedback: null,
    };
    renderPlayWorld();
    return true;
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
}

function getVisibleRoads(playState, visibleNodeIds) {
  if (!playState?.graph || !visibleNodeIds?.length) {
    return [];
  }

  const visible = new Set(visibleNodeIds);
  const seenEdges = new Set();
  const roads = [];

  for (const fromNodeId of visible) {
    const neighbors = playState.graph.get(fromNodeId);
    if (!neighbors) {
      continue;
    }

    for (const [toNodeId, path] of neighbors.entries()) {
      if (!visible.has(toNodeId)) {
        continue;
      }

      const key =
        fromNodeId < toNodeId
          ? `${fromNodeId}_${toNodeId}`
          : `${toNodeId}_${fromNodeId}`;
      if (seenEdges.has(key)) {
        continue;
      }
      seenEdges.add(key);

      const points = (path?.points ?? [])
        .filter(
          (point) =>
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y),
        )
        .map((point) => ({
          x: point.x + 0.5,
          y: point.y + 0.5,
        }));

      if (points.length < 2) {
        continue;
      }

      roads.push({
        id: roads.length,
        type: path?.routeType ?? "road",
        points,
      });
    }
  }

  return roads;
}

function buildRoadOverlaySignature(roadOverlay = {}) {
  const roads = Array.isArray(roadOverlay?.roads) ? roadOverlay.roads : [];
  if (roads.length === 0) {
    return "none";
  }

  return roads
    .map((road, index) => {
      const points = Array.isArray(road?.points) ? road.points : [];
      const first = points[0];
      const last = points[points.length - 1];
      const firstKey =
        first && Number.isFinite(first.x) && Number.isFinite(first.y)
          ? `${first.x.toFixed(1)},${first.y.toFixed(1)}`
          : "-";
      const lastKey =
        last && Number.isFinite(last.x) && Number.isFinite(last.y)
          ? `${last.x.toFixed(1)},${last.y.toFixed(1)}`
          : "-";
      return [
        road?.id ?? index,
        road?.type ?? "road",
        points.length,
        firstKey,
        lastKey,
      ].join(":");
    })
    .join(";");
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
