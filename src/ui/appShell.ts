import { getNearestEditorZoom } from "./cameraState";
import { setElementVisible } from "./viewState";

type AppMode = "editor" | "play";

interface LabelButtonRefs {
  toggleBiomeLabelsButton: HTMLElement;
  toggleNodeLabelsButton: HTMLElement;
  toggleSnowButton: HTMLElement;
}

interface RenderOptionsLike {
  showBiomeLabels: boolean;
  showNodeLabels: boolean;
  showSnow: boolean;
}

interface ModeUiRefs {
  editorShell: HTMLElement | null;
  playView: HTMLElement | null;
  editorLoading: HTMLElement | null;
  playLoading: HTMLElement | null;
}

interface ViewUiRefs {
  zoom1Button: HTMLElement | null;
  zoom2Button: HTMLElement | null;
  zoom3Button: HTMLElement | null;
}

export function inferInitialMode(
  pathname = window.location.pathname,
  search = window.location.search,
): AppMode {
  const requestedMode = new URLSearchParams(search).get("mode");
  if (requestedMode === "editor" || requestedMode === "play") {
    return requestedMode;
  }

  const path = pathname.replace(/\/+$/, "") || "/";
  return path.endsWith("/editor") || path.endsWith("/editor/index.html")
    ? "editor"
    : "play";
}

export function syncLabelButtons({
  refs,
  renderOptions,
}: {
  refs: LabelButtonRefs;
  renderOptions: RenderOptionsLike;
}): void {
  refs.toggleBiomeLabelsButton.dataset.active = renderOptions.showBiomeLabels
    ? "true"
    : "false";
  refs.toggleNodeLabelsButton.dataset.active =
    renderOptions.showNodeLabels ? "true" : "false";
  refs.toggleSnowButton.dataset.active = renderOptions.showSnow
    ? "true"
    : "false";
}

export function syncModeUi({
  refs,
  state,
  updatePlaySubView,
}: {
  refs: ModeUiRefs;
  state: { currentMode: AppMode; editorLoading: boolean; playLoading: boolean };
  updatePlaySubView: () => void;
}): void {
  const isEditor = state.currentMode === "editor";
  setElementVisible(refs.editorShell, isEditor, "grid");
  setElementVisible(refs.playView, !isEditor, "block");
  const showEditorLoading = isEditor && state.editorLoading;
  setElementVisible(refs.editorLoading, showEditorLoading, "flex");
  setElementVisible(refs.playLoading, state.playLoading, "block");
  updatePlaySubView();
}

export function syncViewUi({
  refs,
  cameraState,
}: {
  refs: ViewUiRefs;
  cameraState: { zoom: number };
}): void {
  const zoom = getNearestEditorZoom(cameraState.zoom);
  for (const button of [refs.zoom1Button, refs.zoom2Button, refs.zoom3Button]) {
    if (!button) continue;
    button.dataset.active = String(
      Math.abs(Number(button.dataset.zoom) - zoom) < 0.001,
    );
  }
}
