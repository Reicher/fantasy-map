import { DEFAULT_PARAMS, RENDER_HEIGHT, RENDER_WIDTH } from "./config.js?v=20260402b";
import { generateWorld, normalizeParams } from "./generator/worldGenerator.js?v=20260402k";
import { advanceTravel, beginTravel, createPlayState, getValidTargetIds } from "./game/travel.js?v=20260401b";
import { describePlayView } from "./game/playViewText.js?v=20260402b";
import { inspectWorldAt } from "./inspector.js?v=20260402d";
import { renderWorld } from "./render/renderer.js?v=20260402s";
import {
  clampEditorCamera,
  createEditorCamera,
  createPlayCamera as buildPlayCamera,
  isDefaultEditorCamera,
  zoomCameraAroundPoint as buildZoomedCamera
} from "./ui/cameraState.js?v=20260401b";
import {
  bindRangeLabels,
  getFormValues,
  hydrateForm,
  randomSeed,
  setSeedValue,
  updateLabels
} from "./ui/controls.js?v=20260402b";
import { clearHover, showHoverHit } from "./ui/hoverPanel.js?v=20260401ac";
import { updateStats } from "./ui/statsPanel.js";
import { attachEditorController } from "./ui/editorController.js?v=20260401a";
import { createPlayController } from "./ui/playController.js?v=20260401b";

const refs = {
  editorShell: document.querySelector("#editor-shell"),
  playView: document.querySelector("#play-view"),
  form: document.querySelector("#controls"),
  canvas: document.querySelector("#map-canvas"),
  playCanvas: document.querySelector("#play-canvas"),
  playJourneyPanel: document.querySelector("#play-journey-panel"),
  playJourneyTitle: document.querySelector("#play-journey-title"),
  playJourneySubtitle: document.querySelector("#play-journey-subtitle"),
  playJourneyDetail: document.querySelector("#play-journey-detail"),
  tooltip: document.querySelector("#tooltip"),
  statsContainer: document.querySelector("#stats"),
  titleNode: document.querySelector("#world-title"),
  toggleBiomeLabelsButton: document.querySelector("#toggle-biome-labels"),
  toggleCityLabelsButton: document.querySelector("#toggle-city-labels"),
  toggleSnowButton: document.querySelector("#toggle-snow"),
  resetViewButton: document.querySelector("#reset-view"),
  zoomLevelNode: document.querySelector("#zoom-level"),
  randomSeedButton: document.querySelector("#random-seed"),
  resetButton: document.querySelector("#reset"),
  saveImageButton: document.querySelector("#save-image"),
  enterPlayButton: document.querySelector("#enter-play"),
  exitPlayButton: document.querySelector("#exit-play")
};

refs.canvas.width = RENDER_WIDTH;
refs.canvas.height = RENDER_HEIGHT;
refs.playCanvas.width = RENDER_WIDTH;
refs.playCanvas.height = RENDER_HEIGHT;

const state = {
  currentMode: "editor",
  currentWorld: null,
  currentViewport: null,
  playState: null,
  renderOptions: {
    showBiomeLabels: true,
    showCityLabels: false,
    showSnow: true
  },
  cameraState: { zoom: 1, centerX: 150, centerY: 110 },
  dragState: null,
  pendingInteractiveRender: false,
  playAnimationFrame: null,
  lastTravelTick: 0
};

const playController = createPlayController({
  playCanvas: refs.playCanvas,
  state,
  renderPlayWorld,
  createPlayCamera,
  beginTravel,
  advanceTravel,
  getValidTargetIds
});

attachEditorController({
  canvas: refs.canvas,
  tooltip: refs.tooltip,
  state,
  inspectWorldAt,
  clearHover,
  showHoverHit,
  rerenderCurrentWorld,
  scheduleInteractiveRender,
  syncViewUi,
  clampCamera,
  zoomCameraAroundPoint
});

hydrateForm(DEFAULT_PARAMS);
setSeedValue(randomSeed());
bindRangeLabels();
syncLabelButtons();
syncModeUi();
generateAndRender();

refs.form.addEventListener("submit", (event) => {
  event.preventDefault();
  generateAndRender();
});

refs.randomSeedButton.addEventListener("click", () => {
  setSeedValue(randomSeed());
  generateAndRender();
});

refs.resetButton.addEventListener("click", () => {
  hydrateForm(DEFAULT_PARAMS);
  updateLabels();
  generateAndRender();
});

refs.toggleBiomeLabelsButton.addEventListener("click", () => {
  state.renderOptions.showBiomeLabels = !state.renderOptions.showBiomeLabels;
  syncLabelButtons();
  rerenderCurrentWorld();
});

refs.toggleCityLabelsButton.addEventListener("click", () => {
  state.renderOptions.showCityLabels = !state.renderOptions.showCityLabels;
  syncLabelButtons();
  rerenderCurrentWorld();
});

refs.toggleSnowButton.addEventListener("click", () => {
  state.renderOptions.showSnow = !state.renderOptions.showSnow;
  syncLabelButtons();
  rerenderCurrentWorld();
  renderPlayWorld();
});

refs.resetViewButton.addEventListener("click", () => {
  state.cameraState = createDefaultCamera();
  syncViewUi();
  rerenderCurrentWorld();
});

refs.saveImageButton.addEventListener("click", () => {
  const url = refs.canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.currentWorld?.title || "fantasy-map"}.png`;
  link.click();
});

refs.enterPlayButton.addEventListener("click", () => {
  state.currentMode = "play";
  state.dragState = null;
  clearHover(refs.tooltip);
  renderPlayWorld();
  playController.ensureAnimation();
  syncModeUi();
});

refs.exitPlayButton.addEventListener("click", () => {
  state.currentMode = "editor";
  playController.stopAnimation();
  syncModeUi();
});

window.addEventListener("keydown", (event) => {
  if (state.currentMode !== "play") {
    return;
  }

  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    setPlayViewMode(state.playState?.viewMode === "journey" ? "map" : "journey");
  }
});

function generateAndRender() {
  const params = normalizeParams(getFormValues(refs.form));
  updateLabels();
  playController.stopAnimation();
  state.currentWorld = generateWorld(params);
  state.playState = createPlayState(state.currentWorld);
  state.cameraState = createDefaultCamera();
  state.currentViewport = renderWorld(refs.canvas, state.currentWorld, {
    ...state.renderOptions,
    cameraState: state.cameraState
  });
  renderPlayWorld();
  refs.titleNode.textContent = `seed ${state.currentWorld.params.seed}`;
  updateStats(refs.statsContainer, state.currentWorld.stats);
  syncViewUi();
}

function rerenderCurrentWorld() {
  if (!state.currentWorld) {
    return;
  }

  state.currentViewport = renderWorld(refs.canvas, state.currentWorld, {
    ...state.renderOptions,
    cameraState: state.cameraState
  });
}

function scheduleInteractiveRender() {
  if (state.pendingInteractiveRender || !state.currentWorld) {
    return;
  }

  state.pendingInteractiveRender = true;
  requestAnimationFrame(() => {
    state.pendingInteractiveRender = false;
    state.currentViewport = renderWorld(refs.canvas, state.currentWorld, {
      ...state.renderOptions,
      cameraState: state.cameraState,
      interactive: true
    });
  });
}

function renderPlayWorld() {
  if (!state.currentWorld || !state.playState) {
    return;
  }

  if (state.playState.viewMode === "map") {
    renderWorld(refs.playCanvas, state.currentWorld, {
      showBiomeLabels: false,
      showCityLabels: false,
      showSnow: state.renderOptions.showSnow,
      cameraState: createPlayCamera(),
      playerStart: state.playState.position,
      cityOverlay: {
        validCityIds: getValidTargetIds(state.playState),
        hoveredCityId: state.playState.hoveredCityId,
        pressedCityId: state.playState.pressedCityId
      }
    });
  }

  updatePlaySubView();
}

function syncLabelButtons() {
  refs.toggleBiomeLabelsButton.dataset.active = state.renderOptions.showBiomeLabels ? "true" : "false";
  refs.toggleCityLabelsButton.dataset.active = state.renderOptions.showCityLabels ? "true" : "false";
  refs.toggleSnowButton.dataset.active = state.renderOptions.showSnow ? "true" : "false";
}

function syncModeUi() {
  const isEditor = state.currentMode === "editor";
  refs.editorShell.hidden = !isEditor;
  refs.playView.hidden = isEditor;
  updatePlaySubView();
}

function syncViewUi() {
  refs.zoomLevelNode.textContent = `${Math.round(state.cameraState.zoom * 100)}%`;
  refs.resetViewButton.disabled = isDefaultCamera(state.cameraState);
}

function createDefaultCamera() {
  return createEditorCamera(state.currentWorld);
}

function createPlayCamera() {
  return buildPlayCamera(state.currentWorld, state.playState);
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

  renderPlayWorld();
}

function updatePlaySubView() {
  const isPlay = state.currentMode === "play";
  const isJourney = isPlay && state.playState?.viewMode === "journey";

  refs.playCanvas.hidden = isJourney;
  refs.playJourneyPanel.hidden = !isJourney;
  refs.playCanvas.style.display = isJourney ? "none" : "block";
  refs.playJourneyPanel.style.display = isJourney ? "flex" : "none";

  if (!isPlay || !state.currentWorld || !state.playState) {
    return;
  }

  const description = describePlayView(state.currentWorld, state.playState);
  refs.playJourneySubtitle.textContent = description.subtitle;
  refs.playJourneyTitle.textContent = description.title;
  refs.playJourneyDetail.textContent = description.detail;
}

function clampCamera(camera) {
  return clampEditorCamera(state.currentWorld, camera);
}

function zoomCameraAroundPoint(worldX, worldY, canvasX, canvasY, zoom) {
  return buildZoomedCamera(
    state.currentWorld,
    state.currentViewport,
    worldX,
    worldY,
    canvasX,
    canvasY,
    zoom
  );
}

function isDefaultCamera(camera) {
  return isDefaultEditorCamera(state.currentWorld, camera);
}

syncLabelButtons();
syncModeUi();
syncViewUi();
