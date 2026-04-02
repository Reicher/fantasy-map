import { BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260401a";
import { clamp, coordsOf } from "../utils.js";
import { glyphNoise } from "./hash.js";

export function drawMountains(ctx, terrain, climate, regions, geometry, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const glyphs = [];
  const zoomScale = getMountainZoomScale(viewport);
  const glyphHits = [];
  const roadSegments = buildRoadSegments(geometry?.roads ?? []);

  for (const region of regions.mountainRegions) {
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
    const regionStyle = getMountainRegionStyle(region.id, aspect);
    const targetAnchors = clamp(
      Math.round(cells.length / regionStyle.anchorDivisor),
      2,
      Math.max(4, Math.round(Math.sqrt(region.size) * 1.4))
    );
    const anchors = buildMountainAnchors(
      cells,
      terrain,
      climate,
      targetAnchors,
      regionStyle.anchorSpacingWorld,
      roadSegments
    );

    for (let index = 0; index < anchors.length; index += 1) {
      const glyph = buildMountainGlyph(
        anchors[index],
        region.id,
        index,
        regionStyle,
        viewport,
        showSnow,
        zoomScale
      );
      const fitted = fitMountainGlyphToLand(glyph, terrain, climate, viewport);
      if (fitted) {
        glyphs.push(fitted);
      }
    }
  }

  glyphs.sort((a, b) => a.y - b.y);
  for (const glyph of glyphs) {
    drawMountainGlyph(ctx, glyph);
    glyphHits.push(getMountainGlyphHit(glyph, viewport));
  }

  return glyphHits;
}

function buildMountainAnchors(cells, terrain, climate, targetAnchors, anchorSpacingWorld, roadSegments) {
  if (cells.length === 0) {
    return [];
  }

  const candidates = cells.map((cell) => {
      const [x, y] = coordsOf(cell, terrain.width);
      return {
        cellX: x,
        cellY: y,
        value: terrain.mountainField[cell],
        elevation: terrain.elevation[cell],
        biome: climate.biome[cell],
        temperature: climate.temperature[cell],
        cell
      };
    }).filter((candidate) => !isNearRoad(candidate.cellX + 0.5, candidate.cellY + 0.5, roadSegments, 1.65));

  if (candidates.length === 0) {
    return [];
  }

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
        minDistance = Math.min(
          minDistance,
          Math.hypot(anchor.cellX - candidate.cellX, anchor.cellY - candidate.cellY)
        );
      }

      const spacingPenalty = minDistance < anchorSpacingWorld ? (anchorSpacingWorld - minDistance) * 1.2 : 0;
      const score = minDistance * 1.45 + candidate.value * 2.1 - spacingPenalty;
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

function buildMountainGlyph(anchor, regionId, anchorIndex, regionStyle, viewport, showSnow, zoomScale) {
  const point = viewport.worldToCanvas(anchor.cellX, anchor.cellY);
  const noiseA = glyphNoise(anchor.cell * 17 + anchorIndex * 97 + regionId * 313);
  const noiseB = glyphNoise(anchor.cell * 31 + anchorIndex * 43 + regionId * 127);
  const noiseC = glyphNoise(anchor.cell * 61 + anchorIndex * 59 + regionId * 211);
  const noiseD = glyphNoise(anchor.cell * 83 + anchorIndex * 71 + regionId * 401);
  const noiseE = glyphNoise(anchor.cell * 101 + anchorIndex * 29 + regionId * 157);
  const noiseF = glyphNoise(anchor.cell * 131 + anchorIndex * 19 + regionId * 577);
  const widthScale = 0.82 + noiseF * 0.58;
  const heightScale = 0.8 + noiseC * 0.66;

  const height =
    (4.6 + anchor.value * 4.8 + noiseC * 2.6 + noiseE * 1.1) *
    regionStyle.heightBias *
    heightScale *
    zoomScale;
  const width =
    (5.2 + anchor.value * 5.8 + noiseA * 2.8 + noiseD * 1.6) *
    regionStyle.widthBias *
    widthScale *
    zoomScale;

  return {
    regionId,
    x: point.x + (noiseA - 0.5) * regionStyle.positionJitter * zoomScale,
    y: point.y + (noiseB - 0.5) * regionStyle.positionJitter * 0.7 * zoomScale,
    height: Math.max(4.4, height),
    width: Math.max(3.8, width),
    lean: (noiseA - 0.5) * regionStyle.leanAmount + (noiseD - 0.5) * 0.06,
    snow: anchor.elevation > 0.8 && noiseC > 0.44,
    snowSurface: isSnowCell(anchor.biome, anchor.elevation, anchor.value, anchor.temperature, showSnow),
    noise: noiseB,
    shoulder: noiseD,
    body: noiseE
  };
}

function getMountainRegionStyle(regionId, aspect = 1) {
  const profile = glyphNoise(regionId * 941 + 17);
  const shape = glyphNoise(regionId * 569 + 91);
  const spacing = glyphNoise(regionId * 223 + 47);
  const narrowBoost = aspect > 2.2 ? 0.84 : aspect > 1.6 ? 0.92 : 1;

  if (profile < 0.34) {
    return {
      anchorDivisor: (aspect > 2.2 ? 7.2 : aspect > 1.6 ? 8.5 : 10.5) / narrowBoost,
      anchorSpacingWorld: (2.6 + spacing * 0.6) * narrowBoost,
      widthBias: (1.28 + shape * 0.18) * narrowBoost,
      heightBias: 0.82 + shape * 0.1,
      leanAmount: 0.2,
      positionJitter: 0.7 + shape * 0.4
    };
  }

  if (profile > 0.68) {
    return {
      anchorDivisor: (aspect > 2.2 ? 8.4 : aspect > 1.6 ? 9.6 : 11.4) / narrowBoost,
      anchorSpacingWorld: (2.8 + spacing * 0.55) * narrowBoost,
      widthBias: (0.92 + shape * 0.12) * narrowBoost,
      heightBias: 1.15 + shape * 0.18,
      leanAmount: 0.28,
      positionJitter: 0.55 + shape * 0.25
    };
  }

  return {
    anchorDivisor: (aspect > 2.2 ? 7.8 : aspect > 1.6 ? 9 : 11) / narrowBoost,
    anchorSpacingWorld: (2.7 + spacing * 0.5) * narrowBoost,
    widthBias: (1.05 + shape * 0.14) * narrowBoost,
    heightBias: 0.98 + shape * 0.14,
    leanAmount: 0.24,
    positionJitter: 0.62 + shape * 0.3
  };
}

function buildRoadSegments(roads) {
  const segments = [];
  for (const road of roads) {
    if (road.type !== "road" || !road.points || road.points.length < 2) {
      continue;
    }
    for (let index = 0; index < road.points.length - 1; index += 1) {
      segments.push({
        a: road.points[index],
        b: road.points[index + 1]
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
  const shoulderBias = (glyph.body - 0.5) * width * 0.14;
  const ridgeDip = baseDipY - height * (0.05 + glyph.noise * 0.04);
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
  ctx.quadraticCurveTo(x - width * (0.12 + shoulder * 0.08), peakY + height * (0.16 + glyph.noise * 0.03), peakX, peakY);
  ctx.quadraticCurveTo(x + width * (0.11 + (1 - shoulder) * 0.08), peakY + height * (0.19 + glyph.body * 0.04), rightX, rightFootY);
  ctx.quadraticCurveTo(x + shoulderBias, ridgeDip, leftX, leftFootY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = glyph.snowSurface ? "rgba(107, 102, 94, 0.84)" : "rgba(64, 56, 47, 0.9)";
  ctx.lineWidth = 0.75 + height * 0.018;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(leftX, leftFootY);
  ctx.quadraticCurveTo(x - width * (0.12 + shoulder * 0.08), peakY + height * (0.16 + glyph.noise * 0.03), peakX, peakY);
  ctx.quadraticCurveTo(x + width * (0.11 + (1 - shoulder) * 0.08), peakY + height * (0.19 + glyph.body * 0.04), rightX, rightFootY);
  ctx.stroke();

  ctx.strokeStyle = glyph.snowSurface ? "rgba(186, 183, 177, 0.5)" : "rgba(116, 112, 108, 0.42)";
  ctx.lineWidth = 0.28 + height * 0.008;
  ctx.beginPath();
  ctx.moveTo(leftX + width * (0.3 + shoulder * 0.16), leftFootY + height * 0.04);
  ctx.lineTo(rightX - width * (0.34 + (1 - shoulder) * 0.22), rightFootY + height * 0.01);
  ctx.stroke();

  if (snow) {
    drawMountainSnowCap(ctx, {
      peakX,
      peakY,
      leftX,
      rightX,
      leftFootY,
      rightFootY,
      width,
      height,
      shoulder,
      noise: glyph.noise,
      body: glyph.body
    });
  }
}

function drawMountainSnowCap(ctx, geometry) {
  const {
    peakX,
    peakY,
    leftX,
    rightX,
    leftFootY,
    rightFootY,
    width,
    height,
    shoulder,
    noise,
    body
  } = geometry;

  const leftT = 0.28 + shoulder * 0.1;
  const rightT = 0.26 + (1 - shoulder) * 0.12;
  const leftBase = pointOnSegment(
    { x: peakX, y: peakY + height * 0.03 },
    { x: leftX, y: leftFootY },
    leftT
  );
  const rightBase = pointOnSegment(
    { x: peakX, y: peakY + height * 0.03 },
    { x: rightX, y: rightFootY },
    rightT
  );
  const centerDipY = Math.max(leftBase.y, rightBase.y) - height * (0.035 + body * 0.01);
  const centerDipX = peakX + (noise - 0.5) * width * 0.05;
  const leftInset = width * 0.01;
  const rightInset = width * 0.01;

  ctx.fillStyle = "rgba(245, 241, 233, 0.95)";
  ctx.beginPath();
  ctx.moveTo(peakX, peakY + height * 0.05);
  ctx.lineTo(leftBase.x + leftInset, leftBase.y);
  ctx.lineTo(centerDipX, centerDipY);
  ctx.lineTo(rightBase.x - rightInset, rightBase.y);
  ctx.closePath();
  ctx.fill();
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

function getMountainGlyphHit(glyph, viewport) {
  const geometry = getMountainGeometry(glyph);
  return {
    regionId: glyph.regionId,
    x: geometry.x,
    y: geometry.baseY - glyph.height * 0.24,
    radius: Math.max(6, Math.min(20, glyph.width * 0.4 + glyph.height * 0.16)),
    worldX: viewport.canvasToWorld(geometry.x, geometry.baseY - glyph.height * 0.24).x,
    worldY: viewport.canvasToWorld(geometry.x, geometry.baseY - glyph.height * 0.24).y
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

function pointOnSegment(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}
