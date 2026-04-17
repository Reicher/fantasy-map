import { MAP_HEIGHT, MAP_WIDTH } from "@fardvag/shared/config";
import { fractalNoise2D, ridgeNoise2D } from "@fardvag/shared/noise";
import { createRng } from "@fardvag/shared/random";
import {
  clamp,
  coordsOf,
  forEachNeighbor,
  indexOf,
  quantile,
  segmentPointDistance,
  sliderFactor,
  smootherstep,
} from "@fardvag/shared/utils";
import { floodFillRegions } from "./grid";
import {
  buildInteriorFeatures,
  buildTerrainProvinces,
  sampleInteriorFeatures,
  sampleTerrainProvince,
} from "./terrainFeatures";

export function generateTerrain(params) {
  const baseWidth = clamp(Math.round(params.edgeDetail ?? 300), 180, 520);
  const worldScale = clamp(Number(params.worldScale ?? 100), 70, 220) / 100;
  const horizontalStretch = resolveHorizontalStretch(params.worldAspect);
  const { width, height } = resolveTerrainDimensions(
    baseWidth,
    worldScale,
    horizontalStretch,
  );
  const size = width * height;
  const rng = createRng(`${params.seed}::terrain`);
  const sizeFactor = sliderFactor(params.mapSize, 0.78);
  const coastFactor = sliderFactor(params.coastComplexity, 0.72);
  const mountainFactor = sliderFactor(params.mountainousness, 0.72);
  const fragmentationFactor = sliderFactor(params.fragmentation ?? 52, 0.86);
  const style = createRandomTerrainStyle(
    rng.fork("terrain-style"),
    sizeFactor,
    coastFactor,
    horizontalStretch,
    fragmentationFactor,
  );
  const adjustedTargetLandRatio = resolveTargetLandRatio(
    style.targetLandRatio,
    worldScale,
  );
  const fields = {
    rawLand: new Float32Array(size),
    elevation: new Float32Array(size),
    isLand: new Uint8Array(size),
    mountainField: new Float32Array(size),
    provinceField: new Float32Array(size),
    provinceHeightBiasField: new Float32Array(size),
    provinceRoughnessField: new Float32Array(size),
    provinceMountainBiasField: new Float32Array(size),
    provinceNoiseOffsetXField: new Float32Array(size),
    provinceNoiseOffsetYField: new Float32Array(size),
    reliefHeightField: new Float32Array(size),
    reliefMountainField: new Float32Array(size),
    reliefCenterWeightField: new Float32Array(size),
    reliefMoistureField: new Float32Array(size),
    reliefHeatField: new Float32Array(size),
    oceanMask: new Uint8Array(size),
    inlandWaterMask: new Uint8Array(size),
    coastMask: new Uint8Array(size),
  };
  const terrainProvinces = buildTerrainProvinces(rng.fork("terrain-provinces"));
  const interiorFeatures = buildInteriorFeatures(rng.fork("interior-features"));
  populateTerrainBaseFields({
    width,
    height,
    params,
    style,
    horizontalStretch,
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
    adjustedTargetLandRatio,
    horizontalStretch,
  );
  applyExtremeFragmentation({
    width,
    height,
    seed: params.seed,
    fragmentation: params.fragmentation,
    horizontalStretch,
    rawLand: fields.rawLand,
    isLand: fields.isLand,
    elevation: fields.elevation,
  });
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
    horizontalStretch,
    sizeFactor,
    mountainFactor,
    isLand: fields.isLand,
  elevation: fields.elevation,
  mountainField: fields.mountainField,
  terrainProvinces,
  provinceHeightBiasField: fields.provinceHeightBiasField,
  provinceMountainBiasField: fields.provinceMountainBiasField,
  reliefHeightField: fields.reliefHeightField,
  reliefMountainField: fields.reliefMountainField,
    reliefCenterWeightField: fields.reliefCenterWeightField,
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

function populateTerrainBaseFields({
  width,
  height,
  params,
  style,
  horizontalStretch,
  sizeFactor,
  coastFactor,
  terrainProvinces,
  interiorFeatures,
  fields,
}) {
  const terrainSeed = `${params.seed}::land`;
  const warpSeed = `${params.seed}::warp`;
  const warpSeedY = `${warpSeed}:y`;
  const ridgeSeed = `${params.seed}::coast-ridge`;
  const provinceDetailSeed = `${params.seed}::province-detail`;
  const coastCovesSeed = `${params.seed}::coast-coves`;
  const provinceSample = {
    heightBias: 0,
    roughness: 0.2,
    mountainBias: 0,
    noiseOffsetX: 0,
    noiseOffsetY: 0,
  };
  const interiorSample = {
    heightBias: 0,
    mountainBias: 0,
    moistureBias: 0,
    heatBias: 0,
    centerWeight: 0,
  };

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
        (fractalNoise2D(nx * 1.6 - 1.9, ny * 1.6 + 3.7, warpSeedY, {
          octaves: 3,
          gain: 0.52,
        }) -
          0.5) *
        coastFactor *
        0.24;

      const px = nx + warpX;
      const py = ny + warpY;
      const stretchedPx = px / horizontalStretch;
      const edgeRadius = Math.hypot(stretchedPx / 0.95, py / 0.9);
      const edgeFalloff = smootherstep(
        0.56 + sizeFactor * 0.06,
        1.03,
        edgeRadius,
      );
      const xEndTaper =
        smootherstep(style.endCaps.xStart, 1.02, Math.abs(px)) *
        style.endCaps.xStrength;
      const yEndTaper =
        smootherstep(style.endCaps.yStart, 1.02, Math.abs(py)) *
        style.endCaps.yStrength;
      const edgeWall = xEndTaper + yEndTaper;
      const province = sampleTerrainProvince(
        terrainProvinces,
        px,
        py,
        provinceSample,
      );
      const interior = sampleInteriorFeatures(
        interiorFeatures,
        px,
        py,
        interiorSample,
      );

      let blobScore = 0;
      for (const blob of style.positiveBlobs) {
        const d = Math.hypot(px - blob.x, py - blob.y) / blob.radius;
        blobScore += Math.exp(-(d * d) * blob.tightness) * blob.strength;
      }
      for (const blob of style.negativeBlobs) {
        const d = Math.hypot(px - blob.x, py - blob.y) / blob.radius;
        blobScore -= Math.exp(-(d * d) * blob.tightness) * blob.strength;
      }
      let channelCut = 0;
      for (const channel of style.channelCuts) {
        const channelCenterX =
          channel.x +
          Math.sin((py + channel.phase) * channel.wobbleFreq) * channel.wobbleAmp;
        const dx = Math.abs(px - channelCenterX);
        const influence = Math.exp(-((dx / channel.width) ** 2) * 2);
        channelCut += influence * channel.strength;
      }

      const macroNoise =
        fractalNoise2D(
          (stretchedPx + 2.2) * style.noiseScale,
          (py - 1.8) * style.noiseScale,
          terrainSeed,
          {
            octaves: 5,
            gain: 0.52,
          },
        ) - 0.5;
      const detailNoise =
        ridgeNoise2D((stretchedPx - 0.7) * 6.2, (py + 0.8) * 6.2, ridgeSeed, {
          octaves: 4,
          gain: 0.58,
        }) - 0.5;
      const provinceNoise =
        fractalNoise2D(
          (stretchedPx + province.noiseOffsetX) *
            (3.2 + province.roughness * 2.1),
          (py + province.noiseOffsetY) * (3.2 + province.roughness * 2.1),
          provinceDetailSeed,
          {
            octaves: 4,
            gain: 0.56,
          },
        ) - 0.5;
      const coveNoise =
        ridgeNoise2D(
          (stretchedPx + 5.7) * (6.2 + coastFactor * 5.6),
          (py - 2.8) * (6.2 + coastFactor * 5.6),
          coastCovesSeed,
          {
            octaves: 3,
            gain: 0.6,
          },
        ) - 0.5;
      const coveCut =
        smootherstep(0.09, 0.42, coveNoise) * (0.06 + coastFactor * 0.2);

      fields.rawLand[index] =
        blobScore +
        province.heightBias * 0.42 +
        interior.heightBias * (0.28 + interior.centerWeight * 0.26) +
        macroNoise * (0.28 + coastFactor * 0.34 + province.roughness * 0.08) +
        detailNoise * (0.06 + coastFactor * 0.12 + province.roughness * 0.08) +
        provinceNoise * (0.1 + province.roughness * 0.18) -
        coveCut -
        channelCut -
        edgeFalloff * 1.75 -
        edgeWall -
        style.seaBias;

      fields.provinceField[index] = clamp(
        0.5 + province.heightBias * 0.45 + province.roughness * 0.25,
        0,
        1,
      );
      fields.provinceHeightBiasField[index] = province.heightBias;
      fields.provinceRoughnessField[index] = province.roughness;
      fields.provinceMountainBiasField[index] = province.mountainBias;
      fields.provinceNoiseOffsetXField[index] = province.noiseOffsetX;
      fields.provinceNoiseOffsetYField[index] = province.noiseOffsetY;
      fields.reliefHeightField[index] = interior.heightBias;
      fields.reliefMountainField[index] = interior.mountainBias;
      fields.reliefCenterWeightField[index] = interior.centerWeight;
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
  horizontalStretch,
) {
  const landThreshold = quantile(rawLand, 1 - targetLandRatio);
  const stretchFactor = clamp((horizontalStretch - 1) / 4, 0, 1);
  const waterFrameX = Math.max(4, Math.round(width * (0.04 + stretchFactor * 0.045)));
  const waterFrameY = Math.max(4, Math.round(height * 0.04));

  for (let index = 0; index < size; index += 1) {
    const [x, y] = coordsOf(index, width);
    if (
      x < waterFrameX ||
      y < waterFrameY ||
      x >= width - waterFrameX ||
      y >= height - waterFrameY
    ) {
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

function applyExtremeFragmentation({
  width,
  height,
  seed,
  fragmentation,
  horizontalStretch,
  rawLand,
  isLand,
  elevation,
}) {
  const frag01 = clamp(Number(fragmentation ?? 0) / 100, 0, 1);
  const extreme = smootherstep(0.88, 1, frag01);
  const archipelagoStrength = smootherstep(0.74, 1, frag01);
  if (extreme <= 0 && archipelagoStrength <= 0) {
    return;
  }

  if (extreme > 0) {
    const passes = 1 + Math.round(extreme * 2);
    for (let pass = 0; pass < passes; pass += 1) {
      const toWater = [];
      const freq = 6 + pass * 1.4 + extreme * 4.6;
      const noiseSeed = `${seed}::extreme-frag:${pass}`;

      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = indexOf(x, y, width);
          if (isLand[index] !== 1) {
            continue;
          }

          const left = isLand[index - 1];
          const right = isLand[index + 1];
          const up = isLand[index - width];
          const down = isLand[index + width];
          const horizontalNeck = left === 0 && right === 0 && up === 1 && down === 1;
          const verticalNeck = up === 0 && down === 0 && left === 1 && right === 1;

          const waterNeighbors = countWaterNeighbors8(width, height, x, y, isLand);
          const [nx, ny] = normalizedCell(x, y, width, height);
          const noise =
            ridgeNoise2D(
              (nx / horizontalStretch) * freq,
              ny * freq,
              noiseSeed,
              {
                octaves: 3,
                gain: 0.56,
              },
            ) - 0.5;
          const noiseCut = smootherstep(0.08, 0.44, noise);
          const coastPressure = waterNeighbors / 8;
          const softLand = clamp(
            (0.22 - rawLand[index]) * 1.85 + (0.74 - elevation[index]) * 0.34,
            0,
            1,
          );

          if (elevation[index] > 0.88 && rawLand[index] > 0.56) {
            continue;
          }

          let breakScore =
            coastPressure * (0.6 + extreme * 0.34) +
            softLand * (0.34 + extreme * 0.2) +
            noiseCut * (0.44 + extreme * 0.54);
          if (horizontalNeck || verticalNeck) {
            breakScore += 0.72 + extreme * 0.32;
          }
          if (waterNeighbors >= 5) {
            breakScore += 0.22;
          }

          const threshold = 0.98 - extreme * 0.24 - pass * 0.06;
          if (breakScore > threshold) {
            toWater.push(index);
          }
        }
      }

      for (const index of toWater) {
        isLand[index] = 0;
        elevation[index] = 0;
        rawLand[index] = -1;
      }
    }
  }

  if (archipelagoStrength > 0) {
    enforceMinimumArchipelagoIslands({
      width,
      height,
      seed,
      archipelagoStrength,
      isLand,
      elevation,
      rawLand,
    });
  }
}

function enforceMinimumArchipelagoIslands({
  width,
  height,
  seed,
  archipelagoStrength,
  isLand,
  elevation,
  rawLand,
}) {
  const strength = clamp(Number(archipelagoStrength ?? 0), 0, 1);
  let landTiles = 0;
  for (let index = 0; index < isLand.length; index += 1) {
    landTiles += isLand[index] === 1 ? 1 : 0;
  }
  if (landTiles < 320) {
    return;
  }

  const targetIslands = resolveArchipelagoTargetIslands(landTiles, strength);
  let islands = floodFillRegions(
    width,
    height,
    (index) => isLand[index] === 1,
    true,
  );
  if (islands.length >= targetIslands) {
    return;
  }

  const maxRounds = 8;
  for (let round = 0; round < maxRounds; round += 1) {
    if (islands.length >= targetIslands) {
      break;
    }

    const minSplitSize = Math.max(70, Math.round(landTiles * 0.012));
    const maxCandidates = Math.max(2, Math.round(2 + strength * 5));
    const candidates = [...islands]
      .filter((cells) => cells.length >= minSplitSize)
      .sort((a, b) => b.length - a.length)
      .slice(0, maxCandidates);

    if (candidates.length === 0) {
      break;
    }

    let changed = false;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (islands.length >= targetIslands) {
        break;
      }
      const didSplit = carveIslandChannel({
        width,
        height,
        isLand,
        elevation,
        rawLand,
        cells: candidates[candidateIndex],
        seedToken: `${seed}::island-split:${round}:${candidateIndex}:${candidates[candidateIndex].length}`,
        archipelagoStrength: strength,
      });
      changed = changed || didSplit;
    }

    if (!changed) {
      break;
    }

    islands = floodFillRegions(
      width,
      height,
      (index) => isLand[index] === 1,
      true,
    );
  }
}

function resolveArchipelagoTargetIslands(landTiles, archipelagoStrength) {
  const fromLand = Math.round(landTiles / 6500);
  const fromStrength = Math.round(4 + archipelagoStrength * 9);
  return clamp(fromStrength + fromLand, 6, 18);
}

function carveIslandChannel({
  width,
  height,
  isLand,
  elevation,
  rawLand,
  cells,
  seedToken,
  archipelagoStrength,
}) {
  if (!cells || cells.length < 40) {
    return false;
  }

  const regionMask = new Uint8Array(width * height);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (const cell of cells) {
    regionMask[cell] = 1;
    const [x, y] = coordsOf(cell, width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  if (spanX < 8 && spanY < 8) {
    return false;
  }

  const coastCells = [];
  for (const cell of cells) {
    const [x, y] = coordsOf(cell, width);
    if (
      x <= 0 ||
      y <= 0 ||
      x >= width - 1 ||
      y >= height - 1 ||
      isLand[indexOf(x - 1, y, width)] === 0 ||
      isLand[indexOf(x + 1, y, width)] === 0 ||
      isLand[indexOf(x, y - 1, width)] === 0 ||
      isLand[indexOf(x, y + 1, width)] === 0
    ) {
      coastCells.push({ x, y });
    }
  }
  if (coastCells.length < 2) {
    return false;
  }

  const rng = createRng(seedToken);
  const aspect = spanX / Math.max(1, spanY);
  let splitAlongMajor = rng.chance(0.34);
  if (aspect >= 1.35) {
    // För avlånga huvudmassor vill vi oftare skära tvärs över längdriktningen
    // så att vi får separata öar istället för horisontella korvband.
    splitAlongMajor = rng.chance(0.14);
  } else if (aspect <= 0.74) {
    splitAlongMajor = rng.chance(0.14);
  }
  const useLeftRight = aspect < 1 ? splitAlongMajor : !splitAlongMajor;

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const edgeBandX = Math.max(2, spanX * 0.2);
  const edgeBandY = Math.max(2, spanY * 0.2);

  let startPool;
  let endPool;
  if (useLeftRight) {
    startPool = coastCells.filter((cell) => cell.x <= minX + edgeBandX);
    endPool = coastCells.filter((cell) => cell.x >= maxX - edgeBandX);
  } else {
    startPool = coastCells.filter((cell) => cell.y <= minY + edgeBandY);
    endPool = coastCells.filter((cell) => cell.y >= maxY - edgeBandY);
  }
  if (startPool.length === 0 || endPool.length === 0) {
    return false;
  }

  const axisTarget = useLeftRight
    ? centerY + rng.range(-spanY * 0.22, spanY * 0.22)
    : centerX + rng.range(-spanX * 0.22, spanX * 0.22);
  const axisKey = useLeftRight ? "y" : "x";
  const start = pickCoastPoint(startPool, axisTarget, axisKey, rng);
  const end = pickCoastPoint(endPool, axisTarget, axisKey, rng);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 8) {
    return false;
  }

  const nx = -dy / Math.max(length, 0.001);
  const ny = dx / Math.max(length, 0.001);
  const segments = Math.max(10, Math.round(length * 1.4));
  const baseRadius = Math.max(1, Math.min(3, Math.round(1 + archipelagoStrength * 1.6)));
  const amplitude = Math.max(
    0.9,
    Math.min(5.2, Math.min(spanX, spanY) * (0.09 + archipelagoStrength * 0.11)),
  );
  const phase = rng.range(-1.2, 1.2);
  const wiggleFreq = rng.range(1.8, 3.7);

  let removed = 0;
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments;
    const taper = Math.sin(t * Math.PI);
    const bend =
      Math.sin((t + phase) * Math.PI * wiggleFreq) * amplitude * (0.35 + taper * 0.65);
    const cx = Math.round(start.x + dx * t + nx * bend);
    const cy = Math.round(start.y + dy * t + ny * bend);
    const radius = baseRadius + (taper > 0.3 ? 1 : 0);
    const radiusSq = radius * radius;

    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy > radiusSq) {
          continue;
        }
        const x = cx + ox;
        const y = cy + oy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const index = indexOf(x, y, width);
        if (regionMask[index] !== 1 || isLand[index] !== 1) {
          continue;
        }
        isLand[index] = 0;
        elevation[index] = 0;
        rawLand[index] = -1;
        removed += 1;
      }
    }
  }

  return removed >= Math.max(16, Math.round(length * 0.9));
}

function pickCoastPoint(pool, centerAxis, axisKey, rng) {
  if (pool.length === 1) {
    return pool[0];
  }

  let best = pool[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const point of pool) {
    const axisValue = axisKey === "x" ? point.x : point.y;
    const axis = Math.abs(axisValue - centerAxis);
    const score = axis + rng.range(0, 0.35);
    if (score < bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

function applyMountainRelief({
  width,
  height,
  params,
  style,
  horizontalStretch,
  sizeFactor,
  mountainFactor,
  isLand,
  elevation,
  mountainField,
  terrainProvinces,
  provinceHeightBiasField,
  provinceMountainBiasField,
  reliefHeightField,
  reliefMountainField,
  reliefCenterWeightField,
}) {
  const mountainChains = buildMountainChains(
    params.seed,
    style,
    mountainFactor,
    terrainProvinces,
  );
  const mountainDetailSeed = `${params.seed}::mountain-detail`;
  const scaledMountainChains = mountainChains.map((chain) => ({
    ...chain,
    points: chain.points.map((point) => ({
      x: point.x / horizontalStretch,
      y: point.y,
    })),
  }));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y, width);
      if (!isLand[index]) {
        continue;
      }

      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = ((y + 0.5) / height) * 2 - 1;
      const stretchedNx = nx / horizontalStretch;

      const localNoise =
        fractalNoise2D(
          (stretchedNx + 3.1) * 4.4,
          (ny - 1.9) * 4.4,
          mountainDetailSeed,
          {
            octaves: 3,
            gain: 0.55,
          },
        ) * 0.25;
      let ridge = 0;
      for (const chain of scaledMountainChains) {
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
            segmentPointDistance(
              stretchedNx,
              ny,
              a.x,
              a.y,
              b.x,
              b.y,
            ),
          );
        }

        const influence = Math.exp(-((minDistance / chain.width) ** 2) * 2.4);
        ridge = Math.max(ridge, influence * chain.strength + localNoise);
      }

      mountainField[index] = clamp(
        ridge +
          provinceMountainBiasField[index] * 0.12 +
          reliefMountainField[index] * (0.18 + reliefCenterWeightField[index] * 0.08),
        0,
        1,
      );
      elevation[index] = clamp(
        elevation[index] * (0.94 + 0.08 * sizeFactor) +
          mountainField[index] * (0.06 + mountainFactor * 0.22) +
          provinceHeightBiasField[index] * 0.03 +
          reliefHeightField[index] * (0.12 + reliefCenterWeightField[index] * 0.08),
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

function resolveHorizontalStretch(rawValue) {
  const setting = clamp(Number(rawValue ?? 1), 1, 1.6);
  return 1 + (setting - 1) * 6.6667;
}

function resolveTerrainDimensions(baseWidth, worldScale, horizontalStretch) {
  const baselineWidth = clamp(Math.round(baseWidth * worldScale), 160, 1200);
  const baselineHeight = Math.max(
    120,
    Math.round(baselineWidth * (MAP_HEIGHT / MAP_WIDTH)),
  );
  const baselineArea = baselineWidth * baselineHeight;
  const targetAspect = clamp(horizontalStretch, 1, 5);

  let width = Math.round(Math.sqrt(baselineArea * targetAspect));
  let height = Math.max(72, Math.round(width / targetAspect));

  // Keep extreme aspect values practical while preserving area-driven scaling.
  if (width > 2400) {
    width = 2400;
    height = Math.max(72, Math.round(width / targetAspect));
  }

  // Large grids can stall editor generation on the main thread, especially
  // when land amount and world size are both high. Keep the simulation budget
  // bounded so high-end settings stay responsive.
  const maxCells = 350_000;
  const currentCells = width * height;
  if (currentCells > maxCells) {
    const downscale = Math.sqrt(maxCells / currentCells);
    width = Math.max(160, Math.round(width * downscale));
    height = Math.max(72, Math.round(width / targetAspect));
  }

  return { width, height };
}

function resolveTargetLandRatio(baseRatio, worldScale) {
  // Världsyta ska ge större eller mindre spelbar yta runt samma landformer.
  // Vi justerar därför landandelen mot totalytan efter worldScale.
  const scaleCompensation = Math.pow(clamp(worldScale, 0.7, 2.2), -0.58);
  return clamp(baseRatio * scaleCompensation, 0.06, 0.44);
}

function createRandomTerrainStyle(
  rng,
  sizeFactor,
  coastFactor,
  horizontalStretch,
  fragmentationFactor,
) {
  const positiveBlobs = [];
  const negativeBlobs = [];
  const frag = clamp(Math.pow(clamp(fragmentationFactor, 0, 1), 0.72) * 1.05 - 0.04, 0, 1);
  const maxFragBoost = smootherstep(0.9, 1, frag);
  const archipelagoCompactness =
    smootherstep(0.72, 1, frag) * smootherstep(0.62, 1, sizeFactor);
  const spreadX = 1 - archipelagoCompactness * 0.26;
  const spreadY = 1 - archipelagoCompactness * 0.34;
  const channelTightness = 1 - archipelagoCompactness * 0.24;
  const landStrength = clamp(0.64 + sizeFactor * 0.9, 0.56, 1.56);
  const waterStrength = clamp(1.34 - sizeFactor * 0.72, 0.56, 1.34);
  const landRadiusBoost = clamp(0.88 + sizeFactor * 0.28, 0.84, 1.22);
  const centerPhase = rng.range(-1.1, 1.1);
  const beltCount = rng.int(5 + Math.round(sizeFactor * 2), 9 + Math.round(sizeFactor * 2));
  const beltGapChance = 0.08 + frag * 0.36;

  for (let i = 0; i < beltCount; i += 1) {
    if (i > 0 && i < beltCount - 1 && rng.chance(beltGapChance)) {
      continue;
    }
    const t = beltCount === 1 ? 0 : i / (beltCount - 1);
    const xRaw = -0.82 + t * 1.64 + rng.range(-0.08, 0.08);
    const yRaw =
      Math.sin((t * Math.PI + centerPhase) * rng.range(0.7, 1.35)) *
        (0.12 + frag * 0.1) +
      rng.range(-0.11, 0.11);
    const majorRadiusMin = clamp(0.15 - frag * 0.06, 0.08, 0.2);
    const majorRadiusMax = clamp(0.3 - frag * 0.08, 0.14, 0.34);
    positiveBlobs.push(
      createBlob(
        clamp(xRaw * spreadX, -0.9, 0.9),
        clamp(yRaw * spreadY, -0.68, 0.68),
        rng.range(majorRadiusMin, majorRadiusMax) * landRadiusBoost,
        rng.range(0.58 - frag * 0.18, 1.16 - frag * 0.08) * landStrength,
        rng.range(1.2, 2.25),
      ),
    );
  }

  const coreMin = frag < 0.45 ? (sizeFactor > 0.56 ? 2 : 1) : 1;
  const coreMax = frag < 0.25 ? 4 : frag < 0.6 ? 3 : 2 + Math.round(sizeFactor * 0.8);
  const coreMasses = rng.int(coreMin, coreMax);
  for (let i = 0; i < coreMasses; i += 1) {
    positiveBlobs.push(
      createBlob(
        rng.range(-0.7, 0.7) * spreadX,
        rng.range(-0.46, 0.46) * spreadY,
        rng.range(0.22 - frag * 0.08, 0.42 - frag * 0.04) * landRadiusBoost,
        rng.range(0.72 - frag * 0.24, 1.38 - frag * 0.2) * landStrength,
        rng.range(1.1, 1.9),
      ),
    );
  }

  const lobeCount = rng.int(3 + Math.round(sizeFactor * 3), 7 + Math.round(sizeFactor * 3));
  for (let i = 0; i < lobeCount; i += 1) {
    positiveBlobs.push(
      createBlob(
        rng.range(-0.88, 0.88) * spreadX,
        rng.range(-0.62, 0.62) * spreadY,
        rng.range(0.1, 0.24) * landRadiusBoost,
        rng.range(0.32, 0.96 - frag * 0.08) * landStrength,
        rng.range(1.25, 2.5),
      ),
    );
  }

  const isletCount = rng.int(
    10 + Math.round(frag * 17 + sizeFactor * 10 + maxFragBoost * 12),
    20 + Math.round(frag * 31 + sizeFactor * 16 + maxFragBoost * 24),
  );
  for (let i = 0; i < isletCount; i += 1) {
    positiveBlobs.push(
      createBlob(
        rng.range(-0.94, 0.94) * spreadX,
        rng.range(-0.7, 0.7) * spreadY,
        rng.range(0.05, 0.16) * landRadiusBoost,
        rng.range(0.16, 0.62) * (landStrength * 0.84),
        rng.range(1.6, 3),
      ),
    );
  }

  const cutCount = rng.int(
    4 + Math.round(frag * 9 + (1 - sizeFactor) * 5 + maxFragBoost * 8),
    8 + Math.round(frag * 15 + (1 - sizeFactor) * 8 + maxFragBoost * 14),
  );
  for (let i = 0; i < cutCount; i += 1) {
    negativeBlobs.push(
      createBlob(
        rng.range(-0.86, 0.86) * spreadX,
        rng.range(-0.6, 0.6) * spreadY,
        rng.range(0.09, 0.3),
        rng.range(0.2 + frag * 0.08, 0.58 + frag * 0.18) * waterStrength,
        rng.range(1.75, 3.4),
      ),
    );
  }

  if (rng.chance(0.5 + frag * 0.4)) {
    const seamCount = rng.int(1, 2 + Math.round(frag * 2));
    for (let seamIndex = 0; seamIndex < seamCount; seamIndex += 1) {
      const seamX = rng.range(-0.62, 0.62);
      const seamSegments = rng.int(2, 4);
      for (let segment = 0; segment < seamSegments; segment += 1) {
        const t = seamSegments === 1 ? 0.5 : segment / (seamSegments - 1);
        negativeBlobs.push(
          createBlob(
            (seamX + rng.range(-0.03, 0.03)) * spreadX,
            (-0.54 + t * 1.08 + rng.range(-0.08, 0.08)) * spreadY,
            rng.range(0.1, 0.22),
            rng.range(0.34 + frag * 0.12, 0.74 + frag * 0.2) * waterStrength,
            rng.range(1.8, 3),
          ),
        );
      }
    }
  }

  const stretchFactor = clamp((horizontalStretch - 1) / 4, 0, 1);
  const channelCuts = [];
  const channelCountMin =
    frag < 0.25 ? 0 : frag < 0.5 ? 1 : frag < 0.75 ? 2 : 3 + Math.round(maxFragBoost * 3);
  const channelCountMax =
    frag < 0.25 ? 1 : frag < 0.5 ? 3 : frag < 0.75 ? 4 : 6 + Math.round(maxFragBoost * 5);
  const channelCount = rng.int(channelCountMin, channelCountMax);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const t = channelCount <= 1 ? rng.range(0.2, 0.8) : channelIndex / (channelCount - 1);
    channelCuts.push({
      x: (-0.58 + t * 1.16 + rng.range(-0.08, 0.08)) * spreadX,
      width: rng.range(0.035, 0.095) * (1 + frag * 0.12) * channelTightness,
      strength:
        rng.range(0.42 + frag * 0.62, 0.98 + frag * 0.8) *
        channelTightness *
        waterStrength,
      wobbleAmp: rng.range(0.005, 0.025 + frag * 0.03),
      wobbleFreq: rng.range(2.8, 6.4),
      phase: rng.range(-1.6, 1.6),
    });
  }

  if (frag > 0.45) {
    channelCuts.push({
      x: rng.range(-0.2, 0.2) * spreadX,
      width: rng.range(0.045, 0.11) * channelTightness,
      strength:
        rng.range(0.95 + frag * 0.35, 1.35 + frag * 0.55) *
        channelTightness *
        waterStrength,
      wobbleAmp: rng.range(0.004, 0.024),
      wobbleFreq: rng.range(3.2, 5.9),
      phase: rng.range(-1.2, 1.2),
    });
  }

  return {
    name: "random",
    targetLandRatio: clamp(
      0.13 +
        sizeFactor * 0.26 -
        frag * (0.13 - archipelagoCompactness * 0.06) +
        archipelagoCompactness * 0.03 +
        rng.range(-0.03, 0.038),
      0.07,
      0.46,
    ),
    seaBias: clamp(
      0.32 +
        (1 - sizeFactor) * 0.11 +
        frag * (0.16 - archipelagoCompactness * 0.08) -
        archipelagoCompactness * 0.03 +
        rng.range(-0.035, 0.055),
      0.24,
      0.76,
    ),
    noiseScale: clamp(
      2.05 + coastFactor * 1.02 + rng.range(-0.25, 0.6),
      1.8,
      4.1,
    ),
    mountainBase: clamp(2.2 + rng.range(0.1, 2), 2, 5.2),
    tinyIslandThreshold: rng.int(
      Math.max(2, 6 - Math.round(frag * 4 + maxFragBoost * 1)),
      Math.max(5, 14 - Math.round(frag * 8 + maxFragBoost * 3)),
    ),
    endCaps: {
      xStart: clamp(0.72 - stretchFactor * 0.26 + (1 - frag) * 0.03, 0.42, 0.78),
      xStrength: clamp(1.0 + stretchFactor * 1.8 + frag * 0.25, 0.9, 3.2),
      yStart: clamp(0.7 + (1 - frag) * 0.05, 0.64, 0.82),
      yStrength: clamp(0.58 + frag * 0.34, 0.5, 1.2),
    },
    channelCuts,
    positiveBlobs,
    negativeBlobs,
  };
}

function createBlob(x, y, radius, strength, tightness = 1.8) {
  return { x, y, radius, strength, tightness };
}

function countWaterNeighbors8(width, height, x, y, isLand) {
  let water = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        water += 1;
        continue;
      }
      if (isLand[indexOf(nx, ny, width)] !== 1) {
        water += 1;
      }
    }
  }
  return water;
}

function normalizedCell(x, y, width, height) {
  return [
    ((x + 0.5) / width) * 2 - 1,
    ((y + 0.5) / height) * 2 - 1,
  ];
}
