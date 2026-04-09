import { BIOME_KEYS } from "../config.js";
import { isSnowCell } from "../generator/surfaceModel.js?v=20260402b";
import { clamp, coordsOf } from "../utils.js";
import { MOUNTAIN_COLORS } from "./colorTokens.js";
import { glyphNoise } from "./hash.js";

const MOUNTAIN_ROAD_ANCHOR_EXCLUSION_RADIUS = 1.12;
const MOUNTAIN_ROAD_GLYPH_EXCLUSION_MIN_PX = 5.7;
const MOUNTAIN_ROAD_GLYPH_EXCLUSION_WIDTH_FACTOR = 0.18;

export function collectMountainRenderGlyphs(terrain, climate, regions, geometry, viewport, options = {}) {
  const showSnow = options.showSnow !== false;
  const glyphs = [];
  const zoomScale = getMountainZoomScale(viewport);
  const glyphHits = [];
  const roadSegments = buildRoadSegments(geometry?.roads ?? []);
  const canvasRoadSegments = buildCanvasRoadSegments(geometry?.roads ?? [], viewport);

  for (const region of regions.mountainRegions) {
    const cells = region.cells
      .filter((cell) => terrain.isLand[cell] === 1 && climate.biome[cell] !== BIOME_KEYS.LAKE)
      .sort((a, b) => terrain.mountainField[b] - terrain.mountainField[a]);

    if (cells.length === 0) {
      continue;
    }

    const bounds = getCellBounds(cells, terrain.width);
    const aspect = Math.max(bounds.width, bounds.height) / Math.max(1, Math.min(bounds.width, bounds.height));
    const regionStyle = getMountainRegionStyle(region.id, aspect);
    const targetAnchors = getTargetMountainAnchorCount(region.size, regionStyle.anchorDivisor);
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
      if (fitted && !mountainGlyphNearRoad(fitted, canvasRoadSegments)) {
        glyphs.push(fitted);
      }
    }
  }

  glyphs.sort((a, b) => getMountainFootY(a) - getMountainFootY(b));
  for (const glyph of glyphs) {
    glyphHits.push(getMountainGlyphHit(glyph, viewport));
  }

  return { glyphs, glyphHits };
}

function buildMountainAnchors(cells, terrain, climate, targetAnchors, anchorSpacingWorld, roadSegments) {
  if (cells.length === 0) {
    return [];
  }

  const allCandidates = cells.map((cell) => {
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
    });

  let candidates = allCandidates.filter(
    (candidate) =>
      !isNearRoad(
        candidate.cellX + 0.5,
        candidate.cellY + 0.5,
        roadSegments,
        MOUNTAIN_ROAD_ANCHOR_EXCLUSION_RADIUS,
      )
  );

  if (candidates.length < Math.max(2, Math.round(targetAnchors * 0.7))) {
    candidates = allCandidates;
  }

  if (candidates.length === 0) {
    return [];
  }

  const candidatePool = [...candidates]
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(targetAnchors * 3, 24));
  const desiredSpacing = Math.max(
    anchorSpacingWorld * 1.3,
    Math.sqrt(cells.length / Math.max(1, targetAnchors)) * 0.72
  );
  const anchors = [candidatePool[0]];
  const selected = new Uint8Array(candidatePool.length);
  selected[0] = 1;
  const minDistance = new Float32Array(candidatePool.length);
  minDistance.fill(Number.POSITIVE_INFINITY);
  updateCandidateDistances(candidatePool, selected, minDistance, candidatePool[0]);

  while (anchors.length < targetAnchors && anchors.length < candidatePool.length) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let index = 0; index < candidatePool.length; index += 1) {
      if (selected[index] === 1) {
        continue;
      }
      const spacingRatio = minDistance[index] / Math.max(0.001, desiredSpacing);
      const spreadScore = Math.min(2.4, spacingRatio);
      const crowdPenalty = Math.exp(-(spacingRatio * spacingRatio) * 3.1);
      const score = candidatePool[index].value * 2.7 + spreadScore * 1.7 - crowdPenalty * 2.05;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    selected[bestIndex] = 1;
    const nextAnchor = candidatePool[bestIndex];
    anchors.push(nextAnchor);
    updateCandidateDistances(candidatePool, selected, minDistance, nextAnchor);
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
  const narrowBoost = aspect > 2.2 ? 0.84 : aspect > 1.6 ? 0.92 : 1;
  const densityDivisor = (aspect > 2.2 ? 3.9 : aspect > 1.6 ? 4.8 : 5.9) / narrowBoost;
  const densitySpacing = (aspect > 2.2 ? 1.18 : aspect > 1.6 ? 1.24 : 1.3) * narrowBoost;

  if (profile < 0.34) {
    return {
      anchorDivisor: densityDivisor,
      anchorSpacingWorld: densitySpacing,
      widthBias: (1.28 + shape * 0.18) * narrowBoost,
      heightBias: 0.82 + shape * 0.1,
      leanAmount: 0.2,
      positionJitter: 0.7 + shape * 0.4
    };
  }

  if (profile > 0.68) {
    return {
      anchorDivisor: densityDivisor,
      anchorSpacingWorld: densitySpacing,
      widthBias: (0.92 + shape * 0.12) * narrowBoost,
      heightBias: 1.15 + shape * 0.18,
      leanAmount: 0.28,
      positionJitter: 0.55 + shape * 0.25
    };
  }

  return {
    anchorDivisor: densityDivisor,
    anchorSpacingWorld: densitySpacing,
    widthBias: (1.05 + shape * 0.14) * narrowBoost,
    heightBias: 0.98 + shape * 0.14,
    leanAmount: 0.24,
    positionJitter: 0.62 + shape * 0.3
  };
}

function getTargetMountainAnchorCount(regionSize, anchorDivisor) {
  const packingSpacing = Math.max(1.15, anchorDivisor * 0.45);
  const areaPerAnchor = Math.PI * packingSpacing * packingSpacing;
  return clamp(Math.round(regionSize / areaPerAnchor), 3, Math.max(10, regionSize));
}

function updateCandidateDistances(candidatePool, selected, minDistance, anchor) {
  for (let index = 0; index < candidatePool.length; index += 1) {
    if (selected[index] === 1) {
      continue;
    }
    const candidate = candidatePool[index];
    const distance = Math.hypot(anchor.cellX - candidate.cellX, anchor.cellY - candidate.cellY);
    if (distance < minDistance[index]) {
      minDistance[index] = distance;
    }
  }
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

export function drawMountainGlyph(ctx, glyph) {
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
    fillGradient.addColorStop(0, MOUNTAIN_COLORS.gradient.snow.top);
    fillGradient.addColorStop(0.62, MOUNTAIN_COLORS.gradient.snow.mid);
    fillGradient.addColorStop(1, MOUNTAIN_COLORS.gradient.snow.bottom);
  } else {
    fillGradient.addColorStop(0, MOUNTAIN_COLORS.gradient.rock.top);
    fillGradient.addColorStop(0.62, MOUNTAIN_COLORS.gradient.rock.mid);
    fillGradient.addColorStop(1, MOUNTAIN_COLORS.gradient.rock.bottom);
  }

  ctx.fillStyle = fillGradient;
  ctx.beginPath();
  ctx.moveTo(leftX, leftFootY);
  ctx.quadraticCurveTo(x - width * (0.12 + shoulder * 0.08), peakY + height * (0.16 + glyph.noise * 0.03), peakX, peakY);
  ctx.quadraticCurveTo(x + width * (0.11 + (1 - shoulder) * 0.08), peakY + height * (0.19 + glyph.body * 0.04), rightX, rightFootY);
  ctx.quadraticCurveTo(x + shoulderBias, ridgeDip, leftX, leftFootY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = glyph.snowSurface ? MOUNTAIN_COLORS.ridge.snow : MOUNTAIN_COLORS.ridge.rock;
  ctx.lineWidth = 0.75 + height * 0.018;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(leftX, leftFootY);
  ctx.quadraticCurveTo(x - width * (0.12 + shoulder * 0.08), peakY + height * (0.16 + glyph.noise * 0.03), peakX, peakY);
  ctx.quadraticCurveTo(x + width * (0.11 + (1 - shoulder) * 0.08), peakY + height * (0.19 + glyph.body * 0.04), rightX, rightFootY);
  ctx.stroke();

  ctx.strokeStyle = glyph.snowSurface ? MOUNTAIN_COLORS.detail.snow : MOUNTAIN_COLORS.detail.rock;
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

  ctx.fillStyle = MOUNTAIN_COLORS.snowCap;
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

function mountainGlyphNearRoad(glyph, roadSegments) {
  const geometry = getMountainGeometry(glyph);
  const threshold = Math.max(
    MOUNTAIN_ROAD_GLYPH_EXCLUSION_MIN_PX,
    glyph.width * MOUNTAIN_ROAD_GLYPH_EXCLUSION_WIDTH_FACTOR,
  );
  const samplePoints = [
    [geometry.x, geometry.baseY],
    [geometry.leftX + (geometry.x - geometry.leftX) * 0.24, geometry.leftFootY],
    [geometry.rightX - (geometry.rightX - geometry.x) * 0.24, geometry.rightFootY],
    [geometry.x, geometry.baseY - glyph.height * 0.1]
  ];

  return samplePoints.some(([x, y]) => isNearRoad(x, y, roadSegments, threshold));
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

export function getMountainFootY(glyph) {
  const geometry = getMountainGeometry(glyph);
  return Math.max(geometry.baseY, geometry.leftFootY, geometry.rightFootY);
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
