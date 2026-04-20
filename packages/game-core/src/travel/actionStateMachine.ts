import { toggleTravelPause } from "./pause";
import { beginHunt, cancelHunt } from "./hunt";
import { beginRest, cancelRest } from "./rest";
import { resolveEncounterPlayerAction } from "./encounter";
import {
  getPlayActionMode,
  withPlayActionMode,
} from "./actionMode";
import type { PlayActionMode, PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

export type TravelActionState = PlayActionMode;

export type TravelActionEventType =
  | "TOGGLE_TRAVEL_PAUSE"
  | "START_REST"
  | "START_HUNT"
  | "CANCEL_TIMED_ACTION"
  | "DISMISS_MANUAL_TRAVEL_PAUSE"
  | "DISMISS_HUNT_RESULT"
  | "ENCOUNTER_GREET"
  | "ENCOUNTER_ATTACK"
  | "ENCOUNTER_FLEE";

export type TravelActionEvent =
  | {
      type: "TOGGLE_TRAVEL_PAUSE";
    }
  | {
      type: "START_REST";
      hours: number;
    }
  | {
      type: "START_HUNT";
      hours: number;
    }
  | {
      type: "CANCEL_TIMED_ACTION";
    }
  | {
      type: "DISMISS_MANUAL_TRAVEL_PAUSE";
    }
  | {
      type: "DISMISS_HUNT_RESULT";
    }
  | {
      type: "ENCOUNTER_GREET";
    }
  | {
      type: "ENCOUNTER_ATTACK";
    }
  | {
      type: "ENCOUNTER_FLEE";
    };

interface TravelActionContext {
  world?: World | null;
}

const ALLOWED_EVENT_TYPES_BY_STATE: Record<
  TravelActionState,
  readonly TravelActionEventType[]
> = {
  "game-over": [],
  event: [
    "ENCOUNTER_GREET",
    "ENCOUNTER_ATTACK",
    "ENCOUNTER_FLEE",
    "START_REST",
    "START_HUNT",
  ],
  idle: ["START_REST", "START_HUNT", "DISMISS_HUNT_RESULT"],
  "travel-active": ["TOGGLE_TRAVEL_PAUSE", "DISMISS_HUNT_RESULT"],
  "travel-paused": [
    "TOGGLE_TRAVEL_PAUSE",
    "START_REST",
    "START_HUNT",
    "DISMISS_MANUAL_TRAVEL_PAUSE",
    "DISMISS_HUNT_RESULT",
  ],
  resting: ["CANCEL_TIMED_ACTION", "DISMISS_HUNT_RESULT"],
  hunting: ["CANCEL_TIMED_ACTION"],
};

export function getTravelActionState(
  playState: PlayState | null | undefined,
): TravelActionState {
  return getPlayActionMode(playState);
}

export function isTravelActionEventAllowed(
  state: TravelActionState,
  eventType: TravelActionEventType,
): boolean {
  return ALLOWED_EVENT_TYPES_BY_STATE[state].includes(eventType);
}

export function reduceTravelActionState(
  playState: PlayState | null | undefined,
  event: TravelActionEvent,
  context: TravelActionContext = {},
): PlayState | null | undefined {
  const normalizedPlayState = withPlayActionMode(playState);
  if (!normalizedPlayState) {
    return normalizedPlayState;
  }

  const currentState = getTravelActionState(normalizedPlayState);
  if (!isTravelActionEventAllowed(currentState, event.type)) {
    return normalizedPlayState;
  }

  switch (event.type) {
    case "TOGGLE_TRAVEL_PAUSE":
      return withPlayActionMode(toggleTravelPause(normalizedPlayState));

    case "START_REST":
      return withPlayActionMode(beginRest(normalizedPlayState, event.hours));

    case "START_HUNT":
      if (!context.world) {
        return normalizedPlayState;
      }
      return withPlayActionMode(
        beginHunt(normalizedPlayState, context.world, event.hours),
      );

    case "CANCEL_TIMED_ACTION":
      if (currentState === "hunting") {
        if (!context.world) {
          return normalizedPlayState;
        }
        return withPlayActionMode(cancelHunt(normalizedPlayState, context.world));
      }
      if (currentState === "resting") {
        return withPlayActionMode(cancelRest(normalizedPlayState));
      }
      return normalizedPlayState;

    case "DISMISS_MANUAL_TRAVEL_PAUSE":
      if (
        !normalizedPlayState.travel ||
        !normalizedPlayState.isTravelPaused ||
        normalizedPlayState.travelPauseReason !== "manual" ||
        normalizedPlayState.pendingRestChoice
      ) {
        return normalizedPlayState;
      }
      return withPlayActionMode(toggleTravelPause(normalizedPlayState));

    case "DISMISS_HUNT_RESULT":
      if (normalizedPlayState.latestHuntFeedback?.type !== "result") {
        return normalizedPlayState;
      }
      return withPlayActionMode({
        ...normalizedPlayState,
        latestHuntFeedback: null,
      });

    case "ENCOUNTER_GREET":
      return withPlayActionMode(
        resolveEncounterPlayerAction(normalizedPlayState, "greet"),
      );

    case "ENCOUNTER_ATTACK":
      return withPlayActionMode(
        resolveEncounterPlayerAction(normalizedPlayState, "attack"),
      );

    case "ENCOUNTER_FLEE":
      return withPlayActionMode(
        resolveEncounterPlayerAction(normalizedPlayState, "flee"),
      );

    default:
      return normalizedPlayState;
  }
}
