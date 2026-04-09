import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import { inspectWorldAt } from "../inspector.js?v=20260408b";
import {
  clampEditorCamera,
  createEditorCamera,
  getAdjacentEditorZoom,
  isDefaultEditorCamera,
  zoomCameraAroundPoint as buildZoomedCamera,
} from "./cameraState.js?v=20260407a";
import { clearHover, showHoverHit } from "./hoverPanel.js?v=20260408a";
import { attachEditorController } from "./editorController.js?v=20260407a";
import { renderEditorWorld } from "../render/renderer.js?v=20260409a";
import { createMapAtlasCacheManager } from "./mapAtlasCache.js?v=20260408h";

export function createEditorSession({ refs, state, syncViewUi }) {
  const mapCache = createMapAtlasCacheManager({
    canvas: refs.canvas,
    getWorld: () => state.currentWorld,
    getCameraState: () => state.cameraState,
    renderStaticScene: renderEditorWorld,
    getStaticKey(renderOptions = {}) {
      return [
        renderOptions.showSnow ? 1 : 0,
        renderOptions.showBiomeLabels ? 1 : 0,
        renderOptions.showPoiLabels ? 1 : 0,
      ].join(":");
    },
    getAtlasPadding(world, cameraState) {
      const zoom = cameraState?.zoom ?? 1;
      const visibleWidth = world.terrain.width / zoom;
      const visibleHeight = world.terrain.height / zoom;
      return {
        x: Math.max(12, visibleWidth * 0.24),
        y: Math.max(10, visibleHeight * 0.24),
      };
    },
  });

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
    zoomCameraAroundPoint,
    getAdjacentEditorZoom,
  });

  return {
    rerenderCurrentWorld,
    scheduleInteractiveRender,
    createDefaultCamera,
    isDefaultCamera,
    clampCamera,
    zoomCameraAroundPoint,
    stepZoom,
    setZoom,
  };

  function rerenderCurrentWorld() {
    if (!state.currentWorld) {
      return;
    }

    const renderOptions = {
      ...state.renderOptions,
      cameraState: state.cameraState,
    };
    mapCache.ensure(renderOptions);
    state.currentViewport = mapCache.draw(state.cameraState);
  }

  function scheduleInteractiveRender() {
    if (state.pendingInteractiveRender || !state.currentWorld) {
      return;
    }

    state.pendingInteractiveRender = true;
    requestAnimationFrame(() => {
      state.pendingInteractiveRender = false;
      const renderOptions = {
        ...state.renderOptions,
        cameraState: state.cameraState,
        interactive: true,
      };
      mapCache.ensure(renderOptions);
      state.currentViewport = mapCache.draw(state.cameraState);
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
      zoom,
    );
  }

  function isDefaultCamera(camera) {
    return isDefaultEditorCamera(state.currentWorld, camera);
  }

  function stepZoom(direction) {
    if (!state.currentWorld || !state.currentViewport) {
      return;
    }

    const zoom = getAdjacentEditorZoom(state.cameraState.zoom, direction);
    if (Math.abs(zoom - state.cameraState.zoom) < 0.001) {
      return;
    }

    const canvasX = RENDER_WIDTH * 0.5;
    const canvasY = RENDER_HEIGHT * 0.5;
    const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
    state.cameraState = clampCamera(
      zoomCameraAroundPoint(worldPoint.x, worldPoint.y, canvasX, canvasY, zoom),
    );
    syncViewUi();
    rerenderCurrentWorld();
  }

  function setZoom(targetZoom) {
    if (!state.currentWorld) {
      return;
    }

    if (Math.abs(targetZoom - state.cameraState.zoom) < 0.001) {
      return;
    }

    if (!state.currentViewport) {
      state.cameraState = clampCamera({
        ...state.cameraState,
        zoom: targetZoom,
      });
      syncViewUi();
      return;
    }

    const canvasX = RENDER_WIDTH * 0.5;
    const canvasY = RENDER_HEIGHT * 0.5;
    const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
    state.cameraState = clampCamera(
      zoomCameraAroundPoint(
        worldPoint.x,
        worldPoint.y,
        canvasX,
        canvasY,
        targetZoom,
      ),
    );
    syncViewUi();
    rerenderCurrentWorld();
  }
}
