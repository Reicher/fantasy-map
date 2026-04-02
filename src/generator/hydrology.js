import { fractalNoise2D } from "../noise.js";
import { createRng } from "../random.js";
import { clamp, coordsOf, distance, forEachNeighbor, indexOf } from "../utils.js";
import { collectConnectedCells, distanceField } from "./grid.js";

export function generateHydrology(terrain, params) {
  const { width, height, size, isLand, oceanMask, inlandWaterMask, elevation, mountainField, coastMask } = terrain;
  const lakeAmountFactor = sliderFactor(params.lakeAmount, 0.72);
  const lakeSizeFactor = sliderFactor(params.lakeSize, 0.68);
  const rng = createRng(`${params.seed}::hydrology`);
  const { oceanSources, coastSources } = collectShoreSources(size, oceanMask, coastMask);
  const oceanDistance = distanceField(width, height, oceanSources, false);
  const coastDistance = distanceField(width, height, coastSources, false);
  const baseRainfall = buildBaseRainfall(
    width,
    size,
    params,
    isLand,
    oceanDistance,
    elevation,
    mountainField
  );
  const state = createHydrologyState(size);
  const context = {
    width,
    height,
    size,
    params,
    lakeAmountFactor,
    lakeSizeFactor,
    rng,
    isLand,
    oceanMask,
    inlandWaterMask,
    elevation,
    mountainField,
    oceanDistance,
    coastDistance,
    baseRainfall,
    ...state
  };

  registerNaturalLakes(context);
  collapseDiagonalLakeSingletons(context, 2);
  pruneTinyLakes(context, 5);

  const selectedSources = selectRiverSources({
    width,
    size,
    params,
    lakeAmountFactor,
    rng,
    isLand,
    elevation,
    mountainField,
    baseRainfall,
    oceanDistance,
    coastDistance
  });

  for (const source of selectedSources) {
    const traced = traceRiver(context, source.index, source.score);
    if (traced && traced.cells.length >= 7) {
      const id = context.rivers.length;
      context.rivers.push({
        id,
        source: source.index,
        mouth: traced.cells[traced.cells.length - 1],
        cells: traced.cells,
        width: clamp(source.score * 1.3, 0.8, 2.8),
        sourceScore: source.score,
        joinsRiver: traced.joinsRiver
      });

      traced.cells.forEach((cell, order) => {
        context.riverStrength[cell] += source.score * (0.7 + order / Math.max(1, traced.cells.length) * 0.9);
        if (context.riverCellOwner[cell] < 0) {
          context.riverCellOwner[cell] = id;
        }
      });
    }
  }

  placeBasinLakes(context);
  collapseDiagonalLakeSingletons(context, 2);
  pruneTinyLakes(context, 5);

  return {
    oceanDistance,
    coastDistance,
    waterDistance: buildWaterDistance(width, height, size, oceanSources, context.lakes, context.riverStrength),
    baseRainfall,
    riverStrength: context.riverStrength,
    riverCellOwner: context.riverCellOwner,
    lakeIdByCell: context.lakeIdByCell,
    lakes: context.lakes,
    rivers: context.rivers
  };
}

function createHydrologyState(size) {
  const riverStrength = new Float32Array(size);
  const riverCellOwner = new Int16Array(size);
  riverCellOwner.fill(-1);

  const lakeIdByCell = new Int16Array(size);
  lakeIdByCell.fill(-1);

  return {
    riverStrength,
    riverCellOwner,
    lakeIdByCell,
    lakes: [],
    rivers: []
  };
}

function registerNaturalLakes(context) {
  const { width, height, size, inlandWaterMask, lakeIdByCell, lakes } = context;
  const visited = new Uint8Array(size);

  for (let start = 0; start < size; start += 1) {
    if (!inlandWaterMask[start] || visited[start]) {
      continue;
    }

    const cells = collectConnectedCells(width, height, start, (index) => inlandWaterMask[index] === 1, true, visited);
    if (cells.length < 1) {
      continue;
    }

    const id = lakes.length;
    for (const cell of cells) {
      lakeIdByCell[cell] = id;
    }

    lakes.push({
      id,
      anchor: start,
      outlet: null,
      cells,
      source: "terrain-basin"
    });
  }
}

function pruneTinyLakes(context, minCells = 5) {
  const { isLand, inlandWaterMask, lakeIdByCell } = context;
  const keptLakes = [];
  lakeIdByCell.fill(-1);

  for (const lake of context.lakes) {
    if (lake.cells.length < minCells) {
      if (lake.source === "terrain-basin") {
        for (const cell of lake.cells) {
          isLand[cell] = 1;
          inlandWaterMask[cell] = 0;
        }
      }
      continue;
    }

    const newId = keptLakes.length;
    const nextLake = {
      ...lake,
      id: newId
    };
    keptLakes.push(nextLake);
    for (const cell of nextLake.cells) {
      lakeIdByCell[cell] = newId;
    }
  }

  context.lakes.length = 0;
  context.lakes.push(...keptLakes);
}

function collapseDiagonalLakeSingletons(context, passes = 1) {
  const { width, isLand, inlandWaterMask, lakeIdByCell } = context;
  const orthogonalOffsets = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ];

  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;

    for (const lake of context.lakes) {
      const cellSet = new Set(lake.cells);
      const keptCells = [];
      const removedCells = [];

      for (const cell of lake.cells) {
        const [x, y] = coordsOf(cell, width);
        let sameOrthogonal = 0;

        for (const [dx, dy] of orthogonalOffsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= context.width || ny >= context.height) {
            continue;
          }
          if (cellSet.has(indexOf(nx, ny, width))) {
            sameOrthogonal += 1;
          }
        }

        if (sameOrthogonal === 0) {
          removedCells.push(cell);
        } else {
          keptCells.push(cell);
        }
      }

      if (removedCells.length === 0) {
        continue;
      }

      changed = true;
      lake.cells = keptCells;

      for (const cell of removedCells) {
        lakeIdByCell[cell] = -1;
        if (lake.source === "terrain-basin") {
          isLand[cell] = 1;
          inlandWaterMask[cell] = 0;
        }
      }
    }

    if (!changed) {
      break;
    }
  }
}

function traceRiver(context, sourceIndex, sourceScore) {
  let current = sourceIndex;
  let previous = -1;
  const visited = new Set();
  const cells = [];
  let joinsRiver = false;

  for (let step = 0; step < 340; step += 1) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    cells.push(current);

    if (!context.isLand[current]) {
      break;
    }

    if (context.lakeIdByCell[current] >= 0 && step > 0) {
      break;
    }

    const next = chooseNextFlowCell(context, current, previous);
    if (next !== null) {
      if (!context.isLand[next] || context.lakeIdByCell[next] >= 0) {
        cells.push(next);
        break;
      }
      if (context.riverCellOwner[next] >= 0 && cells.length > 4) {
        cells.push(next);
        joinsRiver = true;
        break;
      }
      previous = current;
      current = next;
      continue;
    }

    const lake = createLake(context, current, sourceScore);
    if (!lake) {
      break;
    }

    if (!cells.includes(lake.anchor)) {
      cells.push(lake.anchor);
    }

    if (lake.outlet === null) {
      break;
    }

    previous = current;
    current = lake.outlet;
  }

  return { cells, joinsRiver };
}

function chooseNextFlowCell(context, current, previous) {
  const { width, height, oceanMask, lakeIdByCell, elevation, mountainField, riverCellOwner } = context;
  const [x, y] = coordsOf(current, width);
  const currentHeight = elevation[current];
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  forEachNeighbor(width, height, x, y, true, (nx, ny, ox, oy) => {
    const neighbor = indexOf(nx, ny, width);
    if (oceanMask[neighbor]) {
      best = neighbor;
      bestScore = -1;
      return;
    }
    if (lakeIdByCell[neighbor] >= 0) {
      best = neighbor;
      bestScore = -0.5;
      return;
    }

    const previousBias = previous >= 0 ? directionPenalty(previous, current, neighbor, width) : 0;
    const riverBias = riverCellOwner[neighbor] >= 0 ? -0.06 : 0;
    const score =
      elevation[neighbor] +
      mountainField[neighbor] * 0.02 +
      previousBias +
      riverBias +
      (Math.abs(ox) + Math.abs(oy) === 2 ? 0.004 : 0);

    if (score < bestScore && score <= currentHeight + 0.02) {
      bestScore = score;
      best = neighbor;
    }
  });

  return best;
}

function createLake(context, anchor, sourceScore) {
  const {
    width,
    height,
    params,
    lakeAmountFactor,
    lakeSizeFactor,
    isLand,
    coastDistance,
    elevation,
    lakeIdByCell,
    lakes
  } = context;

  if (lakeIdByCell[anchor] >= 0 || coastDistance[anchor] < 3) {
    return null;
  }

  const threshold =
    elevation[anchor] +
    0.016 +
    lakeSizeFactor * 0.18 +
    lakeAmountFactor * 0.05 +
    sourceScore * 0.04;
  const areaLimit = Math.round(3 + lakeSizeFactor * 110 + lakeAmountFactor * 24 + sourceScore * 14);
  const stack = [anchor];
  const seen = new Set();
  const cells = [];
  const boundary = new Set();

  while (stack.length > 0 && cells.length <= areaLimit) {
    const current = stack.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (!isLand[current] || lakeIdByCell[current] >= 0) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    const noise =
      fractalNoise2D(x * 0.08 + 3.1, y * 0.08 - 6.4, `${params.seed}::lake-shape`, {
        octaves: 3,
        gain: 0.6
      }) - 0.5;
    const localThreshold = threshold + noise * 0.028;
    if (elevation[current] > localThreshold) {
      continue;
    }

    cells.push(current);
    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (seen.has(neighbor)) {
        return;
      }
      if (!isLand[neighbor]) {
        boundary.add(neighbor);
        return;
      }
      if (elevation[neighbor] <= localThreshold + 0.04) {
        stack.push(neighbor);
      } else {
        boundary.add(neighbor);
      }
    });
  }

  if (cells.length < 3 || cells.length > areaLimit) {
    return null;
  }

  let outlet = null;
  let outletHeight = Number.POSITIVE_INFINITY;
  for (const cell of boundary) {
    if (!isLand[cell]) {
      outlet = cell;
      outletHeight = -1;
      break;
    }
    if (elevation[cell] < outletHeight) {
      outlet = cell;
      outletHeight = elevation[cell];
    }
  }

  const id = lakes.length;
  for (const cell of cells) {
    lakeIdByCell[cell] = id;
  }

  lakes.push({
    id,
    anchor,
    outlet,
    cells,
    source: "river-basin"
  });

  return lakes[id];
}

function placeBasinLakes(context) {
  const {
    width,
    height,
    size,
    lakeAmountFactor,
    rng,
    isLand,
    coastDistance,
    oceanDistance,
    elevation,
    baseRainfall,
    riverStrength,
    lakeIdByCell
  } = context;

  const candidates = [];
  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0 || coastDistance[index] < 5) {
      continue;
    }

    const [x, y] = coordsOf(index, width);
    let lowerNeighbors = 0;
    let slopeBudget = 0;
    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (!isLand[neighbor]) {
        return;
      }
      const delta = elevation[index] - elevation[neighbor];
      if (delta > 0.014) {
        lowerNeighbors += 1;
      }
      slopeBudget += Math.abs(delta);
    });

    const score =
      baseRainfall[index] * 0.54 +
      clamp(oceanDistance[index] / 20, 0, 1) * 0.24 +
      clamp(1 - slopeBudget / 0.4, 0, 1) * 0.26 +
      clamp(riverStrength[index] / 2.5, 0, 1) * 0.18 -
      lowerNeighbors * 0.11 +
      rng.range(-0.05, 0.05);

    if (lowerNeighbors <= 2 && elevation[index] > 0.12 && elevation[index] < 0.62 && score > 0.42) {
      candidates.push({ index, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const wanted = clamp(Math.round(lakeAmountFactor * 16), 0, 16);
  const chosen = [];

  for (const candidate of candidates) {
    if (chosen.length >= wanted) {
      break;
    }

    const [cx, cy] = coordsOf(candidate.index, width);
    if (
      chosen.some((other) => {
        const [ox, oy] = coordsOf(other.index, width);
        return distance(cx, cy, ox, oy) < 14;
      })
    ) {
      continue;
    }

    const lake = createLake(context, candidate.index, candidate.score + 0.25);
    if (lake) {
      chosen.push(candidate);
    }
  }
}

function sliderFactor(value, curve) {
  return clamp(Math.pow(clamp(value / 100, 0, 1), curve), 0, 1);
}

function collectShoreSources(size, oceanMask, coastMask) {
  const oceanSources = [];
  const coastSources = [];

  for (let index = 0; index < size; index += 1) {
    if (oceanMask[index]) {
      oceanSources.push(index);
    } else if (coastMask[index]) {
      coastSources.push(index);
    }
  }

  return { oceanSources, coastSources };
}

function buildBaseRainfall(width, size, params, isLand, oceanDistance, elevation, mountainField) {
  const baseRainfall = new Float32Array(size);
  const rainfallReach = 18 + params.mapSize * 0.12;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }

    const [x, y] = coordsOf(index, width);
    const climateNoise =
      fractalNoise2D(x * 0.05 + 7.2, y * 0.05 - 2.3, `${params.seed}::rainfall`, {
        octaves: 4,
        gain: 0.55
      }) - 0.5;
    const marine = clamp(1 - oceanDistance[index] / rainfallReach, 0, 1);
    const orographic = clamp(mountainField[index] * 0.6 + elevation[index] * 0.25, 0, 1);
    baseRainfall[index] = clamp(marine * 0.72 + orographic * 0.28 + climateNoise * 0.24, 0, 1);
  }

  return baseRainfall;
}

function selectRiverSources({
  width,
  size,
  params,
  rng,
  isLand,
  elevation,
  mountainField,
  baseRainfall,
  oceanDistance,
  coastDistance
}) {
  const candidateSources = [];

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }

    const inlandBias = clamp(coastDistance[index] / 14, 0, 1);
    const deepInlandBias = clamp(oceanDistance[index] / 20, 0, 1);
    const score =
      elevation[index] * 0.32 +
      mountainField[index] * 0.34 +
      baseRainfall[index] * 0.42 +
      inlandBias * 0.24 +
      deepInlandBias * 0.14 +
      rng.range(-0.08, 0.08);

    if (elevation[index] > 0.34 && coastDistance[index] > 3 && score > 0.42) {
      candidateSources.push({ index, score });
    }
  }

  candidateSources.sort((a, b) => b.score - a.score);
  const selectedSources = [];
  const riverAmountFactor = sliderFactor(params.riverAmount ?? 56, 0.78);
  const targetSources = clamp(
    Math.round((candidateSources.length / 1500) * (1.4 + riverAmountFactor * 15.5)),
    1,
    40
  );
  const minSourceSpacing = Math.max(4, Math.round(12 - riverAmountFactor * 7));

  for (const candidate of candidateSources) {
    if (selectedSources.length >= targetSources) {
      break;
    }

    const [cx, cy] = coordsOf(candidate.index, width);
    let tooClose = false;
    for (const other of selectedSources) {
      const [ox, oy] = coordsOf(other.index, width);
      if (distance(cx, cy, ox, oy) < minSourceSpacing) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      selectedSources.push(candidate);
    }
  }

  return selectedSources;
}

function buildWaterDistance(width, height, size, oceanSources, lakes, riverStrength) {
  const waterSources = [...oceanSources];

  for (const lake of lakes) {
    waterSources.push(...lake.cells);
  }
  for (let index = 0; index < size; index += 1) {
    if (riverStrength[index] > 1.1) {
      waterSources.push(index);
    }
  }

  return distanceField(width, height, waterSources, false);
}

function directionPenalty(previous, current, next, width) {
  const [px, py] = [previous % width, Math.floor(previous / width)];
  const [cx, cy] = [current % width, Math.floor(current / width)];
  const [nx, ny] = [next % width, Math.floor(next / width)];
  const prevX = cx - px;
  const prevY = cy - py;
  const nextX = nx - cx;
  const nextY = ny - cy;
  const dot = prevX * nextX + prevY * nextY;
  return dot >= 0 ? -0.01 : 0.02;
}
