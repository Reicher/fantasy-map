export const DEFAULT_TIME_OF_DAY_HOURS = 12;
const MOVING_HOURS_PER_REAL_SECOND = 0.4;
const HOURS_PER_DAY = 24;

export function normalizeTimeOfDayHours(hours) {
  if (!Number.isFinite(hours)) {
    return DEFAULT_TIME_OF_DAY_HOURS;
  }
  const wrapped = hours % HOURS_PER_DAY;
  return wrapped < 0 ? wrapped + HOURS_PER_DAY : wrapped;
}

export function advanceTimeOfDayHours(
  currentHours,
  deltaMs,
  hoursPerSecond = MOVING_HOURS_PER_REAL_SECOND,
) {
  const normalizedCurrent = normalizeTimeOfDayHours(currentHours);
  const safeDeltaMs = Math.max(0, Number(deltaMs) || 0);
  const safeHoursPerSecond = Math.max(0, Number(hoursPerSecond) || 0);
  const elapsedHours = (safeDeltaMs / 1000) * safeHoursPerSecond;
  return normalizeTimeOfDayHours(normalizedCurrent + elapsedHours);
}
