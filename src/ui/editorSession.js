import { inspectWorldAt } from "../inspector.js?v=20260402h";
import { renderEditorWorld } from "../render/renderer.js?v=20260403aq";
import {
  clampEditorCamera,
  createEditorCamera,
  isDefaultEditorCamera,
  zoomCameraAroundPoint as buildZoomedCamera
} from "./cameraState.js?v=20260401b";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260403b";
import { attachEditorController } from "./editorController.js?v=20260401b";

export function createEditorSession({ refs, state, syncViewUi }) {
  attachEditorController({
    canvas: refs.canvas,
    tooltip: refs.tooltip,
    state,
    inspectWorldAt,
    clearHover,
    showHoverHit,
    rerenderCurrentWorld,
    scheduleInteractiveRender,
    syncViewUi,
    clampCamera,
    zoomCameraAroundPoint
  });

  return {
    rerenderCurrentWorld,
    scheduleInteractiveRender,
    createDefaultCamera,
    isDefaultCamera,
    clampCamera,
    zoomCameraAroundPoint
  };

  function rerenderCurrentWorld() {
    if (!state.currentWorld) {
      return;
    }

    state.currentViewport = renderEditorWorld(refs.canvas, state.currentWorld, {
      ...state.renderOptions,
      cameraState: state.cameraState
    });
  }

  function scheduleInteractiveRender() {
    if (state.pendingInteractiveRender || !state.currentWorld) {
      return;
    }

    state.pendingInteractiveRender = true;
    requestAnimationFrame(() => {
      state.pendingInteractiveRender = false;
      state.currentViewport = renderEditorWorld(refs.canvas, state.currentWorld, {
        ...state.renderOptions,
        cameraState: state.cameraState,
        interactive: true
      });
    });
  }

  function createDefaultCamera() {
    return createEditorCamera(state.currentWorld);
  }

  function clampCamera(camera) {
    return clampEditorCamera(state.currentWorld, camera);
  }

  function zoomCameraAroundPoint(worldX, worldY, canvasX, canvasY, zoom) {
    return buildZoomedCamera(
      state.currentWorld,
      state.currentViewport,
      worldX,
      worldY,
      canvasX,
      canvasY,
      zoom
    );
  }

  function isDefaultCamera(camera) {
    return isDefaultEditorCamera(state.currentWorld, camera);
  }
}
