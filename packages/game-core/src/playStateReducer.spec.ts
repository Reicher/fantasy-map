import { describe, expect, it } from "vitest";
import {
  reducePlayState,
  reducePlayStateWithMeta,
} from "./playStateReducer";
import { createPlayState } from "./travel";
import { createInitialInventory } from "./inventory";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

function createTravelWorld(startNodeId = 0): World {
  const width = 8;
  const height = 8;
  const size = width * height;
  const biomeRegionId = new Int32Array(size);
  biomeRegionId.fill(0);
  const lakeIdByCell = new Int32Array(size);
  lakeIdByCell.fill(-1);

  return {
    params: {
      seed: "play-state-reducer",
      fogVisionRadius: 2,
    },
    settlements: [
      {
        id: 0,
        name: "Start",
        x: 2,
        y: 2,
        score: 1,
      },
      {
        id: 1,
        name: "Mål",
        x: 4,
        y: 2,
        score: 1,
      },
    ],
    terrain: {
      width,
      height,
    },
    features: {
      nodes: [
        {
          id: 0,
          x: 2,
          y: 2,
          cell: 2 * width + 2,
          marker: "settlement",
          name: "Start",
        },
        {
          id: 1,
          x: 4,
          y: 2,
          cell: 2 * width + 4,
          marker: "settlement",
          name: "Mål",
        },
      ],
      biomeRegions: [{ id: 0, name: "Slätt" }],
      indices: {
        biomeRegionId,
        lakeIdByCell,
      },
    },
    playerStart: {
      nodeId: startNodeId,
    },
  } as unknown as World;
}

function createTravelPlayState(): PlayState {
  const graph = new Map<number, Map<number, { points: Array<{ x: number; y: number }>; routeType: string }>>();
  graph.set(
    0,
    new Map([
      [
        1,
        {
          points: [
            { x: 2, y: 2 },
            { x: 4, y: 2 },
          ],
          routeType: "road",
        },
      ],
    ]),
  );

  return {
    actionMode: "idle",
    gameOver: null,
    viewMode: "map",
    graph,
    currentNodeId: 0,
    position: { x: 2, y: 2 },
    lastRegionId: 0,
    hoveredNodeId: null,
    pressedNodeId: null,
    travel: null,
    rest: null,
    hunt: null,
    maxStamina: 18,
    stamina: 18,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    latestHuntFeedback: null,
    pendingJourneyEvent: null,
    runStats: {
      meatEaten: 0,
      travelHours: 0,
      huntHours: 0,
      restHours: 0,
      distanceTraveled: 0,
    },
    discoveredCells: new Uint8Array(64),
    discoveredNodeIds: new Uint8Array([1, 0]),
    abandonedLootByNodeId: {},
  };
}

describe("playStateReducer", () => {
  it("starts travel through BEGIN_TRAVEL event and switches to journey view", () => {
    const playState = createTravelPlayState();
    const next = reducePlayState(playState, {
      type: "BEGIN_TRAVEL",
      targetNodeId: 1,
    });

    expect(next).not.toBe(playState);
    expect(next?.viewMode).toBe("journey");
    expect(next?.travel?.targetNodeId).toBe(1);
    expect(next?.actionMode).toBe("travel-active");
  });

  it("allows BEGIN_TRAVEL when encounter is non-hostile", () => {
    const playState = createTravelPlayState();
    const encounterId = "settlement-encounter-test";
    const next = reducePlayState(
      {
        ...playState,
        encounter: {
          id: encounterId,
          type: "settlement-group",
          disposition: "friendly",
          turn: "player",
          round: 1,
          opponentInitiative: 6,
          opponentDamageMin: 2,
          opponentDamageMax: 4,
          opponentMaxHealth: 18,
          opponentHealth: 18,
          opponentMaxStamina: 14,
          opponentStamina: 14,
        },
        pendingJourneyEvent: {
          type: "encounter-turn",
          encounterId,
          message: "Du möter en grupp.",
          requiresAcknowledgement: true,
          canAttack: true,
        },
      },
      {
        type: "BEGIN_TRAVEL",
        targetNodeId: 1,
      },
    );

    expect(next).not.toBeNull();
    expect(next).not.toBe(playState);
    expect(next?.travel?.targetNodeId).toBe(1);
    expect(next?.encounter).toBeNull();
    expect(next?.pendingJourneyEvent).toBeNull();
    expect(next?.viewMode).toBe("journey");
  });

  it("blocks BEGIN_TRAVEL when encounter is hostile", () => {
    const playState = createTravelPlayState();
    const next = reducePlayState(
      {
        ...playState,
        encounter: {
          id: "hostile-encounter",
          type: "wolf",
          disposition: "hostile",
          turn: "player",
          round: 1,
          opponentInitiative: 9,
          opponentDamageMin: 4,
          opponentDamageMax: 8,
          opponentMaxHealth: 12,
          opponentHealth: 12,
          opponentMaxStamina: 20,
          opponentStamina: 20,
        },
      },
      {
        type: "BEGIN_TRAVEL",
        targetNodeId: 1,
      },
    );

    expect(next).toBeDefined();
    expect(next?.travel).toBeNull();
    expect(next?.encounter?.disposition).toBe("hostile");
    expect(next?.currentNodeId).toBe(playState.currentNodeId);
  });

  it("keeps state unchanged on ADVANCE_TRAVEL without world context", () => {
    const started = reducePlayState(createTravelPlayState(), {
      type: "BEGIN_TRAVEL",
      targetNodeId: 1,
    });
    const advanced = reducePlayState(started, {
      type: "ADVANCE_TRAVEL",
      deltaMs: 1000,
    });
    expect(advanced).toBe(started);
  });

  it("advances and resolves arrival through ADVANCE_TRAVEL event", () => {
    const world = createTravelWorld();
    const started = reducePlayState(createTravelPlayState(), {
      type: "BEGIN_TRAVEL",
      targetNodeId: 1,
    });
    const advanced = reducePlayState(
      started,
      {
        type: "ADVANCE_TRAVEL",
        deltaMs: 1000,
      },
      { world },
    );

    expect(advanced?.travel).toBeNull();
    expect(advanced?.currentNodeId).toBe(1);
    expect(advanced?.position).toMatchObject({ x: 4, y: 2 });
    expect(advanced?.pendingJourneyEvent).toBeNull();
    expect(advanced?.runStats?.distanceTraveled).toBeCloseTo(2, 6);
    expect(advanced?.actionMode).toBe("idle");
  });

  it("accumulates runStats distance during partial ADVANCE_TRAVEL steps", () => {
    const world = createTravelWorld();
    const started = reducePlayState(createTravelPlayState(), {
      type: "BEGIN_TRAVEL",
      targetNodeId: 1,
    });
    const advanced = reducePlayState(
      started,
      {
        type: "ADVANCE_TRAVEL",
        deltaMs: 200,
      },
      { world },
    );

    expect(advanced?.travel).not.toBeNull();
    expect(advanced?.travel?.progress).toBeCloseTo(0.75, 6);
    expect(advanced?.runStats?.distanceTraveled).toBeCloseTo(0.75, 6);
  });

  it("does not advance travel while a blocking encounter interaction is active", () => {
    const world = createTravelWorld();
    const started = reducePlayState(createTravelPlayState(), {
      type: "BEGIN_TRAVEL",
      targetNodeId: 1,
    });
    const withEncounter = {
      ...started,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingJourneyEvent: {
        type: "encounter-turn" as const,
        encounterId: "enc-blocking-travel",
        message: "En varg blockerar vägen.",
        requiresAcknowledgement: true,
        canAttack: false,
      },
      encounter: {
        id: "enc-blocking-travel",
        type: "wolf" as const,
        disposition: "hostile" as const,
        turn: "player" as const,
        phase: "active" as const,
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
    };

    const advanced = reducePlayState(
      withEncounter,
      {
        type: "ADVANCE_TRAVEL",
        deltaMs: 1000,
      },
      { world },
    );

    expect(advanced?.travel?.progress).toBe(withEncounter?.travel?.progress);
    expect(advanced?.pendingJourneyEvent?.type).toBe("encounter-turn");
    expect(advanced?.encounter?.id).toBe("enc-blocking-travel");
  });

  it("starts friendly settlement encounter on arrival when settlement has agents", () => {
    const world = createTravelWorld();
    const started = reducePlayState(
      {
        ...createTravelPlayState(),
        initiative: 5,
        settlementStates: {
          "1": {
            settlementId: 1,
            inventory: createInitialInventory(),
            agents: [
              {
                id: "settlement-agent-1",
                name: "Sven Svensson",
                settlementId: 1,
                state: "resting",
                initiative: 9,
                vitality: 10,
                maxHealth: 12,
                health: 12,
                maxStamina: 14,
                stamina: 14,
                inventory: createInitialInventory(),
              },
              {
                id: "settlement-agent-2",
                name: "Klara Kling",
                settlementId: 1,
                state: "resting",
                initiative: 7,
                vitality: 8,
                maxHealth: 10,
                health: 10,
                maxStamina: 12,
                stamina: 12,
                inventory: createInitialInventory(),
              },
            ],
          },
        },
      },
      {
        type: "BEGIN_TRAVEL",
        targetNodeId: 1,
      },
    );
    const arrived = reducePlayState(
      started,
      {
        type: "ADVANCE_TRAVEL",
        deltaMs: 1000,
      },
      { world },
    );

    expect(arrived?.travel).toBeNull();
    expect(arrived?.encounter?.type).toBe("settlement-group");
    expect(arrived?.encounter?.disposition).toBe("friendly");
    expect(arrived?.encounter?.opponentMembers?.length).toBe(2);
    expect(arrived?.encounter?.settlementName).toBe("Mål");
    expect(arrived?.pendingJourneyEvent?.type).toBe("encounter-turn");
    expect(arrived?.pendingJourneyEvent?.message).toContain(
      "Du möter Sven Svensson och Klara Kling från Mål.",
    );
  });

  it("does not start settlement encounter when all settlement agents are hunting", () => {
    const world = createTravelWorld();
    const started = reducePlayState(
      {
        ...createTravelPlayState(),
        initiative: 5,
        settlementStates: {
          "1": {
            settlementId: 1,
            inventory: createInitialInventory(),
            agents: [
              {
                id: "settlement-agent-1",
                settlementId: 1,
                state: "hunting",
                initiative: 9,
                vitality: 10,
                maxHealth: 12,
                health: 12,
                maxStamina: 14,
                stamina: 10,
                inventory: createInitialInventory(),
              },
              {
                id: "settlement-agent-2",
                settlementId: 1,
                state: "hunting",
                initiative: 7,
                vitality: 8,
                maxHealth: 10,
                health: 10,
                maxStamina: 12,
                stamina: 9,
                inventory: createInitialInventory(),
              },
            ],
          },
        },
      },
      {
        type: "BEGIN_TRAVEL",
        targetNodeId: 1,
      },
    );
    const arrived = reducePlayState(
      started,
      {
        type: "ADVANCE_TRAVEL",
        deltaMs: 1000,
      },
      { world },
    );

    expect(arrived?.travel).toBeNull();
    expect(arrived?.encounter).toBeNull();
    expect(arrived?.pendingJourneyEvent).toBeNull();
    expect(arrived?.actionMode).toBe("idle");
  });

  it("starts settlement encounter on configured start settlement", () => {
    const world = createTravelWorld(1);
    const started = createPlayState(world);

    expect(started?.travel).toBeNull();
    expect(started?.currentNodeId).toBe(1);
    expect(started?.encounter?.type).toBe("settlement-group");
    expect(started?.encounter?.disposition).toBe("friendly");
    expect(started?.pendingJourneyEvent?.type).toBe("encounter-turn");
    expect(started?.actionMode).toBe("event");
  });

  it("advances world-hours through reducer event and updates run stats", () => {
    const world = createTravelWorld();
    const travelActiveState = {
      ...createTravelPlayState(),
      travel: {
        points: [
          { x: 2, y: 2 },
          { x: 4, y: 2 },
        ],
        segmentLengths: [2],
        totalLength: 2,
        progress: 0.1,
        targetNodeId: 1,
      },
      inventory: {
        columns: 4,
        rows: 4,
        items: [],
      },
      maxHealth: 5,
      health: 5,
      maxStamina: 10,
      stamina: 10,
      runStats: {
        meatEaten: 0,
        travelHours: 0,
        huntHours: 0,
        restHours: 0,
        distanceTraveled: 0,
      },
      timeOfDayHours: 12,
      journeyElapsedHours: 0,
      hungerElapsedHours: 0,
      staminaElapsedHours: 0,
    };

    const result = reducePlayStateWithMeta(
      travelActiveState,
      {
        type: "ADVANCE_WORLD_HOURS",
        hours: 2,
      },
      { world },
    );

    expect(result.halted).toBe(false);
    expect(result.playState?.journeyElapsedHours).toBe(2);
    expect(result.playState?.hungerElapsedHours).toBe(2);
    expect(result.playState?.runStats?.travelHours).toBe(2);
    expect(result.playState?.timeOfDayHours).toBe(14);
  });

  it("halts world-hour advancement when no activity is active", () => {
    const idleState = createTravelPlayState();
    const result = reducePlayStateWithMeta(
      idleState,
      {
        type: "ADVANCE_WORLD_HOURS",
        hours: 3,
      },
      { world: createTravelWorld() },
    );
    expect(result.halted).toBe(true);
    expect(result.playState).toBe(idleState);
    expect(result.playState?.runStats).toBe(idleState.runStats);
  });
});
