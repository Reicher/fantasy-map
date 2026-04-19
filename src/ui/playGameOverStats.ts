import { formatDistanceWithUnit } from "@fardvag/game-core";
import type { PlayRunStats } from "@fardvag/shared/types/play";

const GAME_OVER_RECORD_STORAGE_KEY = "fardvag.play.run-record.v1";

export interface GameOverRunStats {
  meatEaten: number;
  travelHours: number;
  huntHours: number;
  restHours: number;
  distanceTraveled: number;
}

interface GameOverStatRow {
  label: string;
  value: string;
  recordKey: string | null;
}

interface GameOverRunRecord {
  distanceTraveled: number;
  meatEaten: number;
  travelHours: number;
  huntHours: number;
  restHours: number;
  totalHours: number;
}

export interface GameOverRunRecordSnapshot extends GameOverRunRecord {
  newRecordKeys: string[];
}

export function normalizeRunStatsForGameOver(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
): GameOverRunStats {
  return {
    meatEaten: normalizeStat(stats?.meatEaten, 0),
    travelHours: normalizeElapsedHours(stats?.travelHours),
    huntHours: normalizeElapsedHours(stats?.huntHours),
    restHours: normalizeElapsedHours(stats?.restHours),
    distanceTraveled: normalizeElapsedHours(stats?.distanceTraveled),
  };
}

export function buildRunStatsSignature(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
): string {
  return [
    normalizeStat(stats?.meatEaten, 0),
    normalizeElapsedHours(stats?.travelHours).toFixed(3),
    normalizeElapsedHours(stats?.huntHours).toFixed(3),
    normalizeElapsedHours(stats?.restHours).toFixed(3),
    normalizeElapsedHours(stats?.distanceTraveled).toFixed(3),
  ].join("|");
}

export function buildGameOverStatsRenderSignature(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
  record: Pick<GameOverRunRecordSnapshot, "newRecordKeys"> | null,
): string {
  const newRecordKeys = Array.isArray(record?.newRecordKeys)
    ? record.newRecordKeys
        .filter((key) => typeof key === "string" && key.length > 0)
        .sort()
        .join(",")
    : "";
  return `${buildRunStatsSignature(stats)}|records:${newRecordKeys}`;
}

export function renderGameOverStats(
  container: HTMLElement,
  stats: GameOverRunStats,
  record: Pick<GameOverRunRecordSnapshot, "newRecordKeys"> | null,
): void {
  const rows = createGameOverStatRows(stats);
  const newRecordKeys = getNewRecordKeySet(record);
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const rowElement = document.createElement("p");
    rowElement.className = "play-game-over-stat-row";
    const hasNewRecord =
      typeof row.recordKey === "string" && newRecordKeys.has(row.recordKey);
    if (hasNewRecord) {
      rowElement.classList.add("play-game-over-stat-row--record");
    }

    const label = document.createElement("span");
    label.className = "play-game-over-stat-label";
    label.textContent = row.label;
    rowElement.appendChild(label);

    const valueWrap = document.createElement("span");
    valueWrap.className = "play-game-over-stat-value-wrap";

    const value = document.createElement("span");
    value.className = "play-game-over-stat-value";
    value.textContent = row.value;
    valueWrap.appendChild(value);

    if (hasNewRecord) {
      const recordBadge = document.createElement("span");
      recordBadge.className = "play-game-over-stat-record";
      recordBadge.textContent = "rekord!";
      valueWrap.appendChild(recordBadge);
    }

    rowElement.appendChild(valueWrap);
    fragment.appendChild(rowElement);
  }

  container.innerHTML = "";
  container.appendChild(fragment);
}

export function updateAndLoadRunRecord(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
): GameOverRunRecordSnapshot {
  const runStats = normalizeRunStatsForGameOver(stats);
  const runTotalHours = getRunTotalHours(runStats);
  const currentRecord = loadRunRecord() ?? createEmptyRunRecord();
  const nextRecord = {
    ...currentRecord,
  };
  const newRecordKeys: string[] = [];

  if (runStats.meatEaten > currentRecord.meatEaten) {
    nextRecord.meatEaten = runStats.meatEaten;
    newRecordKeys.push("meatEaten");
  }
  if (runStats.travelHours > currentRecord.travelHours + 1e-9) {
    nextRecord.travelHours = runStats.travelHours;
    newRecordKeys.push("travelHours");
  }
  if (runStats.huntHours > currentRecord.huntHours + 1e-9) {
    nextRecord.huntHours = runStats.huntHours;
    newRecordKeys.push("huntHours");
  }
  if (runStats.restHours > currentRecord.restHours + 1e-9) {
    nextRecord.restHours = runStats.restHours;
    newRecordKeys.push("restHours");
  }
  if (runTotalHours > currentRecord.totalHours + 1e-9) {
    nextRecord.totalHours = runTotalHours;
    newRecordKeys.push("totalHours");
  }
  if (runStats.distanceTraveled > currentRecord.distanceTraveled + 1e-9) {
    nextRecord.distanceTraveled = runStats.distanceTraveled;
    newRecordKeys.push("distanceTraveled");
  }

  persistRunRecord(nextRecord);
  return {
    ...nextRecord,
    newRecordKeys,
  };
}

function createGameOverStatRows(stats: GameOverRunStats): GameOverStatRow[] {
  const totalHours = getRunTotalHours(stats);
  const huntShare = getHuntShare(stats);
  return [
    {
      label: "Kött ätit",
      value: formatInteger(stats.meatEaten),
      recordKey: "meatEaten",
    },
    {
      label: "Restid",
      value: formatHoursValue(stats.travelHours),
      recordKey: "travelHours",
    },
    {
      label: "Jakt",
      value: formatHoursValue(stats.huntHours),
      recordKey: "huntHours",
    },
    {
      label: "Vila",
      value: formatHoursValue(stats.restHours),
      recordKey: "restHours",
    },
    {
      label: "Total tid",
      value: formatHoursValue(totalHours),
      recordKey: "totalHours",
    },
    {
      label: "Ressträcka",
      value: formatDistanceWithUnit(stats.distanceTraveled),
      recordKey: "distanceTraveled",
    },
    {
      label: "Jaktandel",
      value: formatPercent(huntShare),
      recordKey: null,
    },
  ];
}

function getNewRecordKeySet(
  record: Pick<GameOverRunRecordSnapshot, "newRecordKeys"> | null,
): Set<string> {
  const newRecordKeys = Array.isArray(record?.newRecordKeys)
    ? record.newRecordKeys
    : [];
  return new Set(
    newRecordKeys.filter((key) => typeof key === "string" && key.length > 0),
  );
}

function loadRunRecord(): GameOverRunRecord | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(GAME_OVER_RECORD_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeRunRecord(parsed);
  } catch {
    return null;
  }
}

function persistRunRecord(record: GameOverRunRecord): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      GAME_OVER_RECORD_STORAGE_KEY,
      JSON.stringify(normalizeRunRecord(record)),
    );
  } catch {
    // Ignore localStorage errors in private mode or full quota.
  }
}

function normalizeRunRecord(
  record: Partial<GameOverRunRecord> | null | undefined,
): GameOverRunRecord {
  const normalized = {
    distanceTraveled: normalizeElapsedHours(record?.distanceTraveled),
    meatEaten: normalizeStat(record?.meatEaten, 0),
    travelHours: normalizeElapsedHours(record?.travelHours),
    huntHours: normalizeElapsedHours(record?.huntHours),
    restHours: normalizeElapsedHours(record?.restHours),
    totalHours: normalizeElapsedHours(record?.totalHours),
  };
  if (normalized.totalHours <= 0) {
    normalized.totalHours =
      normalized.travelHours + normalized.huntHours + normalized.restHours;
  }
  return normalized;
}

function createEmptyRunRecord(): GameOverRunRecord {
  return normalizeRunRecord(null);
}

function getRunTotalHours(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
): number {
  return (
    normalizeElapsedHours(stats?.travelHours) +
    normalizeElapsedHours(stats?.huntHours) +
    normalizeElapsedHours(stats?.restHours)
  );
}

function getHuntShare(
  stats: PlayRunStats | Partial<GameOverRunStats> | null | undefined,
): number {
  const totalHours = getRunTotalHours(stats);
  if (totalHours <= 0) {
    return 0;
  }
  return normalizeElapsedHours(stats?.huntHours) / totalHours;
}

function formatHoursValue(value: number | null | undefined): string {
  const safeValue = normalizeElapsedHours(value);
  return `${safeValue.toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} h`;
}

function formatInteger(value: number | null | undefined): string {
  return normalizeStat(value, 0).toLocaleString("sv-SE");
}

function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${(safeValue * 100).toLocaleString("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}%`;
}

function normalizeStat(value: number | null | undefined, fallback = 0): number {
  const fallbackValue = Math.max(0, Math.floor(fallback) || 0);
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeElapsedHours(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}
