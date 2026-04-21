import { describe, expect, it } from "vitest";
import { countInventoryItemsByType } from "../inventory";
import { advanceRest, beginRest, cancelRest } from "./rest";
import type { PlayState } from "@fardvag/shared/types/play";

function createBasePlayState(): PlayState {
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
      travelPauseReason: "manual" as const,
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
    expect(cancelled.stamina).toBe(12);
    expect(cancelled.latestHuntFeedback?.text).toContain("Vila avbruten");
  });

  it("keeps resting continuously until cancelled in continuous mode", () => {
    const started = beginRest(createBasePlayState(), -1);
    expect(started?.rest?.hours).toBe(-1);

    const progressed = advanceRest(started, 2);
    expect(progressed?.rest?.hours).toBe(-1);
    expect(progressed?.rest?.elapsedHours).toBe(2);

    const cancelled = cancelRest(progressed);
    expect(cancelled?.rest).toBeNull();
    expect(cancelled?.stamina).toBe(12);
    expect(cancelled?.latestHuntFeedback?.text).toContain("Vila avbruten");
  });

  it("allows rest from non-hostile settlement encounter and clears encounter interaction", () => {
    const playState = {
      ...createBasePlayState(),
      pendingJourneyEvent: {
        type: "encounter-turn" as const,
        encounterId: "settlement-enc-1",
        message: "Du möter bosättare.",
        canAttack: true,
      },
      encounter: {
        id: "settlement-enc-1",
        type: "settlement-group" as const,
        disposition: "friendly" as const,
        turn: "player" as const,
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 8,
        opponentStamina: 8,
      },
    };

    const next = beginRest(playState, 3);
    expect(next).not.toBe(playState);
    expect(next?.rest?.hours).toBe(3);
    expect(next?.pendingJourneyEvent).toBeNull();
    expect(next?.encounter).toBeNull();
  });

  it("restores settlement encounter choices after cancelling rest", () => {
    const playState = {
      ...createBasePlayState(),
      pendingJourneyEvent: {
        type: "encounter-turn" as const,
        encounterId: "settlement-enc-restore",
        message: "Du möter bosättare.",
        requiresAcknowledgement: true,
        canAttack: true,
      },
      encounter: {
        id: "settlement-enc-restore",
        type: "settlement-group" as const,
        disposition: "friendly" as const,
        turn: "player" as const,
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 8,
        opponentStamina: 8,
      },
    };
    const resting = beginRest(playState, -1);
    expect(resting?.pendingJourneyEvent).toBeNull();
    expect(resting?.encounter).toBeNull();
    expect(resting?.rest?.settlementEncounterContext?.pendingJourneyEvent?.type).toBe(
      "encounter-turn",
    );
    if (!resting?.rest) {
      throw new Error("Expected rest to start from settlement encounter.");
    }

    const cancelled = cancelRest({
      ...resting,
      rest: {
        ...resting.rest,
        elapsedHours: 2,
      },
    });
    expect(cancelled?.rest).toBeNull();
    expect(cancelled?.pendingJourneyEvent?.type).toBe("encounter-turn");
    expect(cancelled?.encounter?.type).toBe("settlement-group");
    expect(cancelled?.encounter?.disposition).toBe("friendly");
  });

  it("blocks rest while hostile settlement encounter is active", () => {
    const playState = {
      ...createBasePlayState(),
      pendingJourneyEvent: {
        type: "encounter-turn" as const,
        encounterId: "settlement-enc-hostile",
        message: "Bosättarna är fientliga.",
        canAttack: true,
      },
      encounter: {
        id: "settlement-enc-hostile",
        type: "settlement-group" as const,
        disposition: "hostile" as const,
        turn: "player" as const,
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 8,
        opponentStamina: 8,
      },
    };

    expect(beginRest(playState, 3)).toBe(playState);
  });

  it("keeps travel paused by encounter when rest completes during encounter interaction", () => {
    const playState = {
      ...createBasePlayState(),
      travel: { routeType: "road" },
      isTravelPaused: true,
      travelPauseReason: "encounter" as const,
      pendingJourneyEvent: {
        type: "encounter-turn" as const,
        encounterId: "enc-rest",
        message: "En varg blockerar vägen.",
        requiresAcknowledgement: true,
        canAttack: false,
      },
      encounter: {
        id: "enc-rest",
        type: "wolf" as const,
        disposition: "hostile" as const,
        turn: "player" as const,
        round: 1,
        rollIndex: 0,
        opponentInitiative: 9,
        opponentDamageMin: 4,
        opponentDamageMax: 8,
        opponentMaxHealth: 12,
        opponentHealth: 12,
        opponentMaxStamina: 20,
        opponentStamina: 20,
      },
      rest: {
        hours: 1,
        elapsedHours: 0,
        staminaGain: 9,
        resumeTravelOnFinish: true,
        priorWasTravelPaused: false,
        priorTravelPauseReason: null,
      },
    };

    const finished = advanceRest(playState, 1);
    expect(finished?.rest).toBeNull();
    expect(finished?.pendingJourneyEvent?.type).toBe("encounter-turn");
    expect(finished?.encounter?.id).toBe("enc-rest");
    expect(finished?.isTravelPaused).toBe(true);
    expect(finished?.travelPauseReason).toBe("encounter");
  });

  it("uses medicine during rest when injured and heals all damage", () => {
    const started = beginRest(
      {
        ...createBasePlayState(),
        injuryStatus: "severely-injured",
        maxHealth: 12,
        health: 3,
        inventory: {
          columns: 4,
          rows: 4,
          items: [
            {
              id: "medicine-1",
              type: "medicine",
              name: "Medicin",
              symbol: "medicine",
              count: 2,
              width: 1,
              height: 1,
              column: 0,
              row: 0,
            },
          ],
        },
      },
      1,
    );
    const finished = advanceRest(started, 1);

    expect(finished?.injuryStatus).toBe("healthy");
    expect(finished?.health).toBe(12);
    expect(countInventoryItemsByType(finished?.inventory, "medicine")).toBe(1);
    expect(finished?.latestHuntFeedback?.text).toContain("läkte alla skador");
  });

  it("does not use medicine during rest when no healing is needed", () => {
    const started = beginRest(
      {
        ...createBasePlayState(),
        injuryStatus: "healthy",
        maxHealth: 12,
        health: 12,
        inventory: {
          columns: 4,
          rows: 4,
          items: [
            {
              id: "medicine-1",
              type: "medicine",
              name: "Medicin",
              symbol: "medicine",
              count: 2,
              width: 1,
              height: 1,
              column: 0,
              row: 0,
            },
          ],
        },
      },
      1,
    );
    const finished = advanceRest(started, 1);

    expect(finished?.injuryStatus).toBe("healthy");
    expect(finished?.health).toBe(12);
    expect(countInventoryItemsByType(finished?.inventory, "medicine")).toBe(2);
    expect(finished?.latestHuntFeedback?.text).not.toContain("läkte alla skador");
  });
});
