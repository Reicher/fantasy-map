export interface Point2D {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = edge0 === edge1 ? 0 : clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}

export function coordsOf(index: number, width: number): [number, number] {
  return [index % width, Math.floor(index / width)];
}

export function forEachNeighbor(
  width: number,
  height: number,
  x: number,
  y: number,
  diagonal: boolean,
  callback: (nx: number, ny: number, ox: number, oy: number) => void,
): void {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      if (!diagonal && ox !== 0 && oy !== 0) {
        continue;
      }

      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      callback(nx, ny, ox, oy);
    }
  }
}

export function centroidFromCells(
  cells: readonly number[],
  width: number,
): Point2D {
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    sumX += cell % width;
    sumY += Math.floor(cell / width);
  }
  const count = Math.max(1, cells.length);
  return { x: sumX / count, y: sumY / count };
}

export function segmentPointDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

export function quantile(
  values: ArrayLike<number> | Iterable<number>,
  q: number,
): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = clamp(
    Math.floor((sorted.length - 1) * q),
    0,
    sorted.length - 1,
  );
  return sorted[index];
}

export function dedupePoints<T extends Point2D>(points: readonly T[]): T[] {
  const deduped: T[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      Math.abs(previous.x - point.x) < 0.0001 &&
      Math.abs(previous.y - point.y) < 0.0001
    ) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

export function sliderFactor(value: number, curve: number): number {
  return clamp(Math.pow(clamp(value / 100, 0, 1), curve), 0, 1);
}

export function titleCase(text: string): string {
  return text
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
