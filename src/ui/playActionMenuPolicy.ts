import type { PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

export function isEncounterTurn(playState: PlayStateLike): boolean {
  return playState?.pendingJourneyEvent?.type === "encounter-turn";
}

export function hasHostileEncounter(playState: PlayStateLike): boolean {
  return playState?.encounter?.disposition === "hostile";
}

export function isNonHostileEncounterTurn(playState: PlayStateLike): boolean {
  return (
    isEncounterTurn(playState) &&
    Boolean(playState?.encounter) &&
    !hasHostileEncounter(playState)
  );
}

export function canCloseActionMenu(playState: PlayStateLike): boolean {
  return !hasHostileEncounter(playState);
}

export function shouldForceActionMenuOpen(playState: PlayStateLike): boolean {
  return isEncounterTurn(playState) && hasHostileEncounter(playState);
}

export function isDestinationChoicePending(playState: PlayStateLike): boolean {
  const event = playState?.pendingJourneyEvent;
  return Boolean(
    event?.type === "signpost-directions" &&
      event?.requiresDestinationChoice === true,
  );
}

export function shouldKeepActionMenuOpenAfterEncounter(
  playState: PlayStateLike,
): boolean {
  if (!playState) {
    return false;
  }
  if (isDestinationChoicePending(playState)) {
    return true;
  }
  return Boolean(playState.travel && playState.isTravelPaused);
}
