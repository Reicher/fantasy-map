import { RENDER_HEIGHT, RENDER_WIDTH } from "@fardvag/shared/config";

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
  findEditorNodeAtEvent,
  setEditorPlayerStart,
}) {
  const DRAG_THRESHOLD_PX = 2.5;

  canvas.addEventListener("pointerdown", (event) => {
    if (
      state.currentMode !== "editor" ||
      !state.currentViewport ||
      event.button !== 0
    ) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    state.dragState = {
      startX: ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH,
      startY: ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT,
      centerX: state.cameraState.centerX,
      centerY: state.cameraState.centerY,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
  });

  canvas.addEventListener("pointermove", (event) => {
    if (
      state.currentMode !== "editor" ||
      !state.currentWorld ||
      !state.currentViewport
    ) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;

    if (state.dragState) {
      const dx = canvasX - state.dragState.startX;
      const dy = canvasY - state.dragState.startY;
      const hasDragged =
        Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
      if (!hasDragged) {
        return;
      }
      state.dragState.moved = true;
      state.cameraState = clampCamera({
        zoom: state.cameraState.zoom,
        centerX: state.dragState.centerX - dx / state.currentViewport.scaleX,
        centerY: state.dragState.centerY - dy / state.currentViewport.scaleY,
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
      viewport: state.currentViewport,
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
      const wasDrag = state.dragState.moved;
      state.dragState = null;
      canvas.releasePointerCapture(event.pointerId);
      canvas.dataset.dragging = "false";
      if (
        !wasDrag &&
        state.currentMode === "editor" &&
        event.button === 0 &&
        typeof findEditorNodeAtEvent === "function" &&
        typeof setEditorPlayerStart === "function"
      ) {
        const nodeId = findEditorNodeAtEvent(event);
        if (nodeId != null && setEditorPlayerStart(nodeId)) {
          rerenderCurrentWorld();
        }
      }
    }
  });

  canvas.addEventListener("pointercancel", () => {
    state.dragState = null;
    canvas.dataset.dragging = "false";
    clearHover(tooltip);
  });
}
