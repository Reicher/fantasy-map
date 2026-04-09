import { RENDER_HEIGHT, RENDER_WIDTH } from "../config.js";
import {
  drawPaper,
  drawOcean,
  drawFrame,
} from "./backgroundLayer.js?v=20260401e";
import { drawCities, drawPlayerMarker } from "./citiesLayer.js?v=20260403c";
import { drawTravelDebugOverlay } from "./debugLayer.js?v=20260404a";
import { drawFogOfWar } from "./fogLayer.js?v=20260403h";
import {
  collectForestRenderGlyphs,
  drawForestEntry,
} from "./forestLayer.js?v=20260403o";
import { drawLabels } from "./labelsLayer.js?v=20260402l";
import {
  collectMountainRenderGlyphs,
  drawMountainGlyph,
  getMountainFootY,
} from "./mountainsLayer.js?v=20260403h";
import { drawRoads } from "./roadsLayer.js?v=20260403a";
import {
  drawBiomeBorders,
  drawTerrainRaster,
  drawTerrainTextures,
  drawShorelines,
} from "./terrainLayer.js?v=20260402j";
import { createViewport } from "./viewport.js?v=20260331l";
import {
  drawLakeWaves,
  drawOceanWaves,
  drawRivers,
} from "./waterLayer.js?v=20260403a";

export { createViewport } from "./viewport.js?v=20260331l";

export function renderEditorWorld(canvas, world, options = {}) {
  return renderScene(canvas, world, options, {
    showPaper: true,
    showTerrainTextures: true,
    showLabels: true,
    showFrame: false,
    showPlayerMarker: true,
  });
}

export function renderPlayWorldScene(canvas, world, options = {}) {
  renderPlayWorldStatic(canvas, world, options);
  return renderPlayWorldDynamic(canvas, world, options);
}

export function renderPlayWorldStatic(canvas, world, options = {}) {
  return renderScene(canvas, world, options, {
    showPaper: false,
    showTerrainTextures: false,
    showLabels: false,
    showFrame: false,
    showPlayerMarker: false,
    showCities: false,
    showOceanWaves: true,
    showLakeWaves: true,
    showBiomeBorders: true,
    showShorelines: true,
    showEnvironmentGlyphs: true,
    showFogOfWar: false,
  });
}

export function renderPlayWorldDynamic(canvas, world, options = {}) {
  return renderDynamicOverlays(canvas, world, options, {
    showPlayerMarker: true,
    showCities: true,
    showLabels: true,
    showFogOfWar: true,
  });
}

function renderScene(canvas, world, options = {}, scene = {}) {
  const ctx = canvas.getContext("2d");
  const viewport =
    options.viewport ?? createViewport(world, options.cameraState);
  const { terrain, hydrology, climate, regions, geometry } = world;
  const pointsOfInterest =
    world.pointsOfInterest ?? world.features?.pointsOfInterest ?? world.cities;
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
    showCities = true,
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
  let mountainGlyphHits = [];
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
    const environmentEntries = [
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
  drawRoads(ctx, geometry, viewport);
  if (showCities) {
    drawCities(
      ctx,
      pointsOfInterest,
      viewport,
      options.poiOverlay ?? options.cityOverlay ?? {},
    );
  }
  if (showFogOfWar && options.fogOfWar?.enabled) {
    drawFogOfWar(ctx, world, viewport, options.fogOfWar);
  }
  if (showPlayerMarker) {
    drawPlayerMarker(ctx, options.playerStart ?? null, viewport);
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

function renderDynamicOverlays(canvas, world, options = {}, scene = {}) {
  const ctx = canvas.getContext("2d");
  const viewport =
    options.viewport ?? createViewport(world, options.cameraState);
  const pointsOfInterest =
    world.pointsOfInterest ?? world.features?.pointsOfInterest ?? world.cities;
  const renderWidth = options.renderWidth ?? RENDER_WIDTH;
  const renderHeight = options.renderHeight ?? RENDER_HEIGHT;
  const scaleX = canvas.width / renderWidth;
  const scaleY = canvas.height / renderHeight;
  const {
    showPlayerMarker = true,
    showCities = true,
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
  if (showCities) {
    drawCities(
      ctx,
      pointsOfInterest,
      viewport,
      options.poiOverlay ?? options.cityOverlay ?? {},
    );
  }
  if (showLabels) {
    drawLabels(ctx, world, viewport, options);
  }
  ctx.restore();
  if (showPlayerMarker) {
    drawPlayerMarker(ctx, options.playerStart ?? null, viewport);
  }
  if (options.travelDebug?.enabled) {
    drawTravelDebugOverlay(ctx, viewport, options.travelDebug);
  }
  ctx.restore();

  return {
    ...viewport,
    mountainGlyphHits: [],
  };
}
