import { BIOME_KEYS } from "../config.js";
import { isFrozenLake, isSnowCell } from "../generator/models/surfaceModel.js?v=20260402b";
import {
  ALPHA,
  WORLD_RGB,
  capToBiomePalette,
  capToGamePalette,
  getBiomeBaseRgb,
  rgbToRgbaString,
} from "../colorSystem.js";
import { clamp, coordsOf, forEachNeighbor, indexOf } from "../utils.js";
import { COAST } from "./constants.js";
import { hashSeed, nextHash } from "./hash.js";

export function drawTerrainRaster(ctx, world, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const regionColorById = new Map();
  const lakeById = new Map((world.hydrology.lakes ?? []).map((lake) => [lake.id, lake]));
  const regionCellsById = new Map((world.regions.biomeRegions ?? []).map((region) => [region.id, region.cells]));

  for (const region of world.geometry.biomes) {
    regionColorById.set(
      region.id,
      getRegionFillColor(region, world, regionCellsById.get(region.id) ?? [], showSnow)
    );
  }

  ctx.save();

  for (const region of world.geometry.biomes) {
    const color = regionColorById.get(region.id);
    if (!color) {
      continue;
    }
    fillLoops(ctx, region.loops, viewport, colorToRgba(color), 1.35);
  }

  for (const lake of world.geometry.lakes ?? []) {
    const lakeData = lakeById.get(lake.id);
    const lakeColor = getLakeFillColor(world, lakeData, showSnow);
    fillLoops(ctx, lake.loops, viewport, colorToRgba(lakeColor), 1.2);
  }

  if (showSnow) {
    for (const snowRegion of world.geometry.snowRegions ?? []) {
      fillLoops(
        ctx,
        snowRegion.loops,
        viewport,
        rgbToRgbaString(WORLD_RGB.snow, ALPHA.snowFill),
        1.15
      );
    }
  }

  ctx.restore();
}

function getRegionFillColor(region, world, regionCells, showSnow) {
  if (region.biome !== BIOME_KEYS.MOUNTAIN) {
    return pickCellColor(
      region.biome,
      region.stats.elevation,
      region.stats.mountain,
      region.stats.riverStrength,
      region.stats.temperature,
      region.stats.moisture,
      region.stats.provinceField,
      showSnow
    );
  }

  return pickMountainBackdropColor(region, world, regionCells, showSnow);
}

function pickMountainBackdropColor(region, world, regionCells, showSnow) {
  const { terrain, climate, hydrology } = world;
  const neighborCounts = new Map();

  for (const cell of regionCells) {
    const [x, y] = coordsOf(cell, terrain.width);
    forEachNeighbor(terrain.width, terrain.height, x, y, false, (nx, ny) => {
      const neighborCell = indexOf(nx, ny, terrain.width);
      if (terrain.isLand[neighborCell] !== 1 || hydrology.lakeIdByCell[neighborCell] >= 0) {
        return;
      }

      const neighborBiome = climate.biome[neighborCell];
      if (neighborBiome === BIOME_KEYS.MOUNTAIN || neighborBiome === BIOME_KEYS.LAKE || neighborBiome === BIOME_KEYS.OCEAN) {
        return;
      }

      neighborCounts.set(neighborBiome, (neighborCounts.get(neighborBiome) ?? 0) + 1);
    });
  }

  let dominantBiome = BIOME_KEYS.PLAINS;
  let dominantCount = -1;
  for (const [biome, count] of neighborCounts.entries()) {
    if (count > dominantCount) {
      dominantBiome = biome;
      dominantCount = count;
    }
  }

  const borrowed = pickCellColor(
    dominantBiome,
    region.stats.elevation * 0.55,
    0.08,
    region.stats.riverStrength,
    region.stats.temperature,
    region.stats.moisture,
    region.stats.provinceField,
    showSnow
  );

  const [r, g, b] = capToGamePalette([
    Math.round(borrowed[0] * 0.9 + 214 * 0.1),
    Math.round(borrowed[1] * 0.9 + 205 * 0.1),
    Math.round(borrowed[2] * 0.9 + 191 * 0.1),
  ]);
  return [r, g, b, 255];
}

function getLakeFillColor(world, lake, showSnow) {
  if (!lake) {
    return pickCellColor(BIOME_KEYS.LAKE, 0.18, 0, 0, 0.5, 0.7, 0.5, false);
  }

  if (isFrozenLake(world.climate, world.terrain, lake, showSnow)) {
    return [...WORLD_RGB.lakeFrozen, 255];
  }

  return pickCellColor(BIOME_KEYS.LAKE, 0.18, 0, 0, 0.5, 0.7, 0.5, false);
}

export function drawTerrainTextures(ctx, world, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const { terrain, climate, geometry } = world;
  const startX = clamp(Math.floor(viewport.leftWorld) - 2, 0, terrain.width - 1);
  const endX = clamp(Math.ceil(viewport.leftWorld + viewport.visibleWidth) + 2, 0, terrain.width - 1);
  const startY = clamp(Math.floor(viewport.topWorld) - 2, 0, terrain.height - 1);
  const endY = clamp(Math.ceil(viewport.topWorld + viewport.visibleHeight) + 2, 0, terrain.height - 1);
  const desertLoops = geometry.biomes
    .filter((region) => region.biome === BIOME_KEYS.DESERT)
    .flatMap((region) => region.loops);
  const snowLoops = showSnow ? (geometry.snowRegions ?? []).flatMap((region) => region.loops) : [];

    drawTerrainTexturePass(ctx, viewport, desertLoops, () => {
    ctx.strokeStyle = rgbToRgbaString([165, 136, 86], ALPHA.medium);
    ctx.lineWidth = 0.9;
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const cell = y * terrain.width + x;
        if (climate.biome[cell] !== BIOME_KEYS.DESERT) {
          continue;
        }
        drawTerrainTextureCell(ctx, viewport, cell, x, y, BIOME_KEYS.DESERT);
      }
    }
  });

  if (snowLoops.length > 0) {
    drawTerrainTexturePass(ctx, viewport, snowLoops, () => {
      ctx.strokeStyle = rgbToRgbaString([181, 188, 196], ALPHA.strong);
      ctx.lineWidth = 0.85;
      for (let y = startY; y <= endY; y += 1) {
        for (let x = startX; x <= endX; x += 1) {
          const cell = y * terrain.width + x;
          const biomeKey = climate.biome[cell];
          if (
            !isSnowCell(
              biomeKey,
              terrain.elevation[cell],
              terrain.mountainField[cell],
              climate.temperature[cell],
              showSnow
            )
          ) {
            continue;
          }
          drawTerrainTextureCell(ctx, viewport, cell, x, y, "snow");
        }
      }
    });
  }
}

export function drawShorelines(ctx, geometry, viewport) {
  strokeLoops(
    ctx,
    geometry.coastlineLoops ?? [],
    viewport,
    rgbToRgbaString([126, 104, 72], ALPHA.subtle),
    2.6,
    null,
    0.75
  );
  strokeLoops(ctx, geometry.coastlineLoops ?? [], viewport, COAST, 1.45, null, 0.5);
  const lakeLoops = (geometry.lakes ?? []).flatMap((lake) => lake.loops);
  strokeLoops(ctx, lakeLoops, viewport, rgbToRgbaString([104, 118, 126], ALPHA.subtle), 1.8, null, 0.45);
  strokeLoops(ctx, lakeLoops, viewport, rgbToRgbaString([69, 92, 101], ALPHA.vivid), 0.95, null, 0.3);
}

export function drawBiomeBorders(ctx, geometry, viewport) {
  ctx.save();
  for (const region of geometry.biomes) {
    if (region.biome === BIOME_KEYS.MOUNTAIN) {
      continue;
    }
    strokeLoops(
      ctx,
      region.loops,
      viewport,
      rgbToRgbaString([90, 73, 49], ALPHA.soft),
      0.75,
      null,
      0.18
    );
  }
  ctx.restore();
}

function pickCellColor(biomeKey, elevation, mountain, riverStrength, temperature, moisture, provinceField, showSnow) {
  const baseColor = getBiomeBaseRgb(biomeKey);
  if (!baseColor) {
    return [0, 0, 0, 255];
  }

  if (biomeKey === BIOME_KEYS.OCEAN) {
    return [...WORLD_RGB.ocean, 255];
  }

  const [r, g, b] = baseColor;
  let mix = 0.1 + elevation * 0.14 + mountain * 0.06;
  if (biomeKey === BIOME_KEYS.LAKE) {
    mix = 0.02;
  } else if (biomeKey === BIOME_KEYS.MOUNTAIN) {
    mix += 0.1;
  }
  const riverTint = biomeKey > 1 ? clamp(riverStrength * 0.02, 0, 0.08) : 0;
  const warmth = (temperature - 0.5) * 24;
  const wetness = (moisture - 0.5) * 22;
  const provinceTint = (provinceField - 0.5) * 16;
  const rr = clamp(
    Math.round(r * (1 - mix) + 231 * mix - 26 * riverTint + warmth * 0.6 - wetness * 0.15 + provinceTint * 0.45),
    0,
    255
  );
  const gg = clamp(
    Math.round(g * (1 - mix) + 217 * mix - 10 * riverTint + wetness * 0.7 + provinceTint * 0.2),
    0,
    255
  );
  const bb = clamp(
    Math.round(b * (1 - mix) + 190 * mix + 18 * riverTint - warmth * 0.2 - provinceTint * 0.18),
    0,
    255
  );

  if (biomeKey === BIOME_KEYS.MOUNTAIN) {
    return [...WORLD_RGB.mountain, 255];
  }

  if (isSnowCell(biomeKey, elevation, mountain, temperature, showSnow)) {
    return [...WORLD_RGB.snow, 255];
  }

  const capped = capToBiomePalette([rr, gg, bb], biomeKey);
  return [capped[0], capped[1], capped[2], 255];
}

function fillLoops(ctx, loops, viewport, fillStyle, sealWidth = 1.2) {
  if (!loops.length) {
    return;
  }

  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = fillStyle;
  ctx.lineWidth = sealWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const loop of loops) {
    traceLoop(ctx, loop, viewport, sealWidth, false);
  }
  ctx.fill("evenodd");
  if (sealWidth > 0) {
    ctx.stroke();
  }
}

function clipLoops(ctx, loops, viewport) {
  if (!loops.length) {
    return false;
  }

  ctx.beginPath();
  for (const loop of loops) {
    traceLoop(ctx, loop, viewport, 1, false);
  }
  ctx.clip("evenodd");
  return true;
}

function strokeLoops(ctx, loops, viewport, strokeStyle, lineWidth, snap = null, wobble = 0) {
  if (!loops.length) {
    return;
  }

  const shouldSnap = snap ?? Math.min(viewport.scaleX, viewport.scaleY) >= 3.2;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const loop of loops) {
    traceLoop(ctx, loop, viewport, lineWidth, shouldSnap, wobble);
  }
  ctx.stroke();
}

function traceLoop(ctx, loop, viewport, lineWidth = 1, snap = false, wobble = 0) {
  if (loop.length === 0) {
    return;
  }

  const points =
    wobble > 0 ? wobbleLoopPoints(loop, viewport, lineWidth, snap, wobble) : loop.map((point) => edgePoint(viewport, point.x, point.y, lineWidth, snap));
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function wobbleLoopPoints(loop, viewport, lineWidth, snap, wobble) {
  const basePoints = loop.map((point) => edgePoint(viewport, point.x, point.y, lineWidth, snap));
  const wobbleScale = wobble * Math.max(0.4, Math.min(1.3, viewport.zoom * 0.72));

  return basePoints.map((point, index) => {
    const previous = basePoints[(index - 1 + basePoints.length) % basePoints.length];
    const next = basePoints[(index + 1) % basePoints.length];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const normalX = -tangentY / length;
    const normalY = tangentX / length;
    const jitter = (pointNoise(loop[index].x, loop[index].y, index) - 0.5) * 2 * wobbleScale;

    return {
      x: point.x + normalX * jitter,
      y: point.y + normalY * jitter
    };
  });
}

function edgePoint(viewport, x, y, lineWidth, snap) {
  const point = {
    x: viewport.margin + (x - viewport.leftWorld) * viewport.scaleX,
    y: viewport.margin + (y - viewport.topWorld) * viewport.scaleY
  };

  if (!snap) {
    return point;
  }

  return {
    x: snapToPixel(point.x, lineWidth),
    y: snapToPixel(point.y, lineWidth)
  };
}

function snapToPixel(value, lineWidth) {
  const align = lineWidth <= 1 ? 0.5 : 0;
  return Math.round(value - align) + align;
}

function pointNoise(x, y, index) {
  let state = hashSeed(`loop:${x},${y},${index}`);
  state = nextHash(state);
  return state / 4294967295;
}

function colorToRgba(color) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(color[3] ?? 255) / 255})`;
}

function drawTextureMark(ctx, x, y, length, amplitude) {
  const segments = 2;
  const segmentLength = length / segments;
  const startX = x - length * 0.5;

  for (let index = 0; index < segments; index += 1) {
    const segmentX = startX + index * segmentLength;
    const midX = segmentX + segmentLength * 0.5;
    const endX = segmentX + segmentLength;
    const localAmplitude = amplitude * (0.82 + index * 0.08);

    ctx.beginPath();
    ctx.moveTo(segmentX, y);
    ctx.quadraticCurveTo(
      segmentX + segmentLength * 0.26,
      y - localAmplitude,
      midX,
      y
    );
    ctx.quadraticCurveTo(
      segmentX + segmentLength * 0.74,
      y + localAmplitude * 0.68,
      endX,
      y
    );
    ctx.stroke();
  }
}

function drawTerrainTexturePass(ctx, viewport, loops, drawFn) {
  if (!loops.length) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  if (!clipLoops(ctx, loops, viewport)) {
    ctx.restore();
    return;
  }
  drawFn();
  ctx.restore();
}

function drawTerrainTextureCell(ctx, viewport, cell, x, y, type) {
  let state = hashSeed(`terrain-texture:${cell}`);
  state = nextHash(state);
  const chance = (state % 1000) / 1000;
  const threshold = type === BIOME_KEYS.DESERT ? 0.06 : 0.05;
  if (chance > threshold) {
    return;
  }

  const point = viewport.worldToCanvas(x, y);
  state = nextHash(state);
  const jitterX = ((state % 1000) / 1000 - 0.5) * viewport.scaleX * 0.55;
  state = nextHash(state);
  const jitterY = ((state % 1000) / 1000 - 0.5) * viewport.scaleY * 0.45;
  state = nextHash(state);
  const length =
    type === BIOME_KEYS.DESERT
      ? 4.4 + ((state % 1000) / 1000) * 4.8
      : 3.8 + ((state % 1000) / 1000) * 4.1;
  state = nextHash(state);
  const amplitude =
    type === BIOME_KEYS.DESERT
      ? 0.7 + ((state % 1000) / 1000) * 1.4
      : 0.55 + ((state % 1000) / 1000) * 1.1;

  drawTextureMark(ctx, point.x + jitterX, point.y + jitterY, length, amplitude);
}
