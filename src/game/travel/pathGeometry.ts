import type { PlayGraph, PlayPathData } from "../../types/play";

type PathPointLike = { x?: number; y?: number } | null | undefined;
type PathLike = PlayPathData | null | undefined;
type TravelGraphLike = PlayGraph | null | undefined;

export interface VisibleRoad {
  id: number;
  type: string;
  points: Array<{ x: number; y: number }>;
}

export function measurePathDistance(
  points: PathPointLike[] | null | undefined,
): number | null {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }

  let totalDistance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (
      !Number.isFinite(from?.x) ||
      !Number.isFinite(from?.y) ||
      !Number.isFinite(to?.x) ||
      !Number.isFinite(to?.y)
    ) {
      continue;
    }
    totalDistance += Math.hypot(to.x - from.x, to.y - from.y);
  }

  return Number.isFinite(totalDistance) && totalDistance > 0
    ? totalDistance
    : null;
}

export function measureGraphPathDistance(
  graph: TravelGraphLike,
  fromNodeId: number | null | undefined,
  toNodeId: number | null | undefined,
): number | null {
  if (!graph || fromNodeId == null || toNodeId == null) {
    return null;
  }
  const path = graph.get(fromNodeId)?.get(toNodeId) ?? null;
  return measurePathDistance(Array.isArray(path?.points) ? path.points : []);
}

export function buildVisibleRoadOverlay(
  graph: TravelGraphLike,
  visibleNodeIds: number[],
): VisibleRoad[] {
  if (!graph || !Array.isArray(visibleNodeIds) || visibleNodeIds.length <= 0) {
    return [];
  }

  const visible = new Set(visibleNodeIds);
  const seenEdges = new Set<string>();
  const roads: VisibleRoad[] = [];

  for (const fromNodeId of visible) {
    const neighbors = graph.get(fromNodeId);
    if (!neighbors) {
      continue;
    }

    for (const [toNodeId, path] of neighbors.entries()) {
      if (!visible.has(toNodeId)) {
        continue;
      }

      const key =
        fromNodeId < toNodeId
          ? `${fromNodeId}_${toNodeId}`
          : `${toNodeId}_${fromNodeId}`;
      if (seenEdges.has(key)) {
        continue;
      }
      seenEdges.add(key);

      const points = (path?.points ?? [])
        .filter(
          (point) =>
            point &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y),
        )
        .map((point) => ({
          x: point.x + 0.5,
          y: point.y + 0.5,
        }));

      if (points.length < 2) {
        continue;
      }

      roads.push({
        id: roads.length,
        type:
          typeof (path as { routeType?: unknown } | null)?.routeType === "string"
            ? (path as { routeType: string }).routeType
            : "road",
        points,
      });
    }
  }

  return roads;
}
