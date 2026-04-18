import type { PlayActionMode, PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

export function getPlayActionMode(
  playState: PlayStateLike,
): PlayActionMode {
  if (playState?.gameOver) {
    return "game-over";
  }
  if (playState?.pendingJourneyEvent) {
    return "event";
  }
  if (playState?.rest) {
    return "resting";
  }
  if (playState?.hunt) {
    return "hunting";
  }
  if (playState?.travel) {
    return playState?.isTravelPaused ? "travel-paused" : "travel-active";
  }
  return "idle";
}

export function withPlayActionMode(
  playState: PlayState,
  options?: { force?: boolean },
): PlayState;
export function withPlayActionMode(
  playState: null | undefined,
  options?: { force?: boolean },
): null | undefined;
export function withPlayActionMode(
  playState: PlayStateLike,
  options?: { force?: boolean },
): PlayStateLike {
  if (!playState) {
    return playState;
  }
  const force = options?.force === true;
  if (playState.actionMode == null && !force) {
    return playState;
  }
  const nextActionMode = getPlayActionMode(playState);
  if (playState.actionMode === nextActionMode) {
    return playState;
  }
  return {
    ...playState,
    actionMode: nextActionMode,
  };
}

export function isWorldTimeAdvancingActionMode(
  actionMode: PlayActionMode,
): boolean {
  return (
    actionMode === "travel-active" ||
    actionMode === "resting" ||
    actionMode === "hunting"
  );
}
