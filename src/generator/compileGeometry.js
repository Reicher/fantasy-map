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
    .map((river) => ({
      id: river.id,
      width: river.width,
      cellCount: river.cells.length,
      points: cellsToWorldPoints(river.cells, world.terrain.width)
    }))
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

  const cities = world.features.cities.map((city) => ({
    id: city.id,
    name: city.name,
    x: city.x + 0.5,
    y: city.y + 0.5
  }));

  return {
    biomeRegions,
    lakes,
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
