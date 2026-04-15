import {
  MAP_HEIGHT,
  MAP_WIDTH,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from "../config";
import type { ViewportLike } from "../types/runtime";
import type { World } from "../types/world";

interface CameraStateLike {
  zoom?: number;
  centerX?: number;
  centerY?: number;
}

const MIN_VIEWPORT_ZOOM = 0.05;

export function createViewport(
  world: World,
  cameraState: CameraStateLike | null = null,
): ViewportLike {
  const margin = 0;
  const innerWidth = RENDER_WIDTH - margin * 2;
  const innerHeight = RENDER_HEIGHT - margin * 2;
  const zoom = sanitizeViewportZoom(cameraState?.zoom);
  const { scaleX, scaleY } = getViewportScaleForZoom(zoom, innerWidth, innerHeight);
  const { visibleWidth, visibleHeight } = getViewportVisibleWorldSize(
    zoom,
    innerWidth,
    innerHeight,
  );
  const centerX = sanitizeCameraCenter(cameraState?.centerX, world.terrain.width * 0.5);
  const centerY = sanitizeCameraCenter(cameraState?.centerY, world.terrain.height * 0.5);
  const leftWorld = centerX - visibleWidth * 0.5;
  const topWorld = centerY - visibleHeight * 0.5;

  return {
    margin,
    innerWidth,
    innerHeight,
    zoom,
    centerX,
    centerY,
    leftWorld,
    topWorld,
    visibleWidth,
    visibleHeight,
    scaleX,
    scaleY,
    worldToCanvas(x: number, y: number) {
      return {
        x: margin + (x + 0.5 - leftWorld) * scaleX,
        y: margin + (y + 0.5 - topWorld) * scaleY,
      };
    },
    canvasToWorld(x: number, y: number) {
      return {
        x: leftWorld + (x - margin) / scaleX - 0.5,
        y: topWorld + (y - margin) / scaleY - 0.5,
      };
    },
  };
}

export function getViewportScaleForZoom(
  zoom: number,
  innerWidth = RENDER_WIDTH,
  innerHeight = RENDER_HEIGHT,
) {
  const safeZoom = sanitizeViewportZoom(zoom);
  return {
    scaleX: (innerWidth / MAP_WIDTH) * safeZoom,
    scaleY: (innerHeight / MAP_HEIGHT) * safeZoom,
  };
}

export function getViewportVisibleWorldSize(
  zoom: number,
  innerWidth = RENDER_WIDTH,
  innerHeight = RENDER_HEIGHT,
) {
  const { scaleX, scaleY } = getViewportScaleForZoom(
    zoom,
    innerWidth,
    innerHeight,
  );
  return {
    visibleWidth: innerWidth / scaleX,
    visibleHeight: innerHeight / scaleY,
  };
}

function sanitizeViewportZoom(zoom: unknown): number {
  const numeric = Number(zoom);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(MIN_VIEWPORT_ZOOM, numeric);
}

function sanitizeCameraCenter(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
