import { describePlayHud } from "../game/playViewText.js?v=20260412f";
import {
  canTransferInventoryItem,
  isInventoryEmpty,
  transferAllInventoryItems,
  transferInventoryItem,
} from "../game/inventory.js?v=20260412e";
import {
  describeHuntSituation,
  isNodeDiscovered,
  updateAbandonedLootInventory,
} from "../game/travel.js?v=20260413a";
import { getNodeTitle } from "../node/model.js";
import { createInventoryGridController } from "./inventoryGrid.js?v=20260412e";
import { setElementVisible } from "./viewState.js?v=20260403a";

const PLAYER_INVENTORY_GRID_ID = "player-inventory";
const LOOT_INVENTORY_GRID_ID = "journey-loot";

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  profiler,
}) {
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
      state.playActivePanel,
      refs,
      lastModeButtonLabel,
    );
    lastTravelToggleSignature = syncTravelToggleButton(
      playState,
      state.playActionMenuOpen,
      refs.playToggleTravelButton,
      lastTravelToggleSignature,
    );
    syncHudPanelsVisibility(showBottomHud, state.playActivePanel, refs);

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

  function maybeTriggerArrivalCue(world, playState, presentation = {}) {
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
    world,
    playState,
    targetNodeId,
    cueKey,
    options = {},
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
      return;
    }

    const message = String(gameOver.message ?? "Du svalt ihjäl.");
    if (message !== lastGameOverMessage) {
      body.textContent = message;
      lastGameOverMessage = message;
    }
  }

  function hideGameOverDialog() {
    if (!refs.playGameOverDialog) {
      return;
    }
    setElementVisible(refs.playGameOverDialog, false, "grid");
    lastGameOverVisible = false;
    lastGameOverMessage = null;
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

  function canDropAcrossInventories(payload, targetGridId, column, row) {
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

  function moveAcrossInventories(payload, targetGridId, column, row) {
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

  function getInventoryByGridId(gridId) {
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
  playActivePanel,
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
  setToggleState(refs.playPanelToggleCharacterButton, playActivePanel === "character");
  setToggleState(refs.playPanelToggleInventoryButton, playActivePanel === "inventory");
  setToggleState(refs.playPanelToggleSettingsButton, playActivePanel === "settings");
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

function syncHudPanelsVisibility(showBottomHud, playActivePanel, refs) {
  const panels = [
    [refs.playPanelCharacter, "character"],
    [refs.playPanelInventory, "inventory"],
    [refs.playPanelSettings, "settings"],
  ];
  for (const [panelRef, panelName] of panels) {
    setElementVisible(panelRef, showBottomHud && playActivePanel === panelName, "block");
  }
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
  foodCountElement.textContent = String(foodCount);
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
