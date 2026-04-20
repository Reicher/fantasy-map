import { consumeInventoryItemsByType } from "../inventory";
import { withPlayActionMode } from "./actionMode";
import {
  DEFAULT_MAX_STAMINA,
  STAMINA_PER_TRAVEL_HOUR,
} from "./constants";
import {
  normalizeElapsedHours,
  normalizeStaminaValue,
} from "./normalizers";
import {
  isPlayerStarved,
  normalizeHungerElapsedHours,
  normalizePlayerInjuryStatus,
  resolveHungerStaminaPenaltyPerHour,
  resolvePlayerHungerStatus,
} from "./playerStatus";
import { normalizeRunStats, snapshotRunStats } from "./runStats";
import type { PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

export function applyHourlyHunger(
  playState: PlayStateLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return withPlayActionMode(playState);
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return withPlayActionMode(playState);
  }
  let inventory = playState.inventory;
  let hungerElapsedHours = normalizeHungerElapsedHours(playState.hungerElapsedHours);
  const runStats = normalizeRunStats(playState.runStats);
  let meatEaten = 0;
  const maxStamina = normalizeStaminaValue(
    playState.maxStamina,
    DEFAULT_MAX_STAMINA,
  );
  let stamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );

  for (let hour = 0; hour < safeElapsedHours; hour += 1) {
    const meal = consumeInventoryItemsByType(inventory, "meat", 1);
    inventory = meal.inventory;
    if (meal.consumed > 0) {
      hungerElapsedHours = 0;
      meatEaten += meal.consumed;
    } else {
      hungerElapsedHours += 1;
    }
    const hungerPenalty = resolveHungerStaminaPenaltyPerHour(hungerElapsedHours);
    if (hungerPenalty > 0) {
      stamina = Math.max(0, stamina - hungerPenalty);
    }
  }

  const nextRunStats =
    meatEaten > 0
      ? {
          ...runStats,
          meatEaten: runStats.meatEaten + meatEaten,
        }
      : runStats;
  const nextState: PlayState = {
    ...playState,
    inventory,
    maxStamina,
    stamina,
    hungerElapsedHours,
    hungerStatus: resolvePlayerHungerStatus(hungerElapsedHours),
    injuryStatus: normalizePlayerInjuryStatus(playState.injuryStatus),
    runStats: nextRunStats,
  };

  if (
    nextState.travel &&
    !nextState.isTravelPaused &&
    !nextState.rest &&
    !nextState.hunt &&
    stamina <= 0
  ) {
    return withPlayActionMode({
      ...nextState,
      viewMode: "journey",
      isTravelPaused: true,
      travelPauseReason: "exhausted",
      pendingRestChoice: true,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      hoveredNodeId: null,
      pressedNodeId: null,
    });
  }

  return withPlayActionMode(nextState);
}

export function finalizeHourlySurvival(playState: PlayStateLike): PlayStateLike {
  if (!playState || playState.gameOver) {
    return withPlayActionMode(playState);
  }

  const hungerElapsedHours = normalizeHungerElapsedHours(playState.hungerElapsedHours);
  const hungerStatus = resolvePlayerHungerStatus(hungerElapsedHours);
  const injuryStatus = normalizePlayerInjuryStatus(playState.injuryStatus);

  if (!isPlayerStarved(hungerElapsedHours)) {
    if (
      playState.hungerElapsedHours === hungerElapsedHours &&
      playState.hungerStatus === hungerStatus &&
      playState.injuryStatus === injuryStatus
    ) {
      return withPlayActionMode(playState);
    }
    return withPlayActionMode({
      ...playState,
      hungerElapsedHours,
      hungerStatus,
      injuryStatus,
    });
  }

  return withPlayActionMode({
    ...playState,
    hungerElapsedHours,
    hungerStatus,
    injuryStatus,
    travel: null,
    pendingJourneyEvent: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    hoveredNodeId: null,
    pressedNodeId: null,
    gameOver: {
      reason: "starved",
      message: "Du svalt ihjäl.",
      stats: snapshotRunStats(playState.runStats),
    },
  });
}

export function applyHourlyTravelStamina(
  playState: PlayStateLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return withPlayActionMode(playState);
  }
  if (
    !playState.travel ||
    playState.isTravelPaused ||
    playState.rest ||
    playState.hunt
  ) {
    return withPlayActionMode(playState);
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return withPlayActionMode(playState);
  }

  const previousElapsed = Math.floor(
    normalizeElapsedHours(playState.staminaElapsedHours),
  );
  const nextElapsed = previousElapsed + safeElapsedHours;
  const staminaTicks = Math.max(
    0,
    Math.floor(nextElapsed + 1e-9) - Math.floor(previousElapsed + 1e-9),
  );

  if (staminaTicks <= 0) {
    return withPlayActionMode({
      ...playState,
      staminaElapsedHours: nextElapsed,
    });
  }

  const maxStamina = normalizeStaminaValue(
    playState.maxStamina,
    DEFAULT_MAX_STAMINA,
  );
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const spentStamina = staminaTicks * STAMINA_PER_TRAVEL_HOUR;
  const nextStamina = Math.max(0, currentStamina - spentStamina);
  const nextState = {
    ...playState,
    maxStamina,
    stamina: nextStamina,
    staminaElapsedHours: nextElapsed,
  };

  if (nextStamina > 0) {
    return withPlayActionMode(nextState);
  }

  return withPlayActionMode({
    ...nextState,
    viewMode: "journey",
    isTravelPaused: true,
    travelPauseReason: "exhausted",
    pendingRestChoice: true,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    hoveredNodeId: null,
    pressedNodeId: null,
  });
}
