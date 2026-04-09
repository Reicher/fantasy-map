import { BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260402b";
import { coordsOf } from "../utils.js";
import { glyphNoise } from "./hash.js";

export function collectForestRenderGlyphs(world, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const regionFeatureById = new Map(world.features.biomeRegions.map((region) => [region.id, region]));
  const roadSegments = buildCanvasRoadSegments(world.geometry.roads, viewport);
  const entries = [];

  for (const region of world.geometry.biomes) {
    const style = getVegetationStyle(region.biome);
    if (!style) {
      continue;
    }

    const feature = regionFeatureById.get(region.id);
    if (!feature?.cells?.length) {
      continue;
    }

    const glyphs = collectForestGlyphs(feature.cells, region, style, world, viewport, roadSegments, showSnow);
    if (glyphs.length === 0) {
      continue;
    }

    for (const glyph of glyphs) {
      entries.push({
        glyph,
        style,
        footY: getForestGlyphFootY(glyph, style.type)
      });
    }
  }

  return entries;
}

function getVegetationStyle(biomeKey) {
  switch (biomeKey) {
    case BIOME_KEYS.PLAINS:
      return {
        type: "tuft",
        density: 0.052,
        minSpacing: 12.2,
        minSize: 2.4,
        sizeRange: 1.5,
        fill: "rgba(126, 116, 76, 0.42)",
        stroke: "rgba(102, 90, 58, 0.52)"
      };
    case BIOME_KEYS.DESERT:
      return {
        type: "cactus",
        density: 0.01,
        minSpacing: 17.5,
        minSize: 4,
        sizeRange: 2.4,
        fill: "rgba(104, 116, 82, 0.58)",
        stroke: "rgba(74, 82, 58, 0.72)"
      };
    case BIOME_KEYS.HIGHLANDS:
      return {
        type: "tree",
        density: 0.022,
        minSpacing: 15.5,
        minSize: 7.4,
        sizeRange: 3.2,
        fill: "rgba(92, 94, 80, 0.68)",
        stroke: "rgba(68, 60, 47, 0.82)"
      };
    case BIOME_KEYS.FOREST:
      return {
        type: "tree",
        density: 0.19,
        minSpacing: 7.1,
        minSize: 8.2,
        sizeRange: 4.2,
        fill: "rgba(80, 97, 66, 0.74)",
        stroke: "rgba(54, 66, 41, 0.86)"
      };
    case BIOME_KEYS.RAINFOREST:
      return {
        type: "tree",
        density: 0.29,
        minSpacing: 5.8,
        minSize: 8.8,
        sizeRange: 4.8,
        fill: "rgba(65, 87, 53, 0.8)",
        stroke: "rgba(42, 58, 34, 0.9)"
      };
    default:
      return null;
  }
}

function collectForestGlyphs(cells, region, style, world, viewport, roadSegments, showSnow) {
  const glyphs = [];
  const symbolScale = getVegetationZoomScale(viewport);
  const spacingPx = style.minSpacing * Math.max(1, viewport.zoom * 0.92);
  const startX = viewport.leftWorld - 1;
  const endX = viewport.leftWorld + viewport.visibleWidth + 1;
  const startY = viewport.topWorld - 1;
  const endY = viewport.topWorld + viewport.visibleHeight + 1;

  for (const cell of cells) {
    const [x, y] = coordsOf(cell, world.terrain.width);
    if (x < startX || x > endX || y < startY || y > endY) {
      continue;
    }

    const seed = cell * 97 + region.id * 131;
    const chance = glyphNoise(seed);
    if (chance > style.density) {
      continue;
    }

    if (shouldSuppressBiomeGlyphNearMountains(world, x, y, style.type, region.biome)) {
      continue;
    }

    const point = viewport.worldToCanvas(x, y);
    if (isNearRoad(point.x, point.y, roadSegments, style.type === "tree" ? 6.5 : 4.2)) {
      continue;
    }
    if (glyphs.some((glyph) => Math.hypot(glyph.x - point.x, glyph.y - point.y) < spacingPx)) {
      continue;
    }

    const jitterA = glyphNoise(seed + 17);
    const jitterB = glyphNoise(seed + 29);
    const sizeNoise = glyphNoise(seed + 43);
    const leanNoise = glyphNoise(seed + 61);
    const canopyNoise = glyphNoise(seed + 79);
    const accentNoise = glyphNoise(seed + 113);

    const glyph = {
      x: point.x + (jitterA - 0.5) * viewport.scaleX * 0.5,
      y: point.y + (jitterB - 0.5) * viewport.scaleY * 0.5,
      size: (style.minSize + sizeNoise * style.sizeRange) * symbolScale,
      lean: (leanNoise - 0.5) * 0.28,
      canopy: canopyNoise,
      accent: accentNoise,
      alpha: 0.88 + glyphNoise(seed + 101) * 0.12,
      snowSurface: isSnowCell(
        world.climate.biome[cell],
        world.terrain.elevation[cell],
        world.terrain.mountainField[cell],
        world.climate.temperature[cell],
        showSnow
      )
    };

    if (treeGlyphNearRoad(glyph, style.type, roadSegments)) {
      continue;
    }

    glyphs.push(glyph);
  }

  return glyphs;
}

function getVegetationZoomScale(viewport) {
  return Math.max(1, Math.min(4.2, viewport.zoom));
}

function shouldSuppressBiomeGlyphNearMountains(world, x, y, type, biomeKey) {
  switch (type) {
    case "tree":
      return shouldSuppressTreeNearMountains(world, x, y, biomeKey);
    case "cactus":
      return isNearMountainBand(world, x, y, 2, 0.22);
    case "tuft":
      return isNearMountainBand(world, x, y, 2, 0.24);
    default:
      return false;
  }
}

function shouldSuppressTreeNearMountains(world, x, y, biomeKey) {
  const stats =
    biomeKey === BIOME_KEYS.FOREST || biomeKey === BIOME_KEYS.RAINFOREST
      ? getMountainBandStats(world, x, y, 2, 0.28)
      : getMountainBandStats(world, x, y, 2, 0.22);

  if (biomeKey === BIOME_KEYS.FOREST || biomeKey === BIOME_KEYS.RAINFOREST) {
    return stats.max >= 0.42 && stats.count >= 4;
  }

  return stats.max >= 0.28 && stats.count >= 3;
}

function isNearMountainBand(world, x, y, radius, threshold) {
  return getMountainBandStats(world, x, y, radius, threshold).count > 0;
}

function getMountainBandStats(world, x, y, radius, threshold) {
  const { terrain } = world;
  const { width, height, mountainField } = terrain;
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);
  let count = 0;
  let max = 0;

  for (let yy = minY; yy <= maxY; yy += 1) {
    for (let xx = minX; xx <= maxX; xx += 1) {
      const value = mountainField[yy * width + xx];
      if (value >= threshold) {
        count += 1;
        if (value > max) {
          max = value;
        }
      }
    }
  }

  return { count, max };
}

function getForestGlyphFootY(glyph, type) {
  if (type === "tuft") {
    return glyph.y + glyph.size * 0.18;
  }
  if (type === "cactus") {
    return glyph.y + glyph.size * 0.34;
  }
  return glyph.y + glyph.size * 0.06;
}

export function drawForestEntry(ctx, entry) {
  const { glyph, style } = entry;
  switch (style.type) {
    case "tuft":
      drawTuftGlyph(ctx, glyph, style);
      break;
    case "cactus":
      drawCactusGlyph(ctx, glyph, style);
      break;
    default:
      drawTreeGlyph(ctx, glyph, style);
      break;
  }
}

function buildCanvasRoadSegments(roads, viewport) {
  const segments = [];
  for (const road of roads) {
    if (road.type !== "road" || !road.points || road.points.length < 2) {
      continue;
    }
    for (let index = 0; index < road.points.length - 1; index += 1) {
      segments.push({
        a: viewport.worldToCanvas(road.points[index].x - 0.5, road.points[index].y - 0.5),
        b: viewport.worldToCanvas(road.points[index + 1].x - 0.5, road.points[index + 1].y - 0.5)
      });
    }
  }
  return segments;
}

function isNearRoad(x, y, segments, threshold) {
  const thresholdSq = threshold * threshold;
  for (const segment of segments) {
    if (distanceToSegmentSquared(x, y, segment.a, segment.b) <= thresholdSq) {
      return true;
    }
  }
  return false;
}

function distanceToSegmentSquared(px, py, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = px - a.x;
  const apy = py - a.y;
  const abLengthSq = abx * abx + aby * aby;
  if (abLengthSq <= 0.0001) {
    const dx = px - a.x;
    const dy = py - a.y;
    return dx * dx + dy * dy;
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSq));
  const nearestX = a.x + abx * t;
  const nearestY = a.y + aby * t;
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy;
}

function treeGlyphNearRoad(glyph, type, roadSegments) {
  const threshold = type === "tree" ? Math.max(6.8, glyph.size * 0.34) : Math.max(4.2, glyph.size * 0.28);
  const probePoints = [
    [glyph.x, glyph.y],
    [glyph.x, glyph.y + glyph.size * 0.08]
  ];

  return probePoints.some(([x, y]) => isNearRoad(x, y, roadSegments, threshold));
}

function drawTreeGlyph(ctx, glyph, style) {
  const height = glyph.size;
  const lineColor = glyph.snowSurface ? "rgba(214, 214, 214, 0.98)" : "rgba(18, 18, 18, 0.98)";
  const trunkX = glyph.x + height * glyph.lean * 0.04;
  const trunkTopY = glyph.y - height * 0.9;
  const trunkBottomY = glyph.y + height * 0.08;
  const tierCount = 3;
  const crownBottomY = trunkTopY + height * 0.64;
  const baseSpread = height * 0.34;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1.05, height * 0.092);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(trunkX, trunkBottomY);
  ctx.lineTo(trunkX, trunkTopY);

  for (let tierIndex = 0; tierIndex < tierCount; tierIndex += 1) {
    const tierT = tierCount <= 1 ? 0 : tierIndex / (tierCount - 1);
    const branchY = trunkTopY + (crownBottomY - trunkTopY) * tierT;
    const branchSpread = baseSpread * (0.78 + tierT * 0.34);
    const branchDrop = height * (0.22 + tierT * 0.09);
    const leftTipX = trunkX - branchSpread;
    const rightTipX = trunkX + branchSpread;
    const tipY = Math.min(trunkBottomY - height * 0.02, branchY + branchDrop);

    ctx.moveTo(trunkX, branchY);
    ctx.lineTo(leftTipX, tipY);
    ctx.moveTo(trunkX, branchY);
    ctx.lineTo(rightTipX, tipY);
  }

  ctx.stroke();
  ctx.restore();
}

function drawTuftGlyph(ctx, glyph, style) {
  const height = glyph.size;
  const width = height * (0.75 + glyph.canopy * 0.22);
  const baseY = glyph.y + height * 0.18;

  ctx.save();
  ctx.globalAlpha *= glyph.alpha * 0.9;
  ctx.strokeStyle = glyph.snowSurface ? "rgba(162, 156, 146, 0.5)" : style.stroke;
  ctx.fillStyle = glyph.snowSurface ? "rgba(224, 220, 214, 0.52)" : style.fill;
  ctx.lineWidth = 0.75;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(glyph.x - width * 0.28, baseY);
  ctx.lineTo(glyph.x - width * 0.1, glyph.y - height * (0.34 + glyph.accent * 0.08));
  ctx.moveTo(glyph.x, baseY);
  ctx.lineTo(glyph.x + width * glyph.lean * 0.12, glyph.y - height * (0.46 + glyph.canopy * 0.08));
  ctx.moveTo(glyph.x + width * 0.28, baseY);
  ctx.lineTo(glyph.x + width * 0.08, glyph.y - height * (0.3 + glyph.accent * 0.06));
  ctx.stroke();

  if (glyph.accent > 0.72) {
    ctx.beginPath();
    ctx.arc(glyph.x + width * 0.12, glyph.y - height * 0.08, 0.7 + glyph.canopy * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCactusGlyph(ctx, glyph, style) {
  const height = glyph.size;
  const width = height * (0.42 + glyph.canopy * 0.08);
  const baseY = glyph.y + height * 0.34;
  const armHeight = height * (0.32 + glyph.accent * 0.12);
  const armReach = width * (0.9 + glyph.canopy * 0.25);
  const lean = glyph.lean * width * 0.4;

  ctx.save();
  ctx.globalAlpha *= glyph.alpha * 0.92;
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.fill;
  ctx.lineWidth = 1.05;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(glyph.x + lean, baseY);
  ctx.lineTo(glyph.x + lean, glyph.y - height * 0.48);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(glyph.x + lean, glyph.y - height * 0.2);
  ctx.lineTo(glyph.x - armReach * 0.56, glyph.y - height * 0.2);
  ctx.lineTo(glyph.x - armReach * 0.56, glyph.y - height * 0.2 - armHeight);
  ctx.stroke();

  if (glyph.accent > 0.34) {
    ctx.beginPath();
    ctx.moveTo(glyph.x + lean, glyph.y - height * 0.06);
    ctx.lineTo(glyph.x + armReach * 0.52, glyph.y - height * 0.06);
    ctx.lineTo(glyph.x + armReach * 0.52, glyph.y - height * 0.06 - armHeight * 0.82);
    ctx.stroke();
  }

  ctx.restore();
}
