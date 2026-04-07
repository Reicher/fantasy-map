import { describePlayView } from "../game/playViewText.js?v=20260403a";
import { setElementVisible } from "./viewState.js?v=20260403a";

export function createPlaySubViewController({
  refs,
  state,
  journeyScene,
  clearHover,
  profiler,
}) {
  let lastJourneyVisible = null;
  let lastJourneyTitle = null;
  let lastJourneySubtitle = null;
  let lastMapLegendVisible = null;

  return {
    reset,
    update,
  };

  function reset() {
    lastJourneyVisible = null;
    lastJourneyTitle = null;
    lastJourneySubtitle = null;
    lastMapLegendVisible = null;
  }

  function update(world, playState) {
    const isPlay = state.currentMode === "play";
    const isJourney = isPlay && playState?.viewMode === "journey";
    const showMapLegend = isPlay && playState?.viewMode === "map";

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

    syncPlayLegendButtons(state.playMapOptions, refs);

    if (!isPlay || !world || !playState) {
      return;
    }

    const description = describePlayView(world, playState);
    if (!isJourney) {
      return;
    }

    if (description.subtitle !== lastJourneySubtitle) {
      refs.playJourneySubtitle.textContent = description.subtitle;
      lastJourneySubtitle = description.subtitle;
    }
    if (description.title !== lastJourneyTitle) {
      refs.playJourneyTitle.textContent = description.title;
      lastJourneyTitle = description.title;
    }
    profiler.measure("journey-update", () => {
      journeyScene.update(playState);
    });
    profiler.setSnapshot(journeyScene.getDebugSnapshot());
  }
}

function syncPlayLegendButtons(playMapOptions, refs) {
  refs.playToggleBiomeLabelsButton.dataset.active =
    playMapOptions.showBiomeLabels ? "true" : "false";
  refs.playToggleCityLabelsButton.dataset.active = playMapOptions.showCityLabels
    ? "true"
    : "false";
  refs.playToggleHoverButton.dataset.active = playMapOptions.showHoverInspector
    ? "true"
    : "false";
}
