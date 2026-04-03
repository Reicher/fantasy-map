import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";

export function applyCanvasResolution(refs, renderScale = 125) {
  resizeCanvasForDisplay(refs.canvas, renderScale);
  resizeCanvasForDisplay(refs.playCanvas, renderScale);
}

function resizeCanvasForDisplay(canvas, renderScale) {
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width > 0 ? rect.width : RENDER_WIDTH;
  const cssHeight = rect.height > 0 ? rect.height : RENDER_HEIGHT;
  const baseDeviceScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
  const renderFactor = Math.max(0.5, Math.min(2.5, renderScale / 100));
  let width = Math.round(cssWidth * baseDeviceScale * renderFactor);
  let height = Math.round(cssHeight * baseDeviceScale * renderFactor);

  const maxPixels = 9_000_000;
  if (width * height > maxPixels) {
    const ratio = Math.sqrt(maxPixels / (width * height));
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}
