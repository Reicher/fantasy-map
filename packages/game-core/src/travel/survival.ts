import { consumeInventoryItemsByType } from "../inventory";
import {
  DEFAULT_MAX_HEALTH,
  DEFAULT_MAX_STAMINA,
  STAMINA_PER_TRAVEL_HOUR,
} from "./constants";
import {
  normalizeElapsedHours,
  normalizeHealthValue,
  normalizeStaminaValue,
} from "./normalizers";
import { normalizeRunStats, snapshotRunStats } from "./runStats";
import type { PlayState } from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

export function applyHourlyHunger(
  playState: PlayStateLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }
  const runStats = normalizeRunStats(playState.runStats);

  const previousElapsed = Number.isFinite(playState.hungerElapsedHours)
    ? Math.max(0, Math.floor(playState.hungerElapsedHours))
    : 0;
  const nextElapsed = previousElapsed + safeElapsedHours;
  const mealsNeeded = Math.max(
    0,
    Math.floor(nextElapsed + 1e-9) - Math.floor(previousElapsed + 1e-9),
  );

  if (mealsNeeded === 0) {
    return {
      ...playState,
      hungerElapsedHours: nextElapsed,
    };
  }

  const { inventory, missing } = consumeInventoryItemsByType(
    playState.inventory,
    "meat",
    mealsNeeded,
  );
  const maxHealth = normalizeHealthValue(
    playState.maxHealth,
    DEFAULT_MAX_HEALTH,
  );
  const currentHealth = normalizeHealthValue(playState.health, maxHealth);
  const nextHealth = Math.max(0, currentHealth - missing);
  const meatEaten = Math.max(0, mealsNeeded - missing);
  const nextRunStats =
    meatEaten > 0
      ? {
          ...runStats,
          meatEaten: runStats.meatEaten + meatEaten,
        }
      : runStats;

  return {
    ...playState,
    inventory,
    hungerElapsedHours: nextElapsed,
    runStats: nextRunStats,
    maxHealth,
    health: nextHealth,
  };
}

export function finalizeHourlySurvival(playState: PlayStateLike): PlayStateLike {
  if (!playState || playState.gameOver) {
    return playState;
  }

  const maxHealth = normalizeHealthValue(
    playState.maxHealth,
    DEFAULT_MAX_HEALTH,
  );
  const health = Math.min(
    maxHealth,
    normalizeHealthValue(playState.health, maxHealth),
  );
  if (health > 0) {
    if (playState.health === health && playState.maxHealth === maxHealth) {
      return playState;
    }
    return {
      ...playState,
      maxHealth,
      health,
    };
  }

  return {
    ...playState,
    maxHealth,
    health: 0,
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
  };
}

export function applyHourlyTravelStamina(
  playState: PlayStateLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return playState;
  }
  if (
    !playState.travel ||
    playState.isTravelPaused ||
    playState.rest ||
    playState.hunt
  ) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
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
    return {
      ...playState,
      staminaElapsedHours: nextElapsed,
    };
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
    return nextState;
  }

  return {
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
  };
}
