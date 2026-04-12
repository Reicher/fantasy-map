import { describePlayHud } from "../game/playViewText.js?v=20260412e";
import { isNodeDiscovered } from "../game/travel.js?v=20260412f";
import { getNodeTitle } from "../node/model.js";
import { createInventoryGridController } from "./inventoryGrid.js?v=20260412d";
import { setElementVisible } from "./viewState.js?v=20260403a";

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  profiler,
}) {
  let lastJourneyVisible = null;
  let lastBottomHudVisible = null;
  let lastLocationLine = null;
  let lastCharacterHeartsSignature = null;
  let lastModeButtonLabel = null;
  let lastJourneyEventDialogVisible = null;
  let lastJourneyEventDialogMessage = null;
  let lastGameOverVisible = null;
  let lastGameOverMessage = null;
  let activeTravelCueKey = null;
  let activeTravelTargetNodeId = null;
  let lastDestMarkerCanvasX = null;
  const shownArrivalCueKeys = new Set();
  const inventoryGrid = createInventoryGridController({
    root: refs.playInventoryList,
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
  });

  return {
    reset,
    update,
  };

  function reset() {
    lastJourneyVisible = null;
    lastBottomHudVisible = null;
    lastLocationLine = null;
    lastCharacterHeartsSignature = null;
    lastModeButtonLabel = null;
    lastJourneyEventDialogVisible = null;
    lastJourneyEventDialogMessage = null;
    lastGameOverVisible = null;
    lastGameOverMessage = null;
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
    shownArrivalCueKeys.clear();
    hideArrivalCue();
    hideJourneyEventDialog();
    hideGameOverDialog();
    inventoryGrid.reset();
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
      state.playHudPanels,
      refs,
      lastModeButtonLabel,
    );
    syncHudPanelsVisibility(showBottomHud, state.playHudPanels, refs);

    if (!isPlay || !world || !playState) {
      hideArrivalCue();
      hideJourneyEventDialog();
      hideGameOverDialog();
      resetTravelCueTracking();
      return;
    }

    const hud = describePlayHud(world, playState);
    if (refs.playLocationLine && hud.locationLine !== lastLocationLine) {
      refs.playLocationLine.textContent = hud.locationLine;
      lastLocationLine = hud.locationLine;
    }
    lastCharacterHeartsSignature = syncCharacterHearts(
      refs.playCharacterHearts,
      playState,
      lastCharacterHeartsSignature,
    );
    inventoryGrid.render();
    syncGameOverDialog(playState, isPlay);

    if (playState.gameOver) {
      hideArrivalCue();
      hideJourneyEventDialog();
      resetTravelCueTracking();
      return;
    }

    if (!isJourney) {
      hideArrivalCue();
      hideJourneyEventDialog();
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
      setElementVisible(dialog, shouldShow, "block");
      lastJourneyEventDialogVisible = shouldShow;
    }

    if (!shouldShow) {
      lastJourneyEventDialogMessage = null;
      return;
    }

    const message = String(event.message ?? "Nu är du här.");
    if (message !== lastJourneyEventDialogMessage) {
      body.textContent = message;
      lastJourneyEventDialogMessage = message;
    }
  }

  function hideJourneyEventDialog() {
    if (!refs.playJourneyEventDialog) {
      return;
    }
    setElementVisible(refs.playJourneyEventDialog, false, "block");
    lastJourneyEventDialogVisible = false;
    lastJourneyEventDialogMessage = null;
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

function syncBottomHudButtons(playState, playHudPanels, refs, lastModeButtonLabel) {
  if (!refs.playSwitchModeButton) {
    return lastModeButtonLabel;
  }
  setToggleState(refs.playPanelToggleCharacterButton, playHudPanels?.character);
  setToggleState(refs.playPanelToggleInventoryButton, playHudPanels?.inventory);
  setToggleState(refs.playPanelToggleSettingsButton, playHudPanels?.settings);
  const nextModeLabel = playState?.viewMode === "journey" ? "Karta" : "Resa";
  const tooltipText = `Växla till ${nextModeLabel.toLowerCase()}läge (M)`;
  if (refs.playSwitchModeButton.dataset.tooltip !== tooltipText) {
    refs.playSwitchModeButton.dataset.tooltip = tooltipText;
    refs.playSwitchModeButton.title = tooltipText;
  }
  if (lastModeButtonLabel !== nextModeLabel) {
    refs.playSwitchModeButton.textContent = nextModeLabel;
    return nextModeLabel;
  }
  return lastModeButtonLabel;
}

function syncHudPanelsVisibility(showBottomHud, playHudPanels, refs) {
  const panels = [
    [refs.playPanelCharacter, playHudPanels?.character],
    [refs.playPanelInventory, playHudPanels?.inventory],
    [refs.playPanelSettings, playHudPanels?.settings],
  ];
  for (const [panelRef, isOpen] of panels) {
    setElementVisible(panelRef, showBottomHud && Boolean(isOpen), "block");
  }
}

function setToggleState(element, active) {
  if (!element) {
    return;
  }
  element.dataset.active = active ? "true" : "false";
}

function syncCharacterHearts(element, playState, lastSignature) {
  if (!element) {
    return lastSignature;
  }
  const maxHealth = normalizeHealth(playState?.maxHealth, 3);
  const health = Math.min(maxHealth, normalizeHealth(playState?.health, maxHealth));
  const signature = `${health}/${maxHealth}`;
  if (signature === lastSignature) {
    return lastSignature;
  }
  element.innerHTML = "";
  element.setAttribute("aria-label", `Hälsa: ${health} av ${maxHealth}`);
  for (let index = 0; index < maxHealth; index += 1) {
    const heart = document.createElement("span");
    heart.className = "play-character-heart";
    heart.dataset.filled = index < health ? "true" : "false";
    heart.setAttribute("aria-hidden", "true");
    heart.textContent = "♥";
    element.appendChild(heart);
  }
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
