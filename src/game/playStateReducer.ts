import { advanceTravel, beginTravel } from "./travel";
import {
  advanceHunt,
  advanceRest,
  applyHourlyHunger,
  applyHourlyTravelStamina,
  finalizeHourlySurvival,
} from "./travel";
import {
  reduceTravelActionState,
  type TravelActionEvent,
} from "./travel/actionStateMachine";
import { normalizeRunStats } from "./travel/runStats";
import { normalizeTimeOfDayHours } from "./timeOfDay";
import type { PlayState } from "../types/play";
import type { World } from "../types/world";

export type PlayStateEvent =
  | {
      type: "BEGIN_TRAVEL";
      targetNodeId: number;
    }
  | {
      type: "ADVANCE_TRAVEL";
      deltaMs: number;
    }
  | {
      type: "TRAVEL_ACTION";
      action: TravelActionEvent;
    }
  | {
      type: "ADVANCE_WORLD_HOURS";
      hours: number;
    };

interface ReducePlayStateContext {
  world?: World | null;
}

export interface ReducePlayStateMetaResult {
  playState: PlayState | null | undefined;
  halted: boolean;
}

export function reducePlayState(
  playState: PlayState | null | undefined,
  event: PlayStateEvent,
  context: ReducePlayStateContext = {},
): PlayState | null | undefined {
  return reducePlayStateWithMeta(playState, event, context).playState;
}

export function reducePlayStateWithMeta(
  playState: PlayState | null | undefined,
  event: PlayStateEvent,
  context: ReducePlayStateContext = {},
): ReducePlayStateMetaResult {
  if (!playState) {
    return { playState, halted: true };
  }

  switch (event.type) {
    case "BEGIN_TRAVEL": {
      const nextPlayState = beginTravel(
        playState,
        event.targetNodeId,
        context.world ?? null,
      );
      if (nextPlayState === playState) {
        return { playState, halted: false };
      }
      return {
        playState: {
          ...nextPlayState,
          viewMode: "journey",
        },
        halted: false,
      };
    }

    case "ADVANCE_TRAVEL":
      if (!context.world) {
        return { playState, halted: true };
      }
      return {
        playState: advanceTravel(playState, context.world, event.deltaMs),
        halted: false,
      };

    case "TRAVEL_ACTION":
      return {
        playState: reduceTravelActionState(playState, event.action, {
          world: context.world,
        }),
        halted: false,
      };

    case "ADVANCE_WORLD_HOURS":
      if (!context.world) {
        return { playState, halted: true };
      }
      return advancePlayWorldHours(playState, context.world, event.hours);

    default:
      return { playState, halted: false };
  }
}

export function getPlayWorldTimeActivity(playState: PlayState | null | undefined) {
  const hasTravel = Boolean(playState?.travel);
  const isTravelPaused = Boolean(playState?.isTravelPaused);
  const isResting = Boolean(playState?.rest);
  const isHunting = Boolean(playState?.hunt);
  const isTraveling = hasTravel && !isTravelPaused && !isResting && !isHunting;
  return {
    isTraveling,
    isResting,
    isHunting,
    shouldAdvanceWorldTime: isTraveling || isResting || isHunting,
  };
}

function advancePlayWorldHours(
  playState: PlayState | null | undefined,
  world: World,
  hoursToAdvance: number,
): ReducePlayStateMetaResult {
  const targetHours = Number.isFinite(hoursToAdvance)
    ? Math.max(0, Math.floor(hoursToAdvance))
    : 0;
  if (!playState || targetHours <= 0) {
    return {
      playState,
      halted: targetHours <= 0,
    };
  }

  let nextState = playState;
  let processedHours = 0;

  while (processedHours < targetHours) {
    const activity = getPlayWorldTimeActivity(nextState);
    if (!activity.shouldAdvanceWorldTime) {
      return {
        playState: nextState,
        halted: true,
      };
    }

    const currentJourneyElapsedHours = Number.isFinite(
      nextState?.journeyElapsedHours,
    )
      ? Math.max(0, nextState.journeyElapsedHours)
      : 0;
    const runStats = normalizeRunStats(nextState?.runStats);
    nextState = {
      ...nextState,
      timeOfDayHours: normalizeTimeOfDayHours(
        (nextState?.timeOfDayHours ?? 0) + 1,
      ),
      journeyElapsedHours: currentJourneyElapsedHours + 1,
      runStats: {
        ...runStats,
        travelHours: runStats.travelHours + (activity.isTraveling ? 1 : 0),
        huntHours: runStats.huntHours + (activity.isHunting ? 1 : 0),
        restHours: runStats.restHours + (activity.isResting ? 1 : 0),
      },
    };

    nextState = applyHourlyHunger(nextState, 1);
    if (activity.isTraveling) {
      nextState = applyHourlyTravelStamina(nextState, 1);
    }
    if (activity.isResting) {
      nextState = advanceRest(nextState, 1);
    }
    if (activity.isHunting) {
      nextState = advanceHunt(nextState, world, 1);
    }
    nextState = finalizeHourlySurvival(nextState);

    processedHours += 1;
    if (nextState?.gameOver) {
      return {
        playState: nextState,
        halted: true,
      };
    }
  }

  return {
    playState: nextState,
    halted: false,
  };
}
