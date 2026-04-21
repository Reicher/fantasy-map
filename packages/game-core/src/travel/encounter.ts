import {
  consumeInventoryItemsByType,
  countInventoryItemsByType,
} from "../inventory";
import { withPlayActionMode } from "./actionMode";
import {
  normalizeStaminaValue,
} from "./normalizers";
import {
  resolveEffectiveWeaponAccuracy,
  worsenPlayerInjuryStatus,
} from "./playerStatus";
import { snapshotRunStats } from "./runStats";
import { normalizeTimeOfDayHours } from "../timeOfDay";
import { createRng } from "@fardvag/shared/random";
import type {
  PlayEncounterOpponentMember,
  PlayEncounterState,
  PlayEncounterType,
  PlayJourneyEvent,
  PlayState,
} from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

type EncounterPlayerAction = "greet" | "attack" | "flee";

interface EncounterDefinition {
  type: PlayEncounterType;
  label: string;
  weight: number;
  disposition: "friendly" | "neutral" | "hostile";
  initiative: number;
  damageMin: number;
  damageMax: number;
  maxHealth: number;
  maxStamina: number;
  lootMeatMin: number;
  lootMeatMax: number;
}

const ENCOUNTER_CHANCE_PER_TRAVEL_HOUR = 0.4;
const ENCOUNTER_CHANCE_PER_WILDERNESS_ACTION_HOUR = 0.25;
const ENCOUNTER_WILDERNESS_REST_NIGHT_MULTIPLIER = 1.6;
const ENCOUNTER_WILDERNESS_REST_DAY_MULTIPLIER = 0.65;
const ENCOUNTER_TRAVEL_WOLF_WEIGHT_NIGHT_MULTIPLIER = 1.75;
const ENCOUNTER_TRAVEL_WOLF_WEIGHT_DAY_MULTIPLIER = 0.7;
const ENCOUNTER_TRAVEL_RABBIT_WEIGHT_NIGHT_MULTIPLIER = 0.72;
const ENCOUNTER_TRAVEL_RABBIT_WEIGHT_DAY_MULTIPLIER = 1.45;
const ENCOUNTER_CHANCE_PER_HUNT_RABBIT_HOUR = 0.35;
const ENCOUNTER_HUNT_RABBIT_BONUS_OVER_TRAVEL_BASE = 0.08;
const ENCOUNTER_LOOT_COLUMNS = 4;
const ENCOUNTER_LOOT_ROWS = 4;
const ENCOUNTER_APPROACH_DISTANCE_WORLD = 18;
const ENCOUNTER_MIN_APPROACH_WORLD = 6;
const ENCOUNTER_ENDPOINT_SAFE_DISTANCE_WORLD = 4.5;
const ENCOUNTER_NIGHT_START_HOUR = 20;
const ENCOUNTER_NIGHT_END_HOUR = 6;
const HOSTILE_FLEE_BASE_SUCCESS_CHANCE = 0.2;
const ENCOUNTER_DEFINITIONS: readonly EncounterDefinition[] = Object.freeze([
  Object.freeze({
    type: "rabbit",
    label: "kanin",
    weight: 0.55,
    disposition: "neutral",
    initiative: 4,
    damageMin: 1,
    damageMax: 2,
    maxHealth: 4,
    maxStamina: 14,
    lootMeatMin: 1,
    lootMeatMax: 2,
  }),
  Object.freeze({
    type: "wolf",
    label: "varg",
    weight: 0.45,
    disposition: "hostile",
    initiative: 9,
    damageMin: 4,
    damageMax: 8,
    maxHealth: 12,
    maxStamina: 20,
    lootMeatMin: 2,
    lootMeatMax: 4,
  }),
  Object.freeze({
    type: "settlement-group",
    label: "gruppen",
    weight: 0,
    disposition: "friendly",
    initiative: 7,
    damageMin: 2,
    damageMax: 5,
    maxHealth: 14,
    maxStamina: 14,
    lootMeatMin: 1,
    lootMeatMax: 3,
  }),
]);

export function maybeTriggerTravelEncounter(
  playState: PlayStateLike,
  world,
): PlayStateLike {
  if (!playState || playState.gameOver || !canTriggerEncounter(playState)) {
    return withPlayActionMode(playState);
  }
  if (isSeaRouteTravel(playState)) {
    return withPlayActionMode(playState);
  }

  const encounterSeed = buildEncounterTriggerSeed(playState, world);
  const rng = createRng(encounterSeed);
  if (!rng.chance(ENCOUNTER_CHANCE_PER_TRAVEL_HOUR)) {
    return withPlayActionMode(playState);
  }

  const definition = rng.weighted(ENCOUNTER_DEFINITIONS, (entry) =>
    resolveTravelEncounterWeight(entry, playState),
  );
  const encounter = createEncounterFromDefinition(playState, rng, definition, {
    entryStyle: "travel-static",
  });

  const startedState = {
    ...playState,
    encounter: null,
    pendingJourneyEvent: null,
    latestEncounterResolution: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
  };
  const currentProgress = Number.isFinite(playState.travel?.progress)
    ? Math.max(0, Number(playState.travel.progress))
    : 0;
  const totalLength = Number.isFinite(playState.travel?.totalLength)
    ? Math.max(0, Number(playState.travel.totalLength))
    : 0;
  const targetTravelProgress = resolveEncounterTargetTravelProgress(
    playState,
    world,
    rng,
    currentProgress,
    totalLength,
  );
  const canApproach =
    targetTravelProgress != null &&
    targetTravelProgress - currentProgress >= ENCOUNTER_MIN_APPROACH_WORLD;

  if (!canApproach) {
    return withPlayActionMode(playState);
  }

  return withPlayActionMode({
    ...startedState,
    encounter: {
      ...encounter,
      entryStyle: "travel-static",
      phase: "approaching",
      targetTravelProgress,
    },
  });
}

export function maybeTriggerWildernessHostileEncounter(
  playState: PlayStateLike,
  world,
): PlayStateLike {
  if (!playState || playState.gameOver) {
    return withPlayActionMode(playState);
  }
  const hasTimedAction = Boolean(playState.rest || playState.hunt);
  const isInWilderness = Boolean(playState.travel);
  if (
    !hasTimedAction ||
    !isInWilderness ||
    playState.pendingJourneyEvent ||
    playState.encounter
  ) {
    return withPlayActionMode(playState);
  }
  if (isSeaRouteTravel(playState)) {
    return withPlayActionMode(playState);
  }

  const worldSeed = String(world?.params?.seed ?? "seed");
  const modeLabel = playState.hunt ? "hunt" : "rest";
  const hourIndex = normalizeWorldHour(playState.journeyElapsedHours);
  const rng = createRng(
    `${worldSeed}:wilderness-hostile-encounter:${modeLabel}:${hourIndex}`,
  );
  const hostileEncounterChance = resolveWildernessHostileEncounterChance(playState);
  if (!rng.chance(hostileEncounterChance)) {
    return withPlayActionMode(playState);
  }

  const wolfDefinition = getEncounterDefinition("wolf");
  const encounter = createEncounterFromDefinition(playState, rng, wolfDefinition, {
    entryStyle: "slide-right",
  });

  return withPlayActionMode(
    activateEncounter(
      {
        ...playState,
        rest: playState.rest
          ? {
              ...playState.rest,
              stopAtNextWholeHour: true,
            }
          : playState.rest,
        encounter: {
          ...encounter,
          entryStyle: "slide-right",
          phase: "active",
          targetTravelProgress: Number.isFinite(playState.travel?.progress)
            ? Number(playState.travel.progress)
            : 0,
        },
        pendingJourneyEvent: null,
        isTravelPaused: true,
        travelPauseReason: "encounter",
      },
      "En varg kastar sig fram ur vildmarken.",
    ),
  );
}

export function maybeTriggerHuntRabbitEncounter(
  playState: PlayStateLike,
  world,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.hunt) {
    return withPlayActionMode(playState);
  }
  if (playState.pendingJourneyEvent || playState.encounter) {
    return withPlayActionMode(playState);
  }
  if (isSeaRouteTravel(playState)) {
    return withPlayActionMode(playState);
  }

  const worldSeed = String(world?.params?.seed ?? "seed");
  const runId = Number.isFinite(playState.hunt.runId)
    ? Math.max(0, Math.floor(Number(playState.hunt.runId)))
    : 0;
  const rabbitTravelBaseChance =
    ENCOUNTER_CHANCE_PER_TRAVEL_HOUR * getEncounterDefinition("rabbit").weight;
  const rabbitHuntEncounterChance = clamp01(
    Math.max(
      ENCOUNTER_CHANCE_PER_HUNT_RABBIT_HOUR,
      rabbitTravelBaseChance + ENCOUNTER_HUNT_RABBIT_BONUS_OVER_TRAVEL_BASE,
    ),
  );
  const hourIndex = normalizeWorldHour(playState.journeyElapsedHours);
  const rng = createRng(
    `${worldSeed}:hunt-rabbit-encounter:${runId}:${hourIndex}`,
  );
  if (!rng.chance(rabbitHuntEncounterChance)) {
    return withPlayActionMode(playState);
  }

  const rabbitDefinition = getEncounterDefinition("rabbit");
  const encounter = createEncounterFromDefinition(playState, rng, rabbitDefinition, {
    entryStyle: "slide-right",
  });

  return withPlayActionMode(
    activateEncounter(
      {
        ...playState,
        encounter: {
          ...encounter,
          entryStyle: "slide-right",
          phase: "active",
          targetTravelProgress: Number.isFinite(playState.travel?.progress)
            ? Number(playState.travel.progress)
            : 0,
        },
        pendingJourneyEvent: null,
        isTravelPaused: Boolean(playState.travel),
        travelPauseReason: "encounter",
      },
      "En kanin hoppar fram ur snåren.",
    ),
  );
}

export function maybeActivateEncounterFromTravelProgress(
  playState: PlayStateLike,
): PlayStateLike {
  if (!playState || !playState.travel || !playState.encounter) {
    return withPlayActionMode(playState);
  }
  if (playState.encounter.phase !== "approaching") {
    return withPlayActionMode(playState);
  }
  const targetProgress = Number(playState.encounter.targetTravelProgress);
  const currentProgress = Number(playState.travel.progress);
  if (
    !Number.isFinite(targetProgress) ||
    !Number.isFinite(currentProgress) ||
    currentProgress + 1e-6 < targetProgress
  ) {
    return withPlayActionMode(playState);
  }
  const label = getEncounterLabel(playState.encounter.type);
  return withPlayActionMode(
    activateEncounter(
      {
        ...playState,
        encounter: {
          ...playState.encounter,
          phase: "active",
          targetTravelProgress: targetProgress,
        },
      },
      `En ${label} står i vägen.`,
    ),
  );
}

export function resolveEncounterPlayerAction(
  playState: PlayStateLike,
  action: EncounterPlayerAction,
): PlayStateLike {
  if (
    !playState ||
    playState.gameOver ||
    !playState.encounter ||
    playState.encounter.turn !== "player"
  ) {
    return withPlayActionMode(playState);
  }

  switch (action) {
    case "greet":
      return withPlayActionMode(
        handlePlayerGreet(playState, playState.encounter),
      );
    case "attack":
      return withPlayActionMode(
        handlePlayerAttack(playState, playState.encounter),
      );
    case "flee":
      return withPlayActionMode(
        handlePlayerFlee(playState, playState.encounter),
      );
    default:
      return withPlayActionMode(playState);
  }
}

function createEncounterFromDefinition(
  playState: PlayState,
  rng: ReturnType<typeof createRng>,
  definition: EncounterDefinition,
  options: { entryStyle?: "travel-static" | "slide-right" } = {},
): PlayEncounterState {
  const hourIndex = normalizeWorldHour(playState.journeyElapsedHours);
  const encounterId = `encounter-${hourIndex}-${rng.int(100, 999)}`;
  const playerInitiative = Number.isFinite(playState.initiative)
    ? Math.max(0, Math.floor(Number(playState.initiative)))
    : 0;
  return {
    id: encounterId,
    type: definition.type,
    disposition: definition.disposition,
    turn: definition.initiative > playerInitiative ? "opponent" : "player",
    entryStyle: options.entryStyle ?? "travel-static",
    round: 1,
    rollIndex: 0,
    opponentInitiative: definition.initiative,
    opponentDamageMin: definition.damageMin,
    opponentDamageMax: definition.damageMax,
    opponentMaxHealth: definition.maxHealth,
    opponentHealth: definition.maxHealth,
    opponentMaxStamina: definition.maxStamina,
    opponentStamina: definition.maxStamina,
  };
}

function canTriggerEncounter(playState: PlayState): boolean {
  return Boolean(
    playState.travel &&
      !playState.isTravelPaused &&
      !playState.rest &&
      !playState.hunt &&
      !playState.pendingJourneyEvent &&
      !playState.encounter,
  );
}

function isSeaRouteTravel(playState: PlayState): boolean {
  return (playState.travel?.routeType ?? "road") === "sea-route";
}

function buildEncounterTriggerSeed(playState: PlayState, world): string {
  const worldSeed = String(world?.params?.seed ?? "seed");
  const hourIndex = normalizeWorldHour(playState.journeyElapsedHours);
  const startNodeId = playState.travel?.startNodeId ?? "x";
  const targetNodeId = playState.travel?.targetNodeId ?? "x";
  return `${worldSeed}:journey-encounter:${hourIndex}:${startNodeId}:${targetNodeId}`;
}

function resolveEncounterTargetTravelProgress(
  playState: PlayState,
  world,
  rng: ReturnType<typeof createRng>,
  currentProgress: number,
  totalLength: number,
): number | null {
  if (!Number.isFinite(currentProgress) || !Number.isFinite(totalLength)) {
    return null;
  }
  const safeCurrent = Math.max(0, currentProgress);
  const safeTotal = Math.max(0, totalLength);
  if (safeTotal <= safeCurrent + ENCOUNTER_MIN_APPROACH_WORLD) {
    return null;
  }
  const minProgress = safeCurrent + ENCOUNTER_MIN_APPROACH_WORLD;
  const maxProgress = safeTotal - ENCOUNTER_MIN_APPROACH_WORLD;
  if (maxProgress <= minProgress) {
    return null;
  }

  const preferredTarget = clampValue(
    safeCurrent + ENCOUNTER_APPROACH_DISTANCE_WORLD,
    minProgress,
    maxProgress,
  );
  const candidates = [preferredTarget];
  for (let index = 0; index < 5; index += 1) {
    candidates.push(rng.range(minProgress, maxProgress));
  }

  for (const candidate of candidates) {
    if (!isEncounterProgressSafeFromNodes(playState, world, candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

function isEncounterProgressSafeFromNodes(
  playState: PlayState,
  _world,
  travelProgress: number,
): boolean {
  const travel = playState.travel;
  if (!travel || !Number.isFinite(travelProgress)) {
    return false;
  }
  const safeTotal = Number.isFinite(travel.totalLength)
    ? Math.max(0, Number(travel.totalLength))
    : 0;
  if (safeTotal <= 0) {
    return false;
  }
  const clampedProgress = clampValue(travelProgress, 0, safeTotal);
  const distanceFromStart = clampedProgress;
  const distanceFromDestination = safeTotal - clampedProgress;
  return (
    distanceFromStart >= ENCOUNTER_ENDPOINT_SAFE_DISTANCE_WORLD &&
    distanceFromDestination >= ENCOUNTER_ENDPOINT_SAFE_DISTANCE_WORLD
  );
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value <= min) {
    return min;
  }
  if (value >= max) {
    return max;
  }
  return value;
}

function normalizeWorldHour(value: unknown): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function handlePlayerGreet(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  const lines = ["Du hälsar."];
  const nextEncounter: PlayEncounterState = {
    ...encounter,
    turn: "opponent",
  };
  return advanceEncounterUntilPlayerTurn(
    {
      ...playState,
      encounter: nextEncounter,
    },
    lines,
  );
}

function handlePlayerAttack(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  const bulletsBefore = countInventoryItemsByType(playState.inventory, "bullets");
  const usesStone = bulletsBefore <= 0;
  const consumedAmmo = usesStone
    ? {
        inventory: playState.inventory,
      }
    : consumeInventoryItemsByType(
        playState.inventory,
        "bullets",
        1,
      );
  let nextEncounter: PlayEncounterState = {
    ...encounter,
  };
  if (nextEncounter.type === "rabbit") {
    nextEncounter.disposition = "fleeing";
  } else if (nextEncounter.type === "settlement-group") {
    nextEncounter.disposition = "hostile";
  }

  if (nextEncounter.type === "settlement-group") {
    const aliveMembers = getAliveSettlementMembers(nextEncounter);
    if (aliveMembers.length <= 0) {
      return finishEncounterWithOpponentDefeat(
        {
          ...playState,
          inventory: consumedAmmo.inventory,
        },
        nextEncounter,
        ["Du attackerar."],
      );
    }
  }

  const effectiveAccuracy = clamp01(
    resolveEffectiveWeaponAccuracy(
      playState.vapenTraffsakerhet,
      playState.injuryStatus,
    ) / 100,
  );
  const accuracy = usesStone ? effectiveAccuracy * 0.25 : effectiveAccuracy;
  const hitRoll = rollEncounterChance(
    nextEncounter,
    usesStone ? "player-stone-hit" : "player-attack-hit",
    accuracy,
  );
  nextEncounter = hitRoll.encounter;
  const lines = [usesStone ? "Du attackerar med en sten." : "Du attackerar."];

  if (!hitRoll.success) {
    lines.push(usesStone ? "Stenen missar." : "Skottet missar.");
    return advanceEncounterUntilPlayerTurn(
      {
        ...playState,
        inventory: consumedAmmo.inventory,
        encounter: {
          ...nextEncounter,
          turn: "opponent",
        },
      },
      lines,
    );
  }

  let syncedSettlementState: PlayState = {
    ...playState,
    inventory: consumedAmmo.inventory,
  };
  if (nextEncounter.type === "settlement-group") {
    const settlementDamage = defeatSettlementMember(nextEncounter);
    nextEncounter = settlementDamage.encounter;
    syncedSettlementState = syncSettlementStateFromEncounter(
      syncedSettlementState,
      nextEncounter,
    );
    const targetName = settlementDamage.targetName ?? "Målet";
    lines.push(
      usesStone
        ? `Stenen träffar. ${targetName} faller direkt.`
        : `Träff. ${targetName} faller direkt.`,
    );
    if (nextEncounter.opponentHealth <= 0) {
      return finishEncounterWithOpponentDefeat(
        syncedSettlementState,
        {
          ...nextEncounter,
          opponentHealth: 0,
        },
        lines,
      );
    }
    return advanceEncounterUntilPlayerTurn(
      {
        ...syncedSettlementState,
        encounter: {
          ...nextEncounter,
          turn: "opponent",
        },
      },
      lines,
    );
  } else {
    lines.push(
      usesStone
        ? "Stenen träffar. Motståndaren dör direkt."
        : "Träff. Motståndaren dör direkt.",
    );
    return finishEncounterWithOpponentDefeat(
      syncedSettlementState,
      {
        ...nextEncounter,
        opponentHealth: 0,
      },
      lines,
    );
  }
}

function handlePlayerFlee(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  if (encounter.disposition !== "hostile") {
    return finishEncounterWithFleeOutcome(playState, encounter, "player-fled");
  }
  const playerStamina = normalizePlayerStamina(playState);
  const opponentStamina = normalizeOpponentStamina(encounter);
  if (playerStamina > opponentStamina) {
    return finishEncounterWithFleeOutcome(playState, encounter, "player-fled");
  }
  const fleeRoll = rollEncounterChance(
    encounter,
    "player-flee-hostile-base",
    HOSTILE_FLEE_BASE_SUCCESS_CHANCE,
  );
  if (fleeRoll.success) {
    return finishEncounterWithFleeOutcome(
      {
        ...playState,
        encounter: fleeRoll.encounter,
      },
      fleeRoll.encounter,
      "player-fled",
    );
  }

  return advanceEncounterUntilPlayerTurn(
    {
      ...playState,
      encounter: {
        ...fleeRoll.encounter,
        turn: "opponent",
      },
    },
    ["Du försöker fly men misslyckas."],
  );
}

function advanceEncounterUntilPlayerTurn(
  playState: PlayState,
  initialLines: string[] = [],
): PlayState {
  let nextState = playState;
  const lines = [...initialLines];
  let guard = 0;
  while (nextState.encounter && nextState.encounter.turn === "opponent" && guard < 4) {
    const result = resolveOpponentTurn(nextState);
    nextState = result.playState;
    if (result.message) {
      lines.push(result.message);
    }
    guard += 1;
  }

  if (!nextState.encounter || nextState.gameOver) {
    return nextState;
  }
  return withEncounterTurnEvent(nextState, lines);
}

function activateEncounter(
  playState: PlayState,
  introMessage: string,
): PlayState {
  if (!playState.encounter) {
    return playState;
  }
  const activeEncounter: PlayEncounterState = {
    ...playState.encounter,
    phase: "active",
  };
  return advanceEncounterUntilPlayerTurn(
    {
      ...playState,
      encounter: activeEncounter,
      pendingJourneyEvent: null,
      isTravelPaused: Boolean(playState.travel),
      travelPauseReason: playState.travel ? "encounter" : playState.travelPauseReason,
    },
    [introMessage],
  );
}

function resolveOpponentTurn(
  playState: PlayState,
): { playState: PlayState; message: string | null } {
  const encounter = playState.encounter;
  if (!encounter) {
    return { playState, message: null };
  }
  const opponentLabel = getEncounterDisplayLabel(encounter);

  if (encounter.disposition === "hostile") {
    if (encounter.type === "settlement-group") {
      return resolveSettlementHostileVolley(playState, encounter);
    }
    const attackerPick = pickHostileAttacker(encounter);
    const attackerName = attackerPick.attacker?.name ?? null;
    const nextEncounter = attackerPick.encounter;
    const injuryOutcome = worsenPlayerInjuryStatus(playState.injuryStatus);
    if (injuryOutcome.causesDeath) {
      return {
        playState: finishEncounterWithPlayerDefeat(
          playState,
          nextEncounter,
          {
            attackerName,
          },
        ),
        message: `${capitalize(attackerName ?? opponentLabel)} träffar dig igen. Dina skador blir dödliga.`,
      };
    }
    const injuryStatus = injuryOutcome.nextStatus;
    const statusLabel = describeInjuryStatus(injuryStatus);
    return {
      playState: {
        ...playState,
        injuryStatus,
        encounter: {
          ...nextEncounter,
          turn: "player",
          round: encounter.round + 1,
        },
      },
      message: `${capitalize(attackerName ?? opponentLabel)} träffar dig. Du är nu ${statusLabel}.`,
    };
  }

  if (encounter.disposition === "fleeing") {
    const opponentStamina = normalizeOpponentStamina(encounter);
    const playerStamina = normalizePlayerStamina(playState);
    if (opponentStamina > playerStamina) {
      return {
        playState: finishEncounterWithFleeOutcome(
          playState,
          encounter,
          "opponent-fled",
        ),
        message: `${capitalize(opponentLabel)} flyr.`,
      };
    }
    return {
      playState: {
        ...playState,
        encounter: {
          ...encounter,
          turn: "player",
          round: encounter.round + 1,
        },
      },
      message: `${capitalize(opponentLabel)} försöker fly men misslyckas.`,
    };
  }

  return {
    playState: {
      ...playState,
      encounter: {
        ...encounter,
        turn: "player",
        round: encounter.round + 1,
      },
    },
    message: encounter.type === "settlement-group"
      ? "Bosättarna svarar: hej."
      : `${capitalize(opponentLabel)} svarar: ${getNonHostileGreetingReply(encounter)}`,
  };
}

function resolveSettlementHostileVolley(
  playState: PlayState,
  encounter: PlayEncounterState,
): { playState: PlayState; message: string | null } {
  const aliveMembers = getAliveSettlementMembers(encounter);
  if (aliveMembers.length <= 0) {
    return {
      playState: {
        ...playState,
        encounter: {
          ...encounter,
          turn: "player",
          round: encounter.round + 1,
        },
      },
      message: null,
    };
  }

  let nextEncounter = encounter;
  let nextInjuryStatus = playState.injuryStatus;
  const lines: string[] = [];
  const remainingAttackers = [...aliveMembers];

  while (remainingAttackers.length > 0) {
    const attackerRoll = rollEncounterInt(
      nextEncounter,
      "opponent-attacker-index",
      0,
      remainingAttackers.length - 1,
    );
    nextEncounter = attackerRoll.encounter;
    const attacker =
      remainingAttackers.splice(attackerRoll.value, 1)[0] ?? remainingAttackers.pop();
    if (!attacker) {
      continue;
    }
    nextEncounter = {
      ...nextEncounter,
      activeOpponentMemberId: attacker.id,
    };

    const injuryOutcome = worsenPlayerInjuryStatus(nextInjuryStatus);
    const attackerName = String(attacker.name ?? "").trim() || "En bosättare";
    if (injuryOutcome.causesDeath) {
      lines.push(`${capitalize(attackerName)} träffar dig igen. Dina skador blir dödliga.`);
      return {
        playState: finishEncounterWithPlayerDefeat(
          {
            ...playState,
            injuryStatus: nextInjuryStatus,
          },
          nextEncounter,
          {
            attackerName,
          },
        ),
        message: lines.join("\n"),
      };
    }
    nextInjuryStatus = injuryOutcome.nextStatus;
    lines.push(
      `${capitalize(attackerName)} träffar dig. Du är nu ${describeInjuryStatus(nextInjuryStatus)}.`,
    );
  }

  return {
    playState: {
      ...playState,
      injuryStatus: nextInjuryStatus,
      encounter: {
        ...nextEncounter,
        turn: "player",
        round: encounter.round + 1,
      },
    },
    message: lines.join("\n"),
  };
}

function finishEncounterWithOpponentDefeat(
  playState: PlayState,
  encounter: PlayEncounterState,
  lines: string[],
): PlayState {
  const syncedPlayState = syncSettlementStateFromEncounter(playState, encounter);
  const definition = getEncounterDefinition(encounter.type);
  const lootInventory = createEncounterLootInventory(encounter, definition);
  const defeatedLine = encounter.type === "settlement-group"
    ? "Gruppen är besegrad."
    : `${capitalize(definition.label)} dör.`;
  const message = `${lines.join(" ")} ${defeatedLine} Du kan ta bytet.`;
  const event: PlayJourneyEvent = {
    type: "encounter-loot",
    encounterId: encounter.id,
    message,
    requiresAcknowledgement: false,
    inventory: lootInventory,
  };
  return {
    ...syncedPlayState,
    encounter: null,
    latestEncounterResolution: {
      encounterId: encounter.id,
      type: encounter.type,
      outcome: "opponent-died",
    },
    pendingJourneyEvent: event,
    isTravelPaused: Boolean(syncedPlayState.travel),
    travelPauseReason: resolvePostEncounterPauseReason(syncedPlayState),
  };
}

function finishEncounterWithPlayerDefeat(
  playState: PlayState,
  encounter: PlayEncounterState,
  options: {
    attackerName?: string | null;
  } = {},
): PlayState {
  const label = getEncounterLabel(encounter.type);
  const attackerName = String(options.attackerName ?? "").trim();
  const settlementName = String(encounter.settlementName ?? "").trim();
  const message = attackerName
    ? settlementName.length > 0
      ? `Du dödades av ${attackerName} från ${settlementName}.`
      : `Du dödades av ${attackerName}.`
    : `Du dödades av en ${label}.`;
  return {
    ...playState,
    injuryStatus: "severely-injured",
    travel: null,
    pendingJourneyEvent: null,
    encounter: null,
    latestEncounterResolution: {
      encounterId: encounter.id,
      type: encounter.type,
      outcome: "player-died",
    },
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    hoveredNodeId: null,
    pressedNodeId: null,
    gameOver: {
      reason: "slain",
      message,
      stats: snapshotRunStats(playState.runStats),
    },
  };
}

function finishEncounterWithFleeOutcome(
  playState: PlayState,
  encounter: PlayEncounterState,
  outcome: "player-fled" | "opponent-fled",
): PlayState {
  const forceDestinationChoice =
    outcome === "player-fled" && encounter.type === "settlement-group";
  const fleeDestinationEvent = forceDestinationChoice
    ? createSettlementFleeDestinationEvent(playState, encounter)
    : null;
  const shouldStayPaused = Boolean(playState.travel);
  const pausedReason = resolvePostEncounterPauseReason(playState);
  return {
    ...playState,
    viewMode: forceDestinationChoice ? "map" : playState.viewMode,
    encounter: null,
    latestEncounterResolution: {
      encounterId: encounter.id,
      type: encounter.type,
      outcome,
      targetTravelProgress: Number.isFinite(encounter.targetTravelProgress)
        ? Number(encounter.targetTravelProgress)
        : Number.isFinite(playState.travel?.progress)
          ? Number(playState.travel.progress)
          : undefined,
    },
    pendingJourneyEvent: fleeDestinationEvent,
    isTravelPaused: shouldStayPaused ? true : playState.isTravelPaused,
    travelPauseReason: shouldStayPaused ? pausedReason : playState.travelPauseReason,
    hoveredNodeId: null,
    pressedNodeId: null,
  };
}

function withEncounterTurnEvent(
  playState: PlayState,
  lines: string[],
): PlayState {
  const encounter = playState.encounter;
  if (!encounter) {
    return playState;
  }
  const normalizedLines = lines
    .map((line) => String(line ?? "").trim())
    .filter((line) => line.length > 0);
  return {
    ...playState,
    pendingJourneyEvent: {
      type: "encounter-turn",
      encounterId: encounter.id,
      message: normalizedLines.join("\n"),
      requiresAcknowledgement: true,
      canAttack: true,
    },
    isTravelPaused: playState.travel ? true : playState.isTravelPaused,
    travelPauseReason: playState.travel ? "encounter" : playState.travelPauseReason,
  };
}

function resolvePostEncounterPauseReason(playState: PlayState): "manual" | "exhausted" | "resting" | "hunting" | "encounter" | null {
  if (playState.travel) {
    if (playState.rest) {
      return "resting";
    }
    if (playState.hunt) {
      return "hunting";
    }
    return "encounter";
  }
  return playState.travelPauseReason ?? null;
}

function syncSettlementStateFromEncounter(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  if (encounter.type !== "settlement-group") {
    return playState;
  }
  if (!Number.isFinite(encounter.settlementId)) {
    return playState;
  }
  if (!Array.isArray(encounter.opponentMembers) || encounter.opponentMembers.length <= 0) {
    return playState;
  }
  const settlementStates = playState.settlementStates;
  if (!settlementStates) {
    return playState;
  }
  const settlementId = Number(encounter.settlementId);
  const settlementKey = String(settlementId);
  const settlementState = settlementStates[settlementKey];
  if (!settlementState || !Array.isArray(settlementState.agents)) {
    return playState;
  }

  const membersById = new Map<string, PlayEncounterOpponentMember>();
  for (const member of encounter.opponentMembers) {
    if (!member?.id) {
      continue;
    }
    membersById.set(String(member.id), member);
  }
  if (membersById.size <= 0) {
    return playState;
  }

  let changed = false;
  const nextAgents = settlementState.agents.map((agent) => {
    const agentId = String(agent?.id ?? "");
    const member = membersById.get(agentId);
    if (!member || !agent) {
      return agent;
    }
    const nextMaxHealth = Math.max(
      1,
      Math.floor(Number(member.maxHealth ?? agent.maxHealth ?? 1)),
    );
    const nextHealth = Math.max(
      0,
      Math.min(
        nextMaxHealth,
        Math.floor(Number(member.health ?? agent.health ?? nextMaxHealth)),
      ),
    );
    const nextMaxStamina = Math.max(
      1,
      Math.floor(Number(member.maxStamina ?? agent.maxStamina ?? 1)),
    );
    const nextStamina = Math.max(
      0,
      Math.min(
        nextMaxStamina,
        Math.floor(Number(member.stamina ?? agent.stamina ?? nextMaxStamina)),
      ),
    );
    if (
      Number(agent.maxHealth) === nextMaxHealth &&
      Number(agent.health) === nextHealth &&
      Number(agent.maxStamina) === nextMaxStamina &&
      Number(agent.stamina) === nextStamina
    ) {
      return agent;
    }
    changed = true;
    return {
      ...agent,
      maxHealth: nextMaxHealth,
      health: nextHealth,
      maxStamina: nextMaxStamina,
      stamina: nextStamina,
    };
  });

  if (!changed) {
    return playState;
  }

  return {
    ...playState,
    settlementStates: {
      ...settlementStates,
      [settlementKey]: {
        ...settlementState,
        agents: nextAgents,
      },
    },
  };
}

function normalizePlayerStamina(playState: PlayState): number {
  return normalizeStaminaValue(playState.stamina, playState.maxStamina);
}

function normalizeOpponentStamina(encounter: PlayEncounterState): number {
  if (encounter.type === "settlement-group") {
    const aliveMembers = getAliveSettlementMembers(encounter);
    if (aliveMembers.length > 0) {
      const averageStamina =
        aliveMembers.reduce((sum, member) => sum + member.stamina, 0) /
        aliveMembers.length;
      const averageMaxStamina =
        aliveMembers.reduce((sum, member) => sum + member.maxStamina, 0) /
        aliveMembers.length;
      return normalizeStaminaValue(averageStamina, averageMaxStamina);
    }
  }
  return normalizeStaminaValue(
    encounter.opponentStamina,
    encounter.opponentMaxStamina,
  );
}

function createSettlementFleeDestinationEvent(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayJourneyEvent | null {
  const currentNodeId = Number.isFinite(playState.currentNodeId)
    ? Number(playState.currentNodeId)
    : null;
  const neighborNodeIds = currentNodeId == null
    ? []
    : [...(playState.graph?.get(currentNodeId)?.keys() ?? [])].filter((nodeId) =>
        Number.isFinite(nodeId),
      );
  if (neighborNodeIds.length <= 0) {
    return null;
  }
  const settlementName = String(encounter.settlementName ?? "").trim();
  const message = settlementName.length > 0
    ? `Du flyr från ${settlementName}. Välj en destination på kartan.`
    : "Du flyr från bosättningen. Välj en destination på kartan.";
  return {
    type: "signpost-directions",
    nodeId: currentNodeId,
    message,
    requiresAcknowledgement: true,
    neighborNodeIds,
    requiresDestinationChoice: true,
  };
}

function getAliveSettlementMembers(
  encounter: PlayEncounterState,
): PlayEncounterOpponentMember[] {
  if (!Array.isArray(encounter.opponentMembers)) {
    return [];
  }
  return encounter.opponentMembers.filter((member) =>
    normalizeEncounterMemberHealth(member) > 0,
  );
}

function normalizeEncounterMemberHealth(member: PlayEncounterOpponentMember): number {
  const maxHealth = Math.max(1, Math.floor(Number(member?.maxHealth ?? 1)));
  const health = Math.floor(Number(member?.health ?? 0));
  return Math.max(0, Math.min(maxHealth, Number.isFinite(health) ? health : 0));
}

function normalizeEncounterMemberStamina(member: PlayEncounterOpponentMember): number {
  const maxStamina = Math.max(1, Math.floor(Number(member?.maxStamina ?? 1)));
  const stamina = Math.floor(Number(member?.stamina ?? 0));
  return Math.max(0, Math.min(maxStamina, Number.isFinite(stamina) ? stamina : 0));
}

function normalizeEncounterMemberDamage(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(1, Math.floor(fallback));
  }
  return Math.max(1, Math.floor(numeric));
}

function recalculateSettlementEncounter(
  encounter: PlayEncounterState,
  members: PlayEncounterOpponentMember[],
): PlayEncounterState {
  const normalizedMembers = members.map((member) => {
    const damageMin = normalizeEncounterMemberDamage(member.damageMin, 1);
    const damageMax = Math.max(
      damageMin,
      normalizeEncounterMemberDamage(member.damageMax, damageMin),
    );
    const maxHealth = Math.max(1, Math.floor(Number(member.maxHealth ?? 1)));
    return {
      ...member,
      damageMin,
      damageMax,
      maxHealth,
      health: normalizeEncounterMemberHealth({
        ...member,
        maxHealth,
      }),
      maxStamina: Math.max(1, Math.floor(Number(member.maxStamina ?? 1))),
      stamina: normalizeEncounterMemberStamina(member),
    };
  });
  const aliveMembers = normalizedMembers.filter((member) => member.health > 0);
  const memberCount = Math.max(1, aliveMembers.length);
  const totalMaxHealth = normalizedMembers.reduce(
    (sum, member) => sum + member.maxHealth,
    0,
  );
  const totalHealth = normalizedMembers.reduce((sum, member) => sum + member.health, 0);
  const averageMaxStamina = aliveMembers.length > 0
    ? Math.max(
        1,
        Math.floor(
          aliveMembers.reduce((sum, member) => sum + member.maxStamina, 0) / memberCount,
        ),
      )
    : 1;
  const averageStamina = aliveMembers.length > 0
    ? Math.max(
        0,
        Math.floor(
          aliveMembers.reduce((sum, member) => sum + member.stamina, 0) / memberCount,
        ),
      )
    : 0;
  const averageDamageMin = aliveMembers.length > 0
    ? Math.max(
        1,
        Math.floor(
          aliveMembers.reduce((sum, member) => sum + member.damageMin, 0) / memberCount,
        ),
      )
    : encounter.opponentDamageMin;
  const averageDamageMax = aliveMembers.length > 0
    ? Math.max(
        averageDamageMin,
        Math.ceil(
          aliveMembers.reduce((sum, member) => sum + member.damageMax, 0) / memberCount,
        ),
      )
    : Math.max(averageDamageMin, encounter.opponentDamageMax);
  const activeMemberStillAlive = aliveMembers.some(
    (member) => member.id === encounter.activeOpponentMemberId,
  );
  const nextActiveOpponentMemberId =
    activeMemberStillAlive
      ? encounter.activeOpponentMemberId ?? null
      : aliveMembers[0]?.id ?? null;
  return {
    ...encounter,
    opponentMembers: normalizedMembers,
    opponentHealth: totalHealth,
    opponentMaxHealth: totalMaxHealth,
    opponentStamina: averageStamina,
    opponentMaxStamina: averageMaxStamina,
    opponentDamageMin: averageDamageMin,
    opponentDamageMax: averageDamageMax,
    activeOpponentMemberId: nextActiveOpponentMemberId,
  };
}

function defeatSettlementMember(
  encounter: PlayEncounterState,
): {
  encounter: PlayEncounterState;
  targetName: string | null;
} {
  const members = Array.isArray(encounter.opponentMembers)
    ? encounter.opponentMembers
    : [];
  const aliveMembers = members.filter((member) => normalizeEncounterMemberHealth(member) > 0);
  const target = aliveMembers[0] ?? null;
  if (!target) {
    return {
      encounter,
      targetName: null,
    };
  }
  const updatedMembers = members.map((member) => {
    if (member.id !== target.id) {
      return member;
    }
    return {
      ...member,
      health: 0,
    };
  });
  const recalculated = recalculateSettlementEncounter(encounter, updatedMembers);
  return {
    encounter: recalculated,
    targetName: String(target.name ?? "").trim() || null,
  };
}

function pickHostileAttacker(encounter: PlayEncounterState): {
  encounter: PlayEncounterState;
  attacker: PlayEncounterOpponentMember | null;
  damageMin: number;
  damageMax: number;
} {
  if (encounter.type !== "settlement-group") {
    return {
      encounter,
      attacker: null,
      damageMin: encounter.opponentDamageMin,
      damageMax: encounter.opponentDamageMax,
    };
  }
  const aliveMembers = getAliveSettlementMembers(encounter);
  if (aliveMembers.length <= 0) {
    return {
      encounter,
      attacker: null,
      damageMin: encounter.opponentDamageMin,
      damageMax: encounter.opponentDamageMax,
    };
  }
  const attackerRoll = rollEncounterInt(
    encounter,
    "opponent-attacker-index",
    0,
    aliveMembers.length - 1,
  );
  const attacker = aliveMembers[attackerRoll.value] ?? aliveMembers[0];
  const nextEncounter = {
    ...attackerRoll.encounter,
    activeOpponentMemberId: attacker.id,
  };
  return {
    encounter: nextEncounter,
    attacker,
    damageMin: normalizeEncounterMemberDamage(attacker.damageMin, encounter.opponentDamageMin),
    damageMax: Math.max(
      normalizeEncounterMemberDamage(attacker.damageMin, encounter.opponentDamageMin),
      normalizeEncounterMemberDamage(attacker.damageMax, encounter.opponentDamageMax),
    ),
  };
}

function getEncounterDisplayLabel(encounter: PlayEncounterState): string {
  if (encounter.type !== "settlement-group") {
    return getEncounterLabel(encounter.type);
  }
  const aliveMembers = getAliveSettlementMembers(encounter);
  const activeMember = aliveMembers.find(
    (member) => member.id === encounter.activeOpponentMemberId,
  );
  const selected = activeMember ?? aliveMembers[0] ?? null;
  const selectedName = String(selected?.name ?? "").trim();
  if (selectedName.length > 0) {
    return selectedName;
  }
  return getEncounterLabel(encounter.type);
}

function getNonHostileGreetingReply(encounter: PlayEncounterState): string {
  if (encounter.type === "settlement-group") {
    return "hej.";
  }
  return "...";
}

function describeInjuryStatus(status: unknown): string {
  const normalized = String(status ?? "").trim();
  if (normalized === "injured") {
    return "skadad";
  }
  if (normalized === "severely-injured") {
    return "svårt skadad";
  }
  return "oskadad";
}

function rollEncounterChance(
  encounter: PlayEncounterState,
  label: string,
  probability: number,
): { encounter: PlayEncounterState; success: boolean } {
  const roll = createEncounterRoll(encounter, label);
  return {
    encounter: roll.encounter,
    success: roll.rng.chance(clamp01(probability)),
  };
}

function rollEncounterInt(
  encounter: PlayEncounterState,
  label: string,
  min: number,
  max: number,
): { encounter: PlayEncounterState; value: number } {
  const roll = createEncounterRoll(encounter, label);
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return {
    encounter: roll.encounter,
    value: roll.rng.int(lower, upper),
  };
}

function createEncounterRoll(
  encounter: PlayEncounterState,
  label: string,
): { encounter: PlayEncounterState; rng: ReturnType<typeof createRng> } {
  const rollIndex = Number.isFinite(encounter.rollIndex)
    ? Math.max(0, Math.floor(Number(encounter.rollIndex)))
    : 0;
  const rng = createRng(`${encounter.id}:roll:${rollIndex}:${label}`);
  return {
    encounter: {
      ...encounter,
      rollIndex: rollIndex + 1,
    },
    rng,
  };
}

function createEncounterLootInventory(
  encounter: PlayEncounterState,
  definition: EncounterDefinition,
) {
  const rng = createRng(`${encounter.id}:loot`);
  const meatCount = rng.int(definition.lootMeatMin, definition.lootMeatMax);
  return {
    columns: ENCOUNTER_LOOT_COLUMNS,
    rows: ENCOUNTER_LOOT_ROWS,
    items: [
      {
        id: `encounter-${encounter.id}-meat-1`,
        type: "meat",
        name: "Köttbit",
        symbol: "meat",
        width: 1,
        height: 1,
        count: Math.max(1, meatCount),
        column: 0,
        row: 0,
      },
    ],
  };
}

function getEncounterDefinition(type: PlayEncounterType): EncounterDefinition {
  return ENCOUNTER_DEFINITIONS.find((entry) => entry.type === type) ??
    ENCOUNTER_DEFINITIONS[0];
}

function getEncounterLabel(type: PlayEncounterType): string {
  return getEncounterDefinition(type).label;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function resolveTravelEncounterWeight(
  definition: EncounterDefinition,
  playState: PlayState,
): number {
  const baseWeight = Number.isFinite(definition.weight) ? Number(definition.weight) : 0;
  if (baseWeight <= 0) {
    return 0;
  }
  const isNight = isNightTimeForEncounter(playState);
  if (definition.type === "wolf") {
    return baseWeight *
      (isNight
        ? ENCOUNTER_TRAVEL_WOLF_WEIGHT_NIGHT_MULTIPLIER
        : ENCOUNTER_TRAVEL_WOLF_WEIGHT_DAY_MULTIPLIER);
  }
  if (definition.type === "rabbit") {
    return baseWeight *
      (isNight
        ? ENCOUNTER_TRAVEL_RABBIT_WEIGHT_NIGHT_MULTIPLIER
        : ENCOUNTER_TRAVEL_RABBIT_WEIGHT_DAY_MULTIPLIER);
  }
  return baseWeight;
}

function resolveWildernessHostileEncounterChance(playState: PlayState): number {
  if (!playState?.rest) {
    return ENCOUNTER_CHANCE_PER_WILDERNESS_ACTION_HOUR;
  }
  const multiplier = isNightTimeForEncounter(playState)
    ? ENCOUNTER_WILDERNESS_REST_NIGHT_MULTIPLIER
    : ENCOUNTER_WILDERNESS_REST_DAY_MULTIPLIER;
  return clamp01(ENCOUNTER_CHANCE_PER_WILDERNESS_ACTION_HOUR * multiplier);
}

function isNightTimeForEncounter(playState: PlayState): boolean {
  const normalizedHour = normalizeTimeOfDayHours(playState?.timeOfDayHours);
  return (
    normalizedHour >= ENCOUNTER_NIGHT_START_HOUR ||
    normalizedHour < ENCOUNTER_NIGHT_END_HOUR
  );
}

function capitalize(value: string): string {
  const text = String(value ?? "");
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
