import { normalizeStaminaValue } from "./normalizers";
import type { PlayState } from "../../types/play";

export function toggleTravelPause(
  playState: PlayState | null | undefined,
): PlayState | null | undefined {
  if (!playState || playState.gameOver || !playState.travel) {
    return playState;
  }
  if (playState.rest || playState.hunt) {
    return playState;
  }

  if (playState.isTravelPaused) {
    const stamina = normalizeStaminaValue(playState.stamina, 0);
    if (stamina <= 0) {
      return {
        ...playState,
        viewMode: "journey",
        isTravelPaused: true,
        travelPauseReason: "exhausted",
        pendingRestChoice: true,
        hoveredNodeId: null,
        pressedNodeId: null,
      };
    }
    return {
      ...playState,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
    };
  }

  return {
    ...playState,
    viewMode: "journey",
    isTravelPaused: true,
    travelPauseReason: "manual",
    pendingRestChoice: false,
    rest: null,
    latestHuntFeedback: null,
  };
}
