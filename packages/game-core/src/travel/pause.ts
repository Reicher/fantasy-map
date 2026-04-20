import { normalizeStaminaValue } from "./normalizers";
import { withPlayActionMode } from "./actionMode";
import type { PlayState } from "@fardvag/shared/types/play";

export function toggleTravelPause(
  playState: PlayState | null | undefined,
): PlayState | null | undefined {
  if (!playState || playState.gameOver || !playState.travel) {
    return withPlayActionMode(playState);
  }
  if (playState.rest || playState.hunt) {
    return withPlayActionMode(playState);
  }

  if (playState.isTravelPaused) {
    if (playState.encounter?.disposition === "hostile") {
      return withPlayActionMode({
        ...playState,
        isTravelPaused: true,
        travelPauseReason: "encounter",
      });
    }
    const stamina = normalizeStaminaValue(playState.stamina, 0);
    if (stamina <= 0) {
      return withPlayActionMode({
        ...playState,
        viewMode: "journey",
        isTravelPaused: true,
        travelPauseReason: "exhausted",
        pendingRestChoice: true,
        hoveredNodeId: null,
        pressedNodeId: null,
      });
    }
    return withPlayActionMode({
      ...playState,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
    });
  }

  return withPlayActionMode({
    ...playState,
    viewMode: "journey",
    isTravelPaused: true,
    travelPauseReason: "manual",
    pendingRestChoice: false,
    rest: null,
    latestHuntFeedback: null,
  });
}
