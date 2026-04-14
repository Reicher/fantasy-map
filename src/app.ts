import { DEFAULT_PARAMS } from "./config";
import {
  generateWorld,
  normalizeParams,
} from "./generator/worldGenerator";
import {
  bindRangeLabels,
  getFormValues,
  hydrateForm,
  randomSeed,
  renderControlsFromSchema,
  setSeedValue,
  updateLabels,
} from "./ui/controls";
import {
  inferInitialMode,
  syncLabelButtons as applyLabelButtonState,
  syncModeUi as applyModeUi,
  syncViewUi as applyViewUi,
} from "./ui/appShell";
import { applyCanvasResolution } from "./ui/canvasResolution";
import { createPlayProfiler } from "./ui/playProfiler";
import { updateStats } from "./ui/statsPanel";
import { createEditorSession } from "./ui/editorSession";
import { clearHover } from "./ui/hoverPanel";
import { createPlaySession } from "./ui/playSession";
import {
  applyBuildVersionBadge,
  createAppRefs,
  initializeCanvasSizes,
} from "./app/domRefs";
import {
  createDebouncedFormPersistor,
  loadPersistedEditorParams,
  persistEditorParams,
} from "./app/editorPersistence";
import {
  createTransitionController,
  waitForNextPaintIfActive,
} from "./ui/viewState";
import {
  PLAY_HUD_PANEL_NAMES,
  type AppState,
  type PlayHudPanelName,
  type PlayProfilerLike,
} from "./types/app";

const refs = createAppRefs();
applyBuildVersionBadge(refs);

const initialMode = inferInitialMode();
initializeCanvasSizes(refs);

const state: AppState = {
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
    showBiomeLabels: true,
    showNodeLabels: true,
    showHoverInspector: true,
    debugTravelSampling: false,
  },
  cameraState: { zoom: 1, centerX: 150, centerY: 110 },
  dragState: null,
  pendingInteractiveRender: false,
  playAnimationFrame: null,
  lastTravelTick: 0,
  playProfiler: createPlayProfiler() as PlayProfilerLike,
  playActivePanels: [],
  playActionMenuOpen: false,
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
const initialParams =
  initialMode === "play"
    ? {
        ...(persistedParams ?? DEFAULT_PARAMS),
        seed: randomSeed(),
      }
    : persistedParams ?? {
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

const persistFormSettingsDebounced = createDebouncedFormPersistor(
  persistCurrentForm,
);
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

if (refs.playToggleTravelButton) {
  refs.playToggleTravelButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    runPrimaryActionButton();
  });
}

for (const button of refs.playRestButtons) {
  button.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const requestedHours = Number(button.dataset.restHours);
    if (!playSession.startRest(requestedHours)) {
      return;
    }
    state.playActivePanels = [];
    state.playActionMenuOpen = true;
    playSession.updatePlaySubView();
  });
}

for (const button of refs.playHuntButtons) {
  button.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const requestedHours = Number(button.dataset.huntHours);
    if (!playSession.startHunt(requestedHours)) {
      return;
    }
    state.playActivePanels = [];
    state.playActionMenuOpen = true;
    playSession.updatePlaySubView();
  });
}

if (refs.playActionCancelButton) {
  refs.playActionCancelButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    playSession.cancelTimedAction();
  });
}

if (refs.playActionResultOkButton) {
  refs.playActionResultOkButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    playSession.dismissActionResult();
  });
}

if (refs.playGameOverOkButton) {
  refs.playGameOverOkButton.addEventListener("click", () => {
    restartPlayAfterGameOver();
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
  link.download = `${state.currentWorld?.title || "fardvag"}.png`;
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

  if (state.playState?.gameOver) {
    return;
  }

  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    playSession.setPlayViewMode(
      state.playState?.viewMode === "journey" ? "map" : "journey",
    );
    return;
  }

  if ((event.key === " " || event.code === "Space") && state.playState?.travel) {
    event.preventDefault();
    runPrimaryActionButton();
    return;
  }

  if (event.key === "Escape") {
    if (
      state.playActionMenuOpen &&
      !state.playState?.travel?.isTravelPaused &&
      !state.playState?.rest &&
      !state.playState?.hunt &&
      !state.playState?.pendingRestChoice
    ) {
      event.preventDefault();
      state.playActionMenuOpen = false;
      playSession.updatePlaySubView();
      return;
    }
    if (state.playActivePanels.length > 0) {
      event.preventDefault();
      state.playActivePanels = [];
      playSession.updatePlaySubView();
      return;
    }
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

  if (event.key === "a" || event.key === "A") {
    event.preventDefault();
    runPrimaryActionButton();
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
  state.playActivePanels = [];
  state.playActionMenuOpen = false;
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

function togglePlayHudPanel(panelName: PlayHudPanelName) {
  if (!PLAY_HUD_PANEL_NAMES.includes(panelName)) {
    return;
  }
  const hasPanel = state.playActivePanels.includes(panelName);
  state.playActivePanels = hasPanel
    ? state.playActivePanels.filter((name) => name !== panelName)
    : [...state.playActivePanels, panelName];
  playSession.updatePlaySubView();
}

function restartPlayAfterGameOver() {
  if (!state.currentWorld || !state.playState?.gameOver) {
    return;
  }

  playSession.stopAnimation();
  playSession.resetJourney();
  state.playActivePanels = [];
  state.playActionMenuOpen = false;
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  clearHover(refs.playTooltip);
  playSession.renderPlayWorld();
}

function runPrimaryActionButton() {
  const playState = state.playState;
  if (!playState || playState.gameOver) {
    return;
  }

  if (playState.travel) {
    if (!playSession.toggleTravelPause()) {
      return;
    }
    const isNowPaused = Boolean(state.playState?.isTravelPaused);
    state.playActionMenuOpen = isNowPaused;
    if (isNowPaused) {
      state.playActivePanels = [];
    }
    playSession.updatePlaySubView();
    return;
  }

  if (playState.rest || playState.hunt || playState.pendingRestChoice) {
    if (!state.playActionMenuOpen) {
      state.playActionMenuOpen = true;
      state.playActivePanels = [];
      playSession.updatePlaySubView();
    }
    return;
  }

  if (playState.currentNodeId == null) {
    return;
  }

  state.playActionMenuOpen = !state.playActionMenuOpen;
  if (state.playActionMenuOpen) {
    state.playActivePanels = [];
  }
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

function persistCurrentForm(): void {
  persistEditorParams(getFormValues(refs.form));
}
