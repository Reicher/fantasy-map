import { BIOME_KEYS } from "../config.js";
import { isFrozenLake } from "../generator/models/surfaceModel.js?v=20260402b";
import { clamp, coordsOf } from "../utils.js";
import { hashSeed, nextHash } from "./hash.js";

const OCEAN_WAVE_THRESHOLD = 0.845;
const LAKE_WAVE_THRESHOLD = 0.81;
const WAVE_PEAK_MARGIN = 0.014;

export function drawRivers(ctx, geometry, viewport) {
  const rivers = geometry?.rivers ?? [];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const river of rivers) {
    const points = buildRiverRenderPoints(river.points, viewport, `river:${river.id}`, river.width);
    if (points.length < 2) {
      continue;
    }

    const lineWidth = clamp(1.7 + river.width * 0.82 + river.cellCount / 34, 1.7, 6.4);
    ctx.strokeStyle = "rgba(138, 160, 168, 0.98)";
    ctx.lineWidth = lineWidth;
    strokeRiverPath(ctx, points, Math.max(8, lineWidth * 2.8));

    for (const branch of river.deltaBranches ?? []) {
      const branchPoints = buildRiverRenderPoints(
        branch.points,
        viewport,
        `river:${river.id}:branch`,
        branch.width
      );
      if (branchPoints.length < 2) {
        continue;
      }

      const branchWidth = clamp(1.3 + branch.width * 0.68 + river.cellCount / 58, 1.2, 4.2);
      ctx.strokeStyle = "rgba(138, 160, 168, 0.96)";
      ctx.lineWidth = branchWidth;
      strokeRiverPath(ctx, branchPoints, Math.max(6, branchWidth * 2.4));
    }
  }
}

function strokeRiverPath(ctx, points, cornerRadius = 10) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    return;
  }

  let previousCornerEnd = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (incomingLength < 0.001 || outgoingLength < 0.001) {
      continue;
    }

    const radius = Math.min(cornerRadius, incomingLength * 0.45, outgoingLength * 0.45);
    const cornerStart = pointTowards(current, previous, radius);
    const cornerEnd = pointTowards(current, next, radius);

    if (distanceBetween(previousCornerEnd, cornerStart) > 0.01) {
      ctx.lineTo(cornerStart.x, cornerStart.y);
    }
    ctx.quadraticCurveTo(current.x, current.y, cornerEnd.x, cornerEnd.y);
    previousCornerEnd = cornerEnd;
  }

  const last = points[points.length - 1];
  if (distanceBetween(previousCornerEnd, last) > 0.01) {
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function buildRiverRenderPoints(worldPoints, viewport, seedKey, width = 1) {
  const normalized = worldPoints.map((point) => ({ x: point.x - 0.5, y: point.y - 0.5 }));
  const simplified = simplifyRiverRenderPoints(dedupeRiverPoints(normalized));
  const meandered = meanderRiverPoints(simplified, seedKey, width);
  return meandered.map((point) => viewport.worldToCanvas(point.x, point.y));
}

function dedupeRiverPoints(points) {
  const deduped = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = deduped[deduped.length - 1];
    const current = points[index];
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < 0.02) {
      continue;
    }
    deduped.push(current);
  }
  return deduped;
}

function simplifyRiverRenderPoints(points) {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];
  let lastDirection = null;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) {
      continue;
    }

    const direction = {
      x: Math.round((dx / length) * 100) / 100,
      y: Math.round((dy / length) * 100) / 100
    };

    if (!lastDirection) {
      lastDirection = direction;
      continue;
    }

    const changed =
      Math.abs(direction.x - lastDirection.x) > 0.08 ||
      Math.abs(direction.y - lastDirection.y) > 0.08;
    if (changed) {
      simplified.push(previous);
      lastDirection = direction;
    }
  }

  simplified.push(points[points.length - 1]);
  return dedupeRiverPoints(simplified);
}

function meanderRiverPoints(points, seedKey, width) {
  if (points.length <= 2) {
    return points;
  }

  const meandered = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.75) {
      meandered.push(end);
      continue;
    }

    const nx = -dy / length;
    const ny = dx / length;
    let state = hashSeed(
      `${seedKey}:${index}:${Math.round(start.x * 100)}:${Math.round(start.y * 100)}`
    );
    state = nextHash(state);
    const sign = state % 2 === 0 ? 1 : -1;
    state = nextHash(state);
    const bend = 0.65 + ((state % 1000) / 1000) * 0.5;
    state = nextHash(state);
    const wobble = 0.85 + ((state % 1000) / 1000) * 0.4;

    const amplitude = Math.min(0.62, Math.max(0.11, length * 0.085, width * 0.07)) * bend;
    const subdivisions = Math.max(2, Math.min(6, Math.round(length / 0.85)));

    for (let step = 1; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      const baseX = start.x + dx * t;
      const baseY = start.y + dy * t;
      const envelope = Math.sin(t * Math.PI);
      const wave = Math.sin(t * Math.PI * (1 + (subdivisions > 3 ? 1 : 0))) * wobble;
      const offset = amplitude * envelope * wave * sign;
      meandered.push({
        x: baseX + nx * offset,
        y: baseY + ny * offset
      });
    }

    meandered.push(end);
  }

  return dedupeRiverPoints(meandered);
}

function pointTowards(from, to, distance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: from.x + (dx / length) * distance,
    y: from.y + (dy / length) * distance
  };
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function drawLakeWaves(ctx, hydrology, climate, terrain, geometry, viewport, width) {
  const lakeGeometryById = new Map((geometry.lakes ?? []).map((lake) => [lake.id, lake]));
  const lakeIdByCell = hydrology?.lakeIdByCell ?? null;

  for (const lake of hydrology.lakes) {
    if (lake.cells.length < 3) {
      continue;
    }

    const lakeGeometry = lakeGeometryById.get(lake.id);
    if (!lakeGeometry?.loops?.length) {
      continue;
    }

    if (isFrozenLake(climate, terrain, lake)) {
      continue;
    }

    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";

    for (const cell of lake.cells) {
      const [x, y] = coordsOf(cell, width);
      const waveScore = sampleWaveField("lake", x, y);
      if (waveScore < LAKE_WAVE_THRESHOLD) {
        continue;
      }
      if (
        !isWaveLocalPeak("lake", x, y, waveScore, (nx, ny) =>
          isSameLakeCell(nx, ny, width, terrain.height, lake.id, lakeIdByCell),
        )
      ) {
        continue;
      }

      let state = hashSeed(`lake-wave:${lake.id}:${x},${y}`);
      state = nextHash(state);
      const worldJitterX = ((state % 1000) / 1000 - 0.5) * 0.82;
      state = nextHash(state);
      const worldJitterY = ((state % 1000) / 1000 - 0.5) * 0.68;
      const point = viewport.worldToCanvas(x + worldJitterX, y + worldJitterY);
      state = nextHash(state);
      const length = 8 + ((state % 1000) / 1000) * Math.max(8, viewport.scaleX * 1.84);
      state = nextHash(state);
      const amplitude = 0.95 + ((state % 1000) / 1000) * 2.2;
      state = nextHash(state);
      const lightAlpha = 0.3 + ((state % 1000) / 1000) * 0.14;
      state = nextHash(state);
      const darkAlpha = 0.38 + ((state % 1000) / 1000) * 0.16;
      ctx.strokeStyle = `rgba(236, 232, 220, ${lightAlpha})`;
      drawLakeWaveMark(ctx, point.x, point.y + 0.6, length, amplitude);
      ctx.strokeStyle = `rgba(60, 84, 95, ${darkAlpha})`;
      drawLakeWaveMark(ctx, point.x, point.y, length, amplitude);
    }

    ctx.restore();
  }
}

export function drawOceanWaves(ctx, terrain, climate, geometry, viewport) {
  const startX = Math.floor(viewport.leftWorld - 2);
  const endX = Math.ceil(viewport.leftWorld + viewport.visibleWidth + 2);
  const startY = Math.floor(viewport.topWorld - 2);
  const endY = Math.ceil(viewport.topWorld + viewport.visibleHeight + 2);

  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (!isOceanWaveAnchor(x, y, terrain, climate)) {
        continue;
      }

      const waveScore = sampleWaveField("ocean", x, y);
      const coastBoost = isNearLandCell(x, y, terrain.width, terrain.height, terrain)
        ? 0.03
        : 0;
      if (waveScore < OCEAN_WAVE_THRESHOLD - coastBoost) {
        continue;
      }
      if (
        !isWaveLocalPeak("ocean", x, y, waveScore, (nx, ny) =>
          isOceanWaveAnchor(nx, ny, terrain, climate),
        )
      ) {
        continue;
      }

      let state = hashSeed(`ocean-wave:${x},${y}`);
      state = nextHash(state);
      const worldJitterX = ((state % 1000) / 1000 - 0.5) * 0.92;
      state = nextHash(state);
      const worldJitterY = ((state % 1000) / 1000 - 0.5) * 0.78;
      const point = viewport.worldToCanvas(x + worldJitterX, y + worldJitterY);
      state = nextHash(state);
      const length = 8 + ((state % 1000) / 1000) * Math.max(7, viewport.scaleX * 1.22);
      state = nextHash(state);
      const amplitude = 0.92 + ((state % 1000) / 1000) * 1.7;
      state = nextHash(state);
      const lightAlpha = 0.29 + ((state % 1000) / 1000) * 0.13;
      state = nextHash(state);
      const darkAlpha = 0.35 + ((state % 1000) / 1000) * 0.14;

      ctx.strokeStyle = `rgba(236, 233, 222, ${lightAlpha})`;
      drawLakeWaveMark(ctx, point.x, point.y + 0.7, length, amplitude);
      ctx.strokeStyle = `rgba(52, 73, 86, ${darkAlpha})`;
      drawLakeWaveMark(ctx, point.x, point.y, length, amplitude);

      state = nextHash(state);
      if ((state % 1000) / 1000 < 0.16) {
        state = nextHash(state);
        const smallOffsetX = ((state % 1000) / 1000 - 0.5) * viewport.scaleX * 0.9;
        state = nextHash(state);
        const smallOffsetY = ((state % 1000) / 1000 - 0.5) * viewport.scaleY * 0.8;
        ctx.strokeStyle = "rgba(240, 237, 228, 0.22)";
        drawLakeWaveMark(
          ctx,
          point.x + smallOffsetX,
          point.y + smallOffsetY + 0.45,
          length * 0.62,
          amplitude * 0.62,
        );
      }
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

function isNearLandCell(x, y, width, height, terrain) {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const neighbor = ny * width + nx;
      if (terrain.isLand[neighbor] === 1) {
        return true;
      }
    }
  }
  return false;
}

function isSameLakeCell(x, y, width, height, lakeId, lakeIdByCell) {
  if (!lakeIdByCell || x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  return lakeIdByCell[y * width + x] === lakeId;
}

function isWaveLocalPeak(kind, x, y, centerScore, validNeighbor = () => true) {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (!validNeighbor(nx, ny)) {
        continue;
      }
      const neighborScore = sampleWaveField(kind, nx, ny);
      if (neighborScore > centerScore - WAVE_PEAK_MARGIN) {
        return false;
      }
    }
  }
  return true;
}

function sampleWaveField(kind, x, y) {
  const warpX = Math.sin((x + 3.2) * 0.71 + (y - 1.7) * 0.29) * 0.85;
  const warpY = Math.cos((y + 4.8) * 0.67 - (x + 0.9) * 0.23) * 0.85;
  const sampleX = x + warpX;
  const sampleY = y + warpY;
  let state = hashSeed(
    `${kind}-wave-field:${Math.round(sampleX * 100)},${Math.round(sampleY * 100)}`,
  );
  state = nextHash(state);
  const a = (state % 1000) / 1000;
  state = nextHash(state);
  const b = (state % 1000) / 1000;
  state = nextHash(state);
  const c = (state % 1000) / 1000;
  return clamp(a * 0.56 + b * 0.29 + c * 0.15, 0, 1);
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
