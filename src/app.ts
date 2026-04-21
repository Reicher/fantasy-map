import { DEFAULT_PARAMS } from "@fardvag/shared/config";
import { CONTINUOUS_ACTION_HOURS } from "@fardvag/game-core";
import {
  generateWorld,
  normalizeParams,
} from "@fardvag/world-gen";
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
  canCloseActionMenu,
  isEncounterTurn,
  isNonHostileEncounterTurn,
  shouldKeepActionMenuOpenAfterEncounter,
} from "./ui/playActionMenuPolicy";
import {
  createAppRefs,
  initializeCanvasSizes,
} from "./app/domRefs";
import {
  createDebouncedFormPersistor,
  loadPersistedEditorParams,
  persistEditorParams,
} from "./app/editorPersistence";
import {
  downloadEditorDefaultsFile,
  loadBundledEditorDefaults,
} from "./app/editorDefaultsFile";
import {
  createTransitionController,
  waitForNextPaintIfActive,
} from "./ui/viewState";
import {
  PLAY_HUD_PANEL_NAMES,
  type AppState,
  type PlayHudPanelName,
  type PlayProfilerLike,
} from "@fardvag/shared/types/app";

const refs = createAppRefs();

const initialMode = inferInitialMode();
initializeCanvasSizes(refs);

const EDITOR_GENERATION_STAGE_SUBTITLES = [
  "Förbereder parametrar...",
  "Skapar terräng och hydrologi...",
  "Bygger vägnät, noder och platser...",
  "Ritar karta, etiketter och statistik...",
] as const;

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
  playPresentedEncounterId: null,
  playSettlementDebugOpen: false,
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

const bundledEditorDefaults = await loadBundledEditorDefaults(DEFAULT_PARAMS);
const persistedParams = loadPersistedEditorParams();
const initialParams =
  initialMode === "play"
    ? {
        ...(persistedParams ?? bundledEditorDefaults),
        seed: randomSeed(),
      }
    : persistedParams ?? {
        ...bundledEditorDefaults,
      };
renderControlsFromSchema(refs.form, { initialTab: "karta" });
hydrateForm(initialParams);
state.currentRenderScale = normalizeParams(initialParams).renderScale;
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
  hydrateForm(bundledEditorDefaults);
  updateLabels();
  persistCurrentForm();
  generateAndRender();
});

if (refs.saveDefaultsButton) {
  refs.saveDefaultsButton.addEventListener("click", () => {
    const formParams = getFormValues(refs.form);
    persistEditorParams(formParams);
    downloadEditorDefaultsFile(formParams);
  });
}

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
    const requestedHours = normalizeTimedActionHours(button.dataset.restHours);
    const activeRestHours = state.playState.rest
      ? normalizeTimedActionHours(state.playState.rest.hours)
      : null;
    if (activeRestHours != null && requestedHours === activeRestHours) {
      playSession.cancelTimedAction();
      return;
    }
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
    const requestedHours = normalizeTimedActionHours(button.dataset.huntHours);
    const activeHuntHours = state.playState.hunt
      ? normalizeTimedActionHours(state.playState.hunt.hours)
      : null;
    if (activeHuntHours != null && requestedHours === activeHuntHours) {
      playSession.cancelTimedAction();
      return;
    }
    if (!playSession.startHunt(requestedHours)) {
      return;
    }
    state.playActivePanels = [];
    state.playActionMenuOpen = true;
    playSession.updatePlaySubView();
  });
}

for (const button of refs.playSettlementEncounterRestButtons) {
  button.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const requestedHours = normalizeTimedActionHours(
      button.dataset.settlementRestHours,
    );
    const activeRestHours = state.playState.rest
      ? normalizeTimedActionHours(state.playState.rest.hours)
      : null;
    if (activeRestHours != null && requestedHours === activeRestHours) {
      playSession.cancelTimedAction();
      return;
    }
    if (!playSession.startRest(requestedHours)) {
      return;
    }
    state.playActivePanels = [];
    state.playActionMenuOpen = true;
    playSession.updatePlaySubView();
  });
}

for (const button of refs.playSettlementEncounterHuntButtons) {
  button.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const requestedHours = normalizeTimedActionHours(
      button.dataset.settlementHuntHours,
    );
    const activeHuntHours = state.playState.hunt
      ? normalizeTimedActionHours(state.playState.hunt.hours)
      : null;
    if (activeHuntHours != null && requestedHours === activeHuntHours) {
      playSession.cancelTimedAction();
      return;
    }
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

if (refs.playRestResumeTravelButton) {
  refs.playRestResumeTravelButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    if (!state.playState.travel) {
      state.playActionMenuOpen = false;
      if (state.playState.viewMode !== "map") {
        playSession.setPlayViewMode("map");
        return;
      }
      playSession.updatePlaySubView();
      return;
    }
    const canAttemptResume =
      Boolean(state.playState.isTravelPaused) &&
      !state.playState.rest &&
      !state.playState.hunt;
    if (!canAttemptResume || !playSession.toggleTravelPause()) {
      return;
    }
    if (state.playState?.travel && !state.playState.isTravelPaused) {
      state.playActionMenuOpen = false;
    }
    playSession.updatePlaySubView();
  });
}

if (refs.playJourneyEncounterGreetButton) {
  refs.playJourneyEncounterGreetButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const previousPlayState = state.playState;
    if (!playSession.encounterGreet()) {
      return;
    }
    autoCloseActionMenuAfterEncounter(previousPlayState);
    playSession.updatePlaySubView();
  });
}

if (refs.playJourneyEncounterAttackButton) {
  refs.playJourneyEncounterAttackButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const previousPlayState = state.playState;
    if (!playSession.encounterAttack()) {
      return;
    }
    autoCloseActionMenuAfterEncounter(previousPlayState);
    playSession.updatePlaySubView();
  });
}

if (refs.playJourneyEncounterFleeButton) {
  refs.playJourneyEncounterFleeButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    const previousPlayState = state.playState;
    if (!playSession.encounterFlee()) {
      return;
    }
    autoCloseActionMenuAfterEncounter(previousPlayState);
    playSession.updatePlaySubView();
  });
}

if (refs.playJourneySettlementTravelButton) {
  refs.playJourneySettlementTravelButton.addEventListener("click", () => {
    if (state.currentMode !== "play" || !state.playState) {
      return;
    }
    if (state.playState.travel) {
      if (
        !isNonHostileEncounterTurn(state.playState) ||
        !hasPresentedCurrentEncounter(state.playState)
      ) {
        return;
      }
      continueTravelAfterEncounter();
      return;
    }
    state.playActionMenuOpen = false;
    if (state.playState.viewMode !== "map") {
      playSession.setPlayViewMode("map");
      return;
    }
    playSession.updatePlaySubView();
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
    if (state.currentMode === "editor") {
      void startPlayFromEditorWorld();
      return;
    }
    void startPlayWithRandomSeed();
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

  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    if (isEncounterIntroLocked(state.playState)) {
      if (state.playActionMenuOpen) {
        state.playActionMenuOpen = false;
        playSession.updatePlaySubView();
      }
      return;
    }
    if (
      state.playState?.travel &&
      isEncounterTurn(state.playState) &&
      !isNonHostileEncounterTurn(state.playState)
    ) {
      return;
    }
    if (state.playState?.travel && isNonHostileEncounterTurn(state.playState)) {
      if (!hasPresentedCurrentEncounter(state.playState)) {
        if (!state.playActionMenuOpen) {
          state.playActionMenuOpen = true;
          playSession.updatePlaySubView();
        }
        return;
      }
      continueTravelAfterEncounter();
      return;
    }
    runPrimaryActionButton();
    return;
  }

  if (event.key === "Escape") {
    if (
      state.playActionMenuOpen &&
      !state.playState?.isTravelPaused &&
      !state.playState?.rest &&
      !state.playState?.hunt &&
      !state.playState?.pendingRestChoice &&
      canCloseActionMenu(state.playState)
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
    if (isPlayerInSettlement(state.playState, state.currentWorld)) {
      state.playSettlementDebugOpen = !state.playSettlementDebugOpen;
      playSession.updatePlaySubView();
      return;
    }
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

async function generateAndRender(
  options: {
    paramsOverride?: ReturnType<typeof normalizeParams> | null;
    persistParams?: boolean;
  } = {},
) {
  const runId = generateTransition.begin();
  const formParams = normalizeParams(getFormValues(refs.form));
  const params = options.paramsOverride
    ? normalizeParams(options.paramsOverride)
    : formParams;
  if (options.persistParams !== false) {
    persistEditorParams(formParams);
  }
  state.currentRenderScale = params.renderScale;
  updateLabels();
  state.editorLoading = state.currentMode === "editor";
  state.playLoading = state.currentMode === "play";
  syncModeUi();
  setGenerationLoadingStage(0);
  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }
  setGenerationLoadingStage(1);
  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }

  playSession.stopAnimation();
  playSession.resetJourney();
  applyCanvasResolution(refs, params.renderScale);
  state.currentWorld = generateWorld(params);
  setGenerationLoadingStage(2);
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  state.playActivePanels = [];
  state.playActionMenuOpen = false;
  state.playPresentedEncounterId = null;
  state.playSettlementDebugOpen = false;
  state.cameraState = editorSession.createDefaultCamera();
  if (state.currentMode === "editor") {
    editorSession.rerenderCurrentWorld();
  } else {
    state.currentViewport = null;
  }
  playSession.renderPlayWorld();
  if (state.currentMode === "play") {
    playSession.ensureAnimation();
  }
  updateStats(refs.statsContainer, state.currentWorld.stats);
  syncViewUi();
  setGenerationLoadingStage(3);

  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }

  state.editorLoading = false;
  state.playLoading = false;
  syncModeUi();
  setGenerationLoadingStage(0);

  if (!(await waitForNextPaintIfActive(generateTransition, runId, 1))) {
    return;
  }

  if (state.currentMode === "editor") {
    editorSession.rerenderCurrentWorld();
  } else {
    playSession.renderPlayWorld();
  }
}

async function startPlayWithRandomSeed() {
  const formParams = normalizeParams(getFormValues(refs.form));
  const playParams = normalizeParams({
    ...formParams,
    seed: randomSeed(),
  });
  await generateAndRender({
    paramsOverride: playParams,
    persistParams: false,
  });
  await playSession.enterPlayMode();
}

async function startPlayFromEditorWorld() {
  if (!state.currentWorld) {
    await generateAndRender({
      persistParams: false,
    });
  }
  if (!state.currentWorld) {
    return;
  }

  playSession.stopAnimation();
  playSession.resetJourney();
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  state.playActivePanels = [];
  state.playActionMenuOpen = false;
  state.playPresentedEncounterId = null;
  state.playSettlementDebugOpen = false;
  await playSession.enterPlayMode();
}

function setGenerationLoadingStage(stage: number): void {
  const normalized = Math.max(
    0,
    Math.min(
      EDITOR_GENERATION_STAGE_SUBTITLES.length - 1,
      Math.round(Number(stage) || 0),
    ),
  );
  for (const overlay of [refs.editorLoading, refs.playLoading]) {
    if (!overlay) {
      continue;
    }
    overlay.dataset.stage = String(normalized);
    const subtitle = overlay.querySelector<HTMLElement>(".editor-loading-subtitle");
    if (subtitle) {
      subtitle.textContent = EDITOR_GENERATION_STAGE_SUBTITLES[normalized];
    }
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
  state.playPresentedEncounterId = null;
  state.playSettlementDebugOpen = false;
  state.playState = playSession.createInitialPlayState(state.currentWorld);
  clearHover(refs.playTooltip);
  playSession.renderPlayWorld();
  playSession.ensureAnimation();
}

function runPrimaryActionButton() {
  const playState = state.playState;
  if (!playState || playState.gameOver) {
    return;
  }
  if (isEncounterIntroLocked(playState)) {
    if (state.playActionMenuOpen) {
      state.playActionMenuOpen = false;
      playSession.updatePlaySubView();
    }
    return;
  }

  if (isEncounterTurn(playState)) {
    const shouldClose =
      state.playActionMenuOpen && canCloseActionMenu(playState);
    state.playActionMenuOpen = shouldClose ? false : true;
    if (state.playActionMenuOpen) {
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

  if (playState.currentNodeId == null) {
    return;
  }

  state.playActionMenuOpen = !state.playActionMenuOpen;
  if (state.playActionMenuOpen) {
    state.playActivePanels = [];
  }
  playSession.updatePlaySubView();
}

function isPlayerInSettlement(playState, world): boolean {
  if (!playState || !world || playState.currentNodeId == null) {
    return false;
  }
  const features = world.features as
    | { nodes?: Array<{ marker?: string } | undefined> }
    | null
    | undefined;
  const node = features?.nodes?.[playState.currentNodeId] ?? null;
  return node?.marker === "settlement";
}

function isEncounterIntroLocked(playState): boolean {
  return Boolean(
    playState?.travel &&
      playState?.encounter &&
      playState.encounter.phase === "approaching" &&
      !playState?.pendingJourneyEvent,
  );
}

function hasPresentedCurrentEncounter(playState): boolean {
  const encounterId = String(playState?.pendingJourneyEvent?.encounterId ?? "");
  if (encounterId.length <= 0) {
    return false;
  }
  return encounterId === String(state.playPresentedEncounterId ?? "");
}

function continueTravelAfterEncounter(): void {
  const previousPlayState = state.playState;
  const resolved = playSession.encounterFlee();
  if (resolved) {
    autoCloseActionMenuAfterEncounter(previousPlayState);
  }
  const canResumeAfterEncounter =
    resolved &&
    Boolean(state.playState?.travel) &&
    Boolean(state.playState?.isTravelPaused) &&
    !state.playState?.encounter &&
    !state.playState?.pendingJourneyEvent &&
    state.playState?.travelPauseReason === "encounter";
  if (canResumeAfterEncounter && playSession.toggleTravelPause()) {
    state.playActionMenuOpen = false;
  }
  playSession.updatePlaySubView();
}

function autoCloseActionMenuAfterEncounter(previousPlayState): void {
  if (!previousPlayState || !state.playState) {
    return;
  }
  if (
    isEncounterTurn(previousPlayState) &&
    !isEncounterTurn(state.playState) &&
    !state.playState.rest &&
    !state.playState.hunt
  ) {
    const shouldKeepActionMenuOpen =
      shouldKeepActionMenuOpenAfterEncounter(state.playState);
    state.playActionMenuOpen = shouldKeepActionMenuOpen;
    if (shouldKeepActionMenuOpen) {
      state.playActivePanels = [];
    }
    state.playPresentedEncounterId = null;
  }
}

function normalizeTimedActionHours(value): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  const normalizedHours = Math.floor(numericValue);
  if (normalizedHours === CONTINUOUS_ACTION_HOURS) {
    return CONTINUOUS_ACTION_HOURS;
  }
  return Math.max(0, normalizedHours);
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
