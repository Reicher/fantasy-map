import {
  CONTINUOUS_ACTION_HOURS,
  describePlayHud,
  canTransferInventoryItem,
  describeHuntSituation,
  formatDistanceWithUnit,
  isInventoryEmpty,
  isNodeDiscovered,
  normalizePlayerInjuryStatus,
  resolveEffectiveWeaponAccuracy,
  resolveHungerStaminaPenaltyPerHour,
  resolvePlayerHungerStatus,
  resolveRestStaminaGainPerHour,
  transferAllInventoryItems,
  transferInventoryItem,
  updateAbandonedLootInventory,
} from "@fardvag/game-core";
import { getNodeTitle } from "@fardvag/shared/node/model";
import type { NodeLike } from "@fardvag/shared/node/model";
import { createInventoryGridController } from "./inventoryGrid";
import { setElementVisible } from "./viewState";
import type { PlaySubViewDeps } from "@fardvag/shared/types/runtime";
import type { InventoryDragPayload, InventoryState } from "@fardvag/shared/types/inventory";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";
import {
  buildGameOverStatsRenderSignature,
  buildRunStatsSignature,
  normalizeRunStatsForGameOver,
  renderGameOverStats,
  updateAndLoadRunRecord,
} from "./playGameOverStats";
import {
  hideActionResultDialog,
  syncActionResultDialog,
} from "./playActionResultDialog";
import {
  buildSettlementDebugSummary,
  getCurrentSettlementDebugContext,
} from "./playSettlementDebug";

interface JourneyPresentationSnapshot {
  viewW?: number;
  destMarkerCanvasX?: number | null;
  encounterId?: string | null;
  encounterIntroComplete?: boolean;
  agentHits?: Array<{
    x?: number;
    y?: number;
    radius?: number;
    settlementId?: number;
    agentId?: string;
    greeting?: string;
  }>;
}

interface ArrivalCueOptions {
  revealActualTitle?: boolean;
}

const PLAYER_INVENTORY_GRID_ID = "player-inventory";
const LOOT_INVENTORY_GRID_ID = "journey-loot";
const HUD_STAMINA_PER_TRAVEL_HOUR = 3;
const HUD_STAMINA_PER_REST_HOUR = 9;
const HUD_STAMINA_PER_HUNT_HOUR = 6;

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  profiler,
}: PlaySubViewDeps) {
  let lastJourneyVisible = null;
  let lastBottomHudVisible = null;
  let lastLocationLine = null;
  let lastLocationProgress = null;
  let lastJourneyVitalsSignature = null;
  let lastCharacterPanelSignature = null;
  let lastModeButtonLabel = null;
  let lastTravelToggleSignature = null;
  let lastJourneyEventDialogVisible = null;
  let lastJourneyEventDialogMessage = null;
  let lastJourneyLootPanelVisible = null;
  let lastJourneyLootTakeAllEnabled = null;
  let lastJourneyEncounterActionsVisible = null;
  let lastJourneyEncounterCanAttack = null;
  let lastSettlementActionMenuVisible = null;
  let lastSettlementActionHintVisible = null;
  let lastSettlementActionHintMessage = null;
  let lastEncounterActionMenuEncounterId = null;
  let lastSettlementDebugVisible = null;
  let lastSettlementDebugSignature = null;
  let lastRestDialogVisible = null;
  let lastRestDialogMessage = null;
  let lastHuntOutlookMessage = null;
  let lastRestBodyVisible = null;
  let lastHuntOutlookVisible = null;
  let lastRestOptionsVisible = null;
  let lastHuntCancelVisible = null;
  let actionResultDialogState = {
    visible: null,
    message: null,
  };
  let lastGameOverVisible = null;
  let lastGameOverMessage = null;
  let lastGameOverStatsRenderSignature = null;
  let lastGameOverStatsSignature = null;
  let lastComputedGameOverRecord = null;
  let activeTravelCueKey = null;
  let activeTravelTargetNodeId = null;
  let lastDestMarkerCanvasX = null;
  let autoClearJourneyEventKey = null;
  let autoClearJourneyEventTimer = null;
  const shownArrivalCueKeys = new Set();

  const inventoryGrid = createInventoryGridController({
    root: refs.playInventoryList,
    gridId: PLAYER_INVENTORY_GRID_ID,
    getInventory: () => state.playState?.inventory ?? null,
    onInventoryChange: (nextInventory) => {
      if (!state.playState) {
        return;
      }
      state.playState = {
        ...state.playState,
        inventory: nextInventory,
      };
    },
    canDropExternalItem: (payload, column, row) =>
      canDropAcrossInventories(payload, PLAYER_INVENTORY_GRID_ID, column, row),
    onDropExternalItem: (payload, column, row) => {
      moveAcrossInventories(payload, PLAYER_INVENTORY_GRID_ID, column, row);
    },
  });

  const lootInventoryGrid = createInventoryGridController({
    root: refs.playJourneyEventLootList,
    gridId: LOOT_INVENTORY_GRID_ID,
    getInventory: () => getLootInventory(state.playState),
    onInventoryChange: (nextInventory) => {
      if (!state.playState) {
        return;
      }
      state.playState = withUpdatedLootInventory(state.playState, nextInventory);
    },
    canDropExternalItem: (payload, column, row) =>
      canDropAcrossInventories(payload, LOOT_INVENTORY_GRID_ID, column, row),
    onDropExternalItem: (payload, column, row) => {
      moveAcrossInventories(payload, LOOT_INVENTORY_GRID_ID, column, row);
    },
  });

  if (refs.playJourneyEventTakeAllButton) {
    refs.playJourneyEventTakeAllButton.addEventListener("click", () => {
      takeAllLoot();
    });
  }

  const journeyInteractionRoot = refs.playJourneyPanel ?? refs.playJourneyCanvas;
  if (journeyInteractionRoot) {
    journeyInteractionRoot.addEventListener("pointerup", (event) => {
      handleJourneyAgentInteraction(event);
    });
  }

  return {
    reset,
    update,
  };

  function reset() {
    lastJourneyVisible = null;
    lastBottomHudVisible = null;
    lastLocationLine = null;
    lastLocationProgress = null;
    lastJourneyVitalsSignature = null;
    lastCharacterPanelSignature = null;
    lastModeButtonLabel = null;
    lastTravelToggleSignature = null;
    lastJourneyEventDialogVisible = null;
    lastJourneyEventDialogMessage = null;
    lastJourneyLootPanelVisible = null;
    lastJourneyLootTakeAllEnabled = null;
    lastJourneyEncounterActionsVisible = null;
    lastJourneyEncounterCanAttack = null;
    lastSettlementActionMenuVisible = null;
    lastSettlementActionHintVisible = null;
    lastSettlementActionHintMessage = null;
    lastEncounterActionMenuEncounterId = null;
    lastSettlementDebugVisible = null;
    lastSettlementDebugSignature = null;
    lastRestDialogVisible = null;
    lastRestDialogMessage = null;
    lastHuntOutlookMessage = null;
    lastRestBodyVisible = null;
    lastHuntOutlookVisible = null;
    lastRestOptionsVisible = null;
    lastHuntCancelVisible = null;
    actionResultDialogState = {
      visible: null,
      message: null,
    };
    lastGameOverVisible = null;
    lastGameOverMessage = null;
    lastGameOverStatsRenderSignature = null;
    lastGameOverStatsSignature = null;
    lastComputedGameOverRecord = null;
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
    clearAutoClearJourneyEventTimer();
    shownArrivalCueKeys.clear();
    hideArrivalCue();
    hideJourneyEventDialog();
    hideRestDialog();
    actionResultDialogState = hideActionResultDialog({
      dialog: refs.playActionResultDialog,
      body: refs.playActionResultBody,
    });
    hideGameOverDialog();
    hideSettlementDebugPanel();
    inventoryGrid.reset();
    lootInventoryGrid.reset();
  }

  function update(world, playState) {
    const isPlay = state.currentMode === "play";
    const isJourney = isPlay && playState?.viewMode === "journey";
    const showBottomHud = isPlay && Boolean(playState);

    if (lastJourneyVisible !== isJourney) {
      setElementVisible(refs.playCanvas, !isJourney, "block");
      setElementVisible(refs.playJourneyPanel, isJourney, "flex");
      lastJourneyVisible = isJourney;
    }

    if (lastBottomHudVisible !== showBottomHud) {
      setElementVisible(refs.playBottomHud, showBottomHud, "flex");
      lastBottomHudVisible = showBottomHud;
    }

    syncPlayLegendButtons(state.playMapOptions, refs);
    lastModeButtonLabel = syncBottomHudButtons(
      playState,
      state.playActivePanels,
      refs,
      lastModeButtonLabel,
    );
    lastTravelToggleSignature = syncTravelToggleButton(
      playState,
      state.playActionMenuOpen,
      refs.playToggleTravelButton,
      lastTravelToggleSignature,
    );
    syncHudPanelsVisibility(showBottomHud, state.playActivePanels, refs);

    if (!isPlay || !world || !playState) {
      if (refs.playHudLocationProgress && lastLocationProgress !== "0.000") {
        refs.playHudLocationProgress.style.width = "0%";
        lastLocationProgress = "0.000";
      }
      hideArrivalCue();
      hideJourneyEventDialog();
      hideRestDialog();
      actionResultDialogState = hideActionResultDialog({
        dialog: refs.playActionResultDialog,
        body: refs.playActionResultBody,
      });
      hideGameOverDialog();
      hideSettlementDebugPanel();
      resetTravelCueTracking();
      return;
    }

    const hud = describePlayHud(world, playState);
    if (refs.playLocationLine && hud.locationLine !== lastLocationLine) {
      refs.playLocationLine.textContent = hud.locationLine;
      lastLocationLine = hud.locationLine;
    }
    const locationTooltip = describeLocationTooltip(playState);
    const locationProgress = getLocationProgressRatio(playState);
    const locationProgressKey = locationProgress.toFixed(3);
    if (refs.playHudLocationProgress && locationProgressKey !== lastLocationProgress) {
      refs.playHudLocationProgress.style.width = `${(locationProgress * 100).toFixed(1)}%`;
      lastLocationProgress = locationProgressKey;
    }
    if (refs.playLocationLine?.parentElement) {
      refs.playLocationLine.parentElement.setAttribute("title", locationTooltip);
    }
    lastJourneyVitalsSignature = syncJourneyVitals(
      refs.playJourneyStamina,
      refs.playJourneyHunger,
      refs.playJourneyHearts,
      refs.playJourneyFoodCount,
      refs.playHudBulletsCount,
      playState,
      lastJourneyVitalsSignature,
    );
    lastCharacterPanelSignature = syncCharacterPanel(
      refs,
      playState,
      lastCharacterPanelSignature,
    );
    inventoryGrid.render();
    syncRestDialog(playState, isPlay, world);
    actionResultDialogState = syncActionResultDialog(
      {
        dialog: refs.playActionResultDialog,
        body: refs.playActionResultBody,
      },
      playState,
      isPlay,
      actionResultDialogState,
    );
    syncGameOverDialog(playState, isPlay);

    if (playState.gameOver) {
      hideArrivalCue();
      hideJourneyEventDialog();
      hideRestDialog();
      actionResultDialogState = hideActionResultDialog({
        dialog: refs.playActionResultDialog,
        body: refs.playActionResultBody,
      });
      hideSettlementDebugPanel();
      resetTravelCueTracking();
      return;
    }

    if (!isJourney) {
      hideArrivalCue();
      syncJourneyEventDialog(playState, false, {}, world);
      hideSettlementDebugPanel();
      return;
    }

    profiler.measure("journey-update", () => {
      journeyScene.update(playState, {
        debug: state.playMapOptions?.debugTravelSampling,
        world,
        showSnow: state.renderOptions?.showSnow !== false,
      });
    });

    const presentation =
      typeof journeyScene.getPresentationSnapshot === "function"
        ? journeyScene.getPresentationSnapshot()
        : {};
    maybeTriggerArrivalCue(world, playState, presentation);
    syncJourneyEventDialog(playState, isJourney, presentation, world);
    syncSettlementDebugPanel(world, playState, isJourney);
    profiler.setSnapshot(journeyScene.getDebugSnapshot());
  }

  function maybeTriggerArrivalCue(
    world: World,
    playState: PlayState,
    presentation: JourneyPresentationSnapshot = {},
  ) {
    if (playState.travel) {
      const cueKey = buildTravelCueKey(playState.travel);
      const targetNodeId = playState.travel.targetNodeId ?? null;

      if (activeTravelCueKey !== cueKey) {
        activeTravelCueKey = cueKey;
        activeTravelTargetNodeId = targetNodeId;
        lastDestMarkerCanvasX = null;
      }

      const destCanvasX = Number.isFinite(presentation.destMarkerCanvasX)
        ? presentation.destMarkerCanvasX
        : null;
      const viewW = Number.isFinite(presentation.viewW)
        ? presentation.viewW
        : 0;
      const enteredViewport =
        destCanvasX != null &&
        viewW > 0 &&
        destCanvasX <= viewW &&
        (lastDestMarkerCanvasX == null || lastDestMarkerCanvasX > viewW);

      if (enteredViewport) {
        triggerArrivalCue(world, playState, targetNodeId, cueKey, {
          revealActualTitle: true,
        });
      }

      if (destCanvasX != null) {
        lastDestMarkerCanvasX = destCanvasX;
      }
      return;
    }

    if (activeTravelCueKey && !shownArrivalCueKeys.has(activeTravelCueKey)) {
      triggerArrivalCue(
        world,
        playState,
        activeTravelTargetNodeId,
        activeTravelCueKey,
        {
          revealActualTitle: true,
        },
      );
    }
    resetTravelCueTracking();
  }

  function triggerArrivalCue(
    world: World,
    playState: PlayState,
    targetNodeId: number | null,
    cueKey: string | null,
    options: ArrivalCueOptions = {},
  ) {
    if (cueKey && shownArrivalCueKeys.has(cueKey)) {
      return;
    }
    const nodes = getWorldNodes(world);
    const node = targetNodeId == null ? null : nodes?.[targetNodeId];
    const title = options.revealActualTitle
      ? getNodeTitle(node) || "Okänd plats"
      : getVisibleNodeTitle(playState, node, "Okänd plats");
    if (!title) {
      return;
    }

    if (!refs.playArrivalCueText || !refs.playArrivalCue) {
      return;
    }

    refs.playArrivalCueText.textContent = title;
    refs.playArrivalCue.classList.remove("play-arrival-cue--animate");
    void refs.playArrivalCue.offsetWidth;
    refs.playArrivalCue.classList.add("play-arrival-cue--animate");
    rememberCue(cueKey);
  }

  function getWorldNodes(
    world: World | null | undefined,
  ): Array<(NodeLike & { id?: number }) | undefined> {
    const features = world?.features as
      | { nodes?: Array<(NodeLike & { id?: number }) | undefined> }
      | null
      | undefined;
    return Array.isArray(features?.nodes) ? features.nodes : [];
  }

  function rememberCue(cueKey) {
    if (!cueKey) {
      return;
    }
    shownArrivalCueKeys.add(cueKey);
    if (shownArrivalCueKeys.size <= 24) {
      return;
    }
    const firstKey = shownArrivalCueKeys.values().next().value;
    if (firstKey) {
      shownArrivalCueKeys.delete(firstKey);
    }
  }

  function resetTravelCueTracking() {
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
  }

  function hideArrivalCue() {
    if (!refs.playArrivalCue || !refs.playArrivalCueText) {
      return;
    }
    refs.playArrivalCue.classList.remove("play-arrival-cue--animate");
    refs.playArrivalCueText.textContent = "";
  }

  function syncJourneyEventDialog(
    playState,
    isJourney,
    presentation: JourneyPresentationSnapshot = {},
    world: World | null = null,
  ) {
    const dialog = refs.playJourneyEventDialog;
    const body = refs.playJourneyEventBody;
    if (!dialog || !body) {
      return;
    }

    const event = playState?.pendingJourneyEvent ?? null;
    const isEncounterTurn = event?.type === "encounter-turn";
    const encounterId = String(event?.encounterId ?? "");
    if (
      isEncounterTurn &&
      encounterId.length > 0 &&
      lastEncounterActionMenuEncounterId !== encounterId
    ) {
      lastEncounterActionMenuEncounterId = encounterId;
      if (!state.playActionMenuOpen) {
        state.playActionMenuOpen = true;
      }
    }
    const shouldShowEncounterDialog =
      !isEncounterTurn || Boolean(state.playActionMenuOpen);
    const requiresEncounterIntro =
      isEncounterTurn && isJourney && Boolean(playState?.travel);
    const introReady =
      !requiresEncounterIntro ||
      (encounterId.length <= 0
        ? true
        : String(presentation?.encounterId ?? "") === encounterId &&
          Boolean(presentation?.encounterIntroComplete));
    const shouldShow = Boolean(event) && introReady && shouldShowEncounterDialog;
    if (lastJourneyEventDialogVisible !== shouldShow) {
      setElementVisible(dialog, shouldShow, "grid");
      lastJourneyEventDialogVisible = shouldShow;
    }
    if (isEncounterTurn && shouldShow && encounterId.length > 0) {
      state.playPresentedEncounterId = encounterId;
    }

    if (!shouldShow) {
      lastJourneyEventDialogMessage = null;
      syncJourneyLootPanel(false, null);
      syncJourneyEncounterActions(false, false);
      syncSettlementEncounterActionMenu(false, null, world);
      dialog.classList.remove("play-journey-event-dialog--loot");
      dialog.classList.remove("play-journey-event-dialog--encounter");
      dialog.classList.remove("play-journey-event-dialog--settlement-encounter");
      dialog.classList.remove("play-journey-event-dialog--actions-open");
      if (!isEncounterTurn) {
        lastEncounterActionMenuEncounterId = null;
      }
      clearAutoClearJourneyEventTimer();
      return;
    }

    const message = String(event.message ?? "Nu är du här.");
    if (message !== lastJourneyEventDialogMessage) {
      body.textContent = message;
      lastJourneyEventDialogMessage = message;
    }

    const lootInventory = getLootInventory(playState);
    const showLootPanel = Boolean(lootInventory);
    const showEncounterActions = event?.type === "encounter-turn";
    if (!showEncounterActions) {
      lastEncounterActionMenuEncounterId = null;
    }
    const isEncounterMenuOpen = showEncounterActions && Boolean(state.playActionMenuOpen);
    const isSettlementEncounter =
      showEncounterActions && playState?.encounter?.type === "settlement-group";
    const canAttack =
      showEncounterActions &&
      Boolean(event?.canAttack);
    dialog.classList.toggle("play-journey-event-dialog--loot", showLootPanel);
    dialog.classList.toggle(
      "play-journey-event-dialog--encounter",
      showEncounterActions,
    );
    dialog.classList.toggle(
      "play-journey-event-dialog--settlement-encounter",
      isSettlementEncounter,
    );
    syncJourneyLootPanel(showLootPanel, lootInventory);
    syncJourneyEncounterActions(isEncounterMenuOpen, canAttack);
    syncSettlementEncounterActionMenu(isEncounterMenuOpen, playState, world);
    scheduleAutoClearJourneyEvent(event);
  }

  function syncSettlementEncounterActionMenu(
    showEncounterMenu,
    playState,
    world,
  ) {
    const dialog = refs.playJourneyEventDialog;
    const menu = refs.playJourneySettlementActions;
    const hint = refs.playJourneySettlementActionsHint;
    if (!menu) {
      return;
    }
    const isSettlementEncounter = playState?.encounter?.type === "settlement-group";
    const isHostileSettlementEncounter =
      isSettlementEncounter && playState?.encounter?.disposition === "hostile";
    const canUseTimedActions = isSettlementEncounter && !isHostileSettlementEncounter;
    const shouldShowMenu = Boolean(showEncounterMenu) && isSettlementEncounter;
    if (lastSettlementActionMenuVisible !== shouldShowMenu) {
      setElementVisible(menu, shouldShowMenu, "grid");
      lastSettlementActionMenuVisible = shouldShowMenu;
    }
    dialog?.classList.toggle(
      "play-journey-event-dialog--actions-open",
      shouldShowMenu,
    );
    if (!shouldShowMenu) {
      if (hint) {
        setElementVisible(hint, false, "block");
      }
      lastSettlementActionHintVisible = false;
      lastSettlementActionHintMessage = null;
      return;
    }

    const huntSituation = describeHuntSituation(playState, world);
    const restDisabled =
      !canUseTimedActions ||
      Boolean(playState?.rest) ||
      Boolean(playState?.hunt) ||
      Boolean(playState?.pendingRestChoice);
    const huntDisabled =
      restDisabled ||
      normalizeStamina(playState?.stamina, 0) <= 0 ||
      !huntSituation.available;
    const restrictionReason = !isSettlementEncounter
      ? "Vila och jakt är endast tillgängligt i bosättningsmöten."
      : isHostileSettlementEncounter
        ? "Du kan inte vila eller jaga medan någon part är fientlig."
        : "";
    const huntReason = !huntSituation.available
      ? String(huntSituation.reason ?? "Jakt är inte tillgängligt här.")
      : "";

    for (const button of refs.playSettlementEncounterRestButtons ?? []) {
      if (!button) {
        continue;
      }
      button.disabled = restDisabled;
      if (restrictionReason.length > 0) {
        button.title = restrictionReason;
      } else if (button.hasAttribute("title")) {
        button.removeAttribute("title");
      }
    }

    for (const button of refs.playSettlementEncounterHuntButtons ?? []) {
      if (!button) {
        continue;
      }
      button.disabled = huntDisabled;
      const reason = restrictionReason || huntReason;
      if (reason.length > 0) {
        button.title = reason;
      } else if (button.hasAttribute("title")) {
        button.removeAttribute("title");
      }
    }

    const hintMessage = restrictionReason || huntReason;
    const showHint = hintMessage.length > 0;
    if (hint && lastSettlementActionHintVisible !== showHint) {
      setElementVisible(hint, showHint, "block");
      lastSettlementActionHintVisible = showHint;
    }
    if (hint && showHint && hintMessage !== lastSettlementActionHintMessage) {
      hint.textContent = hintMessage;
      lastSettlementActionHintMessage = hintMessage;
    } else if (!showHint) {
      lastSettlementActionHintMessage = null;
    }
  }

  function syncJourneyLootPanel(showLootPanel, lootInventory) {
    if (lastJourneyLootPanelVisible !== showLootPanel) {
      setElementVisible(refs.playJourneyEventLoot, showLootPanel, "grid");
      lastJourneyLootPanelVisible = showLootPanel;
    }

    if (!showLootPanel) {
      lastJourneyLootTakeAllEnabled = null;
      return;
    }

    lootInventoryGrid.render();
    const canTakeAll = !isInventoryEmpty(lootInventory);
    if (lastJourneyLootTakeAllEnabled !== canTakeAll) {
      if (refs.playJourneyEventTakeAllButton) {
        refs.playJourneyEventTakeAllButton.disabled = !canTakeAll;
      }
      lastJourneyLootTakeAllEnabled = canTakeAll;
    }
  }

  function syncJourneyEncounterActions(showActions, canAttack) {
    if (lastJourneyEncounterActionsVisible !== showActions) {
      setElementVisible(refs.playJourneyEncounterActions, showActions, "grid");
      lastJourneyEncounterActionsVisible = showActions;
    }
    if (!showActions) {
      lastJourneyEncounterCanAttack = null;
      return;
    }
    if (lastJourneyEncounterCanAttack !== canAttack) {
      lastJourneyEncounterCanAttack = canAttack;
      if (refs.playJourneyEncounterAttackButton) {
        refs.playJourneyEncounterAttackButton.disabled = !canAttack;
      }
    }
  }

  function hideJourneyEventDialog() {
    if (!refs.playJourneyEventDialog) {
      return;
    }
    setElementVisible(refs.playJourneyEventDialog, false, "grid");
    refs.playJourneyEventDialog.classList.remove("play-journey-event-dialog--loot");
    refs.playJourneyEventDialog.classList.remove(
      "play-journey-event-dialog--encounter",
    );
    refs.playJourneyEventDialog.classList.remove(
      "play-journey-event-dialog--settlement-encounter",
    );
    refs.playJourneyEventDialog.classList.remove("play-journey-event-dialog--actions-open");
    setElementVisible(refs.playJourneyEventLoot, false, "grid");
    setElementVisible(refs.playJourneyEncounterActions, false, "grid");
    setElementVisible(refs.playJourneySettlementActions, false, "grid");
    if (refs.playJourneySettlementActionsHint) {
      setElementVisible(refs.playJourneySettlementActionsHint, false, "block");
    }
    lastJourneyEventDialogVisible = false;
    lastJourneyEventDialogMessage = null;
    lastJourneyLootPanelVisible = false;
    lastJourneyLootTakeAllEnabled = null;
    lastJourneyEncounterActionsVisible = false;
    lastJourneyEncounterCanAttack = null;
    lastSettlementActionMenuVisible = false;
    lastSettlementActionHintVisible = false;
    lastSettlementActionHintMessage = null;
    lastEncounterActionMenuEncounterId = null;
    clearAutoClearJourneyEventTimer();
  }

  function syncSettlementDebugPanel(world, playState, isJourney) {
    const panel = refs.playSettlementDebug;
    const body = refs.playSettlementDebugBody;
    if (!panel || !body) {
      return;
    }
    const settlement = getCurrentSettlementDebugContext(world, playState);
    const shouldShow =
      isJourney &&
      Boolean(state.playSettlementDebugOpen) &&
      Boolean(settlement);
    if (lastSettlementDebugVisible !== shouldShow) {
      setElementVisible(panel, shouldShow, "grid");
      lastSettlementDebugVisible = shouldShow;
    }
    if (!shouldShow || !settlement) {
      lastSettlementDebugSignature = null;
      return;
    }

    const summary = buildSettlementDebugSummary(settlement);
    if (summary !== lastSettlementDebugSignature) {
      body.textContent = summary;
      lastSettlementDebugSignature = summary;
    }
  }

  function hideSettlementDebugPanel() {
    if (!refs.playSettlementDebug) {
      return;
    }
    setElementVisible(refs.playSettlementDebug, false, "grid");
    lastSettlementDebugVisible = false;
    lastSettlementDebugSignature = null;
  }

  function syncRestDialog(playState, isPlay, world) {
    const dialog = refs.playRestDialog;
    const body = refs.playRestBody;
    if (!dialog || !body) {
      return;
    }

    const restState = playState?.rest ?? null;
    const huntState = playState?.hunt ?? null;
    const isResting = Boolean(restState);
    const isHunting = Boolean(huntState);
    const needsRestChoice = Boolean(playState?.pendingRestChoice);
    const hasBlockingInteraction = Boolean(playState?.pendingJourneyEvent);
    const hasActionResult = playState?.latestHuntFeedback?.type === "result";
    const isActionMenuOpen = Boolean(state.playActionMenuOpen);
    const inNode = !playState?.travel && playState?.currentNodeId != null;
    const isPausedTravel = Boolean(playState?.travel && playState?.isTravelPaused);
    const showIdleMenu = inNode || isPausedTravel;
    const huntSituation = describeHuntSituation(playState, world);
    const shouldShow =
      isPlay &&
      !hasBlockingInteraction &&
      !hasActionResult &&
      (isResting || isHunting || needsRestChoice || (isActionMenuOpen && showIdleMenu));
    if (lastRestDialogVisible !== shouldShow) {
      setElementVisible(dialog, shouldShow, "grid");
      lastRestDialogVisible = shouldShow;
    }

    if (!shouldShow) {
      setElementVisible(body, false, "block");
      if (refs.playHuntOutlook) {
        setElementVisible(refs.playHuntOutlook, false, "block");
      }
      lastRestDialogMessage = null;
      lastHuntOutlookMessage = null;
      lastRestBodyVisible = false;
      lastHuntOutlookVisible = false;
      lastRestOptionsVisible = null;
      if (refs.playActionCancelButton) {
        setElementVisible(refs.playActionCancelButton, false, "inline-flex");
      }
      lastHuntCancelVisible = false;
      return;
    }

    if (lastRestBodyVisible !== false) {
      setElementVisible(body, false, "block");
      lastRestBodyVisible = false;
    }
    lastRestDialogMessage = null;

    const hasActiveTimedAction = isResting || isHunting;
    const optionsElement = refs.playRestOptions;
    const shouldShowOptions = !hasActiveTimedAction;
    if (optionsElement && lastRestOptionsVisible !== shouldShowOptions) {
      setElementVisible(optionsElement, shouldShowOptions, "grid");
      lastRestOptionsVisible = shouldShowOptions;
    }

    if (refs.playHuntOutlook && lastHuntOutlookVisible !== false) {
      setElementVisible(refs.playHuntOutlook, false, "block");
      lastHuntOutlookVisible = false;
    }
    lastHuntOutlookMessage = null;

    const activeRestHours = isResting ? normalizeRestHours(restState?.hours) : null;
    const activeHuntHours = isHunting ? normalizeRestHours(huntState?.hours) : null;
    const disableOtherButtons = isResting || isHunting;
    const shouldDisableHuntWhenIdle =
      needsRestChoice ||
      normalizeStamina(playState?.stamina, 0) <= 0 ||
      !huntSituation.available;
    const huntUnavailableReason = needsRestChoice
      ? "Du måste vila innan du kan jaga."
      : !huntSituation.available
        ? String(huntSituation.reason ?? "Jakt är inte tillgängligt här.")
        : "";

    if (Array.isArray(refs.playRestButtons)) {
      for (const button of refs.playRestButtons) {
        if (!button) {
          continue;
        }
        const requestedHours = normalizeRestHours(Number(button.dataset.restHours));
        const isActiveButton = isResting && requestedHours === activeRestHours;
        setElementVisible(button, shouldShowOptions, "inline-flex");
        button.textContent = isActiveButton ? "Avbryt" : getDefaultTimedActionButtonLabel(button);
        button.disabled = disableOtherButtons ? !isActiveButton : false;
        if (button.hasAttribute("title")) {
          button.removeAttribute("title");
        }
      }
    }
    if (Array.isArray(refs.playHuntButtons)) {
      for (const button of refs.playHuntButtons) {
        if (!button) {
          continue;
        }
        const requestedHours = normalizeRestHours(Number(button.dataset.huntHours));
        const isActiveButton = isHunting && requestedHours === activeHuntHours;
        setElementVisible(button, shouldShowOptions, "inline-flex");
        button.textContent = isActiveButton ? "Avbryt" : getDefaultTimedActionButtonLabel(button);
        button.disabled = disableOtherButtons
          ? !isActiveButton
          : shouldDisableHuntWhenIdle;
        if (!disableOtherButtons && huntUnavailableReason) {
          button.title = huntUnavailableReason;
        } else if (button.hasAttribute("title")) {
          button.removeAttribute("title");
        }
      }
    }

    if (refs.playActionCancelButton && lastHuntCancelVisible !== hasActiveTimedAction) {
      setElementVisible(refs.playActionCancelButton, hasActiveTimedAction, "inline-flex");
      lastHuntCancelVisible = hasActiveTimedAction;
    }
  }

  function hideRestDialog() {
    if (!refs.playRestDialog) {
      return;
    }
    setElementVisible(refs.playRestDialog, false, "grid");
    if (refs.playRestBody) {
      setElementVisible(refs.playRestBody, false, "block");
    }
    if (refs.playHuntOutlook) {
      setElementVisible(refs.playHuntOutlook, false, "block");
    }
    if (refs.playRestOptions) {
      setElementVisible(refs.playRestOptions, false, "grid");
    }
    if (refs.playActionCancelButton) {
      setElementVisible(refs.playActionCancelButton, false, "inline-flex");
    }
    if (Array.isArray(refs.playRestButtons)) {
      for (const button of refs.playRestButtons) {
        if (button) {
          setElementVisible(button, false, "flex");
          button.textContent = getDefaultTimedActionButtonLabel(button);
          button.disabled = false;
        }
      }
    }
    if (Array.isArray(refs.playHuntButtons)) {
      for (const button of refs.playHuntButtons) {
        if (button) {
          setElementVisible(button, false, "flex");
          button.textContent = getDefaultTimedActionButtonLabel(button);
          button.disabled = false;
        }
      }
    }
    lastRestDialogVisible = false;
    lastRestDialogMessage = null;
    lastHuntOutlookMessage = null;
    lastRestBodyVisible = false;
    lastHuntOutlookVisible = false;
    lastRestOptionsVisible = false;
    lastHuntCancelVisible = false;
  }

  function syncGameOverDialog(playState, isPlay) {
    const dialog = refs.playGameOverDialog;
    const body = refs.playGameOverBody;
    const stats = refs.playGameOverStats;
    if (!dialog || !body) {
      return;
    }

    const gameOver = playState?.gameOver ?? null;
    const shouldShow = isPlay && Boolean(gameOver);
    if (lastGameOverVisible !== shouldShow) {
      setElementVisible(dialog, shouldShow, "grid");
      lastGameOverVisible = shouldShow;
    }

    if (!shouldShow) {
      lastGameOverMessage = null;
      lastGameOverStatsRenderSignature = null;
      lastGameOverStatsSignature = null;
      lastComputedGameOverRecord = null;
      if (stats) {
        stats.innerHTML = "";
      }
      setElementVisible(stats, false, "grid");
      return;
    }

    const message = String(gameOver.message ?? "Du svalt ihjäl.");
    if (message !== lastGameOverMessage) {
      body.textContent = message;
      lastGameOverMessage = message;
    }

    const runStats = normalizeRunStatsForGameOver(gameOver?.stats ?? playState?.runStats);

    const runStatsSignature = buildRunStatsSignature(runStats);
    if (runStatsSignature !== lastGameOverStatsSignature) {
      lastGameOverStatsSignature = runStatsSignature;
      lastComputedGameOverRecord = updateAndLoadRunRecord(runStats);
    }

    const statsRenderSignature = buildGameOverStatsRenderSignature(
      runStats,
      lastComputedGameOverRecord,
    );
    if (stats && statsRenderSignature !== lastGameOverStatsRenderSignature) {
      renderGameOverStats(stats, runStats, lastComputedGameOverRecord);
      lastGameOverStatsRenderSignature = statsRenderSignature;
    }
    setElementVisible(stats, true, "grid");
  }

  function hideGameOverDialog() {
    if (!refs.playGameOverDialog) {
      return;
    }
    setElementVisible(refs.playGameOverDialog, false, "grid");
    if (refs.playGameOverStats) {
      refs.playGameOverStats.innerHTML = "";
    }
    setElementVisible(refs.playGameOverStats, false, "grid");
    lastGameOverVisible = false;
    lastGameOverMessage = null;
    lastGameOverStatsRenderSignature = null;
    lastGameOverStatsSignature = null;
    lastComputedGameOverRecord = null;
  }

  function takeAllLoot() {
    const playState = state.playState;
    const lootInventory = getLootInventory(playState);
    if (!playState || !lootInventory || !playState.inventory) {
      return;
    }

    const transferred = transferAllInventoryItems(lootInventory, playState.inventory);
    if (!transferred.moved) {
      return;
    }

    state.playState = withUpdatedLootInventory(
      {
        ...playState,
        inventory: transferred.targetInventory,
      },
      transferred.sourceInventory,
    );
    inventoryGrid.render(true);
    lootInventoryGrid.render(true);
  }

  function handleJourneyAgentInteraction(event: PointerEvent) {
    if (
      event.button !== 0 ||
      event.defaultPrevented ||
      state.currentMode !== "play" ||
      !state.playState ||
      state.playState.gameOver ||
      state.playState.viewMode !== "journey" ||
      !refs.playJourneyCanvas
    ) {
      return;
    }

    if (event.target instanceof Element) {
      const interactiveTarget = event.target.closest(
        ".play-journey-event-dialog, .play-rest-dialog, .play-action-result-dialog, .play-settlement-debug, button, a, input, textarea, select, [role='button']",
      );
      if (interactiveTarget) {
        return;
      }
    }

    const presentation =
      typeof journeyScene.getPresentationSnapshot === "function"
        ? journeyScene.getPresentationSnapshot()
        : {};
    const agentHits = Array.isArray(presentation?.agentHits)
      ? presentation.agentHits
      : [];
    if (!agentHits.length) {
      return;
    }

    const rect = refs.playJourneyCanvas.getBoundingClientRect();
    const canvasX =
      ((event.clientX - rect.left) / Math.max(1, rect.width)) *
      refs.playJourneyCanvas.width;
    const canvasY =
      ((event.clientY - rect.top) / Math.max(1, rect.height)) *
      refs.playJourneyCanvas.height;
    let bestHit = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const hit of agentHits) {
      if (
        !hit ||
        !Number.isFinite(hit.x) ||
        !Number.isFinite(hit.y) ||
        !Number.isFinite(hit.radius)
      ) {
        continue;
      }
      const distance = Math.hypot(canvasX - Number(hit.x), canvasY - Number(hit.y));
      if (distance > Number(hit.radius) || distance >= bestDistance) {
        continue;
      }
      bestDistance = distance;
      bestHit = hit;
    }

    if (!bestHit) {
      return;
    }

    const currentEvent = state.playState.pendingJourneyEvent;
    if (currentEvent && currentEvent.type !== "agent-greeting") {
      return;
    }

    const greeting = "hej";
    state.playState = {
      ...state.playState,
      latestAgentInteraction: greeting,
      pendingJourneyEvent: {
        type: "agent-greeting",
        nodeId:
          Number.isFinite(bestHit.settlementId) && bestHit.settlementId >= 0
            ? Number(bestHit.settlementId)
            : state.playState.currentNodeId ?? null,
        message: greeting,
        requiresAcknowledgement: false,
        agentId: String(bestHit.agentId ?? ""),
      },
    };
    syncJourneyEventDialog(state.playState, true, {});
  }

  function canDropAcrossInventories(
    payload: InventoryDragPayload,
    targetGridId: string,
    column: number,
    row: number,
  ) {
    if (!payload?.itemId || !payload?.gridId || payload.gridId === targetGridId) {
      return false;
    }

    const sourceInventory = getInventoryByGridId(payload.gridId);
    const targetInventory = getInventoryByGridId(targetGridId);
    if (!sourceInventory || !targetInventory) {
      return false;
    }

    return canTransferInventoryItem(
      sourceInventory,
      targetInventory,
      payload.itemId,
      column,
      row,
    );
  }

  function moveAcrossInventories(
    payload: InventoryDragPayload,
    targetGridId: string,
    column: number,
    row: number,
  ) {
    if (!payload?.itemId || !payload?.gridId || payload.gridId === targetGridId) {
      return false;
    }

    const sourceInventory = getInventoryByGridId(payload.gridId);
    const targetInventory = getInventoryByGridId(targetGridId);
    if (!sourceInventory || !targetInventory) {
      return false;
    }

    const transferred = transferInventoryItem(
      sourceInventory,
      targetInventory,
      payload.itemId,
      column,
      row,
    );
    if (!transferred.moved || !state.playState) {
      return false;
    }

    let nextPlayState = state.playState;
    if (payload.gridId === PLAYER_INVENTORY_GRID_ID) {
      nextPlayState = {
        ...nextPlayState,
        inventory: transferred.sourceInventory,
      };
    } else if (payload.gridId === LOOT_INVENTORY_GRID_ID) {
      nextPlayState = withUpdatedLootInventory(
        nextPlayState,
        transferred.sourceInventory,
      );
    }

    if (targetGridId === PLAYER_INVENTORY_GRID_ID) {
      nextPlayState = {
        ...nextPlayState,
        inventory: transferred.targetInventory,
      };
    } else if (targetGridId === LOOT_INVENTORY_GRID_ID) {
      nextPlayState = withUpdatedLootInventory(
        nextPlayState,
        transferred.targetInventory,
      );
    }

    state.playState = nextPlayState;
    inventoryGrid.render(true);
    lootInventoryGrid.render(true);
    return true;
  }

  function getInventoryByGridId(gridId: string): InventoryState | null {
    if (gridId === PLAYER_INVENTORY_GRID_ID) {
      return state.playState?.inventory ?? null;
    }
    if (gridId === LOOT_INVENTORY_GRID_ID) {
      return getLootInventory(state.playState);
    }
    return null;
  }

  function scheduleAutoClearJourneyEvent(event) {
    if (
      !event ||
      event.type === "abandoned-loot" ||
      event.type === "encounter-loot" ||
      event.type === "encounter-turn" ||
      event.requiresAcknowledgement
    ) {
      clearAutoClearJourneyEventTimer();
      return;
    }
    const eventKey = buildJourneyEventKey(event);
    if (autoClearJourneyEventKey === eventKey && autoClearJourneyEventTimer != null) {
      return;
    }
    clearAutoClearJourneyEventTimer();
    autoClearJourneyEventKey = eventKey;
    autoClearJourneyEventTimer = window.setTimeout(() => {
      autoClearJourneyEventTimer = null;
      if (!state.playState?.pendingJourneyEvent) {
        autoClearJourneyEventKey = null;
        return;
      }
      if (buildJourneyEventKey(state.playState.pendingJourneyEvent) !== eventKey) {
        autoClearJourneyEventKey = null;
        return;
      }
      state.playState = {
        ...state.playState,
        pendingJourneyEvent: null,
      };
      autoClearJourneyEventKey = null;
    }, 5600);
  }

  function clearAutoClearJourneyEventTimer() {
    if (autoClearJourneyEventTimer != null) {
      window.clearTimeout(autoClearJourneyEventTimer);
      autoClearJourneyEventTimer = null;
    }
    autoClearJourneyEventKey = null;
  }
}

function syncPlayLegendButtons(playMapOptions, refs) {
  setToggleState(
    refs.playSettingsToggleBiomeLabelsButton,
    playMapOptions.showBiomeLabels,
  );
  setToggleState(
    refs.playSettingsToggleNodeLabelsButton,
    playMapOptions.showNodeLabels,
  );
  setToggleState(refs.playSettingsToggleHoverButton, playMapOptions.showHoverInspector);
}

function syncBottomHudButtons(
  playState,
  playActivePanels,
  refs,
  lastModeButtonLabel,
) {
  if (!refs.playSwitchModeButton) {
    return lastModeButtonLabel;
  }
  syncShortcutTip(
    refs.playPanelToggleInventoryButton,
    formatHudTooltip(
      "Inventarie",
      "Öppna vänsterpanelen med utrustning och föremål.",
      "I",
    ),
  );
  syncShortcutTip(
    refs.playPanelToggleCharacterButton,
    formatHudTooltip(
      "Karaktär",
      "Öppna mittenpanelen med dina stats och status.",
      "C",
    ),
  );
  syncShortcutTip(
    refs.playPanelToggleSettingsButton,
    formatHudTooltip(
      "Inställningar",
      "Öppna högerpanelen med kart- och HUD-val.",
      "S",
    ),
  );
  setToggleState(
    refs.playPanelToggleCharacterButton,
    isPlayHudPanelOpen(playActivePanels, "character"),
  );
  setToggleState(
    refs.playPanelToggleInventoryButton,
    isPlayHudPanelOpen(playActivePanels, "inventory"),
  );
  setToggleState(
    refs.playPanelToggleSettingsButton,
    isPlayHudPanelOpen(playActivePanels, "settings"),
  );
  const isJourneyModeLocked = isJourneyModeLockedForDestinationChoice(playState);
  const nextModeLabel = isJourneyModeLocked
    ? "Låst"
    : playState?.viewMode === "journey"
      ? "Karta"
      : "Spelläge";
  const modeDescription = isJourneyModeLocked
    ? "Välj en destination på kartan för att slutföra flykten."
    : playState?.viewMode === "journey"
      ? "Byt till kartläge för överblick."
      : "Byt till spelläge för att fortsätta resa.";
  const tooltipText = formatHudTooltip(nextModeLabel, modeDescription, "M");
  if (refs.playSwitchModeButton.dataset.tooltip !== tooltipText) {
    refs.playSwitchModeButton.dataset.tooltip = tooltipText;
    refs.playSwitchModeButton.title = tooltipText;
  }
  refs.playSwitchModeButton.dataset.nextMode =
    playState?.viewMode === "journey" ? "map" : "journey";
  refs.playSwitchModeButton.setAttribute("aria-label", `${nextModeLabel} (M)`);
  refs.playSwitchModeButton.disabled = isJourneyModeLocked;
  return nextModeLabel === lastModeButtonLabel ? lastModeButtonLabel : nextModeLabel;
}

function syncTravelToggleButton(playState, playActionMenuOpen, button, lastSignature) {
  if (!button) {
    return lastSignature;
  }

  const hasTravel = Boolean(playState?.travel);
  const isPaused = Boolean(playState?.isTravelPaused);
  const isResting = Boolean(playState?.rest);
  const isHunting = Boolean(playState?.hunt);
  const isEncounterTurnActive = playState?.pendingJourneyEvent?.type === "encounter-turn";
  const isHostileOpponent = playState?.encounter?.disposition === "hostile";
  const isEncounterActive =
    Boolean(playState?.encounter) ||
    playState?.pendingJourneyEvent?.type === "encounter-turn" ||
    playState?.pendingJourneyEvent?.type === "encounter-loot";
  const inNode = !hasTravel && playState?.currentNodeId != null;
  const canResume =
    hasTravel &&
    isPaused &&
    !isResting &&
    !isHunting &&
    normalizeStamina(playState?.stamina, 0) > 0 &&
    !isHostileOpponent;
  let isDisabled = false;
  let label = "Handlingar";
  let description = "Öppna eller stäng handlingar i noder.";
  let isActive = Boolean(playActionMenuOpen && inNode);

  if (isEncounterTurnActive) {
    isDisabled = false;
    label = "Handlingar";
    description = playActionMenuOpen
      ? "Stäng handlingar i mötet."
      : "Öppna handlingar i mötet.";
    isActive = Boolean(playActionMenuOpen);
  } else if (isEncounterActive) {
    isDisabled = true;
    label = "Möte";
    description = "Hantera mötet i dialogen för att fortsätta färden.";
    isActive = true;
  } else if (isResting) {
    isDisabled = true;
    label = "Vilar";
    description = "Vilan pågår och kan avbrytas i dialogen.";
    isActive = true;
  } else if (isHunting) {
    isDisabled = true;
    label = "Jagar";
    description = "Jakten pågår och kan avbrytas i dialogen.";
    isActive = true;
  } else if (hasTravel) {
    if (isPaused) {
      label = "Fortsätt";
      description = canResume
        ? "Fortsätt resan från paus."
        : isHostileOpponent
          ? "Du kan inte fortsätta färden medan motståndaren är fientlig."
          : "Vila krävs innan resan kan fortsätta.";
      isDisabled = !canResume;
      isActive = true;
    } else {
      label = "Pausa";
      description = "Pausa resan och öppna handlingar.";
      isDisabled = false;
      isActive = false;
    }
  } else if (!inNode) {
    isDisabled = true;
    label = "Låst";
    description = "Handlingar är tillgängliga i noder.";
  }

  const tooltip = formatHudTooltip(label, description, "Space");

  const signature = [
    hasTravel ? "travel" : "idle",
    isPaused ? "paused" : "moving",
    isResting ? "resting" : "not-resting",
    isHunting ? "hunting" : "not-hunting",
    isDisabled ? "disabled" : "enabled",
    isActive ? "active" : "inactive",
    label,
    description,
  ].join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }

  button.title = tooltip;
  button.dataset.tooltip = tooltip;
  button.setAttribute("aria-label", `${label} (Space)`);
  button.disabled = isDisabled;
  button.dataset.active = isActive ? "true" : "false";
  return signature;
}

function syncHudPanelsVisibility(showBottomHud, playActivePanels, refs) {
  const panels = [
    [refs.playPanelCharacter, "character"],
    [refs.playPanelInventory, "inventory"],
    [refs.playPanelSettings, "settings"],
  ];
  for (const [panelRef, panelName] of panels) {
    const displayMode = panelName === "character" ? "block" : "flex";
    setElementVisible(
      panelRef,
      showBottomHud && isPlayHudPanelOpen(playActivePanels, panelName),
      displayMode,
    );
  }
}

function isPlayHudPanelOpen(playActivePanels, panelName) {
  return Array.isArray(playActivePanels) && playActivePanels.includes(panelName);
}

function setToggleState(element, active) {
  if (!element) {
    return;
  }
  element.dataset.active = active ? "true" : "false";
}

function syncShortcutTip(element, tooltipText) {
  if (!element || !tooltipText) {
    return;
  }
  if (element.dataset.tooltip !== tooltipText) {
    element.dataset.tooltip = tooltipText;
  }
  if (element.title !== tooltipText) {
    element.title = tooltipText;
  }
}

function formatHudTooltip(
  name: string,
  description: string,
  hotkey: string,
): string {
  return `${name}\n${description}\nHotkey: ${hotkey}`;
}

function syncJourneyVitals(
  staminaElement,
  hungerElement,
  injuryElement,
  foodCountElement,
  bulletsCountElement,
  playState,
  lastSignature,
) {
  if (!staminaElement || !hungerElement || !injuryElement || !foodCountElement) {
    return lastSignature;
  }
  const maxStamina = normalizeStamina(playState?.maxStamina, 60);
  const stamina = Math.min(
    maxStamina,
    normalizeStamina(playState?.stamina, maxStamina),
  );
  const foodCount = getInventoryTypeCount(playState?.inventory, "meat");
  const bulletsCount = getInventoryTypeCount(playState?.inventory, "bullets");
  const visualStamina = getInterpolatedStaminaValue(playState, stamina, maxStamina);
  const staminaRatio =
    maxStamina > 0 ? Math.max(0, Math.min(1, visualStamina / maxStamina)) : 0;
  const hungerHours = normalizeElapsedHours(playState?.hungerElapsedHours);
  const hungerStatus = resolvePlayerHungerStatus(hungerHours);
  const injuryStatus = normalizePlayerInjuryStatus(playState?.injuryStatus);
  const baseAccuracy = normalizeWeaponAccuracy(playState?.vapenTraffsakerhet, 0);
  const effectiveAccuracy = resolveEffectiveWeaponAccuracy(baseAccuracy, injuryStatus);
  const accuracyPenalty = Math.max(0, baseAccuracy - effectiveAccuracy);
  const restGainPerHour = resolveRestStaminaGainPerHour(
    injuryStatus,
    HUD_STAMINA_PER_REST_HOUR,
  );
  const restPenaltyPerHour = Math.max(0, HUD_STAMINA_PER_REST_HOUR - restGainPerHour);
  const hungerPenaltyPerHour = resolveHungerStaminaPenaltyPerHour(hungerHours);
  const hungerTooltip = buildHungerTooltip(
    hungerStatus,
    hungerHours,
    hungerPenaltyPerHour,
  );
  const injuryTooltip = buildInjuryTooltip(
    injuryStatus,
    restPenaltyPerHour,
    accuracyPenalty,
  );
  const signature = [
    `s:${visualStamina.toFixed(2)}/${maxStamina}`,
    `hs:${hungerStatus}:${hungerHours.toFixed(2)}`,
    `is:${injuryStatus}:${effectiveAccuracy}`,
    `hv:${hungerStatus !== "fed" ? 1 : 0}`,
    `iv:${injuryStatus !== "healthy" ? 1 : 0}`,
    `f:${foodCount}`,
    `b:${bulletsCount}`,
  ].join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }
  const staminaFill = staminaElement.querySelector(".play-hud-status-fill");
  if (staminaFill) {
    staminaFill.style.width = `${(staminaRatio * 100).toFixed(2)}%`;
  }
  staminaElement.dataset.tone = getStatusTone(staminaRatio);
  staminaElement.setAttribute(
    "aria-label",
    `Stamina: ${Math.round(visualStamina)} av ${maxStamina}`,
  );
  const showHungerStatus = hungerStatus !== "fed";
  const showInjuryStatus = injuryStatus !== "healthy";
  if (hungerElement.parentElement) {
    hungerElement.parentElement.style.display = showHungerStatus ? "inline-grid" : "none";
  }
  if (injuryElement.parentElement) {
    injuryElement.parentElement.style.display = showInjuryStatus ? "inline-grid" : "none";
  }
  hungerElement.dataset.tone = getHungerTone(hungerStatus);
  hungerElement.title = hungerTooltip;
  hungerElement.setAttribute("aria-label", hungerTooltip);
  injuryElement.dataset.tone = getInjuryTone(injuryStatus);
  injuryElement.title = injuryTooltip;
  injuryElement.setAttribute("aria-label", injuryTooltip);
  foodCountElement.textContent = String(foodCount);
  foodCountElement.setAttribute("aria-label", `Mat: ${foodCount}`);
  if (bulletsCountElement) {
    bulletsCountElement.textContent = String(bulletsCount);
    bulletsCountElement.setAttribute("aria-label", `Kulor: ${bulletsCount}`);
  }
  return signature;
}

function syncCharacterPanel(refs, playState, lastSignature) {
  const initiativeElement = refs.playCharacterInitiative;
  const vitalityElement = refs.playCharacterVitality;
  const staminaElement = refs.playCharacterStamina;
  const accuracyElement = refs.playCharacterAccuracy;
  const statusElement = refs.playCharacterStatus;
  if (
    !initiativeElement ||
    !vitalityElement ||
    !staminaElement ||
    !accuracyElement ||
    !statusElement
  ) {
    return lastSignature;
  }

  const initiative = normalizeStat(playState?.initiative, 0);
  const vitality = normalizeHealth(
    playState?.vitality,
    12,
  );
  const maxStamina = normalizeStamina(playState?.maxStamina, 60);
  const stamina = Math.min(
    maxStamina,
    normalizeStamina(playState?.stamina, maxStamina),
  );
  const baseAccuracy = normalizeWeaponAccuracy(
    playState?.vapenTraffsakerhet,
    0,
  );
  const effectiveAccuracy = resolveEffectiveWeaponAccuracy(
    baseAccuracy,
    playState?.injuryStatus,
  );
  const statusLine = describeCharacterStatusLine(playState);
  const signature = [
    initiative,
    vitality,
    stamina,
    maxStamina,
    effectiveAccuracy,
    statusLine,
  ].join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }

  initiativeElement.textContent = `Initiativ: ${initiative}`;
  vitalityElement.textContent = `Vitalitet: ${vitality}`;
  staminaElement.textContent = `Stamina: ${stamina}/${maxStamina}`;
  accuracyElement.textContent = `Vapenträffsäkerhet: ${effectiveAccuracy}%`;
  statusElement.textContent = `Status: ${statusLine}`;
  return signature;
}

function describeLocationTooltip(playState): string {
  if (!playState?.travel) {
    return "";
  }
  const totalDistance = Number(playState.travel.totalLength);
  const travelledDistance = Number(playState.travel.progress);
  if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
    return "";
  }
  const clampedTravelled = Math.max(0, Math.min(totalDistance, travelledDistance || 0));
  const remainingDistance = Math.max(0, totalDistance - clampedTravelled);
  return [
    "Resinformation",
    `Rest: ${formatDistanceWithUnit(clampedTravelled)}`,
    `Kvar: ${formatDistanceWithUnit(remainingDistance)}`,
  ].join("\n");
}

function getLocationProgressRatio(playState): number {
  if (!playState?.travel) {
    return 0;
  }
  const totalDistance = Number(playState.travel.totalLength);
  const travelledDistance = Number(playState.travel.progress);
  if (!Number.isFinite(totalDistance) || totalDistance <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (travelledDistance || 0) / totalDistance));
}

function getInterpolatedStaminaValue(
  playState,
  stamina: number,
  maxStamina: number,
): number {
  const clampedStamina = Math.max(0, Math.min(maxStamina, stamina));
  const fractionalHour = getFractionalWorldHourProgress(playState);
  if (fractionalHour <= 0) {
    return clampedStamina;
  }
  if (playState?.travel && !playState?.isTravelPaused && !playState?.rest && !playState?.hunt) {
    return Math.max(0, clampedStamina - fractionalHour * HUD_STAMINA_PER_TRAVEL_HOUR);
  }
  if (playState?.rest) {
    const committedRestHours = normalizeElapsedHours(playState.rest?.elapsedHours);
    const totalRestHours = normalizeRestHours(playState.rest?.hours);
    const visualRestHours = totalRestHours === CONTINUOUS_ACTION_HOURS
      ? Math.max(0, committedRestHours + fractionalHour)
      : Math.max(
          0,
          Math.min(totalRestHours, committedRestHours + fractionalHour),
        );
    const staminaGainPerHour = resolveRestStaminaGainPerHour(
      playState?.injuryStatus,
      HUD_STAMINA_PER_REST_HOUR,
    );
    return Math.min(
      maxStamina,
      clampedStamina + visualRestHours * staminaGainPerHour,
    );
  }
  if (playState?.hunt) {
    return Math.max(0, clampedStamina - fractionalHour * HUD_STAMINA_PER_HUNT_HOUR);
  }
  return clampedStamina;
}

function getFractionalWorldHourProgress(playState): number {
  const renderedElapsed = Number(playState?.renderElapsedWorldHours);
  const committedElapsed = Number(playState?.journeyElapsedHours);
  if (!Number.isFinite(renderedElapsed) || !Number.isFinite(committedElapsed)) {
    return 0;
  }
  return Math.max(0, Math.min(0.999, renderedElapsed - committedElapsed));
}

function getStatusTone(ratio: number): "normal" | "low" | "critical" {
  if (ratio <= 0.18) {
    return "critical";
  }
  if (ratio <= 0.38) {
    return "low";
  }
  return "normal";
}

function getHungerTone(status): "normal" | "low" | "critical" {
  if (status === "starving") {
    return "critical";
  }
  if (status === "hungry") {
    return "low";
  }
  return "normal";
}

function getInjuryTone(status): "normal" | "low" | "critical" {
  if (status === "severely-injured") {
    return "critical";
  }
  if (status === "injured") {
    return "low";
  }
  return "normal";
}

function describeHungerStatusLabel(status): string {
  if (status === "peckish") {
    return "Småhungrig";
  }
  if (status === "hungry") {
    return "Hungrig";
  }
  if (status === "starving") {
    return "Svältande";
  }
  return "Mätt";
}

function describeInjuryStatusLabel(status): string {
  if (status === "injured") {
    return "Skadad";
  }
  if (status === "severely-injured") {
    return "Svårt skadad";
  }
  return "Oskadad";
}

function buildHungerTooltip(status, hungerHours, staminaPenaltyPerHour): string {
  const wholeHours = Number.isFinite(hungerHours) ? Math.max(0, Math.floor(hungerHours)) : 0;
  const lines = [`Hungerstatus: ${describeHungerStatusLabel(status)}`];
  if (staminaPenaltyPerHour > 0) {
    lines.push(`Effekt: -${staminaPenaltyPerHour} stamina per timme.`);
  } else {
    lines.push("Effekt: Ingen direkt staminaförlust just nu.");
  }
  if (status === "fed") {
    lines.push("Blir Småhungrig direkt om du inte kan äta under en timme.");
    return lines.join("\n");
  }
  if (status === "peckish") {
    const hoursInStage = Math.max(0, wholeHours);
    const hoursUntilHungry = Math.max(1, 3 - hoursInStage);
    lines.push(`Till Hungrig: ${hoursUntilHungry}h.`);
    return lines.join("\n");
  }
  if (status === "hungry") {
    const hoursInStage = Math.max(0, wholeHours - 3);
    const hoursUntilStarving = Math.max(1, 3 - hoursInStage);
    lines.push(`Till Svältande: ${hoursUntilStarving}h.`);
    return lines.join("\n");
  }
  const hoursInStage = Math.max(0, wholeHours - 6);
  const hoursUntilDeath = Math.max(1, 3 - hoursInStage);
  lines.push(`Till död av svält: ${hoursUntilDeath}h.`);
  return lines.join("\n");
}

function buildInjuryTooltip(
  status,
  restPenaltyPerHour: number,
  accuracyPenalty: number,
): string {
  const lines = [`Skadestatus: ${describeInjuryStatusLabel(status)}`];
  if (status === "healthy") {
    lines.push("Effekt: Ingen negativ effekt.");
    return lines.join("\n");
  }
  lines.push(
    `Effekt: Vila återhämtar ${restPenaltyPerHour} mindre stamina per timme.`,
  );
  lines.push(`Effekt: Vapenträffsäkerhet -${accuracyPenalty}%.`);
  if (status === "severely-injured") {
    lines.push("Nästa träff dödar dig.");
  }
  return lines.join("\n");
}

function getVisibleNodeTitle(playState, node, fallbackTitle = "") {
  if (!node) {
    return fallbackTitle;
  }
  if (!isNodeDiscovered(playState, node.id)) {
    return fallbackTitle;
  }
  return getNodeTitle(node) || fallbackTitle;
}

function buildTravelCueKey(travel) {
  if (!travel) {
    return "";
  }
  return [
    travel.startNodeId ?? "-",
    travel.targetNodeId ?? "-",
    (travel.totalLength ?? 0).toFixed(4),
  ].join(":");
}

function normalizeHealth(value, fallback) {
  const fallbackValue = Math.max(1, Math.floor(fallback) || 1);
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeStamina(value, fallback) {
  const fallbackValue = Math.max(0, Math.floor(fallback) || 0);
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeStat(value, fallback = 0) {
  const fallbackValue = Math.max(0, Math.floor(fallback) || 0);
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeWeaponAccuracy(value, fallback = 0) {
  const fallbackValue = Math.max(0, Math.min(100, Math.floor(fallback) || 0));
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function describeTravelStatus(playState) {
  if (playState?.hunt) {
    return "Jagar";
  }
  if (playState?.rest) {
    return "Vilar";
  }
  if (playState?.pendingRestChoice) {
    return "Utmattad (vila krävs)";
  }
  if (playState?.travel && playState?.isTravelPaused) {
    return "Resan pausad";
  }
  if (playState?.travel) {
    return "Reser";
  }
  return "Stilla";
}

function describeCharacterStatusLine(playState) {
  const parts = [describeTravelStatus(playState)];
  const hungerStatus = resolvePlayerHungerStatus(playState?.hungerElapsedHours);
  const injuryStatus = normalizePlayerInjuryStatus(playState?.injuryStatus);
  parts.push(describeHungerStatusLabel(hungerStatus));
  parts.push(describeInjuryStatusLabel(injuryStatus));
  return parts.join(" · ");
}

function normalizeElapsedHours(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function normalizeRestHours(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wholeHours = Math.floor(value);
  if (wholeHours === CONTINUOUS_ACTION_HOURS) {
    return CONTINUOUS_ACTION_HOURS;
  }
  return Math.max(0, wholeHours);
}

function getDefaultTimedActionButtonLabel(button) {
  const cachedLabel = String(button?.dataset?.defaultLabel ?? "").trim();
  if (cachedLabel.length > 0) {
    return cachedLabel;
  }
  const resolvedLabel = String(button?.textContent ?? "").trim() || "Val";
  if (button?.dataset) {
    button.dataset.defaultLabel = resolvedLabel;
  }
  return resolvedLabel;
}

function getInventoryTypeCount(inventory, type) {
  if (!inventory || !Array.isArray(inventory.items)) {
    return 0;
  }
  let total = 0;
  for (const item of inventory.items) {
    if (item?.type !== type) {
      continue;
    }
    const count = Number.isFinite(item.count) ? Math.max(1, Math.floor(item.count)) : 1;
    total += count;
  }
  return total;
}

function buildJourneyEventKey(event) {
  if (!event) {
    return "";
  }
  return [
    String(event.type ?? ""),
    String(event.nodeId ?? ""),
    String(event.agentId ?? ""),
    String(event.encounterId ?? ""),
    String(event.message ?? ""),
  ].join("|");
}

function getLootEvent(playState) {
  const event = playState?.pendingJourneyEvent;
  return event?.type === "abandoned-loot" || event?.type === "encounter-loot"
    ? event
    : null;
}

function getLootInventory(playState) {
  return getLootEvent(playState)?.inventory ?? null;
}

function withUpdatedLootInventory(playState, nextLootInventory) {
  return updateAbandonedLootInventory(playState, nextLootInventory);
}

function isJourneyModeLockedForDestinationChoice(playState): boolean {
  const event = playState?.pendingJourneyEvent;
  return Boolean(
    playState?.viewMode === "map" &&
      event?.type === "signpost-directions" &&
      event?.requiresDestinationChoice === true,
  );
}
