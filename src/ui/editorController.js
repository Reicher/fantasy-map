import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";

export function attachEditorController({
  canvas,
  tooltip,
  state,
  inspectWorldAt,
  clearHover,
  showHoverHit,
  rerenderCurrentWorld,
  scheduleInteractiveRender,
  syncViewUi,
  clampCamera,
  zoomCameraAroundPoint
}) {
  canvas.addEventListener("pointerdown", (event) => {
    if (state.currentMode !== "editor" || !state.currentViewport || event.button !== 0) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    state.dragState = {
      startX: ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH,
      startY: ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT,
      centerX: state.cameraState.centerX,
      centerY: state.cameraState.centerY
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.currentMode !== "editor" || !state.currentWorld || !state.currentViewport) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;

    if (state.dragState) {
      const dx = canvasX - state.dragState.startX;
      const dy = canvasY - state.dragState.startY;
      state.cameraState = clampCamera({
        zoom: state.cameraState.zoom,
        centerX: state.dragState.centerX - dx / state.currentViewport.scaleX,
        centerY: state.dragState.centerY - dy / state.currentViewport.scaleY
      });
      syncViewUi();
      scheduleInteractiveRender();
      clearHover(tooltip);
      return;
    }

    const position = state.currentViewport.canvasToWorld(canvasX, canvasY);
    const hit = inspectWorldAt(state.currentWorld, position.x, position.y, {
      canvasX,
      canvasY,
      viewport: state.currentViewport
    });

    if (!hit) {
      clearHover(tooltip);
      return;
    }

    showHoverHit(hit, tooltip, event.clientX, event.clientY);
  });

  canvas.addEventListener("pointerleave", () => {
    if (!state.dragState) {
      clearHover(tooltip);
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (state.dragState) {
      state.dragState = null;
      canvas.releasePointerCapture(event.pointerId);
      canvas.dataset.dragging = "false";
    }
  });

  canvas.addEventListener("pointercancel", () => {
    state.dragState = null;
    canvas.dataset.dragging = "false";
    clearHover(tooltip);
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (state.currentMode !== "editor" || !state.currentWorld || !state.currentViewport) {
        return;
      }

      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
      const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
      const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
      const zoomFactor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
      const zoom = clampNumber(state.cameraState.zoom * zoomFactor, 1, 4.5);
      state.cameraState = clampCamera(
        zoomCameraAroundPoint(worldPoint.x, worldPoint.y, canvasX, canvasY, zoom)
      );
      syncViewUi();
      rerenderCurrentWorld();
      clearHover(tooltip);
    },
    { passive: false }
  );
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
