import { describePlayHud } from "../game/playViewText.js?v=20260409f";
import { getNodeTitle } from "../nodeModel.js";
import { setElementVisible } from "./viewState.js?v=20260403a";

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  clearHover,
  profiler,
}) {
  let lastJourneyVisible = null;
  let lastMapLegendVisible = null;
  let lastBottomHudVisible = null;
  let lastLocationLine = null;
  let lastModeButtonLabel = null;
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
    lastMapLegendVisible = null;
    lastBottomHudVisible = null;
    lastLocationLine = null;
    lastModeButtonLabel = null;
    activeTravelCueKey = null;
    activeTravelTargetNodeId = null;
    lastDestMarkerCanvasX = null;
    shownArrivalCueKeys.clear();
    hideArrivalCue();
  }

  function update(world, playState) {
    const isPlay = state.currentMode === "play";
    const isJourney = isPlay && playState?.viewMode === "journey";
    const showMapLegend = isPlay && playState?.viewMode === "map";
    const showBottomHud = isPlay && Boolean(playState);

    if (lastJourneyVisible !== isJourney) {
      setElementVisible(refs.playCanvas, !isJourney, "block");
      setElementVisible(refs.playJourneyPanel, isJourney, "flex");
      lastJourneyVisible = isJourney;
    }

    if (lastMapLegendVisible !== showMapLegend) {
      setElementVisible(refs.playMapLegend, showMapLegend, "flex");
      lastMapLegendVisible = showMapLegend;
      if (!showMapLegend) {
        clearHover(refs.playTooltip);
      }
    }

    if (lastBottomHudVisible !== showBottomHud) {
      setElementVisible(refs.playBottomHud, showBottomHud, "flex");
      lastBottomHudVisible = showBottomHud;
    }

    syncPlayLegendButtons(state.playMapOptions, refs);
    lastModeButtonLabel = syncBottomHudButtons(
      playState,
      refs,
      lastModeButtonLabel,
    );

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

function syncPlayLegendButtons(playMapOptions, refs) {
  refs.playToggleBiomeLabelsButton.dataset.active =
    playMapOptions.showBiomeLabels ? "true" : "false";
  refs.playToggleNodeLabelsButton.dataset.active =
    playMapOptions.showNodeLabels ? "true" : "false";
  refs.playToggleHoverButton.dataset.active = playMapOptions.showHoverInspector
    ? "true"
    : "false";
}

function syncBottomHudButtons(playState, refs, lastModeButtonLabel) {
  if (!refs.playSwitchModeButton) {
    return lastModeButtonLabel;
  }
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
