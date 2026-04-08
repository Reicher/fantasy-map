import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import {
  createViewport,
  renderPlayWorldStatic,
} from "../render/renderer.js?v=20260408a";

export function createPlayMapCacheManager({
  playCanvas,
  getWorld,
  getCameraState,
}) {
  const cache = {
    canvas: null,
    key: null,
    worldRef: null,
    viewport: null,
    renderWidth: 0,
    renderHeight: 0,
  };

  return {
    ensure(renderOptions) {
      const world = getWorld();
      const atlas = createPlayMapAtlas(world, getCameraState());
      const cacheCanvas = getOrCreateCacheCanvas(cache, playCanvas, atlas);
      const cacheKey = [
        playCanvas.width,
        playCanvas.height,
        renderOptions.showSnow ? 1 : 0,
        renderOptions.showMonochrome ? 1 : 0,
        atlas.zoom.toFixed(3),
        atlas.renderWidth.toFixed(2),
        atlas.renderHeight.toFixed(2),
      ].join(":");

      if (cache.worldRef === world && cache.key === cacheKey) {
        return false;
      }

      renderPlayWorldStatic(cacheCanvas, world, {
        ...renderOptions,
        viewport: atlas.viewport,
        renderWidth: atlas.renderWidth,
        renderHeight: atlas.renderHeight,
      });
      cache.worldRef = world;
      cache.key = cacheKey;
      cache.viewport = atlas.viewport;
      cache.renderWidth = atlas.renderWidth;
      cache.renderHeight = atlas.renderHeight;
      return true;
    },

    draw(cameraState) {
      if (!cache.canvas || !cache.viewport) {
        return;
      }

      const world = getWorld();
      const currentViewport = createViewport(world, cameraState);
      const sourceXLogical =
        (currentViewport.leftWorld - cache.viewport.leftWorld) *
        cache.viewport.scaleX;
      const sourceYLogical =
        (currentViewport.topWorld - cache.viewport.topWorld) *
        cache.viewport.scaleY;
      const sourceWidthLogical = RENDER_WIDTH;
      const sourceHeightLogical = RENDER_HEIGHT;
      const sourceScaleX = cache.canvas.width / cache.renderWidth;
      const sourceScaleY = cache.canvas.height / cache.renderHeight;

      playCanvas
        .getContext("2d")
        .drawImage(
          cache.canvas,
          sourceXLogical * sourceScaleX,
          sourceYLogical * sourceScaleY,
          sourceWidthLogical * sourceScaleX,
          sourceHeightLogical * sourceScaleY,
          0,
          0,
          playCanvas.width,
          playCanvas.height,
        );
    },
  };
}

function getOrCreateCacheCanvas(cache, playCanvas, atlas) {
  if (!cache.canvas) {
    cache.canvas = playCanvas.ownerDocument.createElement("canvas");
  }

  const scaleX = playCanvas.width / RENDER_WIDTH;
  const scaleY = playCanvas.height / RENDER_HEIGHT;
  const width = Math.max(1, Math.round(atlas.renderWidth * scaleX));
  const height = Math.max(1, Math.round(atlas.renderHeight * scaleY));
  if (cache.canvas.width !== width || cache.canvas.height !== height) {
    cache.canvas.width = width;
    cache.canvas.height = height;
    cache.key = null;
  }
  return cache.canvas;
}

function createPlayMapAtlas(world, cameraState) {
  const margin = 38;
  const innerWidth = RENDER_WIDTH - margin * 2;
  const innerHeight = RENDER_HEIGHT - margin * 2;
  const scaleX = (innerWidth / world.terrain.width) * cameraState.zoom;
  const scaleY = (innerHeight / world.terrain.height) * cameraState.zoom;
  const maxVisibleWidth = innerWidth / scaleX;
  const maxVisibleHeight = innerHeight / scaleY;
  const leftWorld = -maxVisibleWidth * 0.5;
  const topWorld = -maxVisibleHeight * 0.5;
  const visibleWidth = world.terrain.width + maxVisibleWidth;
  const visibleHeight = world.terrain.height + maxVisibleHeight;
  const renderWidth = margin * 2 + visibleWidth * scaleX;
  const renderHeight = margin * 2 + visibleHeight * scaleY;

  return {
    zoom: cameraState.zoom,
    renderWidth,
    renderHeight,
    viewport: {
      margin,
      innerWidth: visibleWidth * scaleX,
      innerHeight: visibleHeight * scaleY,
      zoom: cameraState.zoom,
      centerX: world.terrain.width * 0.5,
      centerY: world.terrain.height * 0.5,
      leftWorld,
      topWorld,
      visibleWidth,
      visibleHeight,
      scaleX,
      scaleY,
      worldToCanvas(x, y) {
        return {
          x: margin + (x + 0.5 - leftWorld) * scaleX,
          y: margin + (y + 0.5 - topWorld) * scaleY,
        };
      },
      canvasToWorld(x, y) {
        return {
          x: leftWorld + (x - margin) / scaleX - 0.5,
          y: topWorld + (y - margin) / scaleY - 0.5,
        };
      },
    },
  };
}
