import {
  normalizeElapsedHours,
  normalizeStackCount,
} from "./normalizers";
import type { PlayRunStats } from "../../types/play";

const KILOMETERS_PER_CELL = 1;

export function createInitialRunStats() {
  return {
    meatEaten: 0,
    travelHours: 0,
    huntHours: 0,
    restHours: 0,
    distanceTraveled: 0,
  };
}

export function normalizeRunStats(
  stats: PlayRunStats | null | undefined,
): Required<PlayRunStats> {
  const base = createInitialRunStats();
  if (!stats || typeof stats !== "object") {
    return base;
  }
  return {
    meatEaten: normalizeStackCount(stats.meatEaten),
    travelHours: normalizeElapsedHours(stats.travelHours),
    huntHours: normalizeElapsedHours(stats.huntHours),
    restHours: normalizeElapsedHours(stats.restHours),
    distanceTraveled: normalizeElapsedHours(stats.distanceTraveled),
  };
}

export function snapshotRunStats(
  stats: PlayRunStats | null | undefined,
): Required<PlayRunStats> {
  return normalizeRunStats(stats);
}

export function formatDistanceWithUnit(value: unknown): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
  const distanceKm = safeValue * KILOMETERS_PER_CELL;
  return `${distanceKm.toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} km`;
}
