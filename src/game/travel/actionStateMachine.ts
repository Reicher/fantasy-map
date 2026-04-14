import { toggleTravelPause } from "./pause";
import { beginHunt, cancelHunt } from "./hunt";
import { beginRest, cancelRest } from "./rest";
import type { PlayState } from "../../types/play";
import type { World } from "../../types/world";

export type TravelActionState =
  | "game-over"
  | "idle"
  | "travel-active"
  | "travel-paused"
  | "resting"
  | "hunting";

export type TravelActionEventType =
  | "TOGGLE_TRAVEL_PAUSE"
  | "START_REST"
  | "START_HUNT"
  | "CANCEL_TIMED_ACTION"
  | "DISMISS_MANUAL_TRAVEL_PAUSE"
  | "DISMISS_HUNT_RESULT";

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
    };

interface TravelActionContext {
  world?: World | null;
}

const ALLOWED_EVENT_TYPES_BY_STATE: Record<
  TravelActionState,
  readonly TravelActionEventType[]
> = {
  "game-over": [],
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
  if (playState?.gameOver) {
    return "game-over";
  }
  if (playState?.rest) {
    return "resting";
  }
  if (playState?.hunt) {
    return "hunting";
  }
  if (playState?.travel) {
    return playState.isTravelPaused ? "travel-paused" : "travel-active";
  }
  return "idle";
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
  if (!playState) {
    return playState;
  }

  const currentState = getTravelActionState(playState);
  if (!isTravelActionEventAllowed(currentState, event.type)) {
    return playState;
  }

  switch (event.type) {
    case "TOGGLE_TRAVEL_PAUSE":
      return toggleTravelPause(playState);

    case "START_REST":
      return beginRest(playState, event.hours);

    case "START_HUNT":
      if (!context.world) {
        return playState;
      }
      return beginHunt(playState, context.world, event.hours);

    case "CANCEL_TIMED_ACTION":
      if (currentState === "hunting") {
        if (!context.world) {
          return playState;
        }
        return cancelHunt(playState, context.world);
      }
      if (currentState === "resting") {
        return cancelRest(playState);
      }
      return playState;

    case "DISMISS_MANUAL_TRAVEL_PAUSE":
      if (
        !playState.travel ||
        !playState.isTravelPaused ||
        playState.travelPauseReason !== "manual" ||
        playState.pendingRestChoice
      ) {
        return playState;
      }
      return toggleTravelPause(playState);

    case "DISMISS_HUNT_RESULT":
      if (playState.latestHuntFeedback?.type !== "result") {
        return playState;
      }
      return {
        ...playState,
        latestHuntFeedback: null,
      };

    default:
      return playState;
  }
}
