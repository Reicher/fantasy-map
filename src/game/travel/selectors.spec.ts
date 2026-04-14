import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  getDiscoveredNodeIds,
  getVisibleNodeIds,
  isNodeDiscovered,
} from "./selectors";
import type { PlayState } from "../../types/play";

describe("travel selectors", () => {
  it("satisfies discovered/visible node invariants", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(63), { maxLength: 120 }),
        fc.option(fc.nat(63), { nil: null }),
        fc.array(fc.nat(63), { maxLength: 40 }),
        (rawDiscoveredIds, currentNodeId, rawNeighborIds) => {
          const discoveredNodeIds = new Uint8Array(64);
          for (const nodeId of rawDiscoveredIds) {
            discoveredNodeIds[nodeId] = 1;
          }

          const graph = new Map<number, Map<number, { points: [] }>>();
          if (currentNodeId != null) {
            const neighbors = new Map<number, { points: [] }>();
            for (const neighborId of rawNeighborIds) {
              neighbors.set(neighborId, { points: [] });
            }
            graph.set(currentNodeId, neighbors);
          }

          const playState: PlayState = {
            discoveredNodeIds,
            currentNodeId,
            graph,
          };

          const expectedDiscovered = new Set<number>();
          for (let nodeId = 0; nodeId < discoveredNodeIds.length; nodeId += 1) {
            if (discoveredNodeIds[nodeId]) {
              expectedDiscovered.add(nodeId);
            }
          }
          if (currentNodeId != null) {
            expectedDiscovered.add(currentNodeId);
          }

          const expectedVisible = new Set(expectedDiscovered);
          if (currentNodeId != null) {
            for (const neighborId of rawNeighborIds) {
              expectedVisible.add(neighborId);
            }
          }

          const discovered = getDiscoveredNodeIds(playState);
          const visible = getVisibleNodeIds(playState);

          expect(discovered).toEqual([...expectedDiscovered].sort((a, b) => a - b));
          expect(visible).toEqual([...expectedVisible].sort((a, b) => a - b));

          if (currentNodeId != null) {
            expect(isNodeDiscovered(playState, currentNodeId)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
