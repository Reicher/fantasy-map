import { MAP_HEIGHT, MAP_WIDTH } from "../config.js";
import { fractalNoise2D, ridgeNoise2D } from "../noise.js";
import { createRng } from "../random.js";
import {
  clamp,
  coordsOf,
  distance,
  forEachNeighbor,
  indexOf,
  quantile,
  segmentPointDistance,
  sliderFactor,
  smootherstep,
} from "../utils.js";
import { floodFillRegions } from "./grid.js";
import {
  buildInteriorFeatures,
  buildTerrainProvinces,
  sampleInteriorFeatures,
  sampleTerrainProvince,
} from "./terrainFeatures.js";
import { blendStyles, STYLE_BUILDERS } from "./terrainStyles.js";

export function generateTerrain(params) {
  const { width, height } = getTerrainResolution(params.edgeDetail);
  const size = width * height;
  const rng = createRng(`${params.seed}::terrain`);
  const styleKeys = rng.shuffle(Object.keys(STYLE_BUILDERS));
  const styleKey = styleKeys[0];
  const sizeFactor = sliderFactor(params.mapSize, 0.78);
  const coastFactor = sliderFactor(params.coastComplexity, 0.72);
  const mountainFactor = sliderFactor(params.mountainousness, 0.72);
  const primaryStyle = STYLE_BUILDERS[styleKey](
    rng.fork("primary-style"),
    sizeFactor,
  );
  const secondaryKey = styleKeys[1];
  const secondaryStyle = STYLE_BUILDERS[secondaryKey](
    rng.fork("secondary-style"),
    sizeFactor,
  );
  const style = blendStyles(
    primaryStyle,
    secondaryStyle,
    styleKey,
    secondaryKey,
    rng,
  );
  const fields = createTerrainFields(size);
  const terrainProvinces = buildTerrainProvinces(rng.fork("terrain-provinces"));
  const interiorFeatures = buildInteriorFeatures(rng.fork("interior-features"));
  populateTerrainBaseFields({
    width,
    height,
    params,
    style,
    sizeFactor,
    coastFactor,
    terrainProvinces,
    interiorFeatures,
    fields,
  });
  applyLandMask(
    width,
    height,
    size,
    fields.rawLand,
    fields.isLand,
    fields.elevation,
    style.targetLandRatio,
  );
  pruneTinyIslands(width, height, fields.isLand, fields.rawLand, style);
  classifyWaterBodies(
    width,
    height,
    fields.isLand,
    fields.oceanMask,
    fields.inlandWaterMask,
  );
  applyMountainRelief({
    width,
    height,
    params,
    style,
    sizeFactor,
    mountainFactor,
    isLand: fields.isLand,
    elevation: fields.elevation,
    mountainField: fields.mountainField,
    terrainProvinces,
    interiorFeatures,
  });
  fields.coastMask = buildCoastMask(
    width,
    height,
    size,
    fields.isLand,
    fields.oceanMask,
  );

  return {
    width,
    height,
    size,
    style,
    ...fields,
  };
}

function getTerrainResolution(edgeDetail = 300) {
  const width = clamp(Math.round(edgeDetail), 180, 520);
  const height = Math.round(width * (MAP_HEIGHT / MAP_WIDTH));
  return { width, height };
}

function createTerrainFields(size) {
  return {
    rawLand: new Float32Array(size),
    elevation: new Float32Array(size),
    isLand: new Uint8Array(size),
    mountainField: new Float32Array(size),
    provinceField: new Float32Array(size),
    reliefHeightField: new Float32Array(size),
    reliefMoistureField: new Float32Array(size),
    reliefHeatField: new Float32Array(size),
    oceanMask: new Uint8Array(size),
    inlandWaterMask: new Uint8Array(size),
    coastMask: new Uint8Array(size),
  };
}

function populateTerrainBaseFields({
  width,
  height,
  params,
  style,
  sizeFactor,
  coastFactor,
  terrainProvinces,
  interiorFeatures,
  fields,
}) {
  const terrainSeed = `${params.seed}::land`;
  const warpSeed = `${params.seed}::warp`;
  const ridgeSeed = `${params.seed}::coast-ridge`;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y, width);
      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = ((y + 0.5) / height) * 2 - 1;

      const warpX =
        (fractalNoise2D(nx * 1.6 + 4.4, ny * 1.6 - 2.1, warpSeed, {
          octaves: 3,
          gain: 0.52,
        }) -
          0.5) *
        coastFactor *
        0.24;
      const warpY =
        (fractalNoise2D(nx * 1.6 - 1.9, ny * 1.6 + 3.7, `${warpSeed}:y`, {
          octaves: 3,
          gain: 0.52,
        }) -
          0.5) *
        coastFactor *
        0.24;

      const px = nx + warpX;
      const py = ny + warpY;
      const edgeRadius = Math.hypot(px / 0.98, py / 0.92);
      const edgeFalloff = smootherstep(
        0.63 + sizeFactor * 0.07,
        1.03,
        edgeRadius,
      );
      const province = sampleTerrainProvince(terrainProvinces, px, py);
      const interior = sampleInteriorFeatures(interiorFeatures, px, py);

      let blobScore = 0;
      for (const blob of style.positiveBlobs) {
        const d = distance(px, py, blob.x, blob.y) / blob.radius;
        blobScore += Math.exp(-(d * d) * blob.tightness) * blob.strength;
      }
      for (const blob of style.negativeBlobs) {
        const d = distance(px, py, blob.x, blob.y) / blob.radius;
        blobScore -= Math.exp(-(d * d) * blob.tightness) * blob.strength;
      }

      const macroNoise =
        fractalNoise2D(
          (px + 2.2) * style.noiseScale,
          (py - 1.8) * style.noiseScale,
          terrainSeed,
          {
            octaves: 5,
            gain: 0.52,
          },
        ) - 0.5;
      const detailNoise =
        ridgeNoise2D((px - 0.7) * 6.2, (py + 0.8) * 6.2, ridgeSeed, {
          octaves: 4,
          gain: 0.58,
        }) - 0.5;
      const provinceNoise =
        fractalNoise2D(
          (px + province.noiseOffsetX) * (3.2 + province.roughness * 2.1),
          (py + province.noiseOffsetY) * (3.2 + province.roughness * 2.1),
          `${params.seed}::province-detail`,
          {
            octaves: 4,
            gain: 0.56,
          },
        ) - 0.5;

      fields.rawLand[index] =
        blobScore +
        province.heightBias * 0.42 +
        interior.heightBias * (0.28 + interior.centerWeight * 0.26) +
        macroNoise * (0.28 + coastFactor * 0.34 + province.roughness * 0.08) +
        detailNoise * (0.06 + coastFactor * 0.12 + province.roughness * 0.08) +
        provinceNoise * (0.1 + province.roughness * 0.18) -
        edgeFalloff * 1.75 -
        style.seaBias;

      fields.provinceField[index] = clamp(
        0.5 + province.heightBias * 0.45 + province.roughness * 0.25,
        0,
        1,
      );
      fields.reliefHeightField[index] = interior.heightBias;
      fields.reliefMoistureField[index] = interior.moistureBias;
      fields.reliefHeatField[index] = interior.heatBias;
    }
  }
}

function applyLandMask(
  width,
  height,
  size,
  rawLand,
  isLand,
  elevation,
  targetLandRatio,
) {
  const landThreshold = quantile(rawLand, 1 - targetLandRatio);

  for (let index = 0; index < size; index += 1) {
    const [x, y] = coordsOf(index, width);
    if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) {
      isLand[index] = 0;
      elevation[index] = 0;
      continue;
    }

    const cellHeight = rawLand[index];
    if (cellHeight > landThreshold) {
      isLand[index] = 1;
      elevation[index] = clamp(
        smootherstep(landThreshold - 0.05, landThreshold + 0.48, cellHeight),
        0,
        1,
      );
    }
  }
}

function applyMountainRelief({
  width,
  height,
  params,
  style,
  sizeFactor,
  mountainFactor,
  isLand,
  elevation,
  mountainField,
  terrainProvinces,
  interiorFeatures,
}) {
  const mountainChains = buildMountainChains(
    params.seed,
    style,
    mountainFactor,
    terrainProvinces,
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y, width);
      if (!isLand[index]) {
        continue;
      }

      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = ((y + 0.5) / height) * 2 - 1;
      const province = sampleTerrainProvince(terrainProvinces, nx, ny);
      const interior = sampleInteriorFeatures(interiorFeatures, nx, ny);

      const localNoise =
        fractalNoise2D(
          (nx + 3.1) * 4.4,
          (ny - 1.9) * 4.4,
          `${params.seed}::mountain-detail`,
          {
            octaves: 3,
            gain: 0.55,
          },
        ) * 0.25;
      let ridge = 0;
      for (const chain of mountainChains) {
        let minDistance = Number.POSITIVE_INFINITY;
        for (
          let pointIndex = 0;
          pointIndex < chain.points.length - 1;
          pointIndex += 1
        ) {
          const a = chain.points[pointIndex];
          const b = chain.points[pointIndex + 1];
          minDistance = Math.min(
            minDistance,
            segmentPointDistance(nx, ny, a.x, a.y, b.x, b.y),
          );
        }

        const influence = Math.exp(-((minDistance / chain.width) ** 2) * 2.4);
        ridge = Math.max(ridge, influence * chain.strength + localNoise);
      }

      mountainField[index] = clamp(
        ridge +
          province.mountainBias * 0.12 +
          interior.mountainBias * (0.18 + interior.centerWeight * 0.08),
        0,
        1,
      );
      elevation[index] = clamp(
        elevation[index] * (0.94 + 0.08 * sizeFactor) +
          mountainField[index] * (0.06 + mountainFactor * 0.22) +
          province.heightBias * 0.03 +
          interior.heightBias * (0.12 + interior.centerWeight * 0.08),
        0,
        1,
      );
    }
  }
}

function buildCoastMask(width, height, size, isLand, oceanMask) {
  const coastMask = new Uint8Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }
    const [x, y] = coordsOf(index, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      if (oceanMask[indexOf(nx, ny, width)]) {
        coastMask[index] = 1;
      }
    });
  }

  return coastMask;
}

function pruneTinyIslands(width, height, isLand, rawLand, style) {
  const islands = floodFillRegions(
    width,
    height,
    (index) => isLand[index] === 1,
    true,
  );
  const keepThreshold = style.tinyIslandThreshold ?? 18;

  for (const cells of islands) {
    if (cells.length >= keepThreshold) {
      continue;
    }
    for (const cell of cells) {
      isLand[cell] = 0;
      rawLand[cell] = -1;
    }
  }
}

function classifyWaterBodies(
  width,
  height,
  isLand,
  oceanMask,
  inlandWaterMask,
) {
  const waterRegions = floodFillRegions(
    width,
    height,
    (index) => isLand[index] === 0,
    true,
  );

  for (const cells of waterRegions) {
    const touchesEdge = cells.some((cell) => {
      const [x, y] = coordsOf(cell, width);
      return x === 0 || y === 0 || x === width - 1 || y === height - 1;
    });

    const targetMask = touchesEdge ? oceanMask : inlandWaterMask;
    for (const cell of cells) {
      targetMask[cell] = 1;
    }
  }
}

function buildMountainChains(seed, style, mountainFactor, terrainProvinces) {
  const rng = createRng(`${seed}::mountains`);
  const chains = [];
  const targetCount = Math.max(
    2,
    Math.round(style.mountainBase * 0.7 + mountainFactor * 10),
  );
  const blobAnchors = [...style.positiveBlobs]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, Math.max(3, Math.min(6, style.positiveBlobs.length)))
    .map((blob) => ({
      x: blob.x,
      y: blob.y,
      radius: blob.radius,
      weight: blob.strength,
    }));
  const provinceAnchors = [...terrainProvinces]
    .sort((a, b) => b.mountainBias - a.mountainBias)
    .slice(0, 5)
    .map((province) => ({
      x: province.x,
      y: province.y,
      radius: Math.min(province.rx, province.ry),
      weight: 0.55 + Math.max(0, province.mountainBias),
    }));
  const anchors = blobAnchors.concat(provinceAnchors);

  for (let chainIndex = 0; chainIndex < targetCount; chainIndex += 1) {
    const start = rng.pick(anchors);
    const end = rng.pick(anchors);
    const points = [];
    const compactMassif = rng.chance(0.38);
    const segments = compactMassif ? rng.int(2, 3) : rng.int(2, 4);
    const bend = rng.range(-0.12, 0.12);
    const centerX = compactMassif ? start.x + rng.range(-0.12, 0.12) : null;
    const centerY = compactMassif ? start.y + rng.range(-0.12, 0.12) : null;

    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const mx = compactMassif
        ? centerX + rng.range(-0.1, 0.1)
        : start.x + (end.x - start.x) * t;
      const my = compactMassif
        ? centerY + rng.range(-0.08, 0.08)
        : start.y + (end.y - start.y) * t;
      const ox = Math.sin(t * Math.PI) * bend + rng.range(-0.04, 0.04);
      const oy = Math.cos(t * Math.PI) * bend * 0.6 + rng.range(-0.04, 0.04);
      points.push({
        x: clamp(mx + ox, -0.8, 0.8),
        y: clamp(my + oy, -0.8, 0.8),
      });
    }

    chains.push({
      width: compactMassif ? rng.range(0.035, 0.07) : rng.range(0.03, 0.075),
      strength: compactMassif ? rng.range(0.62, 0.96) : rng.range(0.58, 0.92),
      points,
    });
  }

  return chains;
}
