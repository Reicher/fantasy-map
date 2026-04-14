import type { ViewportLike } from "../types/runtime";
import type { PlayState } from "../types/play";
import type { World } from "../types/world";

const EDITOR_ZOOM_LEVELS = [1, 2, 3] as const;

export interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
  [key: string]: unknown;
}

export function createEditorCamera(world: World | null | undefined): CameraState {
  return {
    zoom: EDITOR_ZOOM_LEVELS[0],
    centerX: world?.terrain.width ? world.terrain.width * 0.5 : 150,
    centerY: world?.terrain.height ? world.terrain.height * 0.5 : 110,
  };
}

export function createPlayCamera(
  world: World | null | undefined,
  playState: PlayState | null | undefined,
  zoom = 1,
): CameraState {
  return {
    zoom,
    centerX:
      playState?.position?.x ??
      world?.playerStart?.x ??
      (world?.terrain.width != null ? world.terrain.width * 0.5 : 150),
    centerY:
      playState?.position?.y ??
      world?.playerStart?.y ??
      (world?.terrain.height != null ? world.terrain.height * 0.5 : 110),
  };
}

export function clampEditorCamera(
  world: World | null | undefined,
  camera: CameraState,
): CameraState {
  if (!world) {
    return camera;
  }

  const zoom = clampNumber(
    camera.zoom,
    EDITOR_ZOOM_LEVELS[0],
    EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1],
  );
  const visibleWidth = world.terrain.width / zoom;
  const visibleHeight = world.terrain.height / zoom;
  const oceanPadX = Math.max(12, visibleWidth * 0.24);
  const oceanPadY = Math.max(10, visibleHeight * 0.24);

  return {
    zoom,
    centerX: clampNumber(
      camera.centerX,
      visibleWidth * 0.5 - oceanPadX,
      world.terrain.width - visibleWidth * 0.5 + oceanPadX,
    ),
    centerY: clampNumber(
      camera.centerY,
      visibleHeight * 0.5 - oceanPadY,
      world.terrain.height - visibleHeight * 0.5 + oceanPadY,
    ),
  };
}

export function zoomCameraAroundPoint(
  world: World,
  viewport: ViewportLike,
  worldX: number,
  worldY: number,
  canvasX: number,
  canvasY: number,
  zoom: number,
): CameraState {
  const margin = viewport.margin;
  const innerWidth = viewport.innerWidth;
  const innerHeight = viewport.innerHeight;
  const scaleX = (innerWidth / world.terrain.width) * zoom;
  const scaleY = (innerHeight / world.terrain.height) * zoom;
  const visibleWidth = innerWidth / scaleX;
  const visibleHeight = innerHeight / scaleY;
  const leftWorld = worldX + 0.5 - (canvasX - margin) / scaleX;
  const topWorld = worldY + 0.5 - (canvasY - margin) / scaleY;

  return {
    zoom,
    centerX: leftWorld + visibleWidth * 0.5,
    centerY: topWorld + visibleHeight * 0.5,
  };
}

export function isDefaultEditorCamera(
  world: World | null | undefined,
  camera: CameraState,
): boolean {
  const defaultCamera = createEditorCamera(world);
  return (
    Math.abs(camera.zoom - defaultCamera.zoom) < 0.001 &&
    Math.abs(camera.centerX - defaultCamera.centerX) < 0.01 &&
    Math.abs(camera.centerY - defaultCamera.centerY) < 0.01
  );
}

function getNearestEditorZoomIndex(zoom: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  EDITOR_ZOOM_LEVELS.forEach((level, index) => {
    const distance = Math.abs(level - zoom);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function getNearestEditorZoom(zoom: number): number {
  return EDITOR_ZOOM_LEVELS[getNearestEditorZoomIndex(zoom)];
}

export function getAdjacentEditorZoom(currentZoom: number, direction: number): number {
  const currentIndex = getNearestEditorZoomIndex(currentZoom);
  const nextIndex = clampNumber(
    currentIndex + Math.sign(direction || 0),
    0,
    EDITOR_ZOOM_LEVELS.length - 1,
  );
  return EDITOR_ZOOM_LEVELS[nextIndex];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
