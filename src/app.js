import {
  DEFAULT_PARAMS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from "./config.js?v=20260403d";
import {
  generateWorld,
  normalizeParams,
} from "./generator/worldGenerator.js?v=20260403f";
import { renderEditorWorld } from "./render/renderer.js?v=20260403aq";
import {
  bindRangeLabels,
  getFormValues,
  hydrateForm,
  randomSeed,
  setSeedValue,
  updateLabels,
} from "./ui/controls.js?v=20260403b";
import {
  inferInitialMode,
  syncLabelButtons as applyLabelButtonState,
  syncModeUi as applyModeUi,
  syncViewUi as applyViewUi,
} from "./ui/appShell.js?v=20260407a";
import { applyCanvasResolution } from "./ui/canvasResolution.js?v=20260403a";
import { createPlayProfiler } from "./ui/playProfiler.js?v=20260403a";
import { updateStats } from "./ui/statsPanel.js";
import { createEditorSession } from "./ui/editorSession.js?v=20260407a";
import { clearHover } from "./ui/hoverPanel.js?v=20260403b";
import { createPlaySession } from "./ui/playSession.js?v=20260404g";
import { waitForNextPaint } from "./ui/viewState.js?v=20260403a";

const refs = {
  editorShell: document.querySelector("#editor-shell"),
  editorLoading: document.querySelector("#editor-loading"),
  playView: document.querySelector("#play-view"),
  playLoading: document.querySelector("#play-loading"),
  playTooltip: document.querySelector("#play-tooltip"),
  form: document.querySelector("#controls"),
  canvas: document.querySelector("#map-canvas"),
  playCanvas: document.querySelector("#play-canvas"),
  playJourneyPanel: document.querySelector("#play-journey-panel"),
  playJourneyCanvas: document.querySelector("#play-journey-canvas"),
  playMapLegend: document.querySelector("#play-map-legend"),
  playToggleBiomeLabelsButton: document.querySelector(
    "#play-toggle-biome-labels",
  ),
  playToggleCityLabelsButton: document.querySelector(
    "#play-toggle-city-labels",
  ),
  playToggleHoverButton: document.querySelector("#play-toggle-hover"),
  playJourneyTitle: document.querySelector("#play-journey-title"),
  playJourneySubtitle: document.querySelector("#play-journey-subtitle"),
  tooltip: document.querySelector("#tooltip"),
  statsContainer: document.querySelector("#stats"),
  toggleBiomeLabelsButton: document.querySelector("#toggle-biome-labels"),
  toggleCityLabelsButton: document.querySelector("#toggle-city-labels"),
  toggleSnowButton: document.querySelector("#toggle-snow"),
  toggleMonochromeButton: document.querySelector("#toggle-monochrome"),
  zoom1Button: document.querySelector("#zoom-1"),
  zoom2Button: document.querySelector("#zoom-2"),
  zoom3Button: document.querySelector("#zoom-3"),
  playZoom1Button: document.querySelector("#play-zoom-1"),
  playZoom2Button: document.querySelector("#play-zoom-2"),
  playZoom3Button: document.querySelector("#play-zoom-3"),
  randomSeedButton: document.querySelector("#random-seed"),
  resetButton: document.querySelector("#reset"),
  saveImageButton: document.querySelector("#save-image"),
  enterPlayButton: document.querySelector("#enter-play"),
};

// --- Tab switching ---------------------------------------------------
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanelEls = document.querySelectorAll(".tab-panel");
function setActiveTab(tabName) {
  for (const btn of tabButtons) {
    btn.dataset.active = String(btn.dataset.tab === tabName);
  }
  for (const panel of tabPanelEls) {
    panel.hidden = panel.dataset.tabPanel !== tabName;
  }
}
setActiveTab("karta");
for (const btn of tabButtons) {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
}
// ---------------------------------------------------------------------

const initialMode = inferInitialMode();

refs.canvas.width = RENDER_WIDTH;
refs.canvas.height = RENDER_HEIGHT;
refs.playCanvas.width = RENDER_WIDTH;
refs.playCanvas.height = RENDER_HEIGHT;
if (refs.playJourneyCanvas) {
  refs.playJourneyCanvas.width = RENDER_WIDTH;
  refs.playJourneyCanvas.height = RENDER_HEIGHT;
}

const state = {
  currentMode: initialMode,
  currentWorld: null,
  currentViewport: null,
  playState: null,
  editorLoading: initialMode === "editor",
  playLoading: initialMode === "play",
  isBootReady: false,
  currentRenderScale: DEFAULT_PARAMS.renderScale,
  renderOptions: {
    showBiomeLabels: true,
    showCityLabels: false,
    showSnow: true,
    showMonochrome: false,
  },
  playMapOptions: {
    showBiomeLabels: false,
    showCityLabels: false,
    showHoverInspector: true,
    debugTravelSampling: false,
  },
  playZoom: 2,
  cameraState: { zoom: 1, centerX: 150, centerY: 110 },
  dragState: null,
  pendingInteractiveRender: false,
  playAnimationFrame: null,
  lastTravelTick: 0,
  generateRunId: 0,
  playProfiler: createPlayProfiler(),
};

const editorSession = createEditorSession({
  refs,
  state,
  syncViewUi,
});

const playSession = createPlaySession({
  refs,
  state,
  syncModeUi,
});

hydrateForm(DEFAULT_PARAMS);
setSeedValue(randomSeed());
bindRangeLabels();
syncLabelButtons();
syncModeUi();
bootApp();

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
  editorSession.rerenderCurrentWorld();
});

refs.toggleCityLabelsButton.addEventListener("click", () => {
  state.renderOptions.showCityLabels = !state.renderOptions.showCityLabels;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
});

refs.toggleSnowButton.addEventListener("click", () => {
  state.renderOptions.showSnow = !state.renderOptions.showSnow;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
  playSession.renderPlayWorld();
});

refs.toggleMonochromeButton.addEventListener("click", () => {
  state.renderOptions.showMonochrome = !state.renderOptions.showMonochrome;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
  playSession.renderPlayWorld();
});

refs.playToggleBiomeLabelsButton.addEventListener("click", () => {
  state.playMapOptions.showBiomeLabels = !state.playMapOptions.showBiomeLabels;
  playSession.renderPlayWorld();
});

refs.playToggleCityLabelsButton.addEventListener("click", () => {
  state.playMapOptions.showCityLabels = !state.playMapOptions.showCityLabels;
  playSession.renderPlayWorld();
});

refs.playToggleHoverButton.addEventListener("click", () => {
  state.playMapOptions.showHoverInspector =
    !state.playMapOptions.showHoverInspector;
  if (!state.playMapOptions.showHoverInspector) {
    clearHover(refs.playTooltip);
  }
  playSession.updatePlaySubView();
});

for (const button of [refs.zoom1Button, refs.zoom2Button, refs.zoom3Button]) {
  if (!button) continue;
  button.addEventListener("click", () => {
    editorSession.setZoom(Number(button.dataset.zoom));
  });
}

for (const button of [
  refs.playZoom1Button,
  refs.playZoom2Button,
  refs.playZoom3Button,
]) {
  if (!button) continue;
  button.addEventListener("click", () => {
    state.playZoom = Number(button.dataset.zoom);
    syncPlayZoomButtons();
    playSession.renderPlayWorld();
  });
}

refs.saveImageButton.addEventListener("click", () => {
  const url = refs.canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.currentWorld?.title || "fantasy-map"}.png`;
  link.click();
});

refs.enterPlayButton.addEventListener("click", () => {
  playSession.enterPlayMode();
});

window.addEventListener("resize", () => {
  if (!state.isBootReady) {
    return;
  }
  state.currentRenderScale = normalizeParams(
    getFormValues(refs.form),
  ).renderScale;
  applyCanvasResolution(refs, state.currentRenderScale);
  if (state.currentMode === "editor") {
    editorSession.rerenderCurrentWorld();
  } else {
    playSession.renderPlayWorld();
  }
});

window.addEventListener("keydown", (event) => {
  if (state.currentMode !== "play") {
    return;
  }

  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    playSession.setPlayViewMode(
      state.playState?.viewMode === "journey" ? "map" : "journey",
    );
    return;
  }

  if (event.key === "p" || event.key === "P") {
    event.preventDefault();
    state.playProfiler.toggle();
    return;
  }

  if (event.key === "d" || event.key === "D") {
    if (state.playState?.viewMode !== "map") {
      return;
    }
    event.preventDefault();
    state.playMapOptions.debugTravelSampling =
      !state.playMapOptions.debugTravelSampling;
    playSession.renderPlayWorld();
  }
});

async function generateAndRender() {
  const runId = ++state.generateRunId;
  const params = normalizeParams(getFormValues(refs.form));
  state.currentRenderScale = params.renderScale;
  updateLabels();
  state.editorLoading = state.currentMode === "editor";
  state.playLoading = state.currentMode === "play";
  syncModeUi();
  await waitForNextPaint(1);
  if (runId !== state.generateRunId) {
    return;
  }

  playSession.stopAnimation();
  playSession.resetJourney();
  applyCanvasResolution(refs, params.renderScale);
  state.currentWorld = generateWorld(params);
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  state.cameraState = editorSession.createDefaultCamera();
  if (state.currentMode === "editor") {
    state.currentViewport = renderEditorWorld(refs.canvas, state.currentWorld, {
      ...state.renderOptions,
      cameraState: state.cameraState,
    });
  } else {
    state.currentViewport = null;
  }
  playSession.renderPlayWorld();
  updateStats(refs.statsContainer, state.currentWorld.stats);
  syncViewUi();

  await waitForNextPaint(1);
  if (runId !== state.generateRunId) {
    return;
  }

  state.editorLoading = false;
  state.playLoading = false;
  syncModeUi();

  await waitForNextPaint(1);
  if (runId !== state.generateRunId) {
    return;
  }

  if (state.currentMode === "editor") {
    editorSession.rerenderCurrentWorld();
  } else {
    playSession.renderPlayWorld();
  }
}

function syncLabelButtons() {
  applyLabelButtonState({
    refs,
    renderOptions: state.renderOptions,
  });
}

function syncPlayZoomButtons() {
  for (const button of [
    refs.playZoom1Button,
    refs.playZoom2Button,
    refs.playZoom3Button,
  ]) {
    if (!button) continue;
    button.dataset.active = String(
      Math.abs(Number(button.dataset.zoom) - state.playZoom) < 0.001,
    );
  }
}

function syncModeUi() {
  applyModeUi({
    refs,
    state,
    updatePlaySubView: playSession.updatePlaySubView,
  });
}

function syncViewUi() {
  applyViewUi({
    refs,
    cameraState: state.cameraState,
  });
}

syncLabelButtons();
syncPlayZoomButtons();
syncModeUi();
syncViewUi();

function bootApp() {
  const start = () => {
    if (state.isBootReady) {
      return;
    }
    state.isBootReady = true;
    generateAndRender();
  };

  if (document.readyState === "complete") {
    requestAnimationFrame(start);
    return;
  }

  window.addEventListener(
    "load",
    () => {
      requestAnimationFrame(start);
    },
    { once: true },
  );
}
