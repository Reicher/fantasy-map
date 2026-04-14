import { describe, expect, it } from "vitest";
import { advanceRest, beginRest, cancelRest } from "./rest";

function createBasePlayState(): any {
  return {
    gameOver: null,
    travel: null,
    isTravelPaused: false,
    pendingRestChoice: false,
    pendingJourneyEvent: null,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    hoveredNodeId: 1,
    pressedNodeId: 1,
    travelPauseReason: null,
    maxStamina: 12,
    stamina: 4,
  };
}

describe("travel rest transitions", () => {
  it("does not start resting during active travel unless forced by rest choice", () => {
    const playState = {
      ...createBasePlayState(),
      travel: { routeType: "road" },
      isTravelPaused: false,
      pendingRestChoice: false,
    };
    expect(beginRest(playState, 3)).toBe(playState);
  });

  it("starts rest when travel is paused", () => {
    const playState = {
      ...createBasePlayState(),
      travel: { routeType: "road" },
      isTravelPaused: true,
      travelPauseReason: "manual",
    };
    const next = beginRest(playState, 3);

    expect(next).not.toBe(playState);
    expect(next.rest?.hours).toBe(3);
    expect(next.rest?.elapsedHours).toBe(0);
    expect(next.travelPauseReason).toBe("resting");
    expect(next.hoveredNodeId).toBeNull();
    expect(next.pressedNodeId).toBeNull();
  });

  it("completes rest and restores stamina up to max", () => {
    const started = beginRest(createBasePlayState(), 3);
    const finished = advanceRest(started, 3);

    expect(finished.rest).toBeNull();
    expect(finished.stamina).toBe(finished.maxStamina);
    expect(finished.pendingRestChoice).toBe(false);
    expect(finished.latestHuntFeedback?.type).toBe("result");
  });

  it("supports cancelling an in-progress rest", () => {
    const started = beginRest(createBasePlayState(), 3);
    const progressed = {
      ...started,
      rest: {
        ...started.rest,
        elapsedHours: 1.9,
      },
    };
    const cancelled = cancelRest(progressed);

    expect(cancelled.rest).toBeNull();
    expect(cancelled.stamina).toBe(10);
    expect(cancelled.latestHuntFeedback?.text).toContain("Vila avbruten");
  });
});
