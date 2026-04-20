import { normalizeParams } from "@fardvag/world-gen";
import type { WorldInputParams } from "@fardvag/shared/types/world";

const EDITOR_DEFAULTS_FILE = "editor-defaults.json";

function createEditorDefaultsUrl(): string {
  return `${import.meta.env.BASE_URL}${EDITOR_DEFAULTS_FILE}`;
}

export async function loadBundledEditorDefaults(
  fallbackParams: WorldInputParams,
): Promise<ReturnType<typeof normalizeParams>> {
  const fallback = normalizeParams(fallbackParams);
  try {
    const response = await fetch(createEditorDefaultsUrl(), {
      cache: "no-store",
    });
    if (!response.ok) {
      return fallback;
    }
    const payload = await response.json();
    return normalizeParams(payload);
  } catch {
    return fallback;
  }
}

export function downloadEditorDefaultsFile(params: WorldInputParams): void {
  const payload = `${JSON.stringify(normalizeParams(params), null, 2)}\n`;
  const blob = new Blob([payload], {
    type: "application/json;charset=utf-8",
  });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = EDITOR_DEFAULTS_FILE;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
