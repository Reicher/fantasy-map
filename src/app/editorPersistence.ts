import { normalizeParams } from "../generator/worldGenerator";
import type { WorldInputParams } from "../types/world";

const EDITOR_SETTINGS_STORAGE_KEY = "fardvag.editor.settings.v1";

export function loadPersistedEditorParams(): WorldInputParams | null {
  try {
    const raw = window.localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeParams(parsed);
  } catch {
    return null;
  }
}

export function persistEditorParams(params: WorldInputParams): void {
  try {
    window.localStorage.setItem(
      EDITOR_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeParams(params)),
    );
  } catch {
    // Ignore localStorage errors (privacy mode, quota, etc.).
  }
}

export function createDebouncedFormPersistor(
  persist: () => void,
  delayMs = 150,
): () => void {
  let timeoutId: number | null = null;
  return (): void => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      persist();
    }, delayMs);
  };
}
