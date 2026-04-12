import {
  DEFAULT_PARAMS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from "./config.js?v=20260411d";
import {
  generateWorld,
  normalizeParams,
} from "./generator/worldGenerator.js?v=20260411j";
import {
  bindRangeLabels,
  getFormValues,
  hydrateForm,
  randomSeed,
  renderControlsFromSchema,
  setSeedValue,
  updateLabels,
} from "./ui/controls.js?v=20260411d";
import {
  inferInitialMode,
  syncLabelButtons as applyLabelButtonState,
  syncModeUi as applyModeUi,
  syncViewUi as applyViewUi,
} from "./ui/appShell.js?v=20260408c";
import { applyCanvasResolution } from "./ui/canvasResolution.js?v=20260403a";
import { createPlayProfiler } from "./ui/playProfiler.js?v=20260403a";
import { updateStats } from "./ui/statsPanel.js";
import { createEditorSession } from "./ui/editorSession.js?v=20260411b";
import { clearHover } from "./ui/hoverPanel.js?v=20260408a";
import { createPlaySession } from "./ui/playSession.js?v=20260411e";
import {
  createTransitionController,
  waitForNextPaintIfActive,
} from "./ui/viewState.js?v=20260403a";

const EDITOR_SETTINGS_STORAGE_KEY = "fantasy-map.editor.settings.v1";

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
  playBottomHud: document.querySelector("#play-bottom-hud"),
  playPanelCharacter: document.querySelector("#play-panel-character"),
  playPanelInventory: document.querySelector("#play-panel-inventory"),
  playPanelSettings: document.querySelector("#play-panel-settings"),
  playPanelToggleCharacterButton: document.querySelector(
    "#play-panel-toggle-character",
  ),
  playPanelToggleInventoryButton: document.querySelector(
    "#play-panel-toggle-inventory",
  ),
  playPanelToggleSettingsButton: document.querySelector(
    "#play-panel-toggle-settings",
  ),
  playLocationLine: document.querySelector("#play-location-line"),
  playCharacterPrimaryLine: document.querySelector("#play-character-primary"),
  playCharacterTimeLine: document.querySelector("#play-character-time"),
  playCharacterTravelLine: document.querySelector("#play-character-travel"),
  playInventoryList: document.querySelector("#play-inventory-list"),
  playSwitchModeButton: document.querySelector("#play-switch-mode"),
  playSettingsToggleBiomeLabelsButton: document.querySelector(
    "#play-settings-toggle-biome-labels",
  ),
  playSettingsToggleNodeLabelsButton: document.querySelector(
    "#play-settings-toggle-node-labels",
  ),
  playSettingsToggleHoverButton: document.querySelector(
    "#play-settings-toggle-hover",
  ),
  playSettingsToggleSnowButton: document.querySelector(
    "#play-settings-toggle-snow",
  ),
  playArrivalCue: document.querySelector("#play-arrival-cue"),
  playArrivalCueText: document.querySelector("#play-arrival-cue-text"),
  playJourneyEventDialog: document.querySelector("#play-journey-event-dialog"),
  playJourneyEventBody: document.querySelector("#play-journey-event-body"),
  playJourneyEventOkButton: document.querySelector("#play-journey-event-ok"),
  tooltip: document.querySelector("#tooltip"),
  statsContainer: document.querySelector("#stats"),
  toggleBiomeLabelsButton: document.querySelector("#toggle-biome-labels"),
  toggleNodeLabelsButton: document.querySelector("#toggle-node-labels"),
  toggleSnowButton: document.querySelector("#toggle-snow"),
  zoomOutButton: document.querySelector("#zoom-out"),
  zoomInButton: document.querySelector("#zoom-in"),
  zoomLevelChip: document.querySelector("#zoom-level"),
  resetViewButton: document.querySelector("#reset-view"),
  zoom1Button: document.querySelector("#zoom-1"),
  zoom2Button: document.querySelector("#zoom-2"),
  zoom3Button: document.querySelector("#zoom-3"),
  randomSeedButton: document.querySelector("#random-seed"),
  resetButton: document.querySelector("#reset"),
  saveImageButton: document.querySelector("#save-image"),
  enterPlayButtons: Array.from(document.querySelectorAll("[data-enter-play]")),
};

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
    showNodeLabels: false,
    showSnow: true,
  },
  playMapOptions: {
    showBiomeLabels: false,
    showNodeLabels: false,
    showHoverInspector: true,
    debugTravelSampling: false,
  },
  cameraState: { zoom: 1, centerX: 150, centerY: 110 },
  dragState: null,
  pendingInteractiveRender: false,
  playAnimationFrame: null,
  lastTravelTick: 0,
  playProfiler: createPlayProfiler(),
  playHudPanels: {
    character: false,
    inventory: false,
    settings: false,
  },
};
const generateTransition = createTransitionController();

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

const persistedParams = loadPersistedEditorParams();
const initialParams = persistedParams ?? {
  ...DEFAULT_PARAMS,
  seed: randomSeed(),
};
renderControlsFromSchema(refs.form, { initialTab: "karta" });
hydrateForm(initialParams);
bindRangeLabels();

refs.form.addEventListener("submit", (event) => {
  event.preventDefault();
  generateAndRender();
});

refs.randomSeedButton.addEventListener("click", () => {
  setSeedValue(randomSeed());
  persistCurrentForm();
  generateAndRender();
});

refs.resetButton.addEventListener("click", () => {
  hydrateForm(DEFAULT_PARAMS);
  updateLabels();
  persistCurrentForm();
  generateAndRender();
});

const persistFormSettingsDebounced = createDebouncedFormPersistor();
refs.form.addEventListener("input", persistFormSettingsDebounced);
refs.form.addEventListener("change", persistFormSettingsDebounced);

refs.toggleBiomeLabelsButton.addEventListener("click", () => {
  state.renderOptions.showBiomeLabels = !state.renderOptions.showBiomeLabels;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
});

refs.toggleNodeLabelsButton.addEventListener("click", () => {
  state.renderOptions.showNodeLabels = !state.renderOptions.showNodeLabels;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
});

refs.toggleSnowButton.addEventListener("click", () => {
  state.renderOptions.showSnow = !state.renderOptions.showSnow;
  syncLabelButtons();
  editorSession.rerenderCurrentWorld();
  playSession.renderPlayWorld();
});

const togglePlayBiomeLabels = () => {
  state.playMapOptions.showBiomeLabels = !state.playMapOptions.showBiomeLabels;
  playSession.renderPlayWorld();
};

const togglePlayNodeLabels = () => {
  state.playMapOptions.showNodeLabels = !state.playMapOptions.showNodeLabels;
  playSession.renderPlayWorld();
};

const togglePlayHoverInspector = () => {
  state.playMapOptions.showHoverInspector =
    !state.playMapOptions.showHoverInspector;
  if (!state.playMapOptions.showHoverInspector) {
    clearHover(refs.playTooltip);
  }
  playSession.updatePlaySubView();
};

if (refs.playSettingsToggleBiomeLabelsButton) {
  refs.playSettingsToggleBiomeLabelsButton.addEventListener(
    "click",
    togglePlayBiomeLabels,
  );
}
if (refs.playSettingsToggleNodeLabelsButton) {
  refs.playSettingsToggleNodeLabelsButton.addEventListener(
    "click",
    togglePlayNodeLabels,
  );
}
if (refs.playSettingsToggleHoverButton) {
  refs.playSettingsToggleHoverButton.addEventListener(
    "click",
    togglePlayHoverInspector,
  );
}
if (refs.playSettingsToggleSnowButton) {
  refs.playSettingsToggleSnowButton.addEventListener("click", () => {
    state.renderOptions.showSnow = !state.renderOptions.showSnow;
    syncLabelButtons();
    playSession.renderPlayWorld();
  });
}

if (refs.playPanelToggleCharacterButton) {
  refs.playPanelToggleCharacterButton.addEventListener("click", () => {
    togglePlayHudPanel("character");
  });
}
if (refs.playPanelToggleInventoryButton) {
  refs.playPanelToggleInventoryButton.addEventListener("click", () => {
    togglePlayHudPanel("inventory");
  });
}
if (refs.playPanelToggleSettingsButton) {
  refs.playPanelToggleSettingsButton.addEventListener("click", () => {
    togglePlayHudPanel("settings");
  });
}

if (refs.playSwitchModeButton) {
  refs.playSwitchModeButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    playSession.setPlayViewMode(
      state.playState.viewMode === "journey" ? "map" : "journey",
    );
  });
}

if (refs.playJourneyEventOkButton) {
  refs.playJourneyEventOkButton.addEventListener("click", () => {
    acknowledgePendingJourneyEvent();
  });
}

for (const button of [refs.zoom1Button, refs.zoom2Button, refs.zoom3Button]) {
  if (!button) continue;
  button.addEventListener("click", () => {
    editorSession.setZoom(Number(button.dataset.zoom));
  });
}

if (refs.zoomOutButton) {
  refs.zoomOutButton.addEventListener("click", () => {
    editorSession.stepZoom(-1);
  });
}

if (refs.zoomInButton) {
  refs.zoomInButton.addEventListener("click", () => {
    editorSession.stepZoom(1);
  });
}

if (refs.resetViewButton) {
  refs.resetViewButton.addEventListener("click", () => {
    if (!state.currentWorld) {
      return;
    }
    state.cameraState = editorSession.createDefaultCamera();
    syncViewUi();
    editorSession.rerenderCurrentWorld();
  });
}

refs.saveImageButton.addEventListener("click", () => {
  const url = refs.canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.currentWorld?.title || "fantasy-map"}.png`;
  link.click();
});

for (const button of refs.enterPlayButtons) {
  button.addEventListener("click", () => {
    playSession.enterPlayMode();
  });
}

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
    if (!state.playState) {
      return;
    }
    event.preventDefault();
    state.playMapOptions.debugTravelSampling =
      !state.playMapOptions.debugTravelSampling;
    playSession.renderPlayWorld();
    return;
  }

  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    togglePlayHudPanel("character");
    return;
  }

  if (event.key === "i" || event.key === "I") {
    event.preventDefault();
    togglePlayHudPanel("inventory");
    return;
  }

  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    togglePlayHudPanel("settings");
  }
});

async function generateAndRender() {
  const runId = generateTransition.begin();
  const params = normalizeParams(getFormValues(refs.form));
  persistEditorParams(params);
  state.currentRenderScale = params.renderScale;
  updateLabels();
  state.editorLoading = state.currentMode === "editor";
  state.playLoading = state.currentMode === "play";
  syncModeUi();
  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }

  playSession.stopAnimation();
  playSession.resetJourney();
  applyCanvasResolution(refs, params.renderScale);
  state.currentWorld = generateWorld(params);
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  state.cameraState = editorSession.createDefaultCamera();
  if (state.currentMode === "editor") {
    editorSession.rerenderCurrentWorld();
  } else {
    state.currentViewport = null;
  }
  playSession.renderPlayWorld();
  updateStats(refs.statsContainer, state.currentWorld.stats);
  syncViewUi();

  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }

  state.editorLoading = false;
  state.playLoading = false;
  syncModeUi();

  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
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

function syncModeUi() {
  applyModeUi({
    refs,
    state,
    updatePlaySubView: playSession.updatePlaySubView,
  });
}

function togglePlayHudPanel(panelName) {
  if (!state.playHudPanels || !(panelName in state.playHudPanels)) {
    return;
  }
  state.playHudPanels = {
    ...state.playHudPanels,
    [panelName]: !state.playHudPanels[panelName],
  };
  playSession.updatePlaySubView();
}

function acknowledgePendingJourneyEvent() {
  if (!state.playState?.pendingJourneyEvent) {
    return;
  }
  state.playState = {
    ...state.playState,
    pendingJourneyEvent: null,
  };
  playSession.updatePlaySubView();
}

function syncViewUi() {
  applyViewUi({
    refs,
    cameraState: state.cameraState,
  });

  if (refs.zoomLevelChip) {
    refs.zoomLevelChip.textContent = `${Math.round(state.cameraState.zoom * 100)}%`;
  }
}

syncLabelButtons();
syncModeUi();
syncViewUi();
bootApp();

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

function loadPersistedEditorParams() {
  try {
    const raw = window.localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeParams(parsed);
  } catch {
    return null;
  }
}

function persistEditorParams(params) {
  try {
    window.localStorage.setItem(
      EDITOR_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeParams(params)),
    );
  } catch {
    // Ignore localStorage errors (privacy mode, quota, etc.).
  }
}

function persistCurrentForm() {
  persistEditorParams(getFormValues(refs.form));
}

function createDebouncedFormPersistor(delayMs = 150) {
  let timeoutId = null;
  return () => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      persistCurrentForm();
    }, delayMs);
  };
}
