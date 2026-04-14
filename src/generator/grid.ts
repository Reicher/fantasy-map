import { coordsOf, forEachNeighbor, indexOf } from "../utils";

type IncludeCellFn = (index: number) => boolean;

export function floodFillRegions(
  width: number,
  height: number,
  shouldInclude: IncludeCellFn,
  diagonal = true,
): number[][] {
  const visited = new Uint8Array(width * height);
  const regions: number[][] = [];

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] || !shouldInclude(index)) {
      continue;
    }

    regions.push(collectConnectedCells(width, height, index, shouldInclude, diagonal, visited));
  }

  return regions;
}

export function collectConnectedCells(
  width: number,
  height: number,
  start: number,
  shouldInclude: IncludeCellFn,
  diagonal = true,
  visited: Uint8Array | null = null,
): number[] {
  const marks = visited ?? new Uint8Array(width * height);
  const queue = [start];
  const cells: number[] = [];
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

export function floodFillByKey<T>(
  width: number,
  height: number,
  shouldInclude: IncludeCellFn,
  keyOf: (index: number) => T,
  diagonal = true,
): Array<{ key: T; cells: number[] }> {
  const visited = new Uint8Array(width * height);
  const regions: Array<{ key: T; cells: number[] }> = [];

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

export function expandRegionIds(
  width: number,
  height: number,
  regionIdByCell: ArrayLike<number> & { [index: number]: number },
  expandableMask: ArrayLike<number>,
  regions: Array<{ cells: number[] }>,
  diagonal = true,
): void {
  const queue: number[] = [];
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

export function distanceField(
  width: number,
  height: number,
  sourceIndices: number[],
  diagonal = false,
): Int16Array {
  const size = width * height;
  const distances = new Int16Array(size);
  distances.fill(-1);

  const queue: number[] = [];
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
