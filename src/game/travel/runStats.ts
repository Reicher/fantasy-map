import {
  normalizeElapsedHours,
  normalizeStackCount,
} from "./normalizers";

export function createInitialRunStats() {
  return {
    meatEaten: 0,
    travelHours: 0,
    huntHours: 0,
    restHours: 0,
    distanceTraveled: 0,
  };
}

export function normalizeRunStats(stats: any) {
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

export function snapshotRunStats(stats: any) {
  return normalizeRunStats(stats);
}
