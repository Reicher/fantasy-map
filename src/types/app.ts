import type { PlayState } from "./play";
import type { ViewportLike } from "./runtime";
import type { World } from "./world";

export const PLAY_HUD_PANEL_NAMES = [
  "character",
  "inventory",
  "settings",
] as const;

export type AppMode = "editor" | "play";
export type PlayHudPanelName = (typeof PLAY_HUD_PANEL_NAMES)[number];

export interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
  [key: string]: unknown;
}

export interface PlayProfilerLike {
  isEnabled: () => boolean;
  toggle: () => boolean;
  measure: <T>(label: string, fn: () => T) => T;
  count: (label: string, value?: number) => void;
  setSnapshot: (snapshot: Record<string, unknown>) => void;
  frame: (timestamp: number) => void;
}

export interface AppRefs {
  editorShell: HTMLElement | null;
  editorLoading: HTMLElement | null;
  playView: HTMLElement | null;
  playLoading: HTMLElement | null;
  playTooltip: HTMLElement | null;
  form: HTMLFormElement;
  canvas: HTMLCanvasElement;
  playCanvas: HTMLCanvasElement;
  playJourneyPanel: HTMLElement | null;
  playJourneyCanvas: HTMLCanvasElement | null;
  playBottomHud: HTMLElement | null;
  playJourneyHearts: HTMLElement | null;
  playJourneyStamina: HTMLElement | null;
  playJourneyFoodCount: HTMLElement | null;
  playPanelCharacter: HTMLElement | null;
  playPanelInventory: HTMLElement | null;
  playPanelSettings: HTMLElement | null;
  playPanelToggleCharacterButton: HTMLButtonElement | null;
  playPanelToggleInventoryButton: HTMLButtonElement | null;
  playPanelToggleSettingsButton: HTMLButtonElement | null;
  playCharacterInitiative: HTMLElement | null;
  playCharacterVitality: HTMLElement | null;
  playCharacterStamina: HTMLElement | null;
  playCharacterAccuracy: HTMLElement | null;
  playCharacterStatus: HTMLElement | null;
  playLocationLine: HTMLElement | null;
  playToggleTravelButton: HTMLButtonElement | null;
  playInventoryList: HTMLElement | null;
  playSwitchModeButton: HTMLButtonElement | null;
  playSettingsToggleBiomeLabelsButton: HTMLButtonElement | null;
  playSettingsToggleNodeLabelsButton: HTMLButtonElement | null;
  playSettingsToggleHoverButton: HTMLButtonElement | null;
  playSettingsToggleSnowButton: HTMLButtonElement | null;
  playArrivalCue: HTMLElement | null;
  playArrivalCueText: HTMLElement | null;
  playJourneyEventDialog: HTMLElement | null;
  playJourneyEventBody: HTMLElement | null;
  playJourneyEventLoot: HTMLElement | null;
  playJourneyEventLootList: HTMLElement | null;
  playJourneyEventTakeAllButton: HTMLButtonElement | null;
  playRestDialog: HTMLElement | null;
  playRestBody: HTMLElement | null;
  playHuntOutlook: HTMLElement | null;
  playRestOptions: HTMLElement | null;
  playActionCancelButton: HTMLButtonElement | null;
  playActionResultDialog: HTMLElement | null;
  playActionResultBody: HTMLElement | null;
  playActionResultOkButton: HTMLButtonElement | null;
  playRestButtons: HTMLButtonElement[];
  playHuntButtons: HTMLButtonElement[];
  playGameOverDialog: HTMLElement | null;
  playGameOverBody: HTMLElement | null;
  playGameOverStats: HTMLElement | null;
  playGameOverRecord: HTMLElement | null;
  playGameOverOkButton: HTMLButtonElement | null;
  buildVersionBadge: HTMLElement | null;
  tooltip: HTMLElement | null;
  statsContainer: HTMLElement | null;
  toggleBiomeLabelsButton: HTMLButtonElement;
  toggleNodeLabelsButton: HTMLButtonElement;
  toggleSnowButton: HTMLButtonElement;
  zoomOutButton: HTMLButtonElement | null;
  zoomInButton: HTMLButtonElement | null;
  zoomLevelChip: HTMLElement | null;
  resetViewButton: HTMLButtonElement | null;
  zoom1Button: HTMLButtonElement | null;
  zoom2Button: HTMLButtonElement | null;
  zoom3Button: HTMLButtonElement | null;
  randomSeedButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  saveImageButton: HTMLButtonElement;
  enterPlayButtons: HTMLButtonElement[];
}

export interface AppState {
  currentMode: AppMode;
  currentWorld: World | null;
  currentViewport: ViewportLike | null;
  playState: PlayState | null;
  editorLoading: boolean;
  playLoading: boolean;
  isBootReady: boolean;
  currentRenderScale: number;
  renderOptions: {
    showBiomeLabels: boolean;
    showNodeLabels: boolean;
    showSnow: boolean;
  };
  playMapOptions: {
    showBiomeLabels: boolean;
    showNodeLabels: boolean;
    showHoverInspector: boolean;
    debugTravelSampling: boolean;
  };
  cameraState: CameraState;
  dragState: unknown;
  pendingInteractiveRender: boolean;
  playAnimationFrame: number | null;
  lastTravelTick: number;
  playProfiler: PlayProfilerLike;
  playActivePanels: PlayHudPanelName[];
  playActionMenuOpen: boolean;
  playMapCamera?: CameraState;
  [key: string]: unknown;
}
