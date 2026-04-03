export function inferInitialMode(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path.endsWith("/editor") || path.endsWith("/editor/index.html") ? "editor" : "play";
}

export function syncLabelButtons({ refs, renderOptions }) {
  refs.toggleBiomeLabelsButton.dataset.active = renderOptions.showBiomeLabels ? "true" : "false";
  refs.toggleCityLabelsButton.dataset.active = renderOptions.showCityLabels ? "true" : "false";
  refs.toggleSnowButton.dataset.active = renderOptions.showSnow ? "true" : "false";
  refs.toggleMonochromeButton.dataset.active = renderOptions.showMonochrome ? "true" : "false";
}

export function syncModeUi({ refs, state, updatePlaySubView }) {
  const isEditor = state.currentMode === "editor";
  refs.editorShell.hidden = !isEditor;
  refs.playView.hidden = isEditor;
  refs.editorShell.style.display = isEditor ? "grid" : "none";
  refs.playView.style.display = isEditor ? "none" : "block";
  const showEditorLoading = isEditor && state.editorLoading;
  refs.editorLoading.hidden = !showEditorLoading;
  refs.editorLoading.style.display = showEditorLoading ? "flex" : "none";
  refs.playLoading.hidden = !state.playLoading;
  refs.playLoading.style.display = state.playLoading ? "block" : "none";
  updatePlaySubView();
}

export function syncViewUi({ refs, cameraState, isDefaultCamera }) {
  refs.zoomLevelNode.textContent = `${Math.round(cameraState.zoom * 100)}%`;
  refs.resetViewButton.disabled = isDefaultCamera(cameraState);
}
