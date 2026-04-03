export function inferInitialMode(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/editor" || path === "/editor/index.html" ? "editor" : "play";
}

export function syncLabelButtons({ refs, renderOptions }) {
  refs.toggleBiomeLabelsButton.dataset.active = renderOptions.showBiomeLabels ? "true" : "false";
  refs.toggleCityLabelsButton.dataset.active = renderOptions.showCityLabels ? "true" : "false";
  refs.toggleSnowButton.dataset.active = renderOptions.showSnow ? "true" : "false";
  refs.toggleMonochromeButton.dataset.active = renderOptions.showMonochrome ? "true" : "false";
}

export function syncModeUi({ refs, state, applyCanvasResolution, updatePlaySubView }) {
  const isEditor = state.currentMode === "editor";
  refs.editorShell.hidden = !isEditor;
  refs.playView.hidden = isEditor;
  refs.playLoading.hidden = !state.playLoading;
  if (state.isBootReady) {
    applyCanvasResolution(state.currentRenderScale);
  }
  updatePlaySubView();
}

export function syncViewUi({ refs, cameraState, isDefaultCamera }) {
  refs.zoomLevelNode.textContent = `${Math.round(cameraState.zoom * 100)}%`;
  refs.resetViewButton.disabled = isDefaultCamera(cameraState);
}
