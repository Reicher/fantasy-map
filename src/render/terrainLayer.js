import { BIOME_INFO, BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260401a";
import { clamp } from "../utils.js";
import { COAST } from "./constants.js";
import { hashSeed, nextHash } from "./hash.js";

export function drawTerrainRaster(ctx, world, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const regionColorById = new Map();

  for (const region of world.geometry.biomes) {
    regionColorById.set(
      region.id,
      pickCellColor(
        region.biome,
        region.stats.elevation,
        region.stats.mountain,
        region.stats.riverStrength,
        region.stats.temperature,
        region.stats.moisture,
        region.stats.provinceField,
        showSnow
      )
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

  const lakeColor = pickCellColor(BIOME_KEYS.LAKE, 0.18, 0, 0, 0.5, 0.7, 0.5, false);
  for (const lake of world.geometry.lakes ?? []) {
    fillLoops(ctx, lake.loops, viewport, colorToRgba(lakeColor), 1.2);
  }

  if (showSnow) {
    for (const snowRegion of world.geometry.snowRegions ?? []) {
      fillLoops(ctx, snowRegion.loops, viewport, "rgba(244, 243, 238, 0.99)", 1.15);
    }
  }

  ctx.restore();
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
    ctx.strokeStyle = "rgba(165, 136, 86, 0.42)";
    ctx.lineWidth = 0.9;
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const cell = y * terrain.width + x;
        if (climate.biome[cell] !== BIOME_KEYS.DESERT) {
          continue;
        }
        drawTerrainTextureCell(ctx, viewport, cell, x, y, terrain.width, BIOME_KEYS.DESERT);
      }
    }
  });

  if (snowLoops.length > 0) {
    drawTerrainTexturePass(ctx, viewport, snowLoops, () => {
      ctx.strokeStyle = "rgba(181, 188, 196, 0.52)";
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
          drawTerrainTextureCell(ctx, viewport, cell, x, y, terrain.width, "snow");
        }
      }
    });
  }
}

export function drawShorelines(ctx, geometry, viewport) {
  strokeLoops(ctx, geometry.coastlineLoops ?? [], viewport, COAST, 1.5);
  const lakeLoops = (geometry.lakes ?? []).flatMap((lake) => lake.loops);
  strokeLoops(ctx, lakeLoops, viewport, "rgba(69, 92, 101, 0.72)", 1);
}

export function drawBiomeBorders(ctx, geometry, viewport) {
  ctx.save();
  for (const region of geometry.biomes) {
    strokeLoops(
      ctx,
      region.loops,
      viewport,
      region.biome === BIOME_KEYS.MOUNTAIN ? "rgba(78, 62, 42, 0.26)" : "rgba(90, 73, 49, 0.16)",
      region.biome === BIOME_KEYS.MOUNTAIN ? 1 : 0.75
    );
  }
  ctx.restore();
}

function pickCellColor(biomeKey, elevation, mountain, riverStrength, temperature, moisture, provinceField, showSnow) {
  const info = BIOME_INFO[biomeKey];
  if (!info) {
    return [0, 0, 0, 255];
  }

  if (biomeKey === BIOME_KEYS.OCEAN) {
    return [138, 160, 168, 255];
  }

  const [r, g, b] = hexToRgb(info.color);
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
    return [
      clamp(rr - 18, 0, 255),
      clamp(gg - 16, 0, 255),
      clamp(bb - 14, 0, 255),
      255
    ];
  }

  if (isSnowCell(biomeKey, elevation, mountain, temperature, showSnow)) {
    return [244, 243, 238, 255];
  }

  return [rr, gg, bb, 255];
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

function strokeLoops(ctx, loops, viewport, strokeStyle, lineWidth, snap = null) {
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
    traceLoop(ctx, loop, viewport, lineWidth, shouldSnap);
  }
  ctx.stroke();
}

function traceLoop(ctx, loop, viewport, lineWidth = 1, snap = false) {
  if (loop.length === 0) {
    return;
  }

  const points = loop.map((point) => edgePoint(viewport, point.x, point.y, lineWidth, snap));
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
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

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
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

function drawTerrainTextureCell(ctx, viewport, cell, x, y, width, type) {
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
