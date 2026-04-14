import { clamp } from "../../utils";
import { HUNT_HOUR_OPTIONS, REST_HOUR_OPTIONS } from "./constants";

export function normalizeActionCounter(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

export function normalizeHuntHours(value: unknown): number {
  const numeric = Number(value);
  const wholeHours = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  if (!HUNT_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}

export function normalizeCompletedHours(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeStackCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeAreaCapacity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.25;
  }
  return clamp(numeric, 0.08, 1);
}

export function normalizeWeaponAccuracy(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return clamp(Math.floor(numeric), 0, 100);
}

export function normalizeHealthValue(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeStaminaValue(value: unknown, fallback: number): number {
  const fallbackValue = Number.isFinite(fallback)
    ? Math.max(0, Math.floor(fallback))
    : 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(numeric));
}

export function normalizeElapsedHours(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, numeric);
}

export function normalizeRestHours(value: unknown): number {
  const numeric = Number(value);
  const wholeHours = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  if (!REST_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}
