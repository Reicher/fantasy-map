import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createInitialInventory } from "../inventory";
import { advanceHunt, beginHunt, cancelHunt } from "./hunt";

function createTestWorld(seed = "hunt-test-seed") {
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
  };
}

function createBaseHuntState(overrides: Record<string, unknown> = {}): any {
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
          let state: any = createBaseHuntState({
            maxStamina,
            stamina: initialStamina,
          });

          state = beginHunt(state, world, requestedHours);

          if (state.hunt == null) {
            // With this fixture, only zero stamina should block hunt start.
            expect(initialStamina <= 0).toBe(true);
            return;
          }

          expect(state.hunt.hours).toBe(requestedHours);
          expect(state.rest).toBeNull();
          expect(state.pendingRestChoice).toBe(false);

          for (const elapsedHours of advanceSteps) {
            state = advanceHunt(state, world, elapsedHours);
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
      let state: any = beginHunt(createBaseHuntState(), world, 8);
      for (const elapsedHours of stepSchedule) {
        state = advanceHunt(state, world, elapsedHours);
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
});
