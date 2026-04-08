import { renderEditorWorld } from "../render/renderer.js?v=20260408b";
import { createMapAtlasCacheManager } from "./mapAtlasCache.js?v=20260408c";

export function createEditorMapCacheManager({ canvas, getWorld, getCameraState }) {
  return createMapAtlasCacheManager({
    canvas,
    getWorld,
    getCameraState,
    renderStaticScene: renderEditorWorld,
    getStaticKey(renderOptions = {}) {
      return [
        renderOptions.showSnow ? 1 : 0,
        renderOptions.showBiomeLabels ? 1 : 0,
        renderOptions.showCityLabels ? 1 : 0,
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
}
