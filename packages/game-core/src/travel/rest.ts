import { clamp } from "@fardvag/shared/utils";
import {
  consumeInventoryItemsByType,
  countInventoryItemsByType,
} from "../inventory";
import { withPlayActionMode } from "./actionMode";
import {
  CONTINUOUS_ACTION_HOURS,
  DEFAULT_MAX_STAMINA,
  STAMINA_PER_REST_HOUR,
} from "./constants";
import {
  normalizeHealthValue,
  normalizeElapsedHours,
  normalizeRestHours,
  normalizeStaminaValue,
} from "./normalizers";
import {
  normalizePlayerInjuryStatus,
  resolveRestStaminaGainPerHour,
} from "./playerStatus";
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
  const isContinuousRest = restHours === CONTINUOUS_ACTION_HOURS;
  if (restHours <= 0 && !isContinuousRest) {
    return withPlayActionMode(playState);
  }
  const hasTravel = Boolean(playState.travel);
  const wasTravelPaused = Boolean(playState.isTravelPaused);
  const priorPauseReason = playState.travelPauseReason ?? null;
  const clearSettlementEncounter = canClearSettlementEncounterForTimedAction(playState);
  const plannedRestHours = isContinuousRest ? 0 : restHours;
  const staminaGainPerHour = resolveRestStaminaGainPerHour(
    playState.injuryStatus,
    STAMINA_PER_REST_HOUR,
  );

  return withPlayActionMode({
    ...playState,
    hoveredNodeId: null,
    pressedNodeId: null,
    isTravelPaused: hasTravel ? true : false,
    travelPauseReason: hasTravel ? "resting" : null,
    pendingRestChoice: false,
    latestHuntFeedback: null,
    pendingJourneyEvent: clearSettlementEncounter ? null : playState.pendingJourneyEvent,
    encounter: clearSettlementEncounter ? null : playState.encounter,
    rest: {
      hours: isContinuousRest ? CONTINUOUS_ACTION_HOURS : restHours,
      elapsedHours: 0,
      staminaGain: plannedRestHours * staminaGainPerHour,
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
  const isContinuousRest = totalRestHours === CONTINUOUS_ACTION_HOURS;
  const roundedTargetHours = isContinuousRest
    ? Math.max(0, Math.floor(elapsedHours))
    : clamp(Math.round(elapsedHours), 0, totalRestHours);
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
  const isContinuousRest = totalRestHours === CONTINUOUS_ACTION_HOURS;
  const previousElapsed = Math.floor(
    normalizeElapsedHours(playState.rest.elapsedHours),
  );
  const nextElapsed = isContinuousRest
    ? previousElapsed + safeElapsedHours
    : Math.min(totalRestHours, previousElapsed + safeElapsedHours);

  if (isContinuousRest || nextElapsed < totalRestHours - 1e-6) {
    return withPlayActionMode({
      ...playState,
      rest: {
        ...playState.rest,
        hours: isContinuousRest ? CONTINUOUS_ACTION_HOURS : totalRestHours,
        elapsedHours: nextElapsed,
      },
    });
  }

  return finishRest(playState, totalRestHours, { completed: true });
}

function hasBlockingActionInteraction(playState: PlayStateLike): boolean {
  if (!playState?.pendingJourneyEvent) {
    return false;
  }
  return !canClearSettlementEncounterForTimedAction(playState);
}

function canClearSettlementEncounterForTimedAction(playState: PlayStateLike): boolean {
  if (playState?.pendingJourneyEvent?.type !== "encounter-turn") {
    return false;
  }
  if (playState?.encounter?.type !== "settlement-group") {
    return false;
  }
  return playState.encounter.disposition !== "hostile";
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
  const normalizedRestHours = normalizeRestHours(playState.rest.hours);
  const isContinuousRest = normalizedRestHours === CONTINUOUS_ACTION_HOURS;
  const totalRestHours = isContinuousRest
    ? Math.max(0, Math.floor(normalizeElapsedHours(playState.rest.elapsedHours)))
    : normalizedRestHours;
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
  const staminaGainPerHour = resolveRestStaminaGainPerHour(
    playState.injuryStatus,
    STAMINA_PER_REST_HOUR,
  );
  const requestedGain = countedHours * staminaGainPerHour;
  const nextStamina = Math.min(maxStamina, currentStamina + requestedGain);
  const actualGain = Math.max(0, nextStamina - currentStamina);
  const maxHealth = Math.max(1, normalizeHealthValue(playState.maxHealth, 1));
  const currentHealth = Math.min(
    maxHealth,
    normalizeHealthValue(playState.health, maxHealth),
  );
  const normalizedInjuryStatus = normalizePlayerInjuryStatus(playState.injuryStatus);
  const needsMedicine =
    normalizedInjuryStatus !== "healthy" || currentHealth < maxHealth;
  const availableMedicine = countInventoryItemsByType(playState.inventory, "medicine");
  const shouldUseMedicine = countedHours > 0 && needsMedicine && availableMedicine > 0;
  const consumedMedicine = shouldUseMedicine
    ? consumeInventoryItemsByType(playState.inventory, "medicine", 1)
    : null;
  const usedMedicine = Boolean(consumedMedicine && consumedMedicine.consumed > 0);
  const restSummary = options.completed
    ? `Vila klar: ${countedHours}h, +${actualGain} stamina.`
    : countedHours > 0
      ? `Vila avbruten: ${countedHours}h räknas, +${actualGain} stamina.`
      : "Vila avbruten: ingen full timme räknas (+0 stamina).";
  const hasBlockingEncounter = hasActiveEncounterInteraction(playState);
  const shouldResumeTravel =
    shouldResumeTravelAfterRest(playState.rest) && !hasBlockingEncounter;

  return withPlayActionMode({
    ...playState,
    ...(usedMedicine
      ? {
          inventory: consumedMedicine?.inventory,
          maxHealth,
          health: maxHealth,
          injuryStatus: "healthy" as const,
        }
      : {}),
    maxStamina,
    stamina: nextStamina,
    rest: null,
    isTravelPaused: hasBlockingEncounter
      ? Boolean(playState.travel)
      : shouldResumeTravel
        ? false
        : Boolean(playState.rest.priorWasTravelPaused),
    travelPauseReason: hasBlockingEncounter
      ? playState.travel
        ? "encounter"
        : (playState.travelPauseReason ?? null)
      : shouldResumeTravel
        ? null
        : playState.rest.priorWasTravelPaused
          ? (playState.rest.priorTravelPauseReason ?? "manual")
          : null,
    pendingRestChoice: false,
    latestHuntFeedback: {
      type: "result",
      text: usedMedicine
        ? `${restSummary} Du använde medicin under vilan och läkte alla skador.`
        : restSummary,
      },
  });
}

function hasActiveEncounterInteraction(playState: PlayStateLike): boolean {
  if (!playState) {
    return false;
  }
  if (playState.encounter) {
    return true;
  }
  const eventType = playState.pendingJourneyEvent?.type;
  return eventType === "encounter-turn" || eventType === "encounter-loot";
}
