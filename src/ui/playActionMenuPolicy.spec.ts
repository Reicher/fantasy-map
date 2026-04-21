import { describe, expect, it } from "vitest";
import {
  canCloseActionMenu,
  isDestinationChoicePending,
  isNonHostileEncounterTurn,
  shouldForceActionMenuOpen,
  shouldKeepActionMenuOpenAfterEncounter,
} from "./playActionMenuPolicy";
import type { PlayState } from "@fardvag/shared/types/play";

function createPlayState(partial: Partial<PlayState> = {}): PlayState {
  return {
    viewMode: "journey",
    currentNodeId: 0,
    ...partial,
  };
}

describe("playActionMenuPolicy", () => {
  it("locks menu open during hostile encounter turn", () => {
    const playState = createPlayState({
      encounter: {
        id: "enc-hostile",
        type: "wolf",
        disposition: "hostile",
        turn: "player",
        round: 1,
        opponentInitiative: 8,
        opponentDamageMin: 3,
        opponentDamageMax: 6,
        opponentMaxHealth: 8,
        opponentHealth: 8,
        opponentMaxStamina: 12,
        opponentStamina: 12,
      },
      pendingJourneyEvent: {
        type: "encounter-turn",
        encounterId: "enc-hostile",
      },
    });

    expect(canCloseActionMenu(playState)).toBe(false);
    expect(shouldForceActionMenuOpen(playState)).toBe(true);
  });

  it("allows closing menu in non-hostile encounter turn", () => {
    const playState = createPlayState({
      encounter: {
        id: "enc-neutral",
        type: "rabbit",
        disposition: "neutral",
        turn: "player",
        round: 1,
        opponentInitiative: 4,
        opponentDamageMin: 1,
        opponentDamageMax: 2,
        opponentMaxHealth: 4,
        opponentHealth: 4,
        opponentMaxStamina: 8,
        opponentStamina: 8,
      },
      pendingJourneyEvent: {
        type: "encounter-turn",
        encounterId: "enc-neutral",
      },
    });

    expect(canCloseActionMenu(playState)).toBe(true);
    expect(shouldForceActionMenuOpen(playState)).toBe(false);
    expect(isNonHostileEncounterTurn(playState)).toBe(true);
  });

  it("detects pending destination choice after flee", () => {
    const playState = createPlayState({
      viewMode: "map",
      pendingJourneyEvent: {
        type: "signpost-directions",
        requiresDestinationChoice: true,
      },
    });

    expect(isDestinationChoicePending(playState)).toBe(true);
    expect(shouldKeepActionMenuOpenAfterEncounter(playState)).toBe(true);
  });

  it("keeps menu open when travel stays paused after encounter", () => {
    const playState = createPlayState({
      travel: {
        startNodeId: 1,
        targetNodeId: 2,
      },
      isTravelPaused: true,
    });

    expect(shouldKeepActionMenuOpenAfterEncounter(playState)).toBe(true);
  });

  it("closes menu after encounter when no follow-up state requires it", () => {
    const playState = createPlayState({
      pendingJourneyEvent: null,
      encounter: null,
      travel: null,
      isTravelPaused: false,
    });

    expect(shouldKeepActionMenuOpenAfterEncounter(playState)).toBe(false);
  });
});
