import { BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260401a";
import { clamp, coordsOf } from "../utils.js";
import { glyphNoise } from "./hash.js";

export function drawMountains(ctx, terrain, climate, regions, geometry, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const glyphs = [];
  const zoomScale = getMountainZoomScale(viewport);

  for (const region of regions.mountainRegions) {
    const regionStyle = getMountainRegionStyle(region.id);
    const displayCells = region.cells.filter((cell) => climate.biome[cell] === BIOME_KEYS.MOUNTAIN);
    const cells = (displayCells.length >= 4
      ? displayCells
      : region.cells.filter((cell) => climate.biome[cell] === BIOME_KEYS.MOUNTAIN || terrain.mountainField[cell] > 0.66)
    ).sort((a, b) => terrain.mountainField[b] - terrain.mountainField[a]);

    if (cells.length === 0) {
      continue;
    }

    const bounds = getCellBounds(cells, terrain.width);
    const aspect = Math.max(bounds.width, bounds.height) / Math.max(1, Math.min(bounds.width, bounds.height));
    const targetAnchors = clamp(
      Math.round(cells.length / (aspect > 2.1 ? 11 : aspect > 1.5 ? 14 : 17)),
      2,
      Math.max(3, Math.round(region.size / 10))
    );
    const anchorSpacing = regionStyle.anchorSpacing * (aspect > 2.1 ? 0.66 : aspect > 1.5 ? 0.78 : 0.92);
    const anchors = buildMountainAnchors(cells, terrain, climate, viewport, targetAnchors, anchorSpacing);
    const ridgeScale = aspect > 2.4 ? 0.76 : aspect > 1.7 ? 0.88 : 1;
    const ridgeSpread = aspect > 2.4 ? 0.9 : aspect > 1.7 ? 0.96 : 1;
    const ridgeDensityBoost = aspect > 2.4 ? 0.08 : aspect > 1.7 ? 0.03 : -0.04;

    anchors.forEach((anchor, index) => {
      const cluster = buildMountainCluster(
        anchor,
        region.id,
        index,
        regionStyle,
        showSnow,
        zoomScale * ridgeScale,
        ridgeSpread,
        ridgeDensityBoost
      )
        .map((glyph) => fitMountainGlyphToLand(glyph, terrain, climate, viewport))
        .filter(Boolean);
      glyphs.push(...cluster);
    });
  }

  glyphs.sort((a, b) => a.y - b.y);
  for (const glyph of glyphs) {
    drawMountainGlyph(ctx, glyph);
  }
}

function buildMountainAnchors(cells, terrain, climate, viewport, targetAnchors, anchorSpacing) {
  if (cells.length === 0) {
    return [];
  }

  const candidates = cells
    .slice(0, Math.min(cells.length, Math.max(targetAnchors * 14, 48)))
    .map((cell) => {
      const [x, y] = coordsOf(cell, terrain.width);
      const pixel = viewport.worldToCanvas(x, y);
      return {
        x: pixel.x,
        y: pixel.y,
        value: terrain.mountainField[cell],
        elevation: terrain.elevation[cell],
        biome: climate.biome[cell],
        temperature: climate.temperature[cell],
        cell
      };
    });

  const anchors = [candidates[0]];

  while (anchors.length < targetAnchors) {
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      if (anchors.some((anchor) => anchor.cell === candidate.cell)) {
        continue;
      }

      let minDistance = Infinity;
      for (const anchor of anchors) {
        minDistance = Math.min(minDistance, Math.hypot(anchor.x - candidate.x, anchor.y - candidate.y));
      }

      const spacingPenalty = minDistance < anchorSpacing ? (anchorSpacing - minDistance) * 0.85 : 0;
      const score = minDistance + candidate.value * 18 - spacingPenalty;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) {
      break;
    }

    anchors.push(best);
  }

  return anchors;
}

function buildMountainCluster(anchor, regionId, anchorIndex, regionStyle, showSnow, sizeScale = 1, spreadScale = 1, densityBoost = 0) {
  const clusterNoise = glyphNoise(anchor.cell + regionId * 131 + anchorIndex * 17);
  const clusterWidth = (8 + anchor.value * 9.5 + clusterNoise * 3.8) * regionStyle.clusterWidth * sizeScale;
  const clusterHeight = (3.8 + anchor.value * 4.1 + clusterNoise * 1.2) * regionStyle.clusterHeight * sizeScale;
  const glyphCount = Math.max(
    1,
    Math.min(4, Math.round(1 + anchor.value * 1.5 + clusterNoise * 0.55 + regionStyle.densityBias + densityBoost))
  );
  const glyphs = [];

  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
    const noiseA = glyphNoise(anchor.cell * 17 + glyphIndex * 97 + regionId * 313);
    const noiseB = glyphNoise(anchor.cell * 31 + glyphIndex * 43 + regionId * 127);
    const noiseC = glyphNoise(anchor.cell * 61 + glyphIndex * 59 + regionId * 211);
    const noiseD = glyphNoise(anchor.cell * 83 + glyphIndex * 71 + regionId * 401);
    const noiseE = glyphNoise(anchor.cell * 101 + glyphIndex * 29 + regionId * 157);
    const row = Math.floor(glyphIndex / 2);
    const fan = glyphIndex - (glyphCount - 1) * 0.5;
    const archetype = glyphIndex % 3;
    const x =
      anchor.x +
      fan * (4.3 + noiseA * 2.1) * regionStyle.spread * spreadScale +
      (noiseA - 0.5) * clusterWidth * 0.26;
    const y = anchor.y + row * (1.5 + noiseB * 0.7) + (noiseB - 0.5) * 0.9 - clusterHeight * 0.08;
    const heightBias = (archetype === 0 ? 1.18 : archetype === 1 ? 0.68 : 0.94) * regionStyle.heightBias;
    const widthBias = (archetype === 0 ? 0.96 : archetype === 1 ? 1.92 : 1.28) * regionStyle.widthBias;
    const height =
      (2.8 + anchor.value * 6.1 + noiseC * 4.4 + noiseE * 2.1 - row * 0.8 + Math.abs(fan) * 0.3) *
      heightBias *
      sizeScale;
    const width =
      (2.2 + anchor.value * 5.1 + noiseA * 6.2 + noiseD * 3.4 + Math.max(0, 1 - heightBias) * 2.2) *
      widthBias *
      sizeScale;
    const lean = (noiseA - 0.5) * 0.34 + (noiseD - 0.5) * 0.1;
    const snow = anchor.elevation > 0.8 && noiseC > 0.44;
    glyphs.push({
      x,
      y,
      height: Math.max(3.8, height),
      width: Math.max(2.6, width),
      lean,
      snow,
      snowSurface: isSnowCell(anchor.biome, anchor.elevation, anchor.value, anchor.temperature, showSnow),
      noise: noiseB,
      shoulder: noiseD,
      body: noiseE
    });
  }

  return glyphs;
}

function getMountainRegionStyle(regionId) {
  const profile = glyphNoise(regionId * 941 + 17);
  const shape = glyphNoise(regionId * 569 + 91);
  const spacing = glyphNoise(regionId * 223 + 47);

  if (profile < 0.34) {
    return {
      anchorSpacing: 22 + spacing * 4,
      clusterWidth: 1.2 + shape * 0.22,
      clusterHeight: 0.78 + shape * 0.14,
      widthBias: 1.22 + shape * 0.2,
      heightBias: 0.78 + shape * 0.12,
      spread: 1.08 + shape * 0.16,
      densityBias: -0.15
    };
  }

  if (profile > 0.68) {
    return {
      anchorSpacing: 23 + spacing * 5,
      clusterWidth: 0.88 + shape * 0.16,
      clusterHeight: 1.05 + shape * 0.22,
      widthBias: 0.88 + shape * 0.16,
      heightBias: 1.12 + shape * 0.24,
      spread: 0.92 + shape * 0.08,
      densityBias: 0
    };
  }

  return {
    anchorSpacing: 21 + spacing * 4,
    clusterWidth: 1 + shape * 0.14,
    clusterHeight: 0.92 + shape * 0.12,
    widthBias: 1.02 + shape * 0.16,
    heightBias: 0.94 + shape * 0.16,
    spread: 1 + shape * 0.1,
    densityBias: -0.05
  };
}

function drawMountainGlyph(ctx, glyph) {
  const {
    x,
    peakX,
    peakY,
    leftX,
    rightX,
    baseY,
    leftFootY,
    rightFootY,
    baseDipY,
    width,
    height,
    snow,
    shoulder
  } = getMountainGeometry(glyph);
  const fillGradient = ctx.createLinearGradient(x, peakY, x, baseY + height * 0.18);
  if (glyph.snowSurface) {
    fillGradient.addColorStop(0, "rgba(246, 244, 239, 0.98)");
    fillGradient.addColorStop(0.62, "rgba(235, 233, 228, 0.94)");
    fillGradient.addColorStop(1, "rgba(229, 227, 222, 0.88)");
  } else {
    fillGradient.addColorStop(0, "rgba(134, 128, 121, 0.96)");
    fillGradient.addColorStop(0.62, "rgba(114, 108, 102, 0.9)");
    fillGradient.addColorStop(1, "rgba(121, 115, 108, 0.58)");
  }

  ctx.fillStyle = fillGradient;
  ctx.beginPath();
  ctx.moveTo(leftX, leftFootY);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(rightX, rightFootY);
  ctx.quadraticCurveTo(x + width * (shoulder - 0.5) * 0.28, baseDipY, leftX, leftFootY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = glyph.snowSurface ? "rgba(107, 102, 94, 0.84)" : "rgba(64, 56, 47, 0.9)";
  ctx.lineWidth = 0.75 + height * 0.018;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(leftX, leftFootY);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(rightX, rightFootY);
  ctx.stroke();

  ctx.strokeStyle = glyph.snowSurface ? "rgba(186, 183, 177, 0.5)" : "rgba(116, 112, 108, 0.42)";
  ctx.lineWidth = 0.28 + height * 0.008;
  ctx.beginPath();
  ctx.moveTo(leftX + width * (0.3 + shoulder * 0.16), leftFootY + height * 0.04);
  ctx.lineTo(rightX - width * (0.34 + (1 - shoulder) * 0.22), rightFootY + height * 0.01);
  ctx.stroke();

  if (snow) {
    ctx.fillStyle = "rgba(245, 241, 233, 0.95)";
    ctx.beginPath();
    ctx.moveTo(peakX, peakY + height * 0.05);
    ctx.lineTo(peakX - width * 0.22, peakY + height * 0.26);
    ctx.lineTo(peakX + width * 0.18, peakY + height * 0.24);
    ctx.closePath();
    ctx.fill();
  }
}

function fitMountainGlyphToLand(glyph, terrain, climate, viewport) {
  let candidate = { ...glyph };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (mountainGlyphFitsLand(candidate, terrain, climate, viewport)) {
      return candidate;
    }

    candidate = {
      ...candidate,
      width: candidate.width * 0.84,
      height: candidate.height * 0.92
    };
  }

  return null;
}

function mountainGlyphFitsLand(glyph, terrain, climate, viewport) {
  const geometry = getMountainGeometry(glyph);
  const samplePoints = [
    [geometry.x, geometry.baseY],
    [geometry.leftX, geometry.leftFootY],
    [geometry.rightX, geometry.rightFootY],
    [geometry.x - glyph.width * 0.28, geometry.baseY - glyph.height * 0.08],
    [geometry.x + glyph.width * 0.28, geometry.baseY - glyph.height * 0.08]
  ];

  return samplePoints.every(([canvasX, canvasY]) => isCanvasPointOnDryLand(canvasX, canvasY, terrain, climate, viewport));
}

function isCanvasPointOnDryLand(canvasX, canvasY, terrain, climate, viewport) {
  const world = viewport.canvasToWorld(canvasX, canvasY);
  const x = clamp(Math.floor(world.x), 0, terrain.width - 1);
  const y = clamp(Math.floor(world.y), 0, terrain.height - 1);
  const cell = y * terrain.width + x;
  return terrain.isLand[cell] === 1 && climate.biome[cell] !== BIOME_KEYS.LAKE;
}

function getMountainGeometry(glyph) {
  const { x, y, width, height, lean, noise, shoulder, body } = glyph;
  const peakX = x + width * lean;
  const peakY = y - height * (0.98 + noise * 0.06);
  const leftX = x - width * (0.56 + noise * 0.22 + shoulder * 0.12);
  const rightX = x + width * (0.52 + (1 - noise) * 0.24 + (1 - shoulder) * 0.14);
  const baseY = y + height * (0.1 + body * 0.12);
  const leftFootY = baseY + height * (0.02 + shoulder * 0.08);
  const rightFootY = baseY + height * (0.01 + (1 - shoulder) * 0.09);
  const baseDipY = baseY + height * (0.1 + body * 0.12);

  return {
    ...glyph,
    peakX,
    peakY,
    leftX,
    rightX,
    baseY,
    leftFootY,
    rightFootY,
    baseDipY
  };
}

function getCellBounds(cells, width) {
  let minX = width;
  let maxX = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = 0;

  for (const cell of cells) {
    const [x, y] = coordsOf(cell, width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function getMountainZoomScale(viewport) {
  return clamp(viewport.zoom, 1, 4.5);
}
