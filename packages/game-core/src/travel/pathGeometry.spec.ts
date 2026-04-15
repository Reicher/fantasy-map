import { describe, expect, it } from "vitest";
import {
  buildVisibleRoadOverlay,
  measureGraphPathDistance,
  measurePathDistance,
} from "./pathGeometry";
import type { PlayGraph } from "@fardvag/shared/types/play";

describe("pathGeometry", () => {
  it("measures total distance for valid point paths", () => {
    const distance = measurePathDistance([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 8 },
    ]);
    expect(distance).toBeCloseTo(10, 6);
  });

  it("returns null for invalid or empty paths", () => {
    expect(measurePathDistance(null)).toBeNull();
    expect(measurePathDistance([{ x: 0, y: 0 }])).toBeNull();
    expect(measurePathDistance([{ x: 0, y: 0 }, { x: NaN, y: 1 }])).toBeNull();
  });

  it("measures graph distance using node ids", () => {
    const graph = new Map<number, Map<number, { points: Array<{ x: number; y: number }> }>>();
    graph.set(
      1,
      new Map([
        [
          2,
          {
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 5 },
            ],
          },
        ],
      ]),
    );
    const typedGraph = graph as unknown as PlayGraph;
    expect(measureGraphPathDistance(typedGraph, 1, 2)).toBeCloseTo(5, 6);
    expect(measureGraphPathDistance(typedGraph, 2, 1)).toBeNull();
  });

  it("builds visible roads once per edge with center-offset points", () => {
    const graph = new Map<number, Map<number, { routeType: string; points: Array<{ x: number; y: number }> }>>();
    graph.set(
      1,
      new Map([
        [
          2,
          {
            routeType: "road",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        ],
      ]),
    );
    graph.set(
      2,
      new Map([
        [
          1,
          {
            routeType: "road",
            points: [
              { x: 1, y: 0 },
              { x: 0, y: 0 },
            ],
          },
        ],
      ]),
    );

    const roads = buildVisibleRoadOverlay(graph as unknown as PlayGraph, [1, 2]);
    expect(roads).toHaveLength(1);
    expect(roads[0].type).toBe("road");
    expect(roads[0].points).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
    ]);
  });
});
