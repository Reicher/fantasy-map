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

export { createViewport } from "./viewport";

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
    showRoads: true,
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
    showRoads: false,
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
  const { terrain, hydrology, climate, regions, geometry } = world;
  const nodes = ((world.features as any)?.nodes ?? []) as any[];
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
  drawTerrainRaster(ctx, world, viewport, options);
  if (showOceanWaves) {
    drawOceanWaves(ctx, terrain, climate, geometry, viewport);
  }
  if (showTerrainTextures) {
    drawTerrainTextures(ctx, world, viewport, options);
  }
  if (showLakeWaves) {
    drawLakeWaves(
      ctx,
      hydrology,
      climate,
      terrain,
      geometry,
      viewport,
      terrain.width,
    );
  }
  if (showBiomeBorders) {
    drawBiomeBorders(ctx, geometry, viewport);
  }
  if (showShorelines) {
    drawShorelines(ctx, geometry, viewport);
  }
  drawRivers(ctx, geometry, viewport);
  if (showRoads) {
    drawRoads(ctx, geometry, viewport, options.roadOverlay);
  }
  let mountainGlyphHits: unknown[] = [];
  if (showEnvironmentGlyphs) {
    const forestEntries = collectForestRenderGlyphs(
      world,
      viewport,
      options,
    ).map((entry) => ({
      type: "forest",
      footY: entry.footY,
      entry,
    }));
    const { glyphs: mountainGlyphs, glyphHits } = collectMountainRenderGlyphs(
      terrain,
      climate,
      regions,
      geometry,
      viewport,
      options,
    );
    mountainGlyphHits = glyphHits;
    const environmentEntries: any[] = [
      ...forestEntries,
      ...mountainGlyphs.map((glyph) => ({
        type: "mountain",
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
      viewport,
      options.nodeOverlay ?? {},
    );
  }
  if (showFogOfWar && options.fogOfWar?.enabled) {
    drawFogOfWar(ctx, world, viewport, options.fogOfWar);
  }
  if (showLabels) {
    drawLabels(ctx, world, viewport, options);
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
  const geometry = world.geometry;
  const nodes = ((world.features as any)?.nodes ?? []) as any[];
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
  ctx.restore();

  if (showFogOfWar && options.fogOfWar?.enabled) {
    drawFogOfWar(ctx, world, viewport, options.fogOfWar);
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
  if (showRoads) {
    drawRoads(ctx, geometry, viewport, options.roadOverlay);
  }
  if (showPlayerMarker) {
    drawPlayerMarker(ctx, options.playerStart ?? null, viewport);
  }
  if (showNodes) {
    drawNodes(
      ctx,
      nodes,
      viewport,
      options.nodeOverlay ?? {},
    );
  }
  if (showLabels) {
    drawLabels(ctx, world, viewport, options);
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
