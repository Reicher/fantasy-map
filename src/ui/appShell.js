import { getNearestEditorZoom } from "./cameraState.js?v=20260407a";
import { setElementVisible } from "./viewState.js?v=20260403a";

export function inferInitialMode(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.endsWith("/editor") || path.endsWith("/editor/index.html")
    ? "editor"
    : "play";
}

export function syncLabelButtons({ refs, renderOptions }) {
  refs.toggleBiomeLabelsButton.dataset.active = renderOptions.showBiomeLabels
    ? "true"
    : "false";
  refs.toggleCityLabelsButton.dataset.active = renderOptions.showPoiLabels
    ? "true"
    : "false";
  refs.toggleSnowButton.dataset.active = renderOptions.showSnow
    ? "true"
    : "false";
}

export function syncModeUi({ refs, state, updatePlaySubView }) {
  const isEditor = state.currentMode === "editor";
  setElementVisible(refs.editorShell, isEditor, "grid");
  setElementVisible(refs.playView, !isEditor, "block");
  const showEditorLoading = isEditor && state.editorLoading;
  setElementVisible(refs.editorLoading, showEditorLoading, "flex");
  setElementVisible(refs.playLoading, state.playLoading, "block");
  updatePlaySubView();
}

export function syncViewUi({ refs, cameraState }) {
  const zoom = getNearestEditorZoom(cameraState.zoom);
  for (const button of [
    refs.zoom1Button,
    refs.zoom2Button,
    refs.zoom3Button,
  ]) {
    if (!button) continue;
    button.dataset.active = String(
      Math.abs(Number(button.dataset.zoom) - zoom) < 0.001,
    );
  }
}
