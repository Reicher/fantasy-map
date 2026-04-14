import { describePlayHud } from "../game/playViewText";
import {
  canTransferInventoryItem,
  isInventoryEmpty,
  transferAllInventoryItems,
  transferInventoryItem,
} from "../game/inventory";
import {
  describeHuntSituation,
  updateAbandonedLootInventory,
} from "../game/travel";
import { isNodeDiscovered } from "../game/travel/selectors";
import { getNodeTitle } from "../node/model";
import { createInventoryGridController } from "./inventoryGrid";
import { setElementVisible } from "./viewState";
import type { PlaySubViewDeps } from "../types/runtime";
import type { InventoryDragPayload, InventoryState } from "../types/inventory";

const PLAYER_INVENTORY_GRID_ID = "player-inventory";
const LOOT_INVENTORY_GRID_ID = "journey-loot";
const GAME_OVER_RECORD_STORAGE_KEY = "fardvag.play.run-record.v1";
const KILOMETERS_PER_CELL = 1;

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  profiler,
}: PlaySubViewDeps) {
  let lastJourneyVisible = null;
  let lastBottomHudVisible = null;
  let lastLocationLine = null;
  let lastJourneyVitalsSignature = null;
  let lastCharacterPanelSignature = null;
  let lastModeButtonLabel = null;
  let lastTravelToggleSignature = null;
  let lastJourneyEventDialogVisible = null;
  let lastJourneyEventDialogMessage = null;
  let lastJourneyLootPanelVisible = null;
  let lastJourneyLootTakeAllEnabled = null;
  let lastRestDialogVisible = null;
  let lastRestDialogMessage = null;
  let lastHuntOutlookMessage = null;
  let lastRestBodyVisible = null;
  let lastHuntOutlookVisible = null;
  let lastRestOptionsVisible = null;
  let lastHuntCancelVisible = null;
  let lastActionResultDialogVisible = null;
  let lastActionResultMessage = null;
  let lastGameOverVisible = null;
  let lastGameOverMessage = null;
  let lastGameOverStatsText = null;
  let lastGameOverStatsSignature = null;
  let lastGameOverRecordText = null;
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

  return {
    reset,
    update,
  };

  function reset() {
    lastJourneyVisible = null;
    lastBottomHudVisible = null;
    lastLocationLine = null;
    lastJourneyVitalsSignature = null;
    lastCharacterPanelSignature = null;
    lastModeButtonLabel = null;
    lastTravelToggleSignature = null;
    lastJourneyEventDialogVisible = null;
    lastJourneyEventDialogMessage = null;
    lastJourneyLootPanelVisible = null;
    lastJourneyLootTakeAllEnabled = null;
    lastRestDialogVisible = null;
    lastRestDialogMessage = null;
    lastHuntOutlookMessage = null;
    lastRestBodyVisible = null;
    lastHuntOutlookVisible = null;
    lastRestOptionsVisible = null;
    lastHuntCancelVisible = null;
    lastActionResultDialogVisible = null;
    lastActionResultMessage = null;
    lastGameOverVisible = null;
    lastGameOverMessage = null;
    lastGameOverStatsText = null;
    lastGameOverStatsSignature = null;
    lastGameOverRecordText = null;
    lastComputedGameOverRecord = null;
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
    clearAutoClearJourneyEventTimer();
    shownArrivalCueKeys.clear();
    hideArrivalCue();
    hideJourneyEventDialog();
    hideRestDialog();
    hideActionResultDialog();
    hideGameOverDialog();
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

    syncPlayLegendButtons(state.playMapOptions, state.renderOptions, refs);
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
      hideArrivalCue();
      hideJourneyEventDialog();
      hideRestDialog();
      hideActionResultDialog();
      hideGameOverDialog();
      resetTravelCueTracking();
      return;
    }

    const hud = describePlayHud(world, playState);
    if (refs.playLocationLine && hud.locationLine !== lastLocationLine) {
      refs.playLocationLine.textContent = hud.locationLine;
      lastLocationLine = hud.locationLine;
    }
    lastJourneyVitalsSignature = syncJourneyVitals(
      refs.playJourneyHearts,
      refs.playJourneyStamina,
      refs.playJourneyFoodCount,
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
    syncActionResultDialog(playState, isJourney);
    syncGameOverDialog(playState, isPlay);

    if (playState.gameOver) {
      hideArrivalCue();
      hideJourneyEventDialog();
      hideRestDialog();
      hideActionResultDialog();
      resetTravelCueTracking();
      return;
    }

    if (!isJourney) {
      hideArrivalCue();
      hideJourneyEventDialog();
      hideActionResultDialog();
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
    syncJourneyEventDialog(playState, isJourney);
    profiler.setSnapshot(journeyScene.getDebugSnapshot());
  }

  function maybeTriggerArrivalCue(world: any, playState: any, presentation: any = {}) {
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
    world: any,
    playState: any,
    targetNodeId: number | null,
    cueKey: string | null,
    options: any = {},
  ) {
    if (cueKey && shownArrivalCueKeys.has(cueKey)) {
      return;
    }
    const nodes = world?.features?.nodes;
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

  function syncJourneyEventDialog(playState, isJourney) {
    const dialog = refs.playJourneyEventDialog;
    const body = refs.playJourneyEventBody;
    if (!dialog || !body) {
      return;
    }

    const event = playState?.pendingJourneyEvent ?? null;
    const shouldShow = isJourney && Boolean(event);
    if (lastJourneyEventDialogVisible !== shouldShow) {
      setElementVisible(dialog, shouldShow, "grid");
      lastJourneyEventDialogVisible = shouldShow;
    }

    if (!shouldShow) {
      lastJourneyEventDialogMessage = null;
      syncJourneyLootPanel(false, null);
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
    syncJourneyLootPanel(showLootPanel, lootInventory);
    scheduleAutoClearJourneyEvent(event);
  }

  function syncJourneyLootPanel(showLootPanel, lootInventory) {
    if (refs.playJourneyEventDialog) {
      refs.playJourneyEventDialog.classList.toggle(
        "play-journey-event-dialog--loot",
        showLootPanel,
      );
    }
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

  function hideJourneyEventDialog() {
    if (!refs.playJourneyEventDialog) {
      return;
    }
    setElementVisible(refs.playJourneyEventDialog, false, "grid");
    refs.playJourneyEventDialog.classList.remove("play-journey-event-dialog--loot");
    setElementVisible(refs.playJourneyEventLoot, false, "grid");
    lastJourneyEventDialogVisible = false;
    lastJourneyEventDialogMessage = null;
    lastJourneyLootPanelVisible = false;
    lastJourneyLootTakeAllEnabled = null;
    clearAutoClearJourneyEventTimer();
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

    let message = "";
    if (isResting) {
      const totalHours = normalizeRestHours(restState?.hours);
      const elapsedHours = normalizeElapsedHours(restState?.elapsedHours);
      const remainingHours = Math.max(0, totalHours - elapsedHours);
      message = `Vilar... ${formatRestHours(remainingHours)} kvar.`;
    } else if (isHunting) {
      const totalHours = normalizeRestHours(huntState?.hours);
      const elapsedHours = normalizeElapsedHours(huntState?.elapsedHours);
      const remainingHours = Math.max(0, totalHours - elapsedHours);
      message = `Jagar... ${formatRestHours(remainingHours)} kvar.`;
    } else if (needsRestChoice) {
      message = "Staminan är slut. Du måste vila.";
    }
    const showBody = message.length > 0;
    if (lastRestBodyVisible !== showBody) {
      setElementVisible(body, showBody, "block");
      lastRestBodyVisible = showBody;
    }
    if (!showBody) {
      lastRestDialogMessage = null;
    } else if (message !== lastRestDialogMessage) {
      body.textContent = message;
      lastRestDialogMessage = message;
    }

    const optionsElement = refs.playRestOptions;
    const showOptions = !isResting && !isHunting;
    if (optionsElement && lastRestOptionsVisible !== showOptions) {
      setElementVisible(optionsElement, showOptions, "grid");
      lastRestOptionsVisible = showOptions;
    }

    const huntOutlookElement = refs.playHuntOutlook;
    const showHuntOutlook = showOptions && ((showIdleMenu && isActionMenuOpen) || needsRestChoice);
    const huntOutlookMessage = showHuntOutlook
      ? huntSituation.available
        ? huntSituation.outlook
        : huntSituation.reason
      : "";
    if (huntOutlookElement && lastHuntOutlookVisible !== showHuntOutlook) {
      setElementVisible(huntOutlookElement, showHuntOutlook, "block");
      lastHuntOutlookVisible = showHuntOutlook;
    }
    if (
      showHuntOutlook &&
      huntOutlookElement &&
      huntOutlookMessage !== lastHuntOutlookMessage
    ) {
      huntOutlookElement.textContent = huntOutlookMessage;
      lastHuntOutlookMessage = huntOutlookMessage;
    } else if (!showHuntOutlook) {
      lastHuntOutlookMessage = null;
    }

    const showRestChoices = showOptions;
    const showHuntChoices = showOptions;

    if (Array.isArray(refs.playRestButtons)) {
      for (const button of refs.playRestButtons) {
        if (!button) {
          continue;
        }
        setElementVisible(button, showRestChoices, "inline-flex");
        button.disabled = isResting || isHunting;
      }
    }
    if (Array.isArray(refs.playHuntButtons)) {
      const disableHuntButtons =
        isResting ||
        isHunting ||
        needsRestChoice ||
        normalizeStamina(playState?.stamina, 0) <= 0 ||
        !huntSituation.available;
      for (const button of refs.playHuntButtons) {
        if (!button) {
          continue;
        }
        setElementVisible(button, showHuntChoices, "inline-flex");
        button.disabled = disableHuntButtons;
      }
    }

    const showHuntCancel = isHunting || isResting;
    if (refs.playActionCancelButton) {
      refs.playActionCancelButton.textContent = isResting ? "Avbryt vila" : "Avbryt jakt";
    }
    if (refs.playActionCancelButton && lastHuntCancelVisible !== showHuntCancel) {
      setElementVisible(
        refs.playActionCancelButton,
        showHuntCancel,
        "inline-flex",
      );
      lastHuntCancelVisible = showHuntCancel;
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
          button.disabled = false;
        }
      }
    }
    if (Array.isArray(refs.playHuntButtons)) {
      for (const button of refs.playHuntButtons) {
        if (button) {
          setElementVisible(button, false, "flex");
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

  function syncActionResultDialog(playState, isJourney) {
    const dialog = refs.playActionResultDialog;
    const body = refs.playActionResultBody;
    if (!dialog || !body) {
      return;
    }
    const resultMessage =
      playState?.latestHuntFeedback?.type === "result"
        ? String(playState.latestHuntFeedback.text ?? "")
        : "";
    const hasBlockingInteraction = Boolean(playState?.pendingJourneyEvent);
    const shouldShow = isJourney && resultMessage.length > 0 && !hasBlockingInteraction;
    if (lastActionResultDialogVisible !== shouldShow) {
      setElementVisible(dialog, shouldShow, "grid");
      lastActionResultDialogVisible = shouldShow;
    }
    if (!shouldShow) {
      lastActionResultMessage = null;
      return;
    }
    if (resultMessage !== lastActionResultMessage) {
      body.textContent = resultMessage;
      lastActionResultMessage = resultMessage;
    }
  }

  function hideActionResultDialog() {
    if (!refs.playActionResultDialog) {
      return;
    }
    setElementVisible(refs.playActionResultDialog, false, "grid");
    lastActionResultDialogVisible = false;
    lastActionResultMessage = null;
  }

  function syncGameOverDialog(playState, isPlay) {
    const dialog = refs.playGameOverDialog;
    const body = refs.playGameOverBody;
    const stats = refs.playGameOverStats;
    const record = refs.playGameOverRecord;
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
      lastGameOverStatsText = null;
      lastGameOverStatsSignature = null;
      lastGameOverRecordText = null;
      lastComputedGameOverRecord = null;
      setElementVisible(stats, false, "block");
      setElementVisible(record, false, "block");
      return;
    }

    const message = String(gameOver.message ?? "Du svalt ihjäl.");
    if (message !== lastGameOverMessage) {
      body.textContent = message;
      lastGameOverMessage = message;
    }

    const runStats = normalizeRunStatsForGameOver(gameOver?.stats ?? playState?.runStats);
    const runStatsText = formatGameOverStatsText(runStats);
    if (stats && runStatsText !== lastGameOverStatsText) {
      stats.textContent = runStatsText;
      lastGameOverStatsText = runStatsText;
    }
    setElementVisible(stats, true, "block");

    const runStatsSignature = buildRunStatsSignature(runStats);
    if (runStatsSignature !== lastGameOverStatsSignature) {
      lastGameOverStatsSignature = runStatsSignature;
      lastComputedGameOverRecord = updateAndLoadRunRecord(runStats);
    }

    const recordText = formatGameOverRecordText(lastComputedGameOverRecord);
    if (record && recordText !== lastGameOverRecordText) {
      record.textContent = recordText;
      lastGameOverRecordText = recordText;
    }
    setElementVisible(record, recordText.length > 0, "block");
  }

  function hideGameOverDialog() {
    if (!refs.playGameOverDialog) {
      return;
    }
    setElementVisible(refs.playGameOverDialog, false, "grid");
    setElementVisible(refs.playGameOverStats, false, "block");
    setElementVisible(refs.playGameOverRecord, false, "block");
    lastGameOverVisible = false;
    lastGameOverMessage = null;
    lastGameOverStatsText = null;
    lastGameOverStatsSignature = null;
    lastGameOverRecordText = null;
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
    if (!event || event.type === "abandoned-loot" || event.requiresAcknowledgement) {
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

function syncPlayLegendButtons(playMapOptions, renderOptions, refs) {
  setToggleState(
    refs.playSettingsToggleBiomeLabelsButton,
    playMapOptions.showBiomeLabels,
  );
  setToggleState(
    refs.playSettingsToggleNodeLabelsButton,
    playMapOptions.showNodeLabels,
  );
  setToggleState(refs.playSettingsToggleHoverButton, playMapOptions.showHoverInspector);
  setToggleState(refs.playSettingsToggleSnowButton, renderOptions.showSnow);
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
    refs.playPanelToggleCharacterButton,
    "Öppna/stäng karaktär (C)",
  );
  syncShortcutTip(
    refs.playPanelToggleInventoryButton,
    "Öppna/stäng inventarie (I)",
  );
  syncShortcutTip(
    refs.playPanelToggleSettingsButton,
    "Öppna/stäng inställningar (S)",
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
  const nextModeLabel = playState?.viewMode === "journey" ? "Karta" : "Resa";
  const tooltipText = `Växla till ${nextModeLabel.toLowerCase()}läge (M)`;
  if (refs.playSwitchModeButton.dataset.tooltip !== tooltipText) {
    refs.playSwitchModeButton.dataset.tooltip = tooltipText;
    refs.playSwitchModeButton.title = tooltipText;
  }
  refs.playSwitchModeButton.disabled = false;
  if (lastModeButtonLabel !== nextModeLabel) {
    refs.playSwitchModeButton.textContent = nextModeLabel;
    return nextModeLabel;
  }
  return lastModeButtonLabel;
}

function syncTravelToggleButton(playState, playActionMenuOpen, button, lastSignature) {
  if (!button) {
    return lastSignature;
  }

  const hasTravel = Boolean(playState?.travel);
  const isPaused = Boolean(playState?.isTravelPaused);
  const isResting = Boolean(playState?.rest);
  const isHunting = Boolean(playState?.hunt);
  const inNode = !hasTravel && playState?.currentNodeId != null;
  const canResume =
    hasTravel &&
    isPaused &&
    !isResting &&
    !isHunting &&
    normalizeStamina(playState?.stamina, 0) > 0;
  let isDisabled = false;
  let label = "Handlingar";
  let tooltip = "Öppna/stäng handlingar (A)";
  let isActive = Boolean(playActionMenuOpen && inNode);

  if (isResting) {
    isDisabled = true;
    label = "Vilar...";
    tooltip = "Vilan pågår";
    isActive = true;
  } else if (isHunting) {
    isDisabled = true;
    label = "Jagar...";
    tooltip = "Jakten pågår";
    isActive = true;
  } else if (hasTravel) {
    if (isPaused) {
      label = "Fortsätt";
      tooltip = canResume ? "Fortsätt resan" : "Vila krävs innan du kan fortsätta";
      isDisabled = !canResume;
      isActive = true;
    } else {
      label = "Pausa";
      tooltip = "Pausa resan och öppna handlingar";
      isDisabled = false;
      isActive = false;
    }
  } else if (!inNode) {
    isDisabled = true;
    tooltip = "Handlingar är tillgängliga i noder";
  }

  const signature = [
    hasTravel ? "travel" : "idle",
    isPaused ? "paused" : "moving",
    isResting ? "resting" : "not-resting",
    isHunting ? "hunting" : "not-hunting",
    isDisabled ? "disabled" : "enabled",
    isActive ? "active" : "inactive",
    label,
    tooltip,
  ].join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }

  button.textContent = label;
  button.title = tooltip;
  button.dataset.tooltip = tooltip;
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
    setElementVisible(
      panelRef,
      showBottomHud && isPlayHudPanelOpen(playActivePanels, panelName),
      "block",
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

function syncJourneyVitals(
  heartsElement,
  staminaElement,
  foodCountElement,
  playState,
  lastSignature,
) {
  if (!heartsElement || !staminaElement || !foodCountElement) {
    return lastSignature;
  }
  const maxHealth = normalizeHealth(playState?.maxHealth, 3);
  const health = Math.min(maxHealth, normalizeHealth(playState?.health, maxHealth));
  const maxStamina = normalizeStamina(playState?.maxStamina, 10);
  const stamina = Math.min(
    maxStamina,
    normalizeStamina(playState?.stamina, maxStamina),
  );
  const staminaUnitMax = Math.max(1, Math.ceil(maxStamina / 5));
  const staminaUnitFill = Math.min(staminaUnitMax, Math.ceil(stamina / 5));
  const foodCount = getInventoryTypeCount(playState?.inventory, "meat");
  const signature = `${health}/${maxHealth}|stamina:${stamina}/${maxStamina}|food:${foodCount}`;
  if (signature === lastSignature) {
    return lastSignature;
  }
  heartsElement.innerHTML = "";
  staminaElement.innerHTML = "";
  heartsElement.setAttribute("aria-label", `Hälsa: ${health} av ${maxHealth}`);
  staminaElement.setAttribute(
    "aria-label",
    `Stamina: ${stamina} av ${maxStamina}`,
  );
  for (let index = 0; index < maxHealth; index += 1) {
    const heart = document.createElement("span");
    heart.className = "play-character-heart";
    heart.dataset.filled = index < health ? "true" : "false";
    heart.setAttribute("aria-hidden", "true");
    heart.textContent = "♥";
    heartsElement.appendChild(heart);
  }
  for (let index = 0; index < staminaUnitMax; index += 1) {
    const orb = document.createElement("span");
    orb.className = "play-character-stamina-orb";
    orb.dataset.filled = index < staminaUnitFill ? "true" : "false";
    orb.setAttribute("aria-hidden", "true");
    staminaElement.appendChild(orb);
  }
  foodCountElement.textContent = `${foodCount} Mat`;
  foodCountElement.setAttribute("aria-label", `Mat: ${foodCount}`);
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
    normalizeHealth(playState?.maxHealth, 3),
  );
  const maxStamina = normalizeStamina(playState?.maxStamina, 10);
  const stamina = Math.min(
    maxStamina,
    normalizeStamina(playState?.stamina, maxStamina),
  );
  const vapenTraffsakerhet = normalizeWeaponAccuracy(
    playState?.vapenTraffsakerhet,
    0,
  );
  const statusLine = describeTravelStatus(playState);
  const signature = [
    initiative,
    vitality,
    stamina,
    maxStamina,
    vapenTraffsakerhet,
    statusLine,
  ].join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }

  initiativeElement.textContent = `Initiativ: ${initiative}`;
  vitalityElement.textContent = `Vitalitet: ${vitality}`;
  staminaElement.textContent = `Stamina: ${stamina}/${maxStamina}`;
  accuracyElement.textContent = `Vapenträffsäkerhet: ${vapenTraffsakerhet}%`;
  statusElement.textContent = `Status: ${statusLine}`;
  return signature;
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
    const totalHours = normalizeRestHours(playState.hunt.hours);
    const elapsedHours = normalizeElapsedHours(playState.hunt.elapsedHours);
    const remainingHours = Math.max(0, totalHours - elapsedHours);
    return `Jagar (${formatRestHours(remainingHours)} kvar)`;
  }
  if (playState?.rest) {
    const totalHours = normalizeRestHours(playState.rest.hours);
    const elapsedHours = normalizeElapsedHours(playState.rest.elapsedHours);
    const remainingHours = Math.max(0, totalHours - elapsedHours);
    return `Vilar (${formatRestHours(remainingHours)} kvar)`;
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
  return Math.max(0, Math.floor(value));
}

function formatRestHours(value) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 1) {
    return `${Math.ceil(safeValue)}h`;
  }
  return `${safeValue.toFixed(1)}h`;
}

function normalizeRunStatsForGameOver(stats) {
  return {
    meatEaten: normalizeStat(stats?.meatEaten, 0),
    travelHours: normalizeElapsedHours(stats?.travelHours),
    huntHours: normalizeElapsedHours(stats?.huntHours),
    restHours: normalizeElapsedHours(stats?.restHours),
    distanceTraveled: normalizeElapsedHours(stats?.distanceTraveled),
  };
}

function buildRunStatsSignature(stats) {
  return [
    normalizeStat(stats?.meatEaten, 0),
    normalizeElapsedHours(stats?.travelHours).toFixed(3),
    normalizeElapsedHours(stats?.huntHours).toFixed(3),
    normalizeElapsedHours(stats?.restHours).toFixed(3),
    normalizeElapsedHours(stats?.distanceTraveled).toFixed(3),
  ].join("|");
}

function formatGameOverStatsText(stats) {
  const totalHours = getRunTotalHours(stats);
  const huntShare = getHuntShare(stats);
  return [
    `Kött ätit: ${formatInteger(stats.meatEaten)}`,
    `Restid: ${formatHoursValue(stats.travelHours)}`,
    `Jakt: ${formatHoursValue(stats.huntHours)}`,
    `Vila: ${formatHoursValue(stats.restHours)}`,
    `Total tid: ${formatHoursValue(totalHours)}`,
    `Ressträcka: ${formatDistanceWithUnit(stats.distanceTraveled)}`,
    `Jaktandel: ${formatPercent(huntShare)}`,
  ].join("\n");
}

function formatGameOverRecordText(record) {
  if (!record) {
    return "";
  }
  const lines = [
    "Rekord:",
    `Kött ätit: ${formatInteger(record.meatEaten)}`,
    `Restid: ${formatHoursValue(record.travelHours)}`,
    `Jakt: ${formatHoursValue(record.huntHours)}`,
    `Vila: ${formatHoursValue(record.restHours)}`,
    `Total tid: ${formatHoursValue(record.totalHours)}`,
    `Ressträcka: ${formatDistanceWithUnit(record.distanceTraveled)}`,
  ];
  const newRecordLabels = Array.isArray(record.newRecordLabels)
    ? record.newRecordLabels.filter((label) => typeof label === "string" && label.length > 0)
    : [];
  if (newRecordLabels.length > 0) {
    lines.push(`Nytt rekord: ${newRecordLabels.join(", ")}`);
  }
  return lines.join("\n");
}

function updateAndLoadRunRecord(stats) {
  const runStats = normalizeRunStatsForGameOver(stats);
  const runTotalHours = getRunTotalHours(runStats);
  const currentRecord = loadRunRecord() ?? createEmptyRunRecord();
  const nextRecord = {
    ...currentRecord,
  };
  const newRecordLabels = [];

  if (runStats.meatEaten > currentRecord.meatEaten) {
    nextRecord.meatEaten = runStats.meatEaten;
    newRecordLabels.push("kött");
  }
  if (runStats.travelHours > currentRecord.travelHours + 1e-9) {
    nextRecord.travelHours = runStats.travelHours;
    newRecordLabels.push("restid");
  }
  if (runStats.huntHours > currentRecord.huntHours + 1e-9) {
    nextRecord.huntHours = runStats.huntHours;
    newRecordLabels.push("jakt");
  }
  if (runStats.restHours > currentRecord.restHours + 1e-9) {
    nextRecord.restHours = runStats.restHours;
    newRecordLabels.push("vila");
  }
  if (runTotalHours > currentRecord.totalHours + 1e-9) {
    nextRecord.totalHours = runTotalHours;
    newRecordLabels.push("total tid");
  }
  if (runStats.distanceTraveled > currentRecord.distanceTraveled + 1e-9) {
    nextRecord.distanceTraveled = runStats.distanceTraveled;
    newRecordLabels.push("ressträcka");
  }

  persistRunRecord(nextRecord);
  return {
    ...nextRecord,
    newRecordLabels,
  };
}

function loadRunRecord() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(GAME_OVER_RECORD_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeRunRecord(parsed);
  } catch {
    return null;
  }
}

function persistRunRecord(record) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      GAME_OVER_RECORD_STORAGE_KEY,
      JSON.stringify(normalizeRunRecord(record)),
    );
  } catch {
    // Ignore localStorage errors in private mode or full quota.
  }
}

function normalizeRunRecord(record) {
  const normalized = {
    distanceTraveled: normalizeElapsedHours(record?.distanceTraveled),
    meatEaten: normalizeStat(record?.meatEaten, 0),
    travelHours: normalizeElapsedHours(record?.travelHours),
    huntHours: normalizeElapsedHours(record?.huntHours),
    restHours: normalizeElapsedHours(record?.restHours),
    totalHours: normalizeElapsedHours(record?.totalHours),
  };
  if (normalized.totalHours <= 0) {
    normalized.totalHours =
      normalized.travelHours + normalized.huntHours + normalized.restHours;
  }
  return normalized;
}

function createEmptyRunRecord() {
  return normalizeRunRecord(null);
}

function getRunTotalHours(stats) {
  return (
    normalizeElapsedHours(stats?.travelHours) +
    normalizeElapsedHours(stats?.huntHours) +
    normalizeElapsedHours(stats?.restHours)
  );
}

function getHuntShare(stats) {
  const totalHours = getRunTotalHours(stats);
  if (totalHours <= 0) {
    return 0;
  }
  return normalizeElapsedHours(stats?.huntHours) / totalHours;
}

function formatHoursValue(value) {
  const safeValue = normalizeElapsedHours(value);
  return `${safeValue.toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} h`;
}

function formatDistanceWithUnit(value) {
  const safeValue = normalizeElapsedHours(value);
  const distanceKm = safeValue * KILOMETERS_PER_CELL;
  return `${distanceKm.toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} km`;
}

function formatInteger(value) {
  return normalizeStat(value, 0).toLocaleString("sv-SE");
}

function formatPercent(value) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${(safeValue * 100).toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}%`;
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
    String(event.message ?? ""),
  ].join("|");
}

function getLootEvent(playState) {
  const event = playState?.pendingJourneyEvent;
  return event?.type === "abandoned-loot" ? event : null;
}

function getLootInventory(playState) {
  return getLootEvent(playState)?.inventory ?? null;
}

function withUpdatedLootInventory(playState, nextLootInventory) {
  return updateAbandonedLootInventory(playState, nextLootInventory);
}
