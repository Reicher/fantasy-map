import { RENDER_HEIGHT, RENDER_WIDTH } from "@fardvag/shared/config";
import { BUILD_META, formatBuildLabel } from "../buildMeta";
import type { AppRefs } from "@fardvag/shared/types/app";

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function queryOptional<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function queryAll<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

export function createAppRefs(): AppRefs {
  return {
    editorShell: queryOptional<HTMLElement>("#editor-shell"),
    editorLoading: queryOptional<HTMLElement>("#editor-loading"),
    playView: queryOptional<HTMLElement>("#play-view"),
    playLoading: queryOptional<HTMLElement>("#play-loading"),
    playTooltip: queryOptional<HTMLElement>("#play-tooltip"),
    form: queryRequired<HTMLFormElement>("#controls"),
    canvas: queryRequired<HTMLCanvasElement>("#map-canvas"),
    playCanvas: queryRequired<HTMLCanvasElement>("#play-canvas"),
    playJourneyPanel: queryOptional<HTMLElement>("#play-journey-panel"),
    playJourneyCanvas: queryOptional<HTMLCanvasElement>("#play-journey-canvas"),
    playBottomHud: queryOptional<HTMLElement>("#play-bottom-hud"),
    playJourneyHearts: queryOptional<HTMLElement>("#play-journey-hearts"),
    playJourneyStamina: queryOptional<HTMLElement>("#play-journey-stamina"),
    playJourneyFoodCount: queryOptional<HTMLElement>("#play-journey-food-count"),
    playPanelCharacter: queryOptional<HTMLElement>("#play-panel-character"),
    playPanelInventory: queryOptional<HTMLElement>("#play-panel-inventory"),
    playPanelSettings: queryOptional<HTMLElement>("#play-panel-settings"),
    playPanelToggleCharacterButton: queryOptional<HTMLButtonElement>(
      "#play-panel-toggle-character",
    ),
    playPanelToggleInventoryButton: queryOptional<HTMLButtonElement>(
      "#play-panel-toggle-inventory",
    ),
    playPanelToggleSettingsButton: queryOptional<HTMLButtonElement>(
      "#play-panel-toggle-settings",
    ),
    playCharacterInitiative: queryOptional<HTMLElement>("#play-character-initiative"),
    playCharacterVitality: queryOptional<HTMLElement>("#play-character-vitality"),
    playCharacterStamina: queryOptional<HTMLElement>("#play-character-stamina"),
    playCharacterAccuracy: queryOptional<HTMLElement>("#play-character-accuracy"),
    playCharacterStatus: queryOptional<HTMLElement>("#play-character-status"),
    playLocationLine: queryOptional<HTMLElement>("#play-location-line"),
    playToggleTravelButton: queryOptional<HTMLButtonElement>("#play-toggle-travel"),
    playInventoryList: queryOptional<HTMLElement>("#play-inventory-list"),
    playSwitchModeButton: queryOptional<HTMLButtonElement>("#play-switch-mode"),
    playSettingsToggleBiomeLabelsButton: queryOptional<HTMLButtonElement>(
      "#play-settings-toggle-biome-labels",
    ),
    playSettingsToggleNodeLabelsButton: queryOptional<HTMLButtonElement>(
      "#play-settings-toggle-node-labels",
    ),
    playSettingsToggleHoverButton: queryOptional<HTMLButtonElement>(
      "#play-settings-toggle-hover",
    ),
    playArrivalCue: queryOptional<HTMLElement>("#play-arrival-cue"),
    playArrivalCueText: queryOptional<HTMLElement>("#play-arrival-cue-text"),
    playJourneyEventDialog: queryOptional<HTMLElement>("#play-journey-event-dialog"),
    playJourneyEventBody: queryOptional<HTMLElement>("#play-journey-event-body"),
    playJourneyEventLoot: queryOptional<HTMLElement>("#play-journey-event-loot"),
    playJourneyEventLootList: queryOptional<HTMLElement>("#play-journey-event-loot-list"),
    playJourneyEventTakeAllButton: queryOptional<HTMLButtonElement>(
      "#play-journey-event-take-all",
    ),
    playRestDialog: queryOptional<HTMLElement>("#play-rest-dialog"),
    playRestBody: queryOptional<HTMLElement>("#play-rest-body"),
    playHuntOutlook: queryOptional<HTMLElement>("#play-hunt-outlook"),
    playRestOptions: queryOptional<HTMLElement>("#play-rest-options"),
    playActionCancelButton: queryOptional<HTMLButtonElement>("#play-action-cancel"),
    playActionResultDialog: queryOptional<HTMLElement>("#play-action-result-dialog"),
    playActionResultBody: queryOptional<HTMLElement>("#play-action-result-body"),
    playActionResultOkButton: queryOptional<HTMLButtonElement>("#play-action-result-ok"),
    playRestButtons: queryAll<HTMLButtonElement>("[data-rest-hours]"),
    playHuntButtons: queryAll<HTMLButtonElement>("[data-hunt-hours]"),
    playGameOverDialog: queryOptional<HTMLElement>("#play-game-over-dialog"),
    playGameOverBody: queryOptional<HTMLElement>("#play-game-over-body"),
    playGameOverStats: queryOptional<HTMLElement>("#play-game-over-stats"),
    playGameOverOkButton: queryOptional<HTMLButtonElement>("#play-game-over-ok"),
    buildVersionBadge: queryOptional<HTMLElement>("#build-version-badge"),
    tooltip: queryOptional<HTMLElement>("#tooltip"),
    statsContainer: queryOptional<HTMLElement>("#stats"),
    toggleBiomeLabelsButton: queryRequired<HTMLButtonElement>("#toggle-biome-labels"),
    toggleNodeLabelsButton: queryRequired<HTMLButtonElement>("#toggle-node-labels"),
    toggleSnowButton: queryRequired<HTMLButtonElement>("#toggle-snow"),
    zoomOutButton: queryOptional<HTMLButtonElement>("#zoom-out"),
    zoomInButton: queryOptional<HTMLButtonElement>("#zoom-in"),
    zoomLevelChip: queryOptional<HTMLElement>("#zoom-level"),
    resetViewButton: queryOptional<HTMLButtonElement>("#reset-view"),
    zoom1Button: queryOptional<HTMLButtonElement>("#zoom-1"),
    zoom2Button: queryOptional<HTMLButtonElement>("#zoom-2"),
    zoom3Button: queryOptional<HTMLButtonElement>("#zoom-3"),
    randomSeedButton: queryRequired<HTMLButtonElement>("#random-seed"),
    resetButton: queryRequired<HTMLButtonElement>("#reset"),
    saveImageButton: queryRequired<HTMLButtonElement>("#save-image"),
    enterPlayButtons: queryAll<HTMLButtonElement>("[data-enter-play]"),
  };
}

export function applyBuildVersionBadge(refs: Pick<AppRefs, "buildVersionBadge">): void {
  if (!refs.buildVersionBadge) {
    return;
  }
  const buildLabel = formatBuildLabel(BUILD_META);
  refs.buildVersionBadge.textContent = buildLabel;
  refs.buildVersionBadge.title = buildLabel;
}

export function initializeCanvasSizes(
  refs: Pick<AppRefs, "canvas" | "playCanvas" | "playJourneyCanvas">,
): void {
  refs.canvas.width = RENDER_WIDTH;
  refs.canvas.height = RENDER_HEIGHT;
  refs.playCanvas.width = RENDER_WIDTH;
  refs.playCanvas.height = RENDER_HEIGHT;
  if (refs.playJourneyCanvas) {
    refs.playJourneyCanvas.width = RENDER_WIDTH;
    refs.playJourneyCanvas.height = RENDER_HEIGHT;
  }
}
