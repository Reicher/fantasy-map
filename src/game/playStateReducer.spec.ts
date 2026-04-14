import { describe, expect, it } from "vitest";
import {
  reducePlayState,
  reducePlayStateWithMeta,
} from "./playStateReducer";
import { createInitialInventory } from "./inventory";
import type { PlayState } from "../types/play";
import type { World } from "../types/world";

function createTravelWorld(): World {
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
      inventory: createInitialInventory(),
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
