import type { PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;
interface TravelActionButtonPolicyOptions {
  blockWhenHostile?: boolean;
  hostileReason?: string;
  pauseRequiredReason?: string;
  restRequiredReason?: string;
}

interface TravelActionVisibilityOptions {
  inNode?: boolean;
}

export interface TravelActionButtonPolicy {
  label: "Fortsätt resa" | "Planera resa";
  disabled: boolean;
  reason: string;
}

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

export function shouldShowTravelActionInIdleMenu(
  playState: PlayStateLike,
  options: TravelActionVisibilityOptions = {},
): boolean {
  const inNode = Boolean(options.inNode);
  return Boolean(playState?.travel && playState?.isTravelPaused) || inNode;
}

export function resolveTravelActionButtonPolicy(
  playState: PlayStateLike,
  options: TravelActionButtonPolicyOptions = {},
): TravelActionButtonPolicy {
  const hasTravel = Boolean(playState?.travel);
  const isPaused = Boolean(playState?.isTravelPaused);
  const hasTimedAction = Boolean(playState?.rest || playState?.hunt);
  const needsRestChoice = Boolean(playState?.pendingRestChoice);
  const stamina = Number.isFinite(playState?.stamina) ? Number(playState?.stamina) : 0;
  const shouldBlockWhenHostile = Boolean(options.blockWhenHostile);
  const blockedByHostileEncounter = shouldBlockWhenHostile && hasHostileEncounter(playState);
  const label: TravelActionButtonPolicy["label"] = hasTravel
    ? "Fortsätt resa"
    : "Planera resa";
  let disabled = false;
  let reason = "";

  if (blockedByHostileEncounter) {
    disabled = true;
    reason =
      options.hostileReason ??
      "Du kan inte planera eller fortsätta resan medan någon part är fientlig.";
  } else if (hasTravel && !isPaused) {
    disabled = true;
    reason = options.pauseRequiredReason ?? "Resan måste vara pausad innan den kan fortsätta.";
  } else if (hasTravel && (hasTimedAction || needsRestChoice || stamina <= 0)) {
    disabled = true;
    reason = options.restRequiredReason ?? "Vila krävs innan resan kan fortsätta.";
  }

  return {
    label,
    disabled,
    reason,
  };
}
