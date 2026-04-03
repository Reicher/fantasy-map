import { advanceTravel, beginTravel, createPlayState, getValidTargetIds } from "../game/travel.js?v=20260401b";
import { describePlayView } from "../game/playViewText.js?v=20260403a";
import { createJourneyScene } from "../game/journeyScene.js?v=20260403at";
import { createViewport, renderPlayWorldDynamic, renderPlayWorldStatic } from "../render/renderer.js?v=20260403aq";
import { inspectWorldAt } from "../inspector.js?v=20260402h";
import { createPlayCamera as buildPlayCamera } from "./cameraState.js?v=20260401b";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260403b";
import { createPlayController } from "./playController.js?v=20260403g";

export function createPlaySession({ refs, state, syncModeUi }) {
  let lastJourneyVisible = null;
  let lastJourneyTitle = null;
  let lastJourneySubtitle = null;
  let journeyBackdropApplied = false;
  let lastMapLegendVisible = null;
  const playMapCache = {
    canvas: null,
    key: null,
    worldRef: null,
    viewport: null,
    renderWidth: 0,
    renderHeight: 0
  };
  let playModeTransitionId = 0;

  const journeyScene = createJourneyScene({
    track: refs.playGroundTrack,
    seaTrack: refs.playSeaTrack,
    player: refs.playPlayer,
    poiMarker: refs.playPoiMarker
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
    showHoverHit
  });

  return {
    createInitialPlayState,
    renderPlayWorld,
    setPlayViewMode,
    updatePlaySubView,
    enterPlayMode,
    stopAnimation: playController.stopAnimation,
    resetJourney: journeyScene.reset
  };

  function createInitialPlayState(world) {
    const playState = createPlayState(world);
    return state.currentMode === "play"
      ? {
          ...playState,
          viewMode: "map"
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
        const visibleCityIds = getVisibleCityIds(state.currentWorld, state.playState, validCityIds);
        const renderOptions = {
          showSnow: state.renderOptions.showSnow,
          showMonochrome: state.renderOptions.showMonochrome,
          showBiomeLabels: state.playMapOptions.showBiomeLabels,
          showCityLabels: state.playMapOptions.showCityLabels,
          cityLabelIds: visibleCityIds,
          discoveredCells: state.playState.discoveredCells,
          cameraState: createPlayCamera(),
          playerStart: state.playState.position,
          fogOfWar: {
            enabled: true,
            playState: state.playState,
            radiusCells: state.currentWorld.params?.fogVisionRadius ?? 18
          },
          cityOverlay: {
            validCityIds,
            visibleCityIds,
            onlyValid: true,
            hoveredCityId: state.playState.hoveredCityId,
            pressedCityId: state.playState.pressedCityId
          }
        };

        if (ensurePlayMapCache(renderOptions)) {
          state.playProfiler.count("play-cache-miss");
        } else {
          state.playProfiler.count("play-cache-hit");
        }

        const ctx = refs.playCanvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, refs.playCanvas.width, refs.playCanvas.height);
        drawPlayMapCache(renderOptions.cameraState);
        renderPlayWorldDynamic(refs.playCanvas, state.currentWorld, renderOptions);
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
      pressedCityId: null
    };

    if (mode === "journey") {
      playController.ensureAnimation();
    }
    renderPlayWorld();
  }

  function updatePlaySubView() {
    const isPlay = state.currentMode === "play";
    const isJourney = isPlay && state.playState?.viewMode === "journey";
    const showMapLegend = isPlay && state.playState?.viewMode === "map";

    if (lastJourneyVisible !== isJourney) {
      refs.playCanvas.hidden = isJourney;
      refs.playJourneyPanel.hidden = !isJourney;
      refs.playCanvas.style.display = isJourney ? "none" : "block";
      refs.playJourneyPanel.style.display = isJourney ? "flex" : "none";
      lastJourneyVisible = isJourney;
    }

    if (lastMapLegendVisible !== showMapLegend) {
      refs.playMapLegend.hidden = !showMapLegend;
      refs.playMapLegend.style.display = showMapLegend ? "flex" : "none";
      lastMapLegendVisible = showMapLegend;
      if (!showMapLegend) {
        clearHover(refs.playTooltip);
      }
    }

    syncPlayLegendButtons();

    if (!isPlay || !state.currentWorld || !state.playState) {
      return;
    }

    const description = describePlayView(state.currentWorld, state.playState);
    if (isJourney) {
      if (description.subtitle !== lastJourneySubtitle) {
        refs.playJourneySubtitle.textContent = description.subtitle;
        lastJourneySubtitle = description.subtitle;
      }
      if (description.title !== lastJourneyTitle) {
        refs.playJourneyTitle.textContent = description.title;
        lastJourneyTitle = description.title;
      }
      if (!journeyBackdropApplied) {
        applyJourneyBackdrop();
        journeyBackdropApplied = true;
      }
      state.playProfiler.measure("journey-update", () => {
        journeyScene.update(state.playState, description.biomeKey);
      });
      state.playProfiler.setSnapshot(journeyScene.getDebugSnapshot());
    }
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
        pressedCityId: null
      };
    }
    lastJourneyVisible = null;
    lastJourneyTitle = null;
    lastJourneySubtitle = null;
    journeyBackdropApplied = false;
    lastMapLegendVisible = null;
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
    return buildPlayCamera(state.currentWorld, state.playState);
  }

  function syncPlayLegendButtons() {
    refs.playToggleBiomeLabelsButton.dataset.active = state.playMapOptions.showBiomeLabels
      ? "true"
      : "false";
    refs.playToggleCityLabelsButton.dataset.active = state.playMapOptions.showCityLabels
      ? "true"
      : "false";
    refs.playToggleHoverButton.dataset.active = state.playMapOptions.showHoverInspector
      ? "true"
      : "false";
  }

  function applyJourneyBackdrop() {
    refs.playJourneyPanel.style.setProperty("--journey-sky-top", "rgb(169, 212, 238)");
    refs.playJourneyPanel.style.setProperty("--journey-sky", "rgb(148, 198, 230)");
    refs.playJourneyPanel.style.setProperty("--journey-sea", "rgb(111, 158, 182)");
    refs.playJourneyPanel.style.setProperty("--journey-sea-deep", "rgb(91, 131, 151)");
    refs.playJourneyPanel.style.setProperty("--journey-sea-fill", "rgb(91, 131, 151)");
  }

  function ensurePlayMapCache(renderOptions) {
    const atlas = createPlayMapAtlas();
    const cacheCanvas = getOrCreatePlayMapCacheCanvas(atlas);
    const cacheKey = [
      refs.playCanvas.width,
      refs.playCanvas.height,
      state.renderOptions.showSnow ? 1 : 0,
      state.renderOptions.showMonochrome ? 1 : 0,
      atlas.zoom.toFixed(3),
      atlas.renderWidth.toFixed(2),
      atlas.renderHeight.toFixed(2)
    ].join(":");

    if (
      playMapCache.worldRef === state.currentWorld &&
      playMapCache.key === cacheKey
    ) {
      return false;
    }

    renderPlayWorldStatic(cacheCanvas, state.currentWorld, {
      ...renderOptions,
      viewport: atlas.viewport,
      renderWidth: atlas.renderWidth,
      renderHeight: atlas.renderHeight
    });
    playMapCache.worldRef = state.currentWorld;
    playMapCache.key = cacheKey;
    playMapCache.viewport = atlas.viewport;
    playMapCache.renderWidth = atlas.renderWidth;
    playMapCache.renderHeight = atlas.renderHeight;
    return true;
  }

  function getOrCreatePlayMapCacheCanvas(atlas) {
    if (!playMapCache.canvas) {
      playMapCache.canvas = document.createElement("canvas");
    }
    const scaleX = refs.playCanvas.width / 1200;
    const scaleY = refs.playCanvas.height / 840;
    const width = Math.max(1, Math.round(atlas.renderWidth * scaleX));
    const height = Math.max(1, Math.round(atlas.renderHeight * scaleY));
    if (
      playMapCache.canvas.width !== width ||
      playMapCache.canvas.height !== height
    ) {
      playMapCache.canvas.width = width;
      playMapCache.canvas.height = height;
      playMapCache.key = null;
    }
    return playMapCache.canvas;
  }

  function drawPlayMapCache(cameraState) {
    if (!playMapCache.canvas || !playMapCache.viewport) {
      return;
    }

    const currentViewport = createViewport(state.currentWorld, cameraState);
    const sourceXLogical =
      (currentViewport.leftWorld - playMapCache.viewport.leftWorld) * playMapCache.viewport.scaleX;
    const sourceYLogical =
      (currentViewport.topWorld - playMapCache.viewport.topWorld) * playMapCache.viewport.scaleY;
    const sourceWidthLogical = 1200;
    const sourceHeightLogical = 840;
    const sourceScaleX = playMapCache.canvas.width / playMapCache.renderWidth;
    const sourceScaleY = playMapCache.canvas.height / playMapCache.renderHeight;

    refs.playCanvas.getContext("2d").drawImage(
      playMapCache.canvas,
      sourceXLogical * sourceScaleX,
      sourceYLogical * sourceScaleY,
      sourceWidthLogical * sourceScaleX,
      sourceHeightLogical * sourceScaleY,
      0,
      0,
      refs.playCanvas.width,
      refs.playCanvas.height
    );
  }

  function createPlayMapAtlas() {
    const cameraState = createPlayCamera();
    const margin = 38;
    const innerWidth = 1200 - margin * 2;
    const innerHeight = 840 - margin * 2;
    const scaleX = (innerWidth / state.currentWorld.terrain.width) * cameraState.zoom;
    const scaleY = (innerHeight / state.currentWorld.terrain.height) * cameraState.zoom;
    const maxVisibleWidth = innerWidth / scaleX;
    const maxVisibleHeight = innerHeight / scaleY;
    const leftWorld = -maxVisibleWidth * 0.5;
    const topWorld = -maxVisibleHeight * 0.5;
    const visibleWidth = state.currentWorld.terrain.width + maxVisibleWidth;
    const visibleHeight = state.currentWorld.terrain.height + maxVisibleHeight;
    const renderWidth = margin * 2 + visibleWidth * scaleX;
    const renderHeight = margin * 2 + visibleHeight * scaleY;

    return {
      zoom: cameraState.zoom,
      renderWidth,
      renderHeight,
      viewport: {
        margin,
        innerWidth: visibleWidth * scaleX,
        innerHeight: visibleHeight * scaleY,
        zoom: cameraState.zoom,
        centerX: state.currentWorld.terrain.width * 0.5,
        centerY: state.currentWorld.terrain.height * 0.5,
        leftWorld,
        topWorld,
        visibleWidth,
        visibleHeight,
        scaleX,
        scaleY,
        worldToCanvas(x, y) {
          return {
            x: margin + (x + 0.5 - leftWorld) * scaleX,
            y: margin + (y + 0.5 - topWorld) * scaleY
          };
        },
        canvasToWorld(x, y) {
          return {
            x: leftWorld + (x - margin) / scaleX - 0.5,
            y: topWorld + (y - margin) / scaleY - 0.5
          };
        }
      }
    };
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
      const x = Math.max(0, Math.min(world.terrain.width - 1, Math.floor(city.x)));
      const y = Math.max(0, Math.min(world.terrain.height - 1, Math.floor(city.y)));
      if (discoveredCells[y * world.terrain.width + x]) {
        visibleIds.add(city.id);
      }
    }

    return Array.from(visibleIds);
  }

  function waitForNextPaint(frames = 1) {
    return new Promise((resolve) => {
      const step = () => {
        if (frames <= 0) {
          resolve();
          return;
        }
        frames -= 1;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
}
