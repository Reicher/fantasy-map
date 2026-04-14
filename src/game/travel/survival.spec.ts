import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createInitialInventory } from "../inventory";
import {
  applyHourlyHunger,
  applyHourlyTravelStamina,
  finalizeHourlySurvival,
} from "./survival";

function createBaseSurvivalState(
  overrides: Record<string, unknown> = {},
): any {
  return {
    gameOver: null,
    maxHealth: 5,
    health: 5,
    maxStamina: 18,
    stamina: 18,
    staminaElapsedHours: 0,
    hungerElapsedHours: 0,
    runStats: {
      meatEaten: 0,
      travelHours: 0,
      huntHours: 0,
      restHours: 0,
      distanceTraveled: 0,
    },
    inventory: createInitialInventory(),
    travel: { routeType: "road" },
    rest: null,
    hunt: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    pendingJourneyEvent: null,
    hoveredNodeId: 0,
    pressedNodeId: 0,
    ...overrides,
  };
}

describe("travel survival invariants", () => {
  it("maintains safety invariants across random hourly updates", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 40 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 30 }),
        (hourSteps, initialHealth, initialStamina) => {
          let state = createBaseSurvivalState({
            health: initialHealth,
            maxHealth: Math.max(1, initialHealth),
            stamina: initialStamina,
            maxStamina: Math.max(1, initialStamina),
          });

          for (const elapsedHours of hourSteps) {
            state = applyHourlyHunger(state, elapsedHours);
            state = applyHourlyTravelStamina(state, elapsedHours);
            state = finalizeHourlySurvival(state);

            expect(state.health).toBeGreaterThanOrEqual(0);
            expect(state.health).toBeLessThanOrEqual(state.maxHealth);
            expect(state.stamina).toBeGreaterThanOrEqual(0);
            expect(state.stamina).toBeLessThanOrEqual(state.maxStamina);

            if (state.isTravelPaused && state.travelPauseReason === "exhausted") {
              expect(state.pendingRestChoice).toBe(true);
              expect(state.stamina).toBe(0);
            }

            if (state.gameOver) {
              expect(state.health).toBe(0);
              expect(state.travel).toBeNull();
              expect(state.rest).toBeNull();
              expect(state.hunt).toBeNull();
              break;
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does not consume stamina when travel is paused", () => {
    const initial = createBaseSurvivalState({
      isTravelPaused: true,
      stamina: 9,
      maxStamina: 9,
    });
    const next = applyHourlyTravelStamina(initial, 5);
    expect(next).toBe(initial);
  });
});
