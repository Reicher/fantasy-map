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
import {
  maybeTriggerHuntRabbitEncounter,
  maybeTriggerTravelEncounter,
  maybeTriggerWildernessHostileEncounter,
} from "./travel/encounter";
import {
  getPlayActionMode,
  isWorldTimeAdvancingActionMode,
  withPlayActionMode,
} from "./travel/actionMode";
import { normalizeRunStats } from "./travel/runStats";
import { normalizeTimeOfDayHours } from "./timeOfDay";
import { advanceSettlementAgentsOneHour } from "./settlementAgents";
import type { PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

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
  return withPlayActionMode(
    reducePlayStateWithMeta(playState, event, context).playState,
    { force: true },
  );
}

export function reducePlayStateWithMeta(
  playState: PlayState | null | undefined,
  event: PlayStateEvent,
  context: ReducePlayStateContext = {},
): ReducePlayStateMetaResult {
  const normalizedPlayState = withPlayActionMode(playState, { force: true });
  if (!normalizedPlayState) {
    return { playState: normalizedPlayState, halted: true };
  }

  switch (event.type) {
    case "BEGIN_TRAVEL": {
      const nextPlayState = beginTravel(
        normalizedPlayState,
        event.targetNodeId,
        context.world ?? null,
      );
      if (nextPlayState === normalizedPlayState) {
        return { playState: normalizedPlayState, halted: false };
      }
      return {
        playState: withPlayActionMode({
          ...nextPlayState,
          viewMode: "journey",
        }, { force: true }),
        halted: false,
      };
    }

    case "ADVANCE_TRAVEL":
      if (!context.world) {
        return { playState: normalizedPlayState, halted: true };
      }
      return {
        playState: withPlayActionMode(
          advanceTravel(normalizedPlayState, context.world, event.deltaMs),
          { force: true },
        ),
        halted: false,
      };

    case "TRAVEL_ACTION":
      return {
        playState: withPlayActionMode(
          reduceTravelActionState(normalizedPlayState, event.action, {
            world: context.world,
          }),
          { force: true },
        ),
        halted: false,
      };

    case "ADVANCE_WORLD_HOURS":
      if (!context.world) {
        return { playState: normalizedPlayState, halted: true };
      }
      return advancePlayWorldHours(normalizedPlayState, context.world, event.hours);

    default:
      return { playState: normalizedPlayState, halted: false };
  }
}

export function getPlayWorldTimeActivity(playState: PlayState | null | undefined) {
  const actionMode = getPlayActionMode(playState);
  const isTraveling = actionMode === "travel-active";
  const isResting = actionMode === "resting";
  const isHunting = actionMode === "hunting";
  return {
    isTraveling,
    isResting,
    isHunting,
    shouldAdvanceWorldTime: isWorldTimeAdvancingActionMode(actionMode),
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
      playState: withPlayActionMode(playState, { force: true }),
      halted: targetHours <= 0,
    };
  }

  let nextState = withPlayActionMode(playState, { force: true });
  let processedHours = 0;

  while (processedHours < targetHours) {
    const activity = getPlayWorldTimeActivity(nextState);
    if (!activity.shouldAdvanceWorldTime) {
      return {
        playState: withPlayActionMode(nextState, { force: true }),
        halted: true,
      };
    }

    const currentJourneyElapsedHours = Number.isFinite(
      nextState?.journeyElapsedHours,
    )
      ? Math.max(0, nextState.journeyElapsedHours)
      : 0;
    const runStats = normalizeRunStats(nextState?.runStats);
    nextState = withPlayActionMode({
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
    }, { force: true });

    nextState = withPlayActionMode(applyHourlyHunger(nextState, 1), { force: true });
    if (activity.isHunting) {
      nextState = withPlayActionMode(
        maybeTriggerHuntRabbitEncounter(nextState, world),
        { force: true },
      );
    }
    if (activity.isResting || activity.isHunting) {
      nextState = withPlayActionMode(
        maybeTriggerWildernessHostileEncounter(nextState, world),
        { force: true },
      );
    }
    if (activity.isTraveling) {
      nextState = withPlayActionMode(applyHourlyTravelStamina(nextState, 1), { force: true });
    }
    if (activity.isResting && nextState?.rest) {
      nextState = withPlayActionMode(advanceRest(nextState, 1), { force: true });
    }
    if (activity.isHunting && nextState?.hunt) {
      nextState = withPlayActionMode(advanceHunt(nextState, world, 1), { force: true });
    }
    nextState = withPlayActionMode(finalizeHourlySurvival(nextState), { force: true });
    nextState = withPlayActionMode(advanceSettlementAgentsOneHour(nextState, world), { force: true });
    if (activity.isTraveling) {
      nextState = withPlayActionMode(
        maybeTriggerTravelEncounter(nextState, world),
        { force: true },
      );
    }

    processedHours += 1;
    if (nextState?.gameOver) {
      return {
        playState: withPlayActionMode(nextState, { force: true }),
        halted: true,
      };
    }
  }

  return {
    playState: withPlayActionMode(nextState, { force: true }),
    halted: false,
  };
}
