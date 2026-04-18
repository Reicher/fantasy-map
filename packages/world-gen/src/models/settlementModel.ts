import { getBiomeSettlementHabitabilityById } from "@fardvag/shared/biomes";
import { clamp, coordsOf, distance } from "@fardvag/shared/utils";

interface SettlementCandidate {
  index: number;
  x: number;
  y: number;
  componentId: number;
  quality: number;
  waterScore: number;
  habitability: number;
  coastal: boolean;
  river: boolean;
  lake: boolean;
}

interface CoverageGrid {
  cols: number;
  rows: number;
  width: number;
  height: number;
  expectedPerBin: number;
}

export function buildSettlementCandidates({
  width,
  size,
  isLand,
  elevation,
  coastMask,
  mountainField,
  biome,
  moisture,
  coastDistance,
  waterDistance,
  riverStrength,
  lakeIdByCell,
  rng,
  waterAffinity = 62,
}) {
  const waterAffinity01 = clamp(Number(waterAffinity) / 100, 0, 1);
  const { componentByCell, componentSizeById } = buildLandComponentByCell({
    width,
    size,
    isLand,
    lakeIdByCell,
  });
  const riverDistance = buildRiverDistanceField({
    width,
    size,
    isLand,
    riverStrength,
  });
  const minIslandCells = resolveMinSettlementIslandCells(size);
  const candidates: SettlementCandidate[] = [];
  let habitableArea = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      continue;
    }

    const componentId = componentByCell[index];
    if (componentId < 0 || componentSizeById[componentId] < minIslandCells) {
      continue;
    }

    const habitability = clamp(
      getBiomeSettlementHabitabilityById(biome[index]) ?? 0.4,
      0,
      1,
    );
    if (habitability < 0.14) {
      continue;
    }

    const coastal = coastMask[index] === 1 || coastDistance[index] <= 1;
    const nearCoast = clamp(1 - coastDistance[index] / 10, 0, 1);
    const nearFreshWater = clamp(1 - waterDistance[index] / 7, 0, 1);
    const riverDistanceCells = riverDistance[index];
    const riverProximity = clamp(1 - riverDistanceCells / 5, 0, 1);
    const riverStrengthHere = clamp((riverStrength[index] - 0.22) / 0.95, 0, 1);
    const riverAffinity = Math.max(riverStrengthHere, riverProximity * 0.9);
    const river = riverDistanceCells <= 2 || riverStrengthHere > 0.34;
    const lake = !coastal && waterDistance[index] <= 2 && !river;

    const waterScore = clamp(
      Math.max(
        coastal ? 1 : 0,
        nearCoast * 0.92,
        nearFreshWater * 0.74,
        riverAffinity * 0.88,
      ),
      0,
      1,
    );

    const flatness = clamp(1 - elevation[index], 0, 1);
    const terrainScore = clamp(
      habitability * 0.6 +
        clamp(moisture[index], 0, 1) * 0.18 +
        flatness * 0.22 -
        clamp(mountainField[index], 0, 1) * 0.28,
      0,
      1,
    );

    if (terrainScore < 0.12) {
      continue;
    }

    const veryDryAndFarFromWater = waterDistance[index] > 10 && waterScore < 0.08;
    if (veryDryAndFarFromWater && terrainScore < 0.52) {
      continue;
    }

    const waterWeight = 0.16 + waterAffinity01 * 0.2;
    const quality = clamp(
      terrainScore * (1 - waterWeight) +
        waterScore * waterWeight +
        rng.range(-0.04, 0.04),
      0,
      1,
    );

    if (quality < 0.18) {
      continue;
    }

    if (quality > 0.25 || terrainScore > 0.24) {
      habitableArea += 1;
    }

    const [x, y] = coordsOf(index, width);
    candidates.push({
      index,
      x,
      y,
      componentId,
      quality,
      waterScore,
      habitability,
      coastal,
      river,
      lake,
    });
  }

  candidates.sort((a, b) => b.quality - a.quality);

  return {
    candidates,
    habitableArea,
  };
}

export function selectSettlements({
  width,
  size,
  candidates,
  desiredCount,
  minSpacing,
  waterAffinity = 62,
  rng,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const targetCount = clamp(
    Math.floor(Number(desiredCount) || 0),
    0,
    candidates.length,
  );
  if (targetCount <= 0) {
    return [];
  }

  const waterAffinity01 = clamp(Number(waterAffinity) / 100, 0, 1);
  const coverageGrid = createCoverageGrid(width, size, targetCount);
  const pool = buildCoverageCandidatePool(candidates, coverageGrid, rng);
  const coverageCounts = new Uint16Array(coverageGrid.cols * coverageGrid.rows);

  const selected = [];
  const usedCandidateIndices = new Set<number>();
  let inlandSelected = 0;
  let spacing = clamp(Number(minSpacing) || 0, 2.2, 16);
  const desiredWaterScore = 0.24 + waterAffinity01 * 0.66;
  const targetInlandRatio = clamp(0.12 + (1 - waterAffinity01) * 0.28, 0.12, 0.4);

  for (let pass = 0; pass < 6 && selected.length < targetCount; pass += 1) {
    while (selected.length < targetCount) {
      let bestCandidate: SettlementCandidate | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const candidate of pool) {
        if (usedCandidateIndices.has(candidate.index)) {
          continue;
        }

        const nearestDistance = nearestSettlementDistance(selected, candidate);
        if (selected.length > 0 && nearestDistance < spacing) {
          continue;
        }

        const binIndex = getCoverageBinIndex(
          coverageGrid,
          candidate.x,
          candidate.y,
        );
        const binLoad = coverageCounts[binIndex];
        const spacingScore =
          selected.length === 0
            ? 1
            : clamp(nearestDistance / Math.max(1, spacing * 2.1), 0, 1);
        const coverageScore = clamp(
          1 - binLoad / Math.max(1, coverageGrid.expectedPerBin * 1.15),
          -0.45,
          1,
        );
        const waterFit = 1 - Math.abs(candidate.waterScore - desiredWaterScore);

        const isInlandCandidate =
          !candidate.coastal && !candidate.river && candidate.waterScore < 0.45;
        const currentInlandRatio = inlandSelected / Math.max(1, selected.length);
        let inlandBonus = 0;
        if (isInlandCandidate && currentInlandRatio < targetInlandRatio) {
          inlandBonus = 0.16;
        } else if (isInlandCandidate) {
          inlandBonus = -0.03;
        }

        const score =
          spacingScore * 0.56 +
          coverageScore * 0.28 +
          candidate.quality * 0.26 +
          waterFit * 0.18 +
          inlandBonus +
          rng.range(-0.012, 0.012);

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        break;
      }

      usedCandidateIndices.add(bestCandidate.index);
      const record = toSettlementRecord(width, selected.length, bestCandidate);
      selected.push(record);

      if (!bestCandidate.coastal && !bestCandidate.river && bestCandidate.waterScore < 0.45) {
        inlandSelected += 1;
      }

      const binIndex = getCoverageBinIndex(
        coverageGrid,
        bestCandidate.x,
        bestCandidate.y,
      );
      coverageCounts[binIndex] += 1;
    }

    if (selected.length >= targetCount) {
      break;
    }

    spacing = Math.max(2, spacing * 0.86);
  }

  if (selected.length < targetCount) {
    const fallback = [...candidates];
    for (const candidate of fallback) {
      if (selected.length >= targetCount) {
        break;
      }
      if (usedCandidateIndices.has(candidate.index)) {
        continue;
      }
      usedCandidateIndices.add(candidate.index);
      selected.push(toSettlementRecord(width, selected.length, candidate));
    }
  }

  return selected;
}

function toSettlementRecord(width, id, candidate: SettlementCandidate) {
  return {
    id,
    type: "settlement",
    cell: candidate.index,
    x: candidate.x,
    y: candidate.y,
    coastal: candidate.coastal,
    componentId: candidate.componentId,
    river: candidate.river,
    lake: Boolean(candidate.lake),
    habitability: Number(candidate.habitability ?? 0),
    score: Number(candidate.quality ?? 0),
  };
}

function nearestSettlementDistance(
  settlements,
  candidate: SettlementCandidate,
): number {
  if (!Array.isArray(settlements) || settlements.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let nearest = Number.POSITIVE_INFINITY;
  for (const settlement of settlements) {
    const d = distance(candidate.x, candidate.y, settlement.x, settlement.y);
    if (d < nearest) {
      nearest = d;
    }
  }
  return nearest;
}

function createCoverageGrid(width, size, desiredCount): CoverageGrid {
  const height = Math.max(1, Math.floor(size / width));
  const cols = clamp(Math.round(Math.sqrt(Math.max(1, desiredCount)) * 2.2), 6, 42);
  const rows = clamp(Math.round(cols * (height / Math.max(1, width))), 4, 34);
  const totalBins = Math.max(1, cols * rows);
  return {
    cols,
    rows,
    width,
    height,
    expectedPerBin: desiredCount / totalBins,
  };
}

function getCoverageBinIndex(
  grid: CoverageGrid,
  x: number,
  y: number,
): number {
  const col = clamp(
    Math.floor((x / Math.max(1, grid.width - 1)) * grid.cols),
    0,
    grid.cols - 1,
  );
  const row = clamp(
    Math.floor((y / Math.max(1, grid.height - 1)) * grid.rows),
    0,
    grid.rows - 1,
  );
  return row * grid.cols + col;
}

function buildCoverageCandidatePool(candidates, grid: CoverageGrid, rng) {
  const bins = new Map<number, SettlementCandidate[]>();

  for (const candidate of candidates) {
    const binIndex = getCoverageBinIndex(grid, candidate.x, candidate.y);
    let entries = bins.get(binIndex);
    if (!entries) {
      entries = [];
      bins.set(binIndex, entries);
    }
    entries.push(candidate);
  }

  const pool: SettlementCandidate[] = [];
  const used = new Set<number>();
  const keepPerBin = 6;

  for (const entries of bins.values()) {
    entries.sort((a, b) => b.quality - a.quality);
    for (let index = 0; index < Math.min(keepPerBin, entries.length); index += 1) {
      const candidate = entries[index];
      if (used.has(candidate.index)) {
        continue;
      }
      used.add(candidate.index);
      pool.push(candidate);
    }

    if (entries.length > keepPerBin) {
      const randomStart = keepPerBin;
      const randomEnd = Math.min(entries.length - 1, keepPerBin + 6);
      const randomIndex = rng.int(randomStart, randomEnd);
      const extra = entries[randomIndex];
      if (extra && !used.has(extra.index)) {
        used.add(extra.index);
        pool.push(extra);
      }
    }
  }

  const topGlobal = Math.min(260, candidates.length);
  for (let index = 0; index < topGlobal; index += 1) {
    const candidate = candidates[index];
    if (!used.has(candidate.index)) {
      used.add(candidate.index);
      pool.push(candidate);
    }
  }

  return pool;
}

function resolveMinSettlementIslandCells(size) {
  return clamp(Math.round(size * 0.00022), 18, 72);
}

function buildRiverDistanceField({ width, size, isLand, riverStrength }) {
  const distanceToRiver = new Uint16Array(size);
  distanceToRiver.fill(65535);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index]) {
      continue;
    }
    if ((riverStrength[index] ?? 0) < 0.36) {
      continue;
    }
    distanceToRiver[index] = 0;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const currentDistance = distanceToRiver[current];
    if (currentDistance >= 11) {
      continue;
    }
    const [x, y] = coordsOf(current, width);
    forEachOrthogonalNeighbor(x, y, width, size, (neighbor) => {
      if (!isLand[neighbor]) {
        return;
      }
      const nextDistance = currentDistance + 1;
      if (nextDistance >= distanceToRiver[neighbor]) {
        return;
      }
      distanceToRiver[neighbor] = nextDistance;
      queue[tail] = neighbor;
      tail += 1;
    });
  }

  return distanceToRiver;
}

function buildLandComponentByCell({ width, size, isLand, lakeIdByCell }) {
  const componentByCell = new Int32Array(size);
  componentByCell.fill(-1);
  const componentSizeById = [];
  const queue = new Int32Array(size);
  let componentId = 0;

  for (let start = 0; start < size; start += 1) {
    if (!isLand[start] || lakeIdByCell[start] >= 0 || componentByCell[start] >= 0) {
      continue;
    }

    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    componentByCell[start] = componentId;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const [x, y] = coordsOf(current, width);

      forEachOrthogonalNeighbor(x, y, width, size, (neighbor) => {
        if (
          !isLand[neighbor] ||
          lakeIdByCell[neighbor] >= 0 ||
          componentByCell[neighbor] >= 0
        ) {
          return;
        }
        componentByCell[neighbor] = componentId;
        queue[tail] = neighbor;
        tail += 1;
      });
    }

    componentSizeById[componentId] = tail;
    componentId += 1;
  }

  return { componentByCell, componentSizeById };
}

function forEachOrthogonalNeighbor(x, y, width, size, callback) {
  const height = Math.max(1, Math.floor(size / width));
  if (y > 0) callback((y - 1) * width + x);
  if (x + 1 < width) callback(y * width + (x + 1));
  if (y + 1 < height) callback((y + 1) * width + x);
  if (x > 0) callback(y * width + (x - 1));
}
