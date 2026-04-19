import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createInitialInventory } from "../inventory";
import { advanceHunt, beginHunt, cancelHunt } from "./hunt";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

function createTestWorld(seed = "hunt-test-seed"): World {
  const width = 16;
  const height = 16;
  const size = width * height;
  const biome = new Array(size).fill("forest");

  return {
    params: { seed },
    terrain: {
      width,
      height,
      elevation: new Float32Array(size),
      mountainField: new Float32Array(size),
    },
    climate: {
      biome,
      temperature: new Float32Array(size),
    },
    features: {
      nodes: [
        {
          id: 0,
          x: 4,
          y: 4,
          cell: 4 * width + 4,
          marker: "settlement",
          name: "Basläger",
        },
      ],
    },
  } as unknown as World;
}

function createBaseHuntState(overrides: Record<string, unknown> = {}): PlayState {
  return {
    gameOver: null,
    travel: null,
    isTravelPaused: false,
    travelPauseReason: null,
    rest: null,
    hunt: null,
    pendingJourneyEvent: null,
    pendingRestChoice: false,
    latestHuntFeedback: null,
    hoveredNodeId: 0,
    pressedNodeId: 0,
    currentNodeId: 0,
    lastRegionId: 0,
    position: { x: 4, y: 4 },
    journeyElapsedHours: 0,
    timeOfDayHours: 12,
    vapenTraffsakerhet: 65,
    maxStamina: 18,
    stamina: 18,
    nextHuntRunId: 1,
    huntAreaStates: {},
    inventory: createInitialInventory(),
    ...overrides,
  };
}

function countMeat(inventory: PlayState["inventory"]): number {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  return items.reduce((sum, item) => {
    if (item?.type !== "meat") {
      return sum;
    }
    const count = Number.isFinite(item?.count) ? Number(item.count) : 0;
    return sum + Math.max(0, Math.floor(count));
  }, 0);
}

describe("travel hunt invariants", () => {
  it("preserves key invariants across random hunt advancement schedules", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1, 3, 8),
        fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 20 }),
        fc.integer({ min: 1, max: 25 }),
        (requestedHours, advanceSteps, initialStamina) => {
          const world = createTestWorld("hunt-property-seed");
          const maxStamina = Math.max(1, initialStamina);
          let state = createBaseHuntState({
            maxStamina,
            stamina: initialStamina,
          });

          state = beginHunt(state, world, requestedHours) ?? state;

          if (state.hunt == null) {
            // With this fixture, only zero stamina should block hunt start.
            expect(initialStamina <= 0).toBe(true);
            return;
          }

          expect(state.hunt.hours).toBe(requestedHours);
          expect(state.rest).toBeNull();
          expect(state.pendingRestChoice).toBe(false);

          for (const elapsedHours of advanceSteps) {
            state = advanceHunt(state, world, elapsedHours) ?? state;
            expect(state.stamina).toBeGreaterThanOrEqual(0);
            expect(state.stamina).toBeLessThanOrEqual(state.maxStamina);

            if (state.hunt == null) {
              break;
            }
            expect(state.rest).toBeNull();
            expect(state.hunt.hours).toBe(requestedHours);
            expect(state.hunt.completedHours).toBeLessThanOrEqual(requestedHours);
          }

          if (state.hunt != null) {
            const cancelled = cancelHunt(state, world);
            expect(cancelled.hunt).toBeNull();
            expect(cancelled.stamina).toBeGreaterThanOrEqual(0);
            expect(cancelled.stamina).toBeLessThanOrEqual(cancelled.maxStamina);
          }
        },
      ),
      { numRuns: 160 },
    );
  });

  it("is deterministic for identical seed and step schedule", () => {
    const world = createTestWorld("deterministic-seed");
    const stepSchedule = [1, 1, 2, 1, 3];

    const run = () => {
      let state = beginHunt(createBaseHuntState(), world, 8) ?? createBaseHuntState();
      for (const elapsedHours of stepSchedule) {
        state = advanceHunt(state, world, elapsedHours) ?? state;
      }
      return {
        stamina: state.stamina,
        pendingRestChoice: state.pendingRestChoice,
        latestHuntFeedback: state.latestHuntFeedback,
        hunt: state.hunt
          ? {
              completedHours: state.hunt.completedHours,
              successfulHours: state.hunt.successfulHours,
              totalMeatGained: state.hunt.totalMeatGained,
            }
          : null,
      };
    };

    expect(run()).toEqual(run());
  });

  it("does not persist per-area depletion state after hunting", () => {
    const world = createTestWorld("no-area-depletion-seed");
    let state = createBaseHuntState({
      maxStamina: 120,
      stamina: 120,
      huntAreaStates: {},
    });

    for (let i = 0; i < 4; i += 1) {
      state = beginHunt(state, world, 3) ?? state;
      state = advanceHunt(state, world, 3) ?? state;
      expect(state.hunt).toBeNull();
    }

    expect(state.huntAreaStates ?? {}).toEqual({});
  });

  it("averages above one meat per hour in standard hunt conditions", () => {
    const world = createTestWorld("hunt-yield-target-seed");
    let state = createBaseHuntState({
      maxStamina: 2000,
      stamina: 2000,
      inventory: {
        columns: 128,
        rows: 128,
        items: [],
      },
    });
    let totalHours = 0;
    let totalMeat = 0;

    for (let i = 0; i < 10; i += 1) {
      const before = countMeat(state.inventory);
      state = beginHunt(state, world, 8) ?? state;
      state = advanceHunt(state, world, 8) ?? state;
      const after = countMeat(state.inventory);
      totalHours += 8;
      totalMeat += Math.max(0, after - before);
    }

    expect(totalMeat / totalHours).toBeGreaterThan(1);
  });
});
