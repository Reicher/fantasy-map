import { clamp } from "@fardvag/shared/utils";
import { withPlayActionMode } from "./actionMode";
import {
  DEFAULT_MAX_STAMINA,
  STAMINA_PER_REST_HOUR,
} from "./constants";
import {
  normalizeElapsedHours,
  normalizeRestHours,
  normalizeStaminaValue,
} from "./normalizers";
import type { PlayRestState, PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

export function beginRest(
  playState: PlayStateLike,
  requestedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return withPlayActionMode(playState);
  }
  if (playState.rest || playState.hunt || hasBlockingActionInteraction(playState)) {
    return withPlayActionMode(playState);
  }
  if (playState.travel && !playState.isTravelPaused && !playState.pendingRestChoice) {
    return withPlayActionMode(playState);
  }

  const restHours = normalizeRestHours(requestedHours);
  if (restHours <= 0) {
    return withPlayActionMode(playState);
  }
  const hasTravel = Boolean(playState.travel);
  const wasTravelPaused = Boolean(playState.isTravelPaused);
  const priorPauseReason = playState.travelPauseReason ?? null;

  return withPlayActionMode({
    ...playState,
    hoveredNodeId: null,
    pressedNodeId: null,
    isTravelPaused: hasTravel ? true : false,
    travelPauseReason: hasTravel ? "resting" : null,
    pendingRestChoice: false,
    latestHuntFeedback: null,
    rest: {
      hours: restHours,
      elapsedHours: 0,
      staminaGain: restHours * STAMINA_PER_REST_HOUR,
      resumeTravelOnFinish: hasTravel && !wasTravelPaused,
      priorWasTravelPaused: wasTravelPaused,
      priorTravelPauseReason: priorPauseReason,
    },
  });
}

export function cancelRest(playState: PlayStateLike): PlayStateLike {
  if (!playState || playState.gameOver || !playState.rest) {
    return withPlayActionMode(playState);
  }

  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const elapsedHours = normalizeElapsedHours(playState.rest.elapsedHours);
  const roundedTargetHours = clamp(Math.round(elapsedHours), 0, totalRestHours);
  return finishRest(playState, roundedTargetHours, {
    completed: false,
  });
}

export function advanceRest(
  playState: PlayStateLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.rest) {
    return withPlayActionMode(playState);
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return withPlayActionMode(playState);
  }

  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const previousElapsed = Math.floor(
    normalizeElapsedHours(playState.rest.elapsedHours),
  );
  const nextElapsed = Math.min(totalRestHours, previousElapsed + safeElapsedHours);

  if (nextElapsed < totalRestHours - 1e-6) {
    return withPlayActionMode({
      ...playState,
      rest: {
        ...playState.rest,
        hours: totalRestHours,
        elapsedHours: nextElapsed,
      },
    });
  }

  return finishRest(playState, totalRestHours, { completed: true });
}

function hasBlockingActionInteraction(playState: PlayStateLike): boolean {
  return Boolean(playState?.pendingJourneyEvent);
}

function shouldResumeTravelAfterRest(
  restState: PlayRestState | null | undefined,
): boolean {
  return Boolean(restState?.resumeTravelOnFinish);
}

function finishRest(
  playState: PlayStateLike,
  countedRestHours: number | null | undefined,
  options: { completed?: boolean } = {},
): PlayStateLike {
  if (!playState?.rest) {
    return withPlayActionMode(playState);
  }
  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const countedHours = clamp(
    Number.isFinite(countedRestHours) ? Math.floor(countedRestHours) : 0,
    0,
    totalRestHours,
  );
  const maxStamina = normalizeStaminaValue(
    playState.maxStamina,
    DEFAULT_MAX_STAMINA,
  );
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const requestedGain = countedHours * STAMINA_PER_REST_HOUR;
  const nextStamina = Math.min(maxStamina, currentStamina + requestedGain);
  const actualGain = Math.max(0, nextStamina - currentStamina);

  return withPlayActionMode({
    ...playState,
    maxStamina,
    stamina: nextStamina,
    rest: null,
    isTravelPaused: shouldResumeTravelAfterRest(playState.rest)
      ? false
      : Boolean(playState.rest.priorWasTravelPaused),
    travelPauseReason: shouldResumeTravelAfterRest(playState.rest)
      ? null
      : playState.rest.priorWasTravelPaused
        ? (playState.rest.priorTravelPauseReason ?? "manual")
        : null,
    pendingRestChoice: false,
    latestHuntFeedback: {
      type: "result",
      text: options.completed
        ? `Vila klar: ${countedHours}h, +${actualGain} stamina.`
        : countedHours > 0
          ? `Vila avbruten: ${countedHours}h räknas, +${actualGain} stamina.`
          : "Vila avbruten: ingen full timme räknas (+0 stamina).",
    },
  });
}
