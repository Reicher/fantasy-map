import { RENDER_HEIGHT, RENDER_WIDTH } from "../config";
import {
  createViewport,
  getViewportScaleForZoom,
} from "../render/viewport";
import type { RenderOptions, ViewportLike } from "../types/runtime";
import type { World } from "../types/world";

interface CameraStateLike {
  zoom?: number;
}

interface AtlasPadding {
  x: number;
  y: number;
}

interface MountainHit {
  x: number;
  y: number;
  [key: string]: unknown;
}

interface AtlasViewport extends ViewportLike {
  zoom: number;
  centerX: number;
  centerY: number;
}

interface AtlasCacheState {
  canvas: HTMLCanvasElement | null;
  key: string | null;
  worldRef: World | null;
  viewport: AtlasViewport | null;
  mountainGlyphHits: MountainHit[];
  renderWidth: number;
  renderHeight: number;
}

interface MapAtlasCacheManagerDeps {
  canvas: HTMLCanvasElement;
  getWorld: () => World | null | undefined;
  getCameraState: () => CameraStateLike;
  renderStaticScene: (
    canvas: HTMLCanvasElement,
    world: World,
    options?: RenderOptions,
  ) => { mountainGlyphHits?: unknown[] } | undefined;
  getStaticKey?: (renderOptions?: RenderOptions) => string;
  getAtlasPadding?: (world: World, cameraState: CameraStateLike) => AtlasPadding;
}

export function createMapAtlasCacheManager({
  canvas,
  getWorld,
  getCameraState,
  renderStaticScene,
  getStaticKey = () => "",
  getAtlasPadding = () => ({ x: 0, y: 0 }),
}: MapAtlasCacheManagerDeps) {
  const cache: AtlasCacheState = {
    canvas: null,
    key: null,
    worldRef: null,
    viewport: null,
    mountainGlyphHits: [],
    renderWidth: 0,
    renderHeight: 0,
  };

  return {
    ensure(renderOptions: RenderOptions = {}) {
      const world = getWorld();
      if (!world) {
        return false;
      }

      const cameraState = getCameraState();
      const atlas = createMapAtlas(
        world,
        cameraState,
        getAtlasPadding(world, cameraState),
      );
      const cacheCanvas = getOrCreateCacheCanvas(cache, canvas, atlas);
      const cacheKey = [
        canvas.width,
        canvas.height,
        atlas.zoom.toFixed(3),
        atlas.renderWidth.toFixed(2),
        atlas.renderHeight.toFixed(2),
        getStaticKey(renderOptions),
      ].join(":");

      if (cache.worldRef === world && cache.key === cacheKey) {
        return false;
      }

      const result = renderStaticScene(cacheCanvas, world, {
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
      const rawHits = result?.mountainGlyphHits ?? [];
      cache.mountainGlyphHits = rawHits.filter(isMountainHit);
      return true;
    },

    draw(cameraState: CameraStateLike) {
      if (!cache.canvas || !cache.viewport) {
        return null;
      }

      const world = getWorld();
      if (!world) {
        return null;
      }

      const currentViewport = createViewport(world, cameraState);
      const sourceXLogical =
        (currentViewport.leftWorld - cache.viewport.leftWorld) *
        cache.viewport.scaleX;
      const sourceYLogical =
        (currentViewport.topWorld - cache.viewport.topWorld) *
        cache.viewport.scaleY;
      const sourceScaleX = cache.canvas.width / cache.renderWidth;
      const sourceScaleY = cache.canvas.height / cache.renderHeight;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        cache.canvas,
        sourceXLogical * sourceScaleX,
        sourceYLogical * sourceScaleY,
        currentViewport.innerWidth * sourceScaleX,
        currentViewport.innerHeight * sourceScaleY,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      return {
        ...currentViewport,
        mountainGlyphHits: projectMountainHitsToViewport(
          cache.mountainGlyphHits,
          sourceXLogical,
          sourceYLogical,
          currentViewport,
        ),
      };
    },
  };
}

function getOrCreateCacheCanvas(
  cache: AtlasCacheState,
  canvas: HTMLCanvasElement,
  atlas: ReturnType<typeof createMapAtlas>,
): HTMLCanvasElement {
  if (!cache.canvas) {
    cache.canvas = canvas.ownerDocument.createElement("canvas");
  }

  const scaleX = canvas.width / RENDER_WIDTH;
  const scaleY = canvas.height / RENDER_HEIGHT;
  const width = Math.max(1, Math.round(atlas.renderWidth * scaleX));
  const height = Math.max(1, Math.round(atlas.renderHeight * scaleY));

  if (cache.canvas.width !== width || cache.canvas.height !== height) {
    cache.canvas.width = width;
    cache.canvas.height = height;
    cache.key = null;
  }

  return cache.canvas;
}

function createMapAtlas(
  world: World,
  cameraState: CameraStateLike,
  atlasPadding: AtlasPadding = { x: 0, y: 0 },
) {
  // The atlas keeps one world->canvas scale for the current zoom and pads
  // around the world so any camera center can be cropped from the same image.
  const margin = 0;
  const zoom = cameraState?.zoom ?? 1;
  const { scaleX, scaleY } = getViewportScaleForZoom(
    zoom,
    RENDER_WIDTH,
    RENDER_HEIGHT,
  );
  const maxVisibleWidth = RENDER_WIDTH / scaleX;
  const maxVisibleHeight = RENDER_HEIGHT / scaleY;
  const padX = Math.max(0, atlasPadding?.x ?? 0);
  const padY = Math.max(0, atlasPadding?.y ?? 0);
  const leftWorld = -(maxVisibleWidth * 0.5 + padX);
  const topWorld = -(maxVisibleHeight * 0.5 + padY);
  const visibleWidth = world.terrain.width + maxVisibleWidth + padX * 2;
  const visibleHeight = world.terrain.height + maxVisibleHeight + padY * 2;
  const renderWidth = margin * 2 + visibleWidth * scaleX;
  const renderHeight = margin * 2 + visibleHeight * scaleY;

  return {
    zoom,
    renderWidth,
    renderHeight,
    viewport: {
      margin,
      innerWidth: visibleWidth * scaleX,
      innerHeight: visibleHeight * scaleY,
      zoom,
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

function projectMountainHitsToViewport(
  mountainGlyphHits: MountainHit[],
  sourceXLogical: number,
  sourceYLogical: number,
  viewport: ViewportLike,
): MountainHit[] {
  if (!Array.isArray(mountainGlyphHits) || mountainGlyphHits.length === 0) {
    return [];
  }

  const minX = -8;
  const minY = -8;
  const maxX = viewport.innerWidth + 8;
  const maxY = viewport.innerHeight + 8;

  return mountainGlyphHits
    .map((hit) => ({
      ...hit,
      x: hit.x - sourceXLogical,
      y: hit.y - sourceYLogical,
    }))
    .filter(
      (hit) => hit.x >= minX && hit.y >= minY && hit.x <= maxX && hit.y <= maxY,
    );
}

function isMountainHit(value: unknown): value is MountainHit {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}
