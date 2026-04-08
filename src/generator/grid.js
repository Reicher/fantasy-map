import { coordsOf, forEachNeighbor, indexOf } from "../utils.js";

export function floodFillRegions(width, height, shouldInclude, diagonal = true) {
  const visited = new Uint8Array(width * height);
  const regions = [];

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] || !shouldInclude(index)) {
      continue;
    }

    regions.push(collectConnectedCells(width, height, index, shouldInclude, diagonal, visited));
  }

  return regions;
}

export function collectConnectedCells(width, height, start, shouldInclude, diagonal = true, visited = null) {
  const marks = visited ?? new Uint8Array(width * height);
  const queue = [start];
  const cells = [];
  marks[start] = 1;

  while (queue.length > 0) {
    const current = queue.pop();
    cells.push(current);
    const [x, y] = coordsOf(current, width);

    forEachNeighbor(width, height, x, y, diagonal, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (marks[neighbor] || !shouldInclude(neighbor)) {
        return;
      }
      marks[neighbor] = 1;
      queue.push(neighbor);
    });
  }

  return cells;
}

export function floodFillByKey(width, height, shouldInclude, keyOf, diagonal = true) {
  const visited = new Uint8Array(width * height);
  const regions = [];

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] || !shouldInclude(index)) {
      continue;
    }

    const key = keyOf(index);
    const cells = collectConnectedCells(
      width,
      height,
      index,
      (candidate) => shouldInclude(candidate) && keyOf(candidate) === key,
      diagonal,
      visited
    );
    regions.push({ key, cells });
  }

  return regions;
}

export function expandRegionIds(width, height, regionIdByCell, expandableMask, regions, diagonal = true) {
  const queue = [];
  for (const region of regions) {
    for (const cell of region.cells) {
      queue.push(cell);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const regionId = regionIdByCell[current];
    const [x, y] = coordsOf(current, width);

    forEachNeighbor(width, height, x, y, diagonal, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (!expandableMask[neighbor] || regionIdByCell[neighbor] >= 0) {
        return;
      }
      regionIdByCell[neighbor] = regionId;
      regions[regionId].cells.push(neighbor);
      queue.push(neighbor);
    });
  }
}

export function distanceField(width, height, sourceIndices, diagonal = false) {
  const size = width * height;
  const distances = new Int16Array(size);
  distances.fill(-1);

  const queue = [];
  for (const source of sourceIndices) {
    distances[source] = 0;
    queue.push(source);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const [x, y] = coordsOf(current, width);
    const baseDistance = distances[current];

    forEachNeighbor(width, height, x, y, diagonal, (nx, ny) => {
      const neighbor = indexOf(nx, ny, width);
      if (distances[neighbor] !== -1) {
        return;
      }
      distances[neighbor] = baseDistance + 1;
      queue.push(neighbor);
    });
  }

  return distances;
}
