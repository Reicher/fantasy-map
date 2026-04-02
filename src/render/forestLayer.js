import { BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260401a";
import { coordsOf } from "../utils.js";
import { glyphNoise } from "./hash.js";

export function drawForests(ctx, world, viewport) {
  const regionFeatureById = new Map(world.features.biomeRegions.map((region) => [region.id, region]));

  for (const region of world.geometry.biomes) {
    const style = getVegetationStyle(region.biome);
    if (!style) {
      continue;
    }

    const feature = regionFeatureById.get(region.id);
    if (!feature?.cells?.length) {
      continue;
    }

    const glyphs = collectForestGlyphs(feature.cells, region, style, world, viewport);
    if (glyphs.length === 0) {
      continue;
    }

    ctx.save();
    clipLoops(ctx, region.loops, viewport);
    glyphs.sort((a, b) => a.y - b.y);
    for (const glyph of glyphs) {
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
    ctx.restore();
  }
}

function getVegetationStyle(biomeKey) {
  switch (biomeKey) {
    case BIOME_KEYS.PLAINS:
      return {
        type: "tuft",
        density: 0.085,
        minSpacing: 10.5,
        minSize: 2.4,
        sizeRange: 1.5,
        fill: "rgba(126, 116, 76, 0.42)",
        stroke: "rgba(102, 90, 58, 0.52)"
      };
    case BIOME_KEYS.DESERT:
      return {
        type: "cactus",
        density: 0.018,
        minSpacing: 15.5,
        minSize: 4,
        sizeRange: 2.4,
        fill: "rgba(104, 116, 82, 0.58)",
        stroke: "rgba(74, 82, 58, 0.72)"
      };
    case BIOME_KEYS.HIGHLANDS:
      return {
        type: "tree",
        density: 0.04,
        minSpacing: 12.5,
        minSize: 4.4,
        sizeRange: 2.2,
        fill: "rgba(96, 92, 76, 0.58)",
        stroke: "rgba(72, 62, 48, 0.7)"
      };
    case BIOME_KEYS.FOREST:
      return {
        type: "tree",
        density: 0.34,
        minSpacing: 5.4,
        minSize: 4.8,
        sizeRange: 2.8,
        fill: "rgba(86, 96, 70, 0.64)",
        stroke: "rgba(60, 66, 46, 0.76)"
      };
    case BIOME_KEYS.RAINFOREST:
      return {
        type: "tree",
        density: 0.52,
        minSpacing: 4.1,
        minSize: 4.9,
        sizeRange: 3.2,
        fill: "rgba(68, 87, 56, 0.7)",
        stroke: "rgba(47, 60, 37, 0.8)"
      };
    default:
      return null;
  }
}

function collectForestGlyphs(cells, region, style, world, viewport) {
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

    const point = viewport.worldToCanvas(x, y);
    if (glyphs.some((glyph) => Math.hypot(glyph.x - point.x, glyph.y - point.y) < spacingPx)) {
      continue;
    }

    const jitterA = glyphNoise(seed + 17);
    const jitterB = glyphNoise(seed + 29);
    const sizeNoise = glyphNoise(seed + 43);
    const leanNoise = glyphNoise(seed + 61);
    const canopyNoise = glyphNoise(seed + 79);
    const accentNoise = glyphNoise(seed + 113);

    glyphs.push({
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
        true
      )
    });
  }

  return glyphs;
}

function getVegetationZoomScale(viewport) {
  return Math.max(1, Math.min(4.2, viewport.zoom));
}

function drawTreeGlyph(ctx, glyph, style) {
  const height = glyph.size;
  const width = height * (0.7 + glyph.canopy * 0.22);
  const trunkHeight = height * 0.22;
  const peakX = glyph.x + width * glyph.lean * 0.35;
  const peakY = glyph.y - height * 0.58;
  const midY = glyph.y - height * 0.16;
  const leftX = glyph.x - width * 0.52;
  const rightX = glyph.x + width * 0.52;

  ctx.save();
  ctx.globalAlpha *= glyph.alpha;
  ctx.fillStyle = glyph.snowSurface ? "rgba(242, 240, 234, 0.9)" : style.fill;
  ctx.strokeStyle = glyph.snowSurface ? "rgba(128, 122, 111, 0.72)" : style.stroke;
  ctx.lineWidth = 0.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(glyph.x, glyph.y + trunkHeight * 0.1);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(glyph.x + width * 0.24, midY);
  ctx.lineTo(rightX, glyph.y + trunkHeight * 0.12);
  ctx.lineTo(glyph.x + width * 0.1, glyph.y - height * 0.02);
  ctx.lineTo(glyph.x, glyph.y + trunkHeight * 0.28);
  ctx.lineTo(glyph.x - width * 0.1, glyph.y - height * 0.02);
  ctx.lineTo(leftX, glyph.y + trunkHeight * 0.12);
  ctx.lineTo(glyph.x - width * 0.24, midY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = glyph.snowSurface ? "rgba(150, 144, 134, 0.46)" : "rgba(76, 57, 35, 0.46)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(glyph.x, glyph.y + trunkHeight * 0.28);
  ctx.lineTo(glyph.x, glyph.y + trunkHeight * 0.64);
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

function clipLoops(ctx, loops, viewport) {
  if (!loops.length) {
    return false;
  }

  ctx.beginPath();
  for (const loop of loops) {
    traceLoop(ctx, loop, viewport);
  }
  ctx.clip("evenodd");
  return true;
}

function traceLoop(ctx, loop, viewport) {
  if (!loop.length) {
    return;
  }

  const first = edgePoint(viewport, loop[0].x, loop[0].y);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < loop.length; index += 1) {
    const point = edgePoint(viewport, loop[index].x, loop[index].y);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function edgePoint(viewport, x, y) {
  return {
    x: viewport.margin + (x - viewport.leftWorld) * viewport.scaleX,
    y: viewport.margin + (y - viewport.topWorld) * viewport.scaleY
  };
}
