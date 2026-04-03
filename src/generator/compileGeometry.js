import { createRng } from "../random.js";
import { coordsOf, distance, forEachNeighbor, indexOf } from "../utils.js";

export function compileGeometry(world) {
  return {
    biomes: world.surface.biomes,
    snowRegions: world.surface.snowRegions,
    lakes: world.surface.lakes,
    coastlineLoops: world.surface.coastlineLoops,
    rivers: compileRiverGeometry(world),
    roads: compileRoadGeometry(world),
    labels: compileLabelGeometry(world)
  };
}

function compileRiverGeometry(world) {
  return world.features.rivers
    .map((river) => {
      const points = cellsToWorldPoints(river.cells, world.terrain.width);
      const mouthInfo = findRiverMouth(world, river);
      const delta = buildSimpleRiverDelta(world, river, points, mouthInfo);
      return {
        id: river.id,
        width: river.width,
        cellCount: river.cells.length,
        points: delta?.mainPoints ?? trimRiverToCoast(points, mouthInfo),
        deltaBranches: delta?.branches ?? []
      };
    })
    .sort((a, b) => a.cellCount - b.cellCount);
}

function compileRoadGeometry(world) {
  return world.features.roads.map((road) => ({
    id: road.id,
    type: road.type,
    points: simplifyWorldPoints(cellsToWorldPoints(road.cells, world.terrain.width))
  }));
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
      world.terrain.height
    ),
    candidates: pickRegionLabelCandidates(
      region,
      world.features.indices.biomeRegionId,
      world.terrain.width,
      world.terrain.height
    )
  }));

  const lakes = world.features.lakes.map((lake) => ({
    id: lake.id,
    size: lake.size,
    name: lake.name,
    anchor: pickRegionLabelAnchor(
      lake,
      world.features.indices.lakeIdByCell,
      world.terrain.width,
      world.terrain.height
    )
  }));

  const mountainRegions = world.features.mountainRegions.map((region) => ({
    id: region.id,
    size: region.size,
    name: region.name,
    anchor: pickRegionLabelAnchor(
      region,
      world.features.indices.mountainRegionId,
      world.terrain.width,
      world.terrain.height
    ),
    candidates: pickRegionLabelCandidates(
      region,
      world.features.indices.mountainRegionId,
      world.terrain.width,
      world.terrain.height,
      4
    )
  }));

  const pointsOfInterest = world.features.pointsOfInterest.map((poi) => ({
    id: poi.id,
    kind: poi.kind ?? "city",
    marker: poi.marker ?? "dot",
    name: poi.name,
    x: poi.x + 0.5,
    y: poi.y + 0.5
  }));

  const cities = pointsOfInterest.filter((poi) => poi.kind === "city");

  return {
    biomeRegions,
    mountainRegions,
    lakes,
    pointsOfInterest,
    cities
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

  const splitIndex = Math.max(1, mouthInfo.landIndex - Math.max(2, Math.round(river.width)));
  if (splitIndex >= mouthInfo.landIndex) {
    return null;
  }

  const splitPoint = points[splitIndex];
  const mouthPoint = points[mouthInfo.landIndex];
  const seaPoint = points[mouthInfo.oceanIndex];
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
  const endpoints = findDeltaEndpoints(world, mouthInfo, mouthPoint, seaPoint, forwardX, forwardY, sideX, sideY);
  if (endpoints.length < 2) {
    return null;
  }

  const rng = createRng(`${world.params.seed}::river-delta::${river.id}`);
  const branches = endpoints.map((endpoint) => ({
    points: [
      { x: splitPoint.x, y: splitPoint.y },
      {
        x: splitPoint.x + (mouthPoint.x - splitPoint.x) * 0.58 + endpoint.side * 0.16,
        y: splitPoint.y + (mouthPoint.y - splitPoint.y) * 0.58 + endpoint.sideY * 0.16
      },
      {
        x: mouthPoint.x + (endpoint.x - mouthPoint.x) * 0.42 + endpoint.side * 0.1,
        y: mouthPoint.y + (endpoint.y - mouthPoint.y) * 0.42 + endpoint.sideY * 0.1
      },
      {
        x: endpoint.x + rng.range(-0.08, 0.08),
        y: endpoint.y + rng.range(-0.08, 0.08)
      }
    ],
    width: Math.max(0.52, river.width * (endpoint.center ? 0.62 : 0.46))
  }));

  return {
    mainPoints: points.slice(0, splitIndex + 1),
    branches
  };
}

function findDeltaEndpoints(world, mouthInfo, mouthPoint, seaPoint, forwardX, forwardY, sideX, sideY) {
  const { terrain } = world;
  const candidates = [];
  const radius = 4;
  const [originX, originY] = coordsOf(terrain.width * 0 + mouthInfo.oceanCell, terrain.width);
  const oceanX = originX + 0.5;
  const oceanY = originY + 0.5;

  candidates.push({
    x: oceanX,
    y: oceanY,
    side: 0,
    sideY: 0,
    center: true,
    score: 0
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
        score: along - Math.abs(sideAmount) * 0.1
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

function trimRiverToCoast(points, mouthInfo) {
  if (!mouthInfo) {
    return points;
  }

  return points.slice(0, mouthInfo.landIndex + 1);
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
        oceanCell: current
      };
    }
  }

  return null;
}

function pickRegionLabelAnchor(region, regionIdByCell, width, height) {
  const candidates = pickRegionLabelCandidates(region, regionIdByCell, width, height, 1);
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

    const centroidDistance = distance(x, y, region.centroid.x, region.centroid.y);
    const score = sameNeighbors * 10 - centroidDistance * 1.8;
    if (!best || score > best.score) {
      best = { x: x + 0.5, y: y + 0.5, score };
    }
  }

  return best ?? { x: region.centroid.x, y: region.centroid.y };
}

function pickRegionLabelCandidates(region, regionIdByCell, width, height, maxCandidates = 6) {
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
      sameNeighbors
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
      const centroidDistance = distance(entry.x, entry.y, region.centroid.x, region.centroid.y);
      const score = edgeDistance * 24 + entry.sameNeighbors * 2 - centroidDistance * 0.75;
      return {
        x: entry.x + 0.5,
        y: entry.y + 0.5,
        score,
        edgeDistance
      };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = [];
  const minSpacing = Math.max(4, Math.min(12, Math.sqrt(region.size) * 0.3));
  for (const candidate of ranked) {
    if (
      candidates.every(
        (placed) => Math.hypot(placed.x - candidate.x, placed.y - candidate.y) >= minSpacing
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
