import { RENDER_HEIGHT, RENDER_WIDTH } from "../config";
import {
  drawPaper,
  drawOcean,
  drawFrame,
} from "./backgroundLayer";
import { drawNodes, drawPlayerMarker } from "./nodesLayer";
import { drawTravelDebugOverlay } from "./debugLayer";
import { drawFogOfWar } from "./fogLayer";
import {
  collectForestRenderGlyphs,
  drawForestEntry,
} from "./forestLayer";
import { drawLabels } from "./labelsLayer";
import {
  collectMountainRenderGlyphs,
  drawMountainGlyph,
  getMountainFootY,
} from "./mountainsLayer";
import { drawRoads } from "./roadsLayer";
import {
  drawBiomeBorders,
  drawTerrainRaster,
  drawTerrainTextures,
  drawShorelines,
} from "./terrainLayer";
import { createViewport } from "./viewport";
import {
  drawLakeWaves,
  drawOceanWaves,
  drawRivers,
} from "./waterLayer";
import type { RenderOptions, SceneOptions, ViewportLike } from "../types/runtime";
import type { World } from "../types/world";
import type { NodeLike } from "../node/model";

export { createViewport } from "./viewport";

type RenderNode = { id: number; x: number; y: number; marker?: string };
type EnvironmentEntry =
  | { type: "forest"; footY: number; entry: unknown }
  | { type: "mountain"; footY: number; glyph: unknown };

export function renderEditorWorld(
  canvas: HTMLCanvasElement,
  world: World,
  options: RenderOptions = {},
) {
  return renderScene(canvas, world, options, {
    showPaper: true,
    showTerrainTextures: true,
    showLabels: true,
    showFrame: false,
    showPlayerMarker: true,
  });
}

export function renderPlayWorldStatic(
  canvas: HTMLCanvasElement,
  world: World,
  options: RenderOptions = {},
) {
  return renderScene(canvas, world, options, {
    showPaper: false,
    showTerrainTextures: false,
    showLabels: false,
    showFrame: false,
    showPlayerMarker: false,
    showNodes: false,
    showRoads: false,
    showOceanWaves: true,
    showLakeWaves: true,
    showBiomeBorders: true,
    showShorelines: true,
    showEnvironmentGlyphs: true,
    showFogOfWar: false,
  });
}

export function renderPlayWorldDynamic(
  canvas: HTMLCanvasElement,
  world: World,
  options: RenderOptions = {},
) {
  return renderDynamicOverlays(canvas, world, options, {
    showPlayerMarker: true,
    showRoads: true,
    showNodes: true,
    showLabels: true,
    showFogOfWar: true,
  });
}

function renderScene(
  canvas: HTMLCanvasElement,
  world: World,
  options: RenderOptions = {},
  scene: SceneOptions = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }
  const viewport =
    (options.viewport as ViewportLike | undefined) ??
    createViewport(world, options.cameraState);
  const viewportWithZoom = ensureViewportWithZoom(
    viewport,
    options.cameraState?.zoom,
  );
  const { terrain, hydrology, climate, regions, geometry } = world;
  const nodes = getWorldNodes(world);
  const renderWidth = options.renderWidth ?? RENDER_WIDTH;
  const renderHeight = options.renderHeight ?? RENDER_HEIGHT;
  const scaleX = canvas.width / renderWidth;
  const scaleY = canvas.height / renderHeight;
  const {
    showPaper = true,
    showTerrainTextures = true,
    showLabels = true,
    showFrame = true,
    showPlayerMarker = true,
    showNodes = true,
    showRoads = true,
    showOceanWaves = true,
    showLakeWaves = true,
    showBiomeBorders = true,
    showShorelines = true,
    showEnvironmentGlyphs = true,
    showFogOfWar = false,
  } = scene;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.filter = options.showMonochrome ? "grayscale(1)" : "none";
  if (showPaper) {
    drawPaper(ctx, renderWidth, renderHeight, world.params.seed);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    viewport.margin,
    viewport.margin,
    viewport.innerWidth,
    viewport.innerHeight,
  );
  ctx.clip();
  drawOcean(ctx, renderWidth, renderHeight);
  drawTerrainRaster(ctx, world, viewportWithZoom, options);
  if (showOceanWaves) {
    drawOceanWaves(ctx, terrain, climate, geometry, viewportWithZoom);
  }
  if (showTerrainTextures) {
    drawTerrainTextures(ctx, world, viewportWithZoom, options);
  }
  if (showLakeWaves) {
    drawLakeWaves(
      ctx,
      hydrology,
      climate,
      terrain,
      geometry,
      viewportWithZoom,
      terrain.width,
    );
  }
  if (showBiomeBorders) {
    drawBiomeBorders(ctx, geometry, viewportWithZoom);
  }
  if (showShorelines) {
    drawShorelines(ctx, geometry, viewportWithZoom);
  }
  drawRivers(ctx, geometry, viewportWithZoom);
  if (showRoads) {
    drawRoads(ctx, geometry, viewportWithZoom, options.roadOverlay);
  }
  let mountainGlyphHits: unknown[] = [];
  if (showEnvironmentGlyphs) {
    const forestEntries = collectForestRenderGlyphs(
      world,
      viewportWithZoom,
      options,
    ).map((entry) => ({
      type: "forest" as const,
      footY: Number(entry?.footY ?? 0),
      entry,
    }));
    const { glyphs: mountainGlyphs, glyphHits } = collectMountainRenderGlyphs(
      terrain,
      climate,
      regions,
      geometry,
      viewportWithZoom,
      options,
    );
    mountainGlyphHits = glyphHits;
    const environmentEntries: EnvironmentEntry[] = [
      ...forestEntries,
      ...mountainGlyphs.map((glyph) => ({
        type: "mountain" as const,
        footY: getMountainFootY(glyph),
        glyph,
      })),
    ].sort((a, b) => a.footY - b.footY);
    for (const item of environmentEntries) {
      if (item.type === "forest") {
        drawForestEntry(ctx, item.entry);
      } else {
        drawMountainGlyph(ctx, item.glyph);
      }
    }
  }
  if (showPlayerMarker) {
    drawPlayerMarker(ctx, options.playerStart ?? null, viewport);
  }
  if (showNodes) {
    drawNodes(
      ctx,
      nodes,
      viewportWithZoom,
      options.nodeOverlay ?? {},
    );
  }
  if (showFogOfWar && options.fogOfWar?.enabled) {
    drawFogOfWar(ctx, world, viewportWithZoom, options.fogOfWar);
  }
  if (showLabels) {
    drawLabels(ctx, world, viewportWithZoom, options);
  }
  ctx.restore();
  if (showFrame) {
    drawFrame(ctx, renderWidth, renderHeight);
  }
  ctx.restore();

  return {
    ...viewport,
    mountainGlyphHits,
  };
}

function renderDynamicOverlays(
  canvas: HTMLCanvasElement,
  world: World,
  options: RenderOptions = {},
  scene: SceneOptions = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }
  const viewport =
    (options.viewport as ViewportLike | undefined) ??
    createViewport(world, options.cameraState);
  const viewportWithZoom = ensureViewportWithZoom(
    viewport,
    options.cameraState?.zoom,
  );
  const geometry = world.geometry;
  const nodes = getWorldNodes(world);
  const renderWidth = options.renderWidth ?? RENDER_WIDTH;
  const renderHeight = options.renderHeight ?? RENDER_HEIGHT;
  const scaleX = canvas.width / renderWidth;
  const scaleY = canvas.height / renderHeight;
  const {
    showPlayerMarker = true,
    showRoads = false,
    showNodes = true,
    showLabels = false,
    showFogOfWar = false,
  } = scene;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.filter = options.showMonochrome ? "grayscale(1)" : "none";
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    viewport.margin,
    viewport.margin,
    viewport.innerWidth,
    viewport.innerHeight,
  );
  ctx.clip();
  if (showFogOfWar && options.fogOfWar?.enabled) {
    drawFogOfWar(ctx, world, viewportWithZoom, options.fogOfWar);
  }
  if (showRoads) {
    drawRoads(ctx, geometry, viewportWithZoom, options.roadOverlay);
  }
  if (showPlayerMarker) {
    drawPlayerMarker(ctx, options.playerStart ?? null, viewportWithZoom);
  }
  if (showNodes) {
    drawNodes(
      ctx,
      nodes,
      viewportWithZoom,
      options.nodeOverlay ?? {},
    );
  }
  if (showLabels) {
    drawLabels(ctx, world, viewportWithZoom, options);
  }
  ctx.restore();
  if (options.travelDebug?.enabled) {
    drawTravelDebugOverlay(ctx, viewport, options.travelDebug);
  }
  ctx.restore();

  return {
    ...viewport,
    mountainGlyphHits: [],
  };
}

function getWorldNodes(world: World): RenderNode[] {
  const features = world.features as
    | { nodes?: Array<(NodeLike & { id?: unknown; x?: unknown; y?: unknown }) | undefined> }
    | null
    | undefined;
  const nodes = Array.isArray(features?.nodes) ? features.nodes : [];
  return nodes
    .filter((node) =>
      Number.isInteger(node?.id) &&
      Number.isFinite(node?.x) &&
      Number.isFinite(node?.y),
    )
    .map((node) => ({
      id: Number(node?.id),
      x: Number(node?.x),
      y: Number(node?.y),
      marker: typeof node?.marker === "string" ? node.marker : undefined,
    }));
}

function ensureViewportWithZoom(
  viewport: ViewportLike,
  fallbackZoom: unknown,
): ViewportLike & { zoom: number } {
  const currentZoom = (viewport as { zoom?: unknown })?.zoom;
  const numericZoom = Number(
    Number.isFinite(Number(currentZoom)) ? currentZoom : fallbackZoom,
  );
  const zoom = Number.isFinite(numericZoom) && numericZoom > 0 ? numericZoom : 1;
  return {
    ...(viewport as ViewportLike & { [key: string]: unknown }),
    zoom,
  };
}
