import { clamp } from "@fardvag/shared/utils";
import type {
  PlayState,
  PlayerHungerStatus,
  PlayerInjuryStatus,
} from "@fardvag/shared/types/play";

export const HUNGER_STAGE_HOURS = 3;
export const HUNGER_FATAL_HOURS = HUNGER_STAGE_HOURS * 3;

const HUNGER_STAMINA_PENALTY_BY_STATUS: Record<PlayerHungerStatus, number> = {
  fed: 0,
  peckish: 0,
  hungry: 2,
  starving: 5,
};

const INJURY_ACCURACY_PENALTY_BY_STATUS: Record<PlayerInjuryStatus, number> = {
  healthy: 0,
  injured: 15,
  "severely-injured": 35,
};

const INJURY_REST_GAIN_MULTIPLIER_BY_STATUS: Record<PlayerInjuryStatus, number> =
  {
    healthy: 1,
    injured: 0.78,
    "severely-injured": 0.56,
  };

export function normalizeHungerElapsedHours(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

export function resolvePlayerHungerStatus(
  value: unknown,
): PlayerHungerStatus {
  const elapsedHours = normalizeHungerElapsedHours(value);
  if (elapsedHours >= HUNGER_STAGE_HOURS * 2) {
    return "starving";
  }
  if (elapsedHours >= HUNGER_STAGE_HOURS) {
    return "hungry";
  }
  if (elapsedHours >= 1) {
    return "peckish";
  }
  return "fed";
}

export function isPlayerStarved(value: unknown): boolean {
  return normalizeHungerElapsedHours(value) >= HUNGER_FATAL_HOURS;
}

export function resolveHungerStaminaPenaltyPerHour(
  value: unknown,
): number {
  const status = resolvePlayerHungerStatus(value);
  return HUNGER_STAMINA_PENALTY_BY_STATUS[status];
}

export function normalizePlayerInjuryStatus(
  value: unknown,
): PlayerInjuryStatus {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "healthy" ||
    normalized === "injured" ||
    normalized === "severely-injured"
  ) {
    return normalized;
  }
  return "healthy";
}

export function resolveRestStaminaGainPerHour(
  status: unknown,
  baseGain: number,
): number {
  const normalizedBaseGain = Math.max(1, Math.floor(Number(baseGain) || 1));
  const injuryStatus = normalizePlayerInjuryStatus(status);
  return Math.max(
    1,
    Math.floor(normalizedBaseGain * INJURY_REST_GAIN_MULTIPLIER_BY_STATUS[injuryStatus]),
  );
}

export function resolveEffectiveWeaponAccuracy(
  baseAccuracy: unknown,
  injuryStatus: unknown,
): number {
  const normalizedBaseAccuracy = Math.floor(Number(baseAccuracy) || 0);
  const penalty =
    INJURY_ACCURACY_PENALTY_BY_STATUS[normalizePlayerInjuryStatus(injuryStatus)];
  return clamp(normalizedBaseAccuracy - penalty, 0, 100);
}

export function worsenPlayerInjuryStatus(
  currentStatus: unknown,
): {
  nextStatus: PlayerInjuryStatus;
  causesDeath: boolean;
} {
  const normalizedStatus = normalizePlayerInjuryStatus(currentStatus);
  if (normalizedStatus === "healthy") {
    return {
      nextStatus: "injured",
      causesDeath: false,
    };
  }
  if (normalizedStatus === "injured") {
    return {
      nextStatus: "severely-injured",
      causesDeath: false,
    };
  }
  return {
    nextStatus: "severely-injured",
    causesDeath: true,
  };
}

export function normalizePlayerStatuses(
  playState: PlayState,
): PlayState {
  if (!playState) {
    return playState;
  }
  const normalizedHungerElapsedHours = normalizeHungerElapsedHours(
    playState.hungerElapsedHours,
  );
  const hungerStatus = resolvePlayerHungerStatus(normalizedHungerElapsedHours);
  const injuryStatus = normalizePlayerInjuryStatus(playState.injuryStatus);
  if (
    playState.hungerElapsedHours === normalizedHungerElapsedHours &&
    playState.hungerStatus === hungerStatus &&
    playState.injuryStatus === injuryStatus
  ) {
    return playState;
  }
  return {
    ...playState,
    hungerElapsedHours: normalizedHungerElapsedHours,
    hungerStatus,
    injuryStatus,
  };
}
