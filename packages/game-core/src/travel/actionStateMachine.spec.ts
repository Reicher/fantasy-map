import { describe, expect, it } from "vitest";
import {
  getTravelActionState,
  reduceTravelActionState,
} from "./actionStateMachine";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

function createTestWorld(seed = "travel-action-state-machine") {
  const width = 16;
  const height = 16;
  const size = width * height;
  return {
    params: { seed },
    terrain: {
      width,
      height,
      elevation: new Float32Array(size),
      mountainField: new Float32Array(size),
    },
    climate: {
      biome: new Array(size).fill("forest"),
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

function createBasePlayState(overrides: Record<string, unknown> = {}): PlayState {
  return {
    gameOver: null,
    travel: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    pendingJourneyEvent: null,
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
    inventory: {
      columns: 4,
      rows: 4,
      items: [],
    },
    ...overrides,
  };
}

describe("travel action state machine", () => {
  it("classifies explicit action states", () => {
    expect(getTravelActionState(createBasePlayState())).toBe("idle");
    expect(
      getTravelActionState(
        createBasePlayState({
          travel: { routeType: "road" },
        }),
      ),
    ).toBe("travel-active");
    expect(
      getTravelActionState(
        createBasePlayState({
          travel: { routeType: "road" },
          isTravelPaused: true,
        }),
      ),
    ).toBe("travel-paused");
    expect(
      getTravelActionState(
        createBasePlayState({
          rest: { hours: 3, elapsedHours: 0 },
        }),
      ),
    ).toBe("resting");
    expect(
      getTravelActionState(
        createBasePlayState({
          hunt: { hours: 3, elapsedHours: 0 },
        }),
      ),
    ).toBe("hunting");
  });

  it("blocks invalid event transitions", () => {
    const activeTravel = createBasePlayState({
      travel: { routeType: "road", progress: 1, totalLength: 4 },
      isTravelPaused: false,
    });
    const next = reduceTravelActionState(
      activeTravel,
      { type: "START_HUNT", hours: 3 },
      { world: createTestWorld() },
    );
    expect(next).toBe(activeTravel);
  });

  it("supports explicit pause -> rest transition", () => {
    const pausedTravel = createBasePlayState({
      travel: { routeType: "road", progress: 1, totalLength: 4 },
      isTravelPaused: true,
      travelPauseReason: "manual",
    });
    const next = reduceTravelActionState(pausedTravel, {
      type: "START_REST",
      hours: 3,
    });
    expect(next).not.toBe(pausedTravel);
    expect(next?.rest?.hours).toBe(3);
    expect(next?.travelPauseReason).toBe("resting");
  });

  it("supports explicit hunt cancel transition", () => {
    const world = createTestWorld();
    const pausedTravel = createBasePlayState({
      travel: { routeType: "road", progress: 1, totalLength: 4 },
      isTravelPaused: true,
      travelPauseReason: "manual",
    });
    const hunting = reduceTravelActionState(
      pausedTravel,
      { type: "START_HUNT", hours: 3 },
      { world },
    );
    expect(hunting?.hunt).toBeTruthy();

    const cancelled = reduceTravelActionState(
      hunting,
      { type: "CANCEL_TIMED_ACTION" },
      { world },
    );
    expect(cancelled?.hunt).toBeNull();
  });

  it("only dismisses manual travel pause when rules allow it", () => {
    const exhaustedPause = createBasePlayState({
      travel: { routeType: "road", progress: 1, totalLength: 4 },
      isTravelPaused: true,
      travelPauseReason: "exhausted",
      pendingRestChoice: true,
    });
    const blocked = reduceTravelActionState(exhaustedPause, {
      type: "DISMISS_MANUAL_TRAVEL_PAUSE",
    });
    expect(blocked).toBe(exhaustedPause);

    const manualPause = createBasePlayState({
      travel: { routeType: "road", progress: 1, totalLength: 4 },
      isTravelPaused: true,
      travelPauseReason: "manual",
      pendingRestChoice: false,
    });
    const resumed = reduceTravelActionState(manualPause, {
      type: "DISMISS_MANUAL_TRAVEL_PAUSE",
    });
    expect(resumed).not.toBe(manualPause);
    expect(resumed?.isTravelPaused).toBe(false);
  });

  it("clears hunt result feedback via explicit event", () => {
    const withResult = createBasePlayState({
      latestHuntFeedback: {
        type: "result",
        text: "Jaktresultat",
      },
    });
    const next = reduceTravelActionState(withResult, {
      type: "DISMISS_HUNT_RESULT",
    });
    expect(next).not.toBe(withResult);
    expect(next?.latestHuntFeedback).toBeNull();
  });
});
