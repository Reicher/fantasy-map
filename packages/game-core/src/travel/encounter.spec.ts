import { describe, expect, it } from "vitest";
import {
  maybeTriggerHuntRabbitEncounter,
  maybeTriggerTravelEncounter,
  maybeTriggerWildernessHostileEncounter,
  resolveEncounterPlayerAction,
} from "./encounter";
import type { PlayState } from "@fardvag/shared/types/play";

function createBasePlayState(overrides: Record<string, unknown> = {}): PlayState {
  return {
    gameOver: null,
    viewMode: "journey",
    travel: {
      startNodeId: 0,
      targetNodeId: 1,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      segmentLengths: [1],
      totalLength: 1,
      progress: 0.4,
    },
    isTravelPaused: true,
    travelPauseReason: "encounter",
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    pendingJourneyEvent: null,
    encounter: {
      id: "enc-1",
      type: "rabbit",
      disposition: "neutral",
      turn: "player",
      round: 1,
      rollIndex: 0,
      opponentInitiative: 4,
      opponentDamageMin: 1,
      opponentDamageMax: 2,
      opponentMaxHealth: 4,
      opponentHealth: 4,
      opponentMaxStamina: 12,
      opponentStamina: 12,
    },
    latestEncounterResolution: null,
    latestHuntFeedback: null,
    maxHealth: 12,
    health: 12,
    maxStamina: 12,
    stamina: 8,
    vapenTraffsakerhet: 75,
    initiative: 8,
    journeyElapsedHours: 1,
    runStats: {
      meatEaten: 0,
      travelHours: 0,
      huntHours: 0,
      restHours: 0,
      distanceTraveled: 0,
    },
    inventory: {
      columns: 4,
      rows: 4,
      items: [
        {
          id: "bullets-1",
          type: "bullets",
          name: "Kulor",
          symbol: "bullets",
          width: 1,
          height: 1,
          count: 4,
          column: 0,
          row: 0,
        },
      ],
    },
    ...overrides,
  };
}

describe("travel encounters", () => {
  it("changes rabbit to fleeing when attacked", () => {
    const state = createBasePlayState({
      vapenTraffsakerhet: 0,
      encounter: {
        id: "enc-attack",
        type: "rabbit",
        disposition: "neutral",
        turn: "player",
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 1,
        opponentMaxHealth: 8,
        opponentHealth: 8,
        opponentMaxStamina: 8,
        opponentStamina: 1,
      },
      stamina: 8,
    });

    const next = resolveEncounterPlayerAction(state, "attack") ?? state;
    expect(next.encounter?.disposition).toBe("fleeing");
    expect(next.pendingJourneyEvent?.type).toBe("encounter-turn");
  });

  it("spends ammo and creates loot event when opponent dies", () => {
    const state = createBasePlayState({
      vapenTraffsakerhet: 100,
      encounter: {
        id: "enc-kill",
        type: "wolf",
        disposition: "hostile",
        turn: "player",
        round: 1,
        rollIndex: 0,
        opponentInitiative: 9,
        opponentDamageMin: 6,
        opponentDamageMax: 6,
        opponentMaxHealth: 12,
        opponentHealth: 1,
        opponentMaxStamina: 18,
        opponentStamina: 18,
      },
    });

    const next = resolveEncounterPlayerAction(state, "attack") ?? state;
    expect(next.encounter).toBeNull();
    expect(next.pendingJourneyEvent?.type).toBe("encounter-loot");
    expect(next.latestEncounterResolution?.outcome).toBe("opponent-died");
    expect(next.inventory?.items?.[0]?.count).toBe(3);
  });

  it("fails flee against hostile opponent with higher stamina", () => {
    const state = createBasePlayState({
      encounter: {
        id: "enc-flee-fail",
        type: "wolf",
        disposition: "hostile",
        turn: "player",
        round: 1,
        rollIndex: 0,
        opponentInitiative: 9,
        opponentDamageMin: 0,
        opponentDamageMax: 0,
        opponentMaxHealth: 12,
        opponentHealth: 12,
        opponentMaxStamina: 18,
        opponentStamina: 12,
      },
      stamina: 5,
      health: 10,
    });

    const next = resolveEncounterPlayerAction(state, "flee") ?? state;
    expect(next.encounter).toBeTruthy();
    expect(next.latestEncounterResolution).toBeNull();
    expect(next.pendingJourneyEvent?.type).toBe("encounter-turn");
  });

  it("auto-succeeds flee when opponent is neutral", () => {
    const state = createBasePlayState({
      encounter: {
        id: "enc-flee-ok",
        type: "rabbit",
        disposition: "neutral",
        turn: "player",
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 10,
        opponentStamina: 10,
      },
      isTravelPaused: true,
      travelPauseReason: "encounter",
    });

    const next = resolveEncounterPlayerAction(state, "flee") ?? state;
    expect(next.encounter).toBeNull();
    expect(next.pendingJourneyEvent).toBeNull();
    expect(next.isTravelPaused).toBe(false);
    expect(next.latestEncounterResolution?.outcome).toBe("player-fled");
  });

  it("can trigger encounter while traveling by world-hour roll", () => {
    const world = {
      params: {
        seed: "encounter-trigger-seed",
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 128; hour += 1) {
      const travelActive = createBasePlayState({
        isTravelPaused: false,
        travelPauseReason: null,
        pendingJourneyEvent: null,
        encounter: null,
        journeyElapsedHours: hour,
        travel: {
          startNodeId: 0,
          targetNodeId: 1,
          points: [
            { x: 1, y: 1 },
            { x: 200, y: 1 },
          ],
          segmentLengths: [199],
          totalLength: 199,
          progress: 12,
        },
      });
      const next = maybeTriggerTravelEncounter(travelActive, world) ?? travelActive;
      if (next.encounter || next.pendingJourneyEvent) {
        triggered = true;
        expect(next.encounter).toBeTruthy();
        expect(next.encounter?.phase === "approaching" || next.encounter?.phase === "active").toBe(true);
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it("can trigger travel encounters even when nearby non-route nodes exist", () => {
    const world = {
      params: {
        seed: "encounter-dense-nodes-seed",
      },
      features: {
        nodes: Array.from({ length: 80 }, (_, index) => ({
          id: index,
          x: 8 + index * 2,
          y: index % 2 === 0 ? 0.7 : 1.3,
        })),
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 128; hour += 1) {
      const travelActive = createBasePlayState({
        isTravelPaused: false,
        travelPauseReason: null,
        pendingJourneyEvent: null,
        encounter: null,
        journeyElapsedHours: hour,
        travel: {
          startNodeId: 0,
          targetNodeId: 1,
          points: [
            { x: 1, y: 1 },
            { x: 260, y: 1 },
          ],
          segmentLengths: [259],
          totalLength: 259,
          progress: 10,
        },
      });
      const next = maybeTriggerTravelEncounter(travelActive, world) ?? travelActive;
      if (next.encounter) {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it("can trigger hostile wilderness encounter while resting outside nodes", () => {
    const world = {
      params: {
        seed: "encounter-rest-wilderness-seed",
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 128; hour += 1) {
      const resting = createBasePlayState({
        journeyElapsedHours: hour,
        isTravelPaused: true,
        travelPauseReason: "resting",
        pendingJourneyEvent: null,
        encounter: null,
        rest: {
          hours: 8,
          elapsedHours: 0,
          staminaGain: 72,
          resumeTravelOnFinish: false,
          priorWasTravelPaused: true,
          priorTravelPauseReason: "manual",
        },
        hunt: null,
      });
      const next = maybeTriggerWildernessHostileEncounter(resting, world) ?? resting;
      if (next.encounter || next.pendingJourneyEvent?.type === "encounter-turn") {
        triggered = true;
        expect(next.encounter?.type).toBe("wolf");
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it("can trigger hostile wilderness encounter while hunting outside nodes", () => {
    const world = {
      params: {
        seed: "encounter-hunt-wilderness-seed",
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 128; hour += 1) {
      const hunting = createBasePlayState({
        journeyElapsedHours: hour,
        isTravelPaused: true,
        travelPauseReason: "hunting",
        pendingJourneyEvent: null,
        encounter: null,
        rest: null,
        hunt: {
          runId: 1,
          seed: "hunt-seed",
          hours: 8,
          elapsedHours: 0,
          completedHours: 0,
          successfulHours: 0,
          totalMeatGained: 0,
          areaKey: "wild",
          areaLabel: "Vildmark",
          areaType: "wild",
          biomeKey: "forest",
          areaCapacity: 1,
          worldSeed: "world",
          startedAtJourneyHours: 0,
          startedTimeOfDayHours: 12,
          resumeTravelOnFinish: false,
          priorWasTravelPaused: true,
          priorTravelPauseReason: "manual",
          lastMessage: "Du spanar efter spår.",
        },
      });
      const next = maybeTriggerWildernessHostileEncounter(hunting, world) ?? hunting;
      if (next.encounter || next.pendingJourneyEvent?.type === "encounter-turn") {
        triggered = true;
        expect(next.encounter?.type).toBe("wolf");
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it("does not trigger wilderness encounter when resting at a node", () => {
    const world = {
      params: {
        seed: "encounter-node-rest-seed",
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 256; hour += 1) {
      const restingAtNode = createBasePlayState({
        journeyElapsedHours: hour,
        travel: null,
        isTravelPaused: false,
        travelPauseReason: null,
        pendingJourneyEvent: null,
        encounter: null,
        rest: {
          hours: 8,
          elapsedHours: 0,
          staminaGain: 72,
          resumeTravelOnFinish: false,
          priorWasTravelPaused: false,
          priorTravelPauseReason: null,
        },
        hunt: null,
      });
      const next = maybeTriggerWildernessHostileEncounter(restingAtNode, world) ?? restingAtNode;
      if (next.encounter || next.pendingJourneyEvent?.type === "encounter-turn") {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(false);
  });

  it("can trigger rabbit encounter while hunting", () => {
    const world = {
      params: {
        seed: "hunt-rabbit-seed",
      },
    };
    let triggered = false;
    for (let hour = 0; hour < 128; hour += 1) {
      const hunting = createBasePlayState({
        journeyElapsedHours: hour,
        isTravelPaused: true,
        travelPauseReason: "hunting",
        pendingJourneyEvent: null,
        encounter: null,
        rest: null,
        hunt: {
          runId: 3,
          seed: "hunt-seed",
          hours: 8,
          elapsedHours: 0,
          completedHours: 0,
          successfulHours: 0,
          totalMeatGained: 0,
          areaKey: "wild",
          areaLabel: "Vildmark",
          areaType: "wild",
          biomeKey: "forest",
          areaCapacity: 1,
          worldSeed: "world",
          startedAtJourneyHours: 0,
          startedTimeOfDayHours: 12,
          resumeTravelOnFinish: false,
          priorWasTravelPaused: true,
          priorTravelPauseReason: "manual",
          lastMessage: "Du spanar efter spår.",
        },
      });
      const next = maybeTriggerHuntRabbitEncounter(hunting, world) ?? hunting;
      if (next.encounter || next.pendingJourneyEvent?.type === "encounter-turn") {
        triggered = true;
        expect(next.encounter?.type).toBe("rabbit");
        break;
      }
    }
    expect(triggered).toBe(true);
  });

  it("does not auto-resume travel after flee when hunt is still active", () => {
    const state = createBasePlayState({
      isTravelPaused: true,
      travelPauseReason: "encounter",
      encounter: {
        id: "enc-hunt-flee",
        type: "rabbit",
        disposition: "neutral",
        turn: "player",
        round: 1,
        rollIndex: 0,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 10,
        opponentStamina: 10,
      },
      rest: null,
      hunt: {
        runId: 2,
        seed: "hunt-seed",
        hours: 8,
        elapsedHours: 2,
        completedHours: 2,
        successfulHours: 0,
        totalMeatGained: 0,
        areaKey: "wild",
        areaLabel: "Vildmark",
        areaType: "wild",
        biomeKey: "forest",
        areaCapacity: 1,
        worldSeed: "world",
        startedAtJourneyHours: 0,
        startedTimeOfDayHours: 12,
        resumeTravelOnFinish: false,
        priorWasTravelPaused: true,
        priorTravelPauseReason: "manual",
        lastMessage: "Du spanar efter spår.",
      },
    });

    const next = resolveEncounterPlayerAction(state, "flee") ?? state;
    expect(next.encounter).toBeNull();
    expect(next.hunt).toBeTruthy();
    expect(next.isTravelPaused).toBe(true);
    expect(next.travelPauseReason).toBe("hunting");
  });

  it("uses higher rabbit encounter rate while hunting than during normal travel", () => {
    const travelWorld = {
      params: {
        seed: "rabbit-rate-seed",
      },
      features: {
        nodes: [],
      },
    };
    let travelRabbitHits = 0;
    let huntRabbitHits = 0;
    for (let hour = 0; hour < 512; hour += 1) {
      const travelActive = createBasePlayState({
        isTravelPaused: false,
        travelPauseReason: null,
        pendingJourneyEvent: null,
        encounter: null,
        journeyElapsedHours: hour,
        travel: {
          startNodeId: 0,
          targetNodeId: 1,
          points: [
            { x: 1, y: 1 },
            { x: 280, y: 1 },
          ],
          segmentLengths: [279],
          totalLength: 279,
          progress: 16,
        },
      });
      const travelNext = maybeTriggerTravelEncounter(travelActive, travelWorld) ?? travelActive;
      if (travelNext.encounter?.type === "rabbit") {
        travelRabbitHits += 1;
      }

      const hunting = createBasePlayState({
        journeyElapsedHours: hour,
        isTravelPaused: true,
        travelPauseReason: "hunting",
        pendingJourneyEvent: null,
        encounter: null,
        rest: null,
        hunt: {
          runId: 9,
          seed: "hunt-seed",
          hours: 8,
          elapsedHours: 0,
          completedHours: 0,
          successfulHours: 0,
          totalMeatGained: 0,
          areaKey: "wild",
          areaLabel: "Vildmark",
          areaType: "wild",
          biomeKey: "forest",
          areaCapacity: 1,
          worldSeed: "world",
          startedAtJourneyHours: 0,
          startedTimeOfDayHours: 12,
          resumeTravelOnFinish: false,
          priorWasTravelPaused: true,
          priorTravelPauseReason: "manual",
          lastMessage: "Du spanar efter spår.",
        },
      });
      const huntNext = maybeTriggerHuntRabbitEncounter(hunting, travelWorld) ?? hunting;
      if (huntNext.encounter?.type === "rabbit") {
        huntRabbitHits += 1;
      }
    }
    expect(huntRabbitHits).toBeGreaterThan(travelRabbitHits);
  });
});
