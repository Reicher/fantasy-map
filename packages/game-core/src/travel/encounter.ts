import {
  consumeInventoryItemsByType,
  countInventoryItemsByType,
} from "../inventory";
import { withPlayActionMode } from "./actionMode";
import {
  DEFAULT_MAX_HEALTH,
} from "./constants";
import {
  normalizeHealthValue,
  normalizeStaminaValue,
} from "./normalizers";
import { snapshotRunStats } from "./runStats";
import { createRng } from "@fardvag/shared/random";
import type {
  PlayEncounterState,
  PlayEncounterType,
  PlayState,
  PlayJourneyEvent,
} from "@fardvag/shared/types/play";

type PlayStateLike = PlayState | null | undefined;

type EncounterPlayerAction = "greet" | "attack" | "flee";

interface EncounterDefinition {
  type: PlayEncounterType;
  label: string;
  weight: number;
  disposition: "neutral" | "hostile";
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
const ENCOUNTER_CHANCE_PER_HUNT_RABBIT_HOUR = 0.35;
const ENCOUNTER_HUNT_RABBIT_BONUS_OVER_TRAVEL_BASE = 0.08;
const ENCOUNTER_LOOT_COLUMNS = 4;
const ENCOUNTER_LOOT_ROWS = 4;
const ENCOUNTER_APPROACH_DISTANCE_WORLD = 18;
const ENCOUNTER_MIN_APPROACH_WORLD = 6;
const ENCOUNTER_ENDPOINT_SAFE_DISTANCE_WORLD = 4.5;
const PLAYER_ATTACK_DAMAGE_MIN = 7;
const PLAYER_ATTACK_DAMAGE_MAX = 12;
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
]);

export function maybeTriggerTravelEncounter(
  playState: PlayStateLike,
  world,
): PlayStateLike {
  if (!playState || playState.gameOver || !canTriggerEncounter(playState)) {
    return withPlayActionMode(playState);
  }

  const encounterSeed = buildEncounterTriggerSeed(playState, world);
  const rng = createRng(encounterSeed);
  if (!rng.chance(ENCOUNTER_CHANCE_PER_TRAVEL_HOUR)) {
    return withPlayActionMode(playState);
  }

  const definition = rng.weighted(
    ENCOUNTER_DEFINITIONS,
    (entry) => entry.weight,
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

  const worldSeed = String(world?.params?.seed ?? "seed");
  const modeLabel = playState.hunt ? "hunt" : "rest";
  const hourIndex = normalizeWorldHour(playState.journeyElapsedHours);
  const rng = createRng(
    `${worldSeed}:wilderness-hostile-encounter:${modeLabel}:${hourIndex}`,
  );
  if (!rng.chance(ENCOUNTER_CHANCE_PER_WILDERNESS_ACTION_HOUR)) {
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
  const opponentLabel = getEncounterLabel(encounter.type);
  const lines = ["Du hälsar."];
  if (encounter.disposition !== "hostile") {
    lines.push(`${capitalize(opponentLabel)} svarar: ...`);
  }
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
  if (bulletsBefore <= 0) {
    return withEncounterTurnEvent(playState, [
      "Du har inga kulor kvar.",
    ]);
  }

  const consumedAmmo = consumeInventoryItemsByType(
    playState.inventory,
    "bullets",
    1,
  );
  let nextEncounter: PlayEncounterState = {
    ...encounter,
  };
  if (nextEncounter.type === "rabbit") {
    nextEncounter.disposition = "fleeing";
  }

  const accuracy = clamp01(
    Number.isFinite(playState.vapenTraffsakerhet)
      ? Number(playState.vapenTraffsakerhet) / 100
      : 0,
  );
  const hitRoll = rollEncounterChance(nextEncounter, "player-attack-hit", accuracy);
  nextEncounter = hitRoll.encounter;
  const lines = ["Du attackerar."];

  if (!hitRoll.success) {
    lines.push("Skottet missar.");
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

  const damageRoll = rollEncounterInt(
    nextEncounter,
    "player-attack-damage",
    PLAYER_ATTACK_DAMAGE_MIN,
    PLAYER_ATTACK_DAMAGE_MAX,
  );
  nextEncounter = damageRoll.encounter;
  const damage = damageRoll.value;
  const remainingHealth = Math.max(0, nextEncounter.opponentHealth - damage);
  lines.push(`Träff. Du gör ${damage} skada.`);

  if (remainingHealth <= 0) {
    return finishEncounterWithOpponentDefeat(
      {
        ...playState,
        inventory: consumedAmmo.inventory,
      },
      {
        ...nextEncounter,
        opponentHealth: 0,
      },
      lines,
    );
  }

  return advanceEncounterUntilPlayerTurn(
    {
      ...playState,
      inventory: consumedAmmo.inventory,
      encounter: {
        ...nextEncounter,
        opponentHealth: remainingHealth,
        turn: "opponent",
      },
    },
    lines,
  );
}

function handlePlayerFlee(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  if (encounter.disposition === "neutral" || encounter.disposition === "fleeing") {
    return finishEncounterWithFleeOutcome(playState, encounter, "player-fled");
  }
  const playerStamina = normalizePlayerStamina(playState);
  const opponentStamina = normalizeOpponentStamina(encounter);
  if (playerStamina > opponentStamina) {
    return finishEncounterWithFleeOutcome(playState, encounter, "player-fled");
  }

  return advanceEncounterUntilPlayerTurn(
    {
      ...playState,
      encounter: {
        ...encounter,
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
  const opponentLabel = getEncounterLabel(encounter.type);

  if (encounter.disposition === "hostile") {
    const damageRoll = rollEncounterInt(
      encounter,
      "opponent-attack-damage",
      encounter.opponentDamageMin,
      encounter.opponentDamageMax,
    );
    const nextEncounter = damageRoll.encounter;
    const damage = damageRoll.value;
    const maxHealth = normalizeHealthValue(
      playState.maxHealth,
      DEFAULT_MAX_HEALTH,
    );
    const currentHealth = normalizeHealthValue(playState.health, maxHealth);
    const nextHealth = Math.max(0, currentHealth - damage);
    const message = `${capitalize(opponentLabel)} anfaller och gör ${damage} skada.`;
    if (nextHealth <= 0) {
      return {
        playState: finishEncounterWithPlayerDefeat(
          {
            ...playState,
            health: 0,
            maxHealth,
          },
          nextEncounter,
        ),
        message,
      };
    }
    return {
      playState: {
        ...playState,
        health: nextHealth,
        maxHealth,
        encounter: {
          ...nextEncounter,
          turn: "player",
          round: encounter.round + 1,
        },
      },
      message,
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
    message: `${capitalize(opponentLabel)} svarar: ...`,
  };
}

function finishEncounterWithOpponentDefeat(
  playState: PlayState,
  encounter: PlayEncounterState,
  lines: string[],
): PlayState {
  const definition = getEncounterDefinition(encounter.type);
  const lootInventory = createEncounterLootInventory(encounter, definition);
  const message = `${lines.join(" ")} ${capitalize(definition.label)} dör. Du kan ta bytet.`;
  const event: PlayJourneyEvent = {
    type: "encounter-loot",
    encounterId: encounter.id,
    message,
    requiresAcknowledgement: false,
    inventory: lootInventory,
  };
  return {
    ...playState,
    encounter: null,
    latestEncounterResolution: {
      encounterId: encounter.id,
      type: encounter.type,
      outcome: "opponent-died",
    },
    pendingJourneyEvent: event,
    isTravelPaused: Boolean(playState.travel),
    travelPauseReason: resolvePostEncounterPauseReason(playState),
  };
}

function finishEncounterWithPlayerDefeat(
  playState: PlayState,
  encounter: PlayEncounterState,
): PlayState {
  const label = getEncounterLabel(encounter.type);
  return {
    ...playState,
    maxHealth: normalizeHealthValue(playState.maxHealth, DEFAULT_MAX_HEALTH),
    health: 0,
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
      message: `Du dödades av en ${label}.`,
      stats: snapshotRunStats(playState.runStats),
    },
  };
}

function finishEncounterWithFleeOutcome(
  playState: PlayState,
  encounter: PlayEncounterState,
  outcome: "player-fled" | "opponent-fled",
): PlayState {
  const shouldResumeTravel = Boolean(
    playState.travel && !playState.rest && !playState.hunt,
  );
  const pausedReason = resolvePostEncounterPauseReason(playState);
  return {
    ...playState,
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
    pendingJourneyEvent: null,
    isTravelPaused: shouldResumeTravel ? false : playState.isTravelPaused,
    travelPauseReason: shouldResumeTravel ? null : pausedReason,
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
  const canAttack = countInventoryItemsByType(playState.inventory, "bullets") > 0;
  return {
    ...playState,
    pendingJourneyEvent: {
      type: "encounter-turn",
      encounterId: encounter.id,
      message: normalizedLines.join("\n"),
      requiresAcknowledgement: true,
      canAttack,
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

function normalizePlayerStamina(playState: PlayState): number {
  return normalizeStaminaValue(playState.stamina, playState.maxStamina);
}

function normalizeOpponentStamina(encounter: PlayEncounterState): number {
  return normalizeStaminaValue(
    encounter.opponentStamina,
    encounter.opponentMaxStamina,
  );
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

function capitalize(value: string): string {
  const text = String(value ?? "");
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
