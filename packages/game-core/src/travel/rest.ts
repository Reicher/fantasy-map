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
import type {
  PlayEncounterState,
  PlayJourneyEvent,
  PlayRestState,
  PlayState,
} from "@fardvag/shared/types/play";

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
  const settlementEncounterContext = getSettlementEncounterContextForTimedAction(
    playState,
  );
  const clearSettlementEncounter = Boolean(settlementEncounterContext);
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
      stopAtNextWholeHour: false,
      usedMedicine: false,
      resumeTravelOnFinish: hasTravel && !wasTravelPaused,
      priorWasTravelPaused: wasTravelPaused,
      priorTravelPauseReason: priorPauseReason,
      settlementEncounterContext,
    },
  });
}

export function cancelRest(playState: PlayStateLike): PlayStateLike {
  if (!playState || playState.gameOver || !playState.rest) {
    return withPlayActionMode(playState);
  }
  if (playState.rest.stopAtNextWholeHour) {
    return withPlayActionMode(playState);
  }
  return withPlayActionMode({
    ...playState,
    rest: {
      ...playState.rest,
      stopAtNextWholeHour: true,
    },
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

  const appliedMedicineState = maybeApplyMedicineDuringRest(playState);
  if (!appliedMedicineState?.rest) {
    return withPlayActionMode(appliedMedicineState);
  }
  const totalRestHours = normalizeRestHours(appliedMedicineState.rest.hours);
  const isContinuousRest = totalRestHours === CONTINUOUS_ACTION_HOURS;
  const shouldStopAtNextWholeHour = Boolean(
    appliedMedicineState.rest.stopAtNextWholeHour,
  );
  const hoursToAdvance = shouldStopAtNextWholeHour ? 1 : safeElapsedHours;
  const previousElapsed = Math.floor(
    normalizeElapsedHours(appliedMedicineState.rest.elapsedHours),
  );
  const nextElapsed = isContinuousRest
    ? previousElapsed + hoursToAdvance
    : Math.min(totalRestHours, previousElapsed + hoursToAdvance);
  const shouldStopNow =
    shouldStopAtNextWholeHour &&
    nextElapsed > previousElapsed;

  if (shouldStopNow) {
    return finishRest(appliedMedicineState, nextElapsed, {
      completed: false,
    });
  }

  if (isContinuousRest || nextElapsed < totalRestHours - 1e-6) {
    return withPlayActionMode({
      ...appliedMedicineState,
      rest: {
        ...appliedMedicineState.rest,
        hours: isContinuousRest ? CONTINUOUS_ACTION_HOURS : totalRestHours,
        elapsedHours: nextElapsed,
      },
    });
  }

  return finishRest(appliedMedicineState, totalRestHours, { completed: true });
}

function maybeApplyMedicineDuringRest(playState: PlayStateLike): PlayStateLike {
  if (!playState?.rest || playState.rest.usedMedicine) {
    return playState;
  }
  const maxHealth = Math.max(1, normalizeHealthValue(playState.maxHealth, 1));
  const currentHealth = Math.min(
    maxHealth,
    normalizeHealthValue(playState.health, maxHealth),
  );
  const normalizedInjuryStatus = normalizePlayerInjuryStatus(playState.injuryStatus);
  const needsMedicine =
    normalizedInjuryStatus !== "healthy" || currentHealth < maxHealth;
  if (!needsMedicine) {
    return playState;
  }
  const availableMedicine = countInventoryItemsByType(playState.inventory, "medicine");
  if (availableMedicine <= 0) {
    return playState;
  }
  const consumedMedicine = consumeInventoryItemsByType(playState.inventory, "medicine", 1);
  if (!consumedMedicine || consumedMedicine.consumed <= 0) {
    return playState;
  }
  return {
    ...playState,
    inventory: consumedMedicine.inventory,
    maxHealth,
    health: maxHealth,
    injuryStatus: "healthy",
    rest: {
      ...playState.rest,
      usedMedicine: true,
    },
  };
}

function hasBlockingActionInteraction(playState: PlayStateLike): boolean {
  if (!playState?.pendingJourneyEvent) {
    return false;
  }
  return !getSettlementEncounterContextForTimedAction(playState);
}

function getSettlementEncounterContextForTimedAction(
  playState: PlayStateLike,
): {
  pendingJourneyEvent: PlayJourneyEvent;
  encounter: PlayEncounterState;
} | null {
  if (playState?.pendingJourneyEvent?.type !== "encounter-turn") {
    return null;
  }
  if (playState?.encounter?.type !== "settlement-group") {
    return null;
  }
  if (playState.encounter.disposition === "hostile") {
    return null;
  }
  return {
    pendingJourneyEvent: { ...playState.pendingJourneyEvent },
    encounter: { ...playState.encounter },
  };
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
  const rawCountedHours = Number.isFinite(countedRestHours)
    ? Math.max(0, Math.floor(countedRestHours))
    : 0;
  const totalRestHours = isContinuousRest
    ? Math.max(
        0,
        Math.max(
          Math.floor(normalizeElapsedHours(playState.rest.elapsedHours)),
          rawCountedHours,
        ),
      )
    : normalizedRestHours;
  const countedHours = clamp(
    rawCountedHours,
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
  const medicineAlreadyUsed = Boolean(playState.rest?.usedMedicine);
  const availableMedicine = countInventoryItemsByType(playState.inventory, "medicine");
  const shouldUseMedicine =
    !medicineAlreadyUsed &&
    countedHours > 0 &&
    needsMedicine &&
    availableMedicine > 0;
  const consumedMedicine = shouldUseMedicine
    ? consumeInventoryItemsByType(playState.inventory, "medicine", 1)
    : null;
  const usedMedicine =
    medicineAlreadyUsed ||
    Boolean(consumedMedicine && consumedMedicine.consumed > 0);
  const restSummary = options.completed
    ? `Vila klar: ${countedHours}h, +${actualGain} stamina.`
    : countedHours > 0
      ? `Vila avbruten: ${countedHours}h räknas, +${actualGain} stamina.`
      : "Vila avbruten: ingen full timme räknas (+0 stamina).";
  const restoredSettlementEncounterContext = resolveRestoredSettlementEncounterContext(
    playState,
    playState.rest?.settlementEncounterContext,
  );
  const hasBlockingEncounter =
    hasActiveEncounterInteraction(playState) ||
    Boolean(restoredSettlementEncounterContext);
  const shouldResumeTravel =
    shouldResumeTravelAfterRest(playState.rest) && !hasBlockingEncounter;

  return withPlayActionMode({
    ...playState,
    ...(!medicineAlreadyUsed && usedMedicine
      ? {
          inventory: consumedMedicine?.inventory,
          maxHealth,
          health: maxHealth,
          injuryStatus: "healthy" as const,
        }
      : {}),
    pendingJourneyEvent:
      restoredSettlementEncounterContext?.pendingJourneyEvent ??
      playState.pendingJourneyEvent ??
      null,
    encounter:
      restoredSettlementEncounterContext?.encounter ??
      playState.encounter ??
      null,
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

function resolveRestoredSettlementEncounterContext(
  playState: PlayStateLike,
  settlementEncounterContext:
    | {
        pendingJourneyEvent?: PlayJourneyEvent | null;
        encounter?: PlayEncounterState | null;
      }
    | null
    | undefined,
): {
  pendingJourneyEvent: PlayJourneyEvent;
  encounter: PlayEncounterState;
} | null {
  if (!settlementEncounterContext) {
    return null;
  }
  if (playState?.pendingJourneyEvent || playState?.encounter) {
    return null;
  }
  if (
    settlementEncounterContext.pendingJourneyEvent?.type !== "encounter-turn" ||
    settlementEncounterContext.encounter?.type !== "settlement-group"
  ) {
    return null;
  }
  return {
    pendingJourneyEvent: { ...settlementEncounterContext.pendingJourneyEvent },
    encounter: { ...settlementEncounterContext.encounter },
  };
}
