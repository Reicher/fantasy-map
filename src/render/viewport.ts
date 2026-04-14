import { RENDER_HEIGHT, RENDER_WIDTH } from "../config";
import type { ViewportLike } from "../types/runtime";
import type { World } from "../types/world";

interface CameraStateLike {
  zoom?: number;
  centerX?: number;
  centerY?: number;
}

export function createViewport(
  world: World,
  cameraState: CameraStateLike | null = null,
): ViewportLike {
  const margin = 0;
  const innerWidth = RENDER_WIDTH - margin * 2;
  const innerHeight = RENDER_HEIGHT - margin * 2;
  const baseScaleX = innerWidth / world.terrain.width;
  const baseScaleY = innerHeight / world.terrain.height;
  const zoom = cameraState?.zoom ?? 1;
  const scaleX = baseScaleX * zoom;
  const scaleY = baseScaleY * zoom;
  const visibleWidth = innerWidth / scaleX;
  const visibleHeight = innerHeight / scaleY;
  const centerX = cameraState?.centerX ?? world.terrain.width * 0.5;
  const centerY = cameraState?.centerY ?? world.terrain.height * 0.5;
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
