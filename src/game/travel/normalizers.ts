import { clamp } from "../../utils";
import { HUNT_HOUR_OPTIONS, REST_HOUR_OPTIONS } from "./constants";

export function normalizeActionCounter(value: any): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

export function normalizeHuntHours(value: any): number {
  const wholeHours = Number.isFinite(value) ? Math.floor(value) : 0;
  if (!HUNT_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}

export function normalizeCompletedHours(value: any): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeStackCount(value: any): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeAreaCapacity(value: any): number {
  if (!Number.isFinite(value)) {
    return 0.25;
  }
  return clamp(value, 0.08, 1);
}

export function normalizeWeaponAccuracy(value: any): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, 100);
}

export function normalizeHealthValue(value: any, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeStaminaValue(value: any, fallback: number): number {
  const fallbackValue = Number.isFinite(fallback)
    ? Math.max(0, Math.floor(fallback))
    : 0;
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeElapsedHours(value: any): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

export function normalizeRestHours(value: any): number {
  const wholeHours = Number.isFinite(value) ? Math.floor(value) : 0;
  if (!REST_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}
