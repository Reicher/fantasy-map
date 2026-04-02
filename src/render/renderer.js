import { drawPaper, drawOcean, drawFrame } from "./backgroundLayer.js?v=20260401e";
import { drawCities, drawPlayerMarker } from "./citiesLayer.js?v=20260401a";
import { drawForests } from "./forestLayer.js?v=20260402g";
import { drawLabels } from "./labelsLayer.js?v=20260402h";
import { drawMountains } from "./mountainsLayer.js?v=20260402b";
import { drawRoads } from "./roadsLayer.js?v=20260401c";
import { drawBiomeBorders, drawTerrainRaster, drawTerrainTextures, drawShorelines } from "./terrainLayer.js?v=20260402d";
import { createViewport } from "./viewport.js?v=20260331l";
import { drawLakeWaves, drawOceanWaves, drawRivers } from "./waterLayer.js?v=20260402i";

export { createViewport } from "./viewport.js?v=20260331l";

export function renderWorld(canvas, world, options = {}) {
  const ctx = canvas.getContext("2d");
  const viewport = createViewport(world, options.cameraState);
  const { terrain, hydrology, climate, regions, cities, geometry } = world;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPaper(ctx, canvas.width, canvas.height, world.params.seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(viewport.margin, viewport.margin, viewport.innerWidth, viewport.innerHeight);
  ctx.clip();
  drawOcean(ctx, canvas.width, canvas.height);
  drawTerrainRaster(ctx, world, viewport, options);
  drawOceanWaves(ctx, terrain, climate, geometry, viewport);
  drawTerrainTextures(ctx, world, viewport, options);
  drawLakeWaves(ctx, hydrology, geometry, viewport, terrain.width);
  drawBiomeBorders(ctx, geometry, viewport);
  drawShorelines(ctx, geometry, viewport);
  drawRivers(ctx, geometry, viewport);
  drawForests(ctx, world, viewport);
  drawMountains(ctx, terrain, climate, regions, geometry, viewport, options);
  drawRoads(ctx, geometry, viewport);
  drawCities(ctx, cities, viewport, options.cityOverlay ?? {});
  drawPlayerMarker(ctx, options.playerStart ?? null, viewport);
  drawLabels(ctx, world, viewport, options);
  ctx.restore();
  drawFrame(ctx, canvas.width, canvas.height);

  return viewport;
}
