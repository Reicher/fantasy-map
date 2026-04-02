import { BIOME_KEYS } from "../config.js";
import { clamp, coordsOf } from "../utils.js";
import { hashSeed, nextHash } from "./hash.js";
import { WATER_DARK } from "./constants.js";

export function drawRivers(ctx, geometry, viewport) {
  const rivers = geometry?.rivers ?? [];
  ctx.strokeStyle = WATER_DARK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const river of rivers) {
    const points = river.points.map((point) => viewport.worldToCanvas(point.x - 0.5, point.y - 0.5));
    if (points.length < 2) {
      continue;
    }

    ctx.lineWidth = clamp(1.1 + river.width * 0.55 + river.cellCount / 42, 1, 4.6);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index += 1) {
      const midpointX = (points[index].x + points[index + 1].x) * 0.5;
      const midpointY = (points[index].y + points[index + 1].y) * 0.5;
      ctx.quadraticCurveTo(points[index].x, points[index].y, midpointX, midpointY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

export function drawLakeWaves(ctx, hydrology, geometry, viewport, width) {
  const lakeGeometryById = new Map((geometry.lakes ?? []).map((lake) => [lake.id, lake]));

  for (const lake of hydrology.lakes) {
    if (lake.cells.length < 3) {
      continue;
    }

    const lakeGeometry = lakeGeometryById.get(lake.id);
    if (!lakeGeometry?.loops?.length) {
      continue;
    }

    let state = hashSeed(`lake:${lake.id}:${lake.cells.length}`);
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    clipLoops(ctx, lakeGeometry.loops, viewport);

    for (const cell of lake.cells) {
      state = nextHash(state);
      if ((state % 1000) / 1000 > 0.042) {
        continue;
      }

      const [x, y] = coordsOf(cell, width);
      const point = viewport.worldToCanvas(x, y);
      state = nextHash(state);
      const length = 10 + ((state % 1000) / 1000) * Math.max(9, viewport.scaleX * 1.45);
      state = nextHash(state);
      const amplitude = 1.4 + ((state % 1000) / 1000) * 2.8;
      ctx.strokeStyle = "rgba(235, 229, 214, 0.38)";
      drawLakeWaveMark(ctx, point.x, point.y + 0.6, length, amplitude);
      ctx.strokeStyle = "rgba(70, 92, 100, 0.48)";
      drawLakeWaveMark(ctx, point.x, point.y, length, amplitude);
    }

    ctx.restore();
  }
}

export function drawOceanWaves(ctx, terrain, climate, geometry, viewport) {
  const spacing = 4;
  const startX = Math.floor((viewport.leftWorld - 2) / spacing) * spacing;
  const endX = Math.ceil((viewport.leftWorld + viewport.visibleWidth + 2) / spacing) * spacing;
  const startY = Math.floor((viewport.topWorld - 2) / spacing) * spacing;
  const endY = Math.ceil((viewport.topWorld + viewport.visibleHeight + 2) / spacing) * spacing;

  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  clipOceanArea(ctx, geometry, viewport);

  for (let y = startY; y <= endY; y += spacing) {
    for (let x = startX; x <= endX; x += spacing) {
      if (!isOceanWaveAnchor(x, y, terrain, climate)) {
        continue;
      }

      let state = hashSeed(`ocean-wave:${x},${y}`);
      state = nextHash(state);
      if ((state % 1000) / 1000 > 0.038) {
        continue;
      }

      const point = viewport.worldToCanvas(x, y);
      state = nextHash(state);
      const jitterX = ((state % 1000) / 1000 - 0.5) * viewport.scaleX * spacing * 0.22;
      state = nextHash(state);
      const jitterY = ((state % 1000) / 1000 - 0.5) * viewport.scaleY * spacing * 0.18;
      state = nextHash(state);
      const length = 11 + ((state % 1000) / 1000) * Math.max(7, viewport.scaleX * 0.95);
      state = nextHash(state);
      const amplitude = 1.2 + ((state % 1000) / 1000) * 1.8;

      ctx.strokeStyle = "rgba(234, 229, 214, 0.36)";
      drawLakeWaveMark(ctx, point.x + jitterX, point.y + jitterY + 0.7, length, amplitude);
      ctx.strokeStyle = "rgba(65, 83, 90, 0.46)";
      drawLakeWaveMark(ctx, point.x + jitterX, point.y + jitterY, length, amplitude);
    }
  }

  ctx.restore();
}

function isOceanWaveAnchor(x, y, terrain, climate) {
  const sampleX = Math.round(x);
  const sampleY = Math.round(y);
  if (sampleX < 0 || sampleY < 0 || sampleX >= terrain.width || sampleY >= terrain.height) {
    return true;
  }

  const cell = sampleY * terrain.width + sampleX;
  return terrain.isLand[cell] !== 1 && climate.biome[cell] !== BIOME_KEYS.LAKE;
}

function drawLakeWaveMark(ctx, x, y, length, amplitude) {
  const segments = 2 + (length > 12 ? 1 : 0);
  const segmentLength = length / segments;
  const startX = x - length * 0.5;

  for (let index = 0; index < segments; index += 1) {
    const segmentX = startX + index * segmentLength;
    const midX = segmentX + segmentLength * 0.5;
    const endX = segmentX + segmentLength;
    const localAmplitude = amplitude * (0.78 + index * 0.1);

    ctx.beginPath();
    ctx.moveTo(segmentX, y);
    ctx.quadraticCurveTo(
      segmentX + segmentLength * 0.24,
      y - localAmplitude,
      midX,
      y
    );
    ctx.quadraticCurveTo(
      segmentX + segmentLength * 0.76,
      y + localAmplitude * 0.68,
      endX,
      y
    );
    ctx.stroke();
  }
}

function clipLoops(ctx, loops, viewport) {
  if (!loops.length) {
    return;
  }

  ctx.beginPath();
  for (const loop of loops) {
    traceLoop(ctx, loop, viewport);
  }
  ctx.clip("evenodd");
}

function clipOceanArea(ctx, geometry, viewport) {
  ctx.beginPath();
  ctx.rect(viewport.margin, viewport.margin, viewport.innerWidth, viewport.innerHeight);
  for (const loop of geometry.coastlineLoops ?? []) {
    traceLoop(ctx, loop, viewport);
  }
  ctx.clip("evenodd");
}

function traceLoop(ctx, loop, viewport) {
  if (!loop.length) {
    return;
  }

  const first = viewport.worldToCanvas(loop[0].x - 0.5, loop[0].y - 0.5);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < loop.length; index += 1) {
    const point = viewport.worldToCanvas(loop[index].x - 0.5, loop[index].y - 0.5);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}
