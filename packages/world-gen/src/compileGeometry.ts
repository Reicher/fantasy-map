import { createRng } from "@fardvag/shared/random";
import { coordsOf, distance, forEachNeighbor, indexOf } from "@fardvag/shared/utils";

export function compileGeometry(world) {
  return {
    biomes: world.surface.biomes,
    snowRegions: world.surface.snowRegions,
    lakes: world.surface.lakes,
    coastlineLoops: world.surface.coastlineLoops,
    rivers: compileRiverGeometry(world),
    roads: compileRoadGeometry(world),
    labels: compileLabelGeometry(world),
  };
}

function compileRiverGeometry(world) {
  return world.features.rivers
    .map((river) => {
      const points = cellsToWorldPoints(river.cells, world.terrain.width);
      const mouthInfo = findRiverMouth(world, river);
      const delta = buildSimpleRiverDelta(world, river, points, mouthInfo);
      const trimmed =
        mouthInfo != null ? points.slice(0, mouthInfo.landIndex + 1) : points;
      return {
        id: river.id,
        width: river.width,
        cellCount: river.cells.length,
        points: delta?.mainPoints ?? trimmed,
        deltaBranches: delta?.branches ?? [],
      };
    })
    .sort((a, b) => a.cellCount - b.cellCount);
}

function compileRoadGeometry(world) {
  const width = world.terrain.width;
  const uniqueRoadChains = buildUniqueRoadChains(world.features.roads ?? []);

  return uniqueRoadChains.map((chain, index) => ({
    id: index,
    type: chain.type,
    points: resampleWorldPoints(
      simplifyWorldPoints(cellsToWorldPoints(chain.cells, width)),
      3.5,
    ),
  }));
}

function buildUniqueRoadChains(roads) {
  const roadsByType = new Map();
  for (const road of roads) {
    const type = road?.type ?? "road";
    if (!roadsByType.has(type)) {
      roadsByType.set(type, []);
    }
    roadsByType.get(type).push(road);
  }

  const chains = [];
  for (const [type, typeRoads] of roadsByType.entries()) {
    chains.push(...traceUniqueChains(typeRoads, type));
  }
  return chains;
}

function traceUniqueChains(roads, type) {
  const adjacency = new Map<number, Set<number>>();
  const edgeSet = new Set<string>();

  const addNeighbor = (fromCell, toCell) => {
    let neighbors = adjacency.get(fromCell);
    if (!neighbors) {
      neighbors = new Set();
      adjacency.set(fromCell, neighbors);
    }
    neighbors.add(toCell);
  };

  for (const road of roads) {
    const cells = road?.cells ?? [];
    for (let i = 1; i < cells.length; i += 1) {
      const fromCell = cells[i - 1];
      const toCell = cells[i];
      if (fromCell === toCell) {
        continue;
      }
      const edge = edgeKey(fromCell, toCell);
      if (edgeSet.has(edge)) {
        continue;
      }
      edgeSet.add(edge);
      addNeighbor(fromCell, toCell);
      addNeighbor(toCell, fromCell);
    }
  }

  const visitedEdges = new Set<string>();
  const chains = [];

  const walkChain = (startCell, nextCell) => {
    const cells = [startCell, nextCell];
    let previousCell = startCell;
    let currentCell = nextCell;
    visitedEdges.add(edgeKey(startCell, nextCell));

    while (true) {
      const neighbors = [...(adjacency.get(currentCell) ?? [])];
      if (neighbors.length !== 2) {
        break;
      }
      const forwardCell =
        neighbors[0] === previousCell ? neighbors[1] : neighbors[0];
      const edge = edgeKey(currentCell, forwardCell);
      if (visitedEdges.has(edge)) {
        break;
      }
      visitedEdges.add(edge);
      cells.push(forwardCell);
      previousCell = currentCell;
      currentCell = forwardCell;
    }

    return cells;
  };

  // Start with endpoints and branch points.
  for (const [startCell, neighbors] of adjacency.entries()) {
    if (neighbors.size === 2) {
      continue;
    }
    for (const nextCell of neighbors) {
      const edge = edgeKey(startCell, nextCell);
      if (visitedEdges.has(edge)) {
        continue;
      }
      chains.push({ type, cells: walkChain(startCell, nextCell) });
    }
  }

  // Remaining edges belong to pure cycles.
  for (const edge of edgeSet) {
    if (visitedEdges.has(edge)) {
      continue;
    }
    const [a, b] = edge.split("_").map((value) => Number(value));
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      continue;
    }
    chains.push({ type, cells: walkChain(a, b) });
  }

  return chains.filter((chain) => (chain.cells?.length ?? 0) >= 2);
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function resampleWorldPoints(points, maxSegmentLength) {
  if (points.length < 2) {
    return points;
  }
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > maxSegmentLength) {
      const count = Math.ceil(len / maxSegmentLength);
      for (let j = 1; j < count; j += 1) {
        const t = j / count;
        result.push({ x: prev.x + dx * t, y: prev.y + dy * t });
      }
    }
    result.push(curr);
  }
  return result;
}

function compileLabelGeometry(world) {
  const biomeRegions = world.features.biomeRegions.map((region) => ({
    id: region.id,
    biome: region.biome,
    size: region.size,
    name: region.name,
    anchor: pickRegionLabelAnchor(
      region,
      world.features.indices.biomeRegionId,
      world.terrain.width,
      world.terrain.height,
    ),
    candidates: pickRegionLabelCandidates(
      region,
      world.terrain.width,
      world.terrain.height,
    ),
  }));

  const lakes = world.features.lakes.map((lake) => ({
    id: lake.id,
    size: lake.size,
    name: lake.name,
    anchor: pickRegionLabelAnchor(
      lake,
      world.features.indices.lakeIdByCell,
      world.terrain.width,
      world.terrain.height,
    ),
  }));

  const mountainRegions = world.features.mountainRegions.map((region) => ({
    id: region.id,
    size: region.size,
    name: region.name,
    anchor: pickRegionLabelAnchor(
      region,
      world.features.indices.mountainRegionId,
      world.terrain.width,
      world.terrain.height,
    ),
    candidates: pickRegionLabelCandidates(
      region,
      world.terrain.width,
      world.terrain.height,
      4,
    ),
  }));

  const nodes = world.features.nodes.map((node) => ({
    id: node.id,
    kind: node.kind ?? "settlement",
    marker: node.marker ?? "settlement",
    name: node.name,
    x: node.x + 0.5,
    y: node.y + 0.5,
  }));

  return {
    biomeRegions,
    mountainRegions,
    lakes,
    nodes,
  };
}

function cellsToWorldPoints(cells, width) {
  return cells.map((cell) => {
    const [x, y] = coordsOf(cell, width);
    return { x: x + 0.5, y: y + 0.5 };
  });
}

function simplifyWorldPoints(points) {
  if (points.length <= 2) {
    return points;
  }

  const simplified = [points[0]];
  let lastDx = null;
  let lastDy = null;

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const dx = Math.sign(next.x - current.x) || Math.sign(current.x - prev.x);
    const dy = Math.sign(next.y - current.y) || Math.sign(current.y - prev.y);

    if (dx !== lastDx || dy !== lastDy) {
      simplified.push(current);
      lastDx = dx;
      lastDy = dy;
    }
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

function buildSimpleRiverDelta(world, river, points, mouthInfo) {
  if (!mouthInfo || river.cells.length < 14 || river.width < 1.15) {
    return null;
  }

  const splitIndex = Math.max(
    1,
    mouthInfo.landIndex - Math.max(2, Math.round(river.width)),
  );
  if (splitIndex >= mouthInfo.landIndex) {
    return null;
  }

  const splitPoint = points[splitIndex];
  const mouthPoint = points[mouthInfo.landIndex];
  const dirX = mouthPoint.x - splitPoint.x;
  const dirY = mouthPoint.y - splitPoint.y;
  const dirLength = Math.hypot(dirX, dirY);
  if (dirLength < 0.5) {
    return null;
  }

  const forwardX = dirX / dirLength;
  const forwardY = dirY / dirLength;
  const sideX = -forwardY;
  const sideY = forwardX;
  const endpoints = findDeltaEndpoints(
    world,
    mouthInfo,
    mouthPoint,
    forwardX,
    forwardY,
    sideX,
    sideY,
  );
  if (endpoints.length < 2) {
    return null;
  }

  const rng = createRng(`${world.params.seed}::river-delta::${river.id}`);
  const branches = endpoints.map((endpoint) => ({
    points: [
      { x: splitPoint.x, y: splitPoint.y },
      {
        x:
          splitPoint.x +
          (mouthPoint.x - splitPoint.x) * 0.58 +
          endpoint.side * 0.16,
        y:
          splitPoint.y +
          (mouthPoint.y - splitPoint.y) * 0.58 +
          endpoint.sideY * 0.16,
      },
      {
        x:
          mouthPoint.x +
          (endpoint.x - mouthPoint.x) * 0.42 +
          endpoint.side * 0.1,
        y:
          mouthPoint.y +
          (endpoint.y - mouthPoint.y) * 0.42 +
          endpoint.sideY * 0.1,
      },
      {
        x: endpoint.x + rng.range(-0.08, 0.08),
        y: endpoint.y + rng.range(-0.08, 0.08),
      },
    ],
    width: Math.max(0.52, river.width * (endpoint.center ? 0.62 : 0.46)),
  }));

  return {
    mainPoints: points.slice(0, splitIndex + 1),
    branches,
  };
}

function findDeltaEndpoints(
  world,
  mouthInfo,
  mouthPoint,
  forwardX,
  forwardY,
  sideX,
  sideY,
) {
  const { terrain } = world;
  const candidates = [];
  const radius = 4;
  const [originX, originY] = coordsOf(mouthInfo.oceanCell, terrain.width);
  const oceanX = originX + 0.5;
  const oceanY = originY + 0.5;

  candidates.push({
    x: oceanX,
    y: oceanY,
    side: 0,
    sideY: 0,
    center: true,
    score: 0,
  });

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = originX + dx;
      const y = originY + dy;
      if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
        continue;
      }

      const cell = indexOf(x, y, terrain.width);
      if (!terrain.oceanMask[cell] || !oceanTouchesLand(terrain, x, y)) {
        continue;
      }

      const px = x + 0.5;
      const py = y + 0.5;
      const vx = px - mouthPoint.x;
      const vy = py - mouthPoint.y;
      const along = vx * forwardX + vy * forwardY;
      const sideAmount = vx * sideX + vy * sideY;
      if (along < 0.25 || Math.abs(sideAmount) < 0.45) {
        continue;
      }

      candidates.push({
        x: px,
        y: py,
        side: sideX * sideAmount,
        sideY: sideY * sideAmount,
        center: false,
        sideAmount,
        score: along - Math.abs(sideAmount) * 0.1,
      });
    }
  }

  const left = candidates
    .filter((candidate) => candidate.sideAmount < -0.45)
    .sort((a, b) => b.score - a.score)[0];
  const right = candidates
    .filter((candidate) => candidate.sideAmount > 0.45)
    .sort((a, b) => b.score - a.score)[0];
  const center = candidates.find((candidate) => candidate.center);

  return [left, center, right].filter(Boolean);
}

function oceanTouchesLand(terrain, x, y) {
  let touchesLand = false;
  forEachNeighbor(terrain.width, terrain.height, x, y, true, (nx, ny) => {
    if (terrain.isLand[indexOf(nx, ny, terrain.width)]) {
      touchesLand = true;
    }
  });
  return touchesLand;
}

function findRiverMouth(world, river) {
  const { terrain } = world;
  for (let index = river.cells.length - 1; index > 0; index -= 1) {
    const current = river.cells[index];
    const previous = river.cells[index - 1];
    if (terrain.oceanMask[current] && terrain.isLand[previous]) {
      return {
        landIndex: index - 1,
        oceanIndex: index,
        oceanCell: current,
      };
    }
  }

  return null;
}

function pickRegionLabelAnchor(region, regionIdByCell, width, height) {
  const candidates = pickRegionLabelCandidates(
    region,
    width,
    height,
    1,
  );
  if (candidates.length > 0) {
    return candidates[0];
  }

  let best = null;

  for (const cell of region.cells) {
    const [x, y] = coordsOf(cell, width);
    let sameNeighbors = 0;
    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      if (regionIdByCell[indexOf(nx, ny, width)] === region.id) {
        sameNeighbors += 1;
      }
    });

    const centroidDistance = distance(
      x,
      y,
      region.centroid.x,
      region.centroid.y,
    );
    const mapEdgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
    const score =
      sameNeighbors * 8.5 + mapEdgeDistance * 2.2 - centroidDistance * 1.35;
    if (!best || score > best.score) {
      best = { x: x + 0.5, y: y + 0.5, score };
    }
  }

  return best ?? { x: region.centroid.x, y: region.centroid.y };
}

function pickRegionLabelCandidates(
  region,
  width,
  height,
  maxCandidates = 6,
) {
  const cellSet = new Set(region.cells);
  const distances = new Map();
  const queue = [];
  const scored = [];

  for (const cell of region.cells) {
    const [x, y] = coordsOf(cell, width);
    let isBoundary = false;
    let sameNeighbors = 0;

    forEachNeighbor(width, height, x, y, true, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (cellSet.has(neighbor)) {
        sameNeighbors += 1;
      } else {
        isBoundary = true;
      }
    });

    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      isBoundary = true;
    }

    if (isBoundary) {
      distances.set(cell, 0);
      queue.push(cell);
    } else {
      distances.set(cell, -1);
    }

    scored.push({
      cell,
      x,
      y,
      sameNeighbors,
    });
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const [x, y] = coordsOf(current, width);
    const currentDistance = distances.get(current);

    forEachNeighbor(width, height, x, y, false, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (!cellSet.has(neighbor) || distances.get(neighbor) !== -1) {
        return;
      }
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    });
  }

  const ranked = scored
    .map((entry) => {
      const edgeDistance = Math.max(0, distances.get(entry.cell) ?? 0);
      const centroidDistance = distance(
        entry.x,
        entry.y,
        region.centroid.x,
        region.centroid.y,
      );
      const mapEdgeDistance = Math.min(
        entry.x,
        entry.y,
        width - 1 - entry.x,
        height - 1 - entry.y,
      );
      const localCoreRatio = estimateLocalCoreRatio(
        entry.x,
        entry.y,
        cellSet,
        width,
        height,
        2,
      );
      const localCoreScore = localCoreRatio * 12;
      const score =
        edgeDistance * 21 +
        entry.sameNeighbors * 1.8 +
        localCoreScore * 3.6 +
        Math.min(9, mapEdgeDistance) * 1.25 -
        centroidDistance * 0.72;
      return {
        x: entry.x + 0.5,
        y: entry.y + 0.5,
        score,
        edgeDistance,
        centroidDistance,
        mapEdgeDistance,
        localCoreRatio,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-4) {
        return b.score - a.score;
      }
      if (Math.abs(b.edgeDistance - a.edgeDistance) > 1e-4) {
        return b.edgeDistance - a.edgeDistance;
      }
      return a.centroidDistance - b.centroidDistance;
    });

  const candidates = [];
  const minSpacing = Math.max(5, Math.min(14, Math.sqrt(region.size) * 0.36));
  for (const candidate of ranked) {
    if (
      candidates.every(
        (placed) =>
          Math.hypot(placed.x - candidate.x, placed.y - candidate.y) >=
          minSpacing,
      )
    ) {
      candidates.push(candidate);
    }
    if (candidates.length >= maxCandidates) {
      break;
    }
  }

  return candidates;
}

function estimateLocalCoreRatio(x, y, cellSet, width, height, radius) {
  let inside = 0;
  let total = 0;
  const radiusSq = radius * radius;

  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      if (ox * ox + oy * oy > radiusSq) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      total += 1;
      if (cellSet.has(indexOf(nx, ny, width))) {
        inside += 1;
      }
    }
  }

  return total > 0 ? inside / total : 0;
}
