import { renderPlayWorldStatic } from "../render/renderer.js?v=20260408b";
import { createMapAtlasCacheManager } from "./mapAtlasCache.js?v=20260408c";

export function createPlayMapCacheManager({
  playCanvas,
  getWorld,
  getCameraState,
}) {
  return createMapAtlasCacheManager({
    canvas: playCanvas,
    getWorld,
    getCameraState,
    renderStaticScene: renderPlayWorldStatic,
    getStaticKey(renderOptions = {}) {
      return `snow:${renderOptions.showSnow ? 1 : 0}`;
    },
  });
}
