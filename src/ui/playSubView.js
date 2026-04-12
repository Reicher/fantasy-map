import { describePlayHud } from "../game/playViewText.js?v=20260409f";
import { getNodeTitle } from "../node/model.js";
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
  let lastModeButtonLabel = null;
  let lastCharacterPrimary = null;
  let lastCharacterTime = null;
  let lastCharacterTravel = null;
  let lastInventorySignature = null;
  let activeTravelCueKey = null;
  let activeTravelTargetNodeId = null;
  let lastDestMarkerCanvasX = null;
  const shownArrivalCueKeys = new Set();

  return {
    reset,
    update,
  };

  function reset() {
    lastJourneyVisible = null;
    lastBottomHudVisible = null;
    lastLocationLine = null;
    lastModeButtonLabel = null;
    lastCharacterPrimary = null;
    lastCharacterTime = null;
    lastCharacterTravel = null;
    lastInventorySignature = null;
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
    shownArrivalCueKeys.clear();
    hideArrivalCue();
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
      resetTravelCueTracking();
      return;
    }

    const hud = describePlayHud(world, playState);
    if (refs.playLocationLine && hud.locationLine !== lastLocationLine) {
      refs.playLocationLine.textContent = hud.locationLine;
      lastLocationLine = hud.locationLine;
    }
    lastCharacterPrimary = syncLineText(
      refs.playCharacterPrimaryLine,
      buildCharacterPrimaryLine(hud),
      lastCharacterPrimary,
    );
    lastCharacterTime = syncLineText(
      refs.playCharacterTimeLine,
      `Tid på dygnet: ${formatTimeOfDay(playState.timeOfDayHours)}`,
      lastCharacterTime,
    );
    lastCharacterTravel = syncLineText(
      refs.playCharacterTravelLine,
      describeTravelLine(world, playState),
      lastCharacterTravel,
    );
    lastInventorySignature = syncInventoryList(
      refs.playInventoryList,
      buildInventoryLines(world, playState, hud),
      lastInventorySignature,
    );

    if (!isJourney) {
      hideArrivalCue();
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
        triggerArrivalCue(world, targetNodeId, cueKey);
      }

      if (destCanvasX != null) {
        lastDestMarkerCanvasX = destCanvasX;
      }
      return;
    }

    if (activeTravelCueKey && !shownArrivalCueKeys.has(activeTravelCueKey)) {
      triggerArrivalCue(world, activeTravelTargetNodeId, activeTravelCueKey);
    }
    resetTravelCueTracking();
  }

  function triggerArrivalCue(world, targetNodeId, cueKey) {
    if (cueKey && shownArrivalCueKeys.has(cueKey)) {
      return;
    }
    const nodes = world?.features?.nodes;
    const node = targetNodeId == null ? null : nodes?.[targetNodeId];
    const title = node ? getNodeTitle(node) : "";
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

function syncLineText(element, nextText, lastText) {
  if (!element) {
    return lastText;
  }
  const normalizedText = String(nextText ?? "");
  if (normalizedText !== lastText) {
    element.textContent = normalizedText;
    return normalizedText;
  }
  return lastText;
}

function describeTravelLine(world, playState) {
  const travel = playState?.travel;
  if (!travel) {
    return "Status: Vila";
  }
  const nodes = world?.features?.nodes ?? [];
  const targetNode = nodes[travel.targetNodeId];
  const targetName = targetNode ? getNodeTitle(targetNode) : "okänd plats";
  const total = Math.max(0.001, Number(travel.totalLength ?? 0));
  const progress = Math.max(0, Number(travel.progress ?? 0));
  const percent = Math.max(0, Math.min(100, Math.round((progress / total) * 100)));
  return `Status: På väg mot ${targetName} (${percent}%)`;
}

function buildInventoryLines(world, playState, hud) {
  const travel = playState?.travel;
  if (!travel) {
    return [
      "Inga föremål registrerade ännu.",
      "Besök platser för att hitta utrustning.",
    ];
  }
  const nodes = world?.features?.nodes ?? [];
  const targetNode = nodes[travel.targetNodeId];
  const targetTitle = targetNode ? getNodeTitle(targetNode) : "okänd plats";
  return [
    `Resmål: ${targetTitle}`,
    `Område: ${hud.regionName || "Mellan regioner"}`,
    "Packning: Basutrustning",
  ];
}

function syncInventoryList(listElement, lines, lastSignature) {
  if (!listElement) {
    return lastSignature;
  }
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const signature = normalizedLines.join("|");
  if (signature === lastSignature) {
    return lastSignature;
  }
  listElement.innerHTML = "";
  for (const line of normalizedLines) {
    const item = document.createElement("li");
    item.textContent = line;
    listElement.appendChild(item);
  }
  return signature;
}

function formatTimeOfDay(hours) {
  const wrapped = Number.isFinite(hours) ? ((hours % 24) + 24) % 24 : 0;
  const wholeHour = Math.floor(wrapped);
  const minutes = Math.floor((wrapped - wholeHour) * 60);
  return `${String(wholeHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildCharacterPrimaryLine(hud) {
  if (hud?.nodeTitle) {
    return `Plats: ${hud.nodeTitle}`;
  }
  if (hud?.regionName) {
    return `Område: ${hud.regionName}`;
  }
  return "Plats: Mellan regioner";
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
