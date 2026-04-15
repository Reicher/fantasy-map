import type { ViewportLike } from "../types/runtime";
import type { PlayState } from "../types/play";
import type { World } from "../types/world";
import { MAP_HEIGHT, MAP_WIDTH } from "../config";
import {
  getViewportScaleForZoom,
  getViewportVisibleWorldSize,
} from "../render/viewport";

const EDITOR_ZOOM_LEVELS = [0.35, 0.5, 0.75, 1, 1.5, 2, 3] as const;

export interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
  [key: string]: unknown;
}

export function createEditorCamera(world: World | null | undefined): CameraState {
  const minZoom = getEditorMinZoom(world);
  const startZoom = getEditorStartZoom(world, minZoom);
  return {
    zoom: startZoom,
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

  const minZoom = getEditorMinZoom(world);
  const zoom = clampNumber(
    camera.zoom,
    minZoom,
    EDITOR_ZOOM_LEVELS[EDITOR_ZOOM_LEVELS.length - 1],
  );
  const { visibleWidth, visibleHeight } = getViewportVisibleWorldSize(zoom);
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
  const { scaleX, scaleY } = getViewportScaleForZoom(zoom, innerWidth, innerHeight);
  const { visibleWidth, visibleHeight } = getViewportVisibleWorldSize(
    zoom,
    innerWidth,
    innerHeight,
  );
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
  if (zoom <= EDITOR_ZOOM_LEVELS[0]) {
    return 0;
  }

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
  const signedDirection = Math.sign(direction || 0);
  if (signedDirection === 0) {
    return currentZoom;
  }

  if (currentZoom < EDITOR_ZOOM_LEVELS[0]) {
    return signedDirection > 0 ? EDITOR_ZOOM_LEVELS[0] : currentZoom;
  }
  const currentIndex = getNearestEditorZoomIndex(currentZoom);
  const nextIndex = clampNumber(
    currentIndex + signedDirection,
    0,
    EDITOR_ZOOM_LEVELS.length - 1,
  );
  return EDITOR_ZOOM_LEVELS[nextIndex];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getEditorMinZoom(world: World | null | undefined): number {
  const fitZoom = getEditorFitZoom(world);
  if (!Number.isFinite(fitZoom)) {
    return 1;
  }
  return Math.min(EDITOR_ZOOM_LEVELS[0], fitZoom);
}

function getEditorStartZoom(
  world: World | null | undefined,
  minZoom: number,
): number {
  const fitZoom = getEditorFitZoom(world);
  if (!Number.isFinite(fitZoom)) {
    return 1;
  }
  return clampNumber(fitZoom, minZoom, 1);
}

function getEditorFitZoom(world: World | null | undefined): number {
  const worldWidth = Number(world?.terrain?.width);
  const worldHeight = Number(world?.terrain?.height);
  if (
    !Number.isFinite(worldWidth) ||
    !Number.isFinite(worldHeight) ||
    worldWidth <= 0 ||
    worldHeight <= 0
  ) {
    return Number.NaN;
  }

  return Math.min(MAP_WIDTH / worldWidth, MAP_HEIGHT / worldHeight);
}
