import { transferAllInventoryItems } from "../inventory";
import { clamp } from "@fardvag/shared/utils";
import { normalizeTimeOfDayHours } from "../timeOfDay";
import { createRng } from "@fardvag/shared/random";
import { getNodeTitle } from "@fardvag/shared/node/model";
import { biomeKeyAtPoint } from "./biomeBands";
import {
  DEFAULT_MAX_STAMINA,
  HUNT_AREA_RECOVERY_PER_HOUR,
  HUNT_BIOME_FACTORS,
  HUNT_MEAT_LOOT_COLUMNS,
  HUNT_MEAT_LOOT_ROWS,
  HUNT_SEA_ROUTE_REASON,
  HUNT_SUCCESS_MAX_CHANCE,
  HUNT_SUCCESS_MIN_CHANCE,
  HUNT_TIME_OF_DAY_MODIFIERS,
  HUNT_UNAVAILABLE_REASON,
  STAMINA_PER_HUNT_HOUR,
} from "./constants";
import {
  normalizeActionCounter,
  normalizeAreaCapacity,
  normalizeCompletedHours,
  normalizeElapsedHours,
  normalizeHuntHours,
  normalizeStackCount,
  normalizeStaminaValue,
  normalizeWeaponAccuracy,
} from "./normalizers";
import type { InventoryState } from "@fardvag/shared/types/inventory";
import type {
  PlayHuntAreaState,
  PlayHuntFeedback,
  PlayHuntState,
  PlayState,
} from "@fardvag/shared/types/play";
import type { NodeLike } from "@fardvag/shared/node/model";
import type { World } from "@fardvag/shared/types/world";

type PlayStateLike = PlayState | null | undefined;
interface HuntWorldLike {
  params?: { seed?: unknown };
  features?: {
    nodes?: Array<(NodeLike & { id?: number; cell?: number }) | undefined>;
  };
  climate?: {
    biome?: Array<string | number> | Uint8Array;
  };
}
type WorldLike = World | HuntWorldLike | null | undefined;
type HuntAreaState = PlayHuntAreaState;
type HuntFeedback =
  | Pick<PlayHuntFeedback, "type" | "text">
  | null;
type RngLike = ReturnType<typeof createRng>;

interface HuntContextUnavailable {
  available: false;
  reason: string;
  areaLabel?: string | null;
}

interface HuntContextAvailable {
  available: true;
  areaKey: string;
  areaLabel: string;
  areaType: "stretch" | "node" | "wild";
  biomeKey: string | number;
  areaCapacity: number;
  worldSeed: string;
  reason?: null;
}

type HuntContext = HuntContextUnavailable | HuntContextAvailable;

export function beginHunt(
  playState: PlayStateLike,
  world: WorldLike,
  requestedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver || !world) {
    return playState;
  }
  if (playState.hunt || playState.rest || hasBlockingActionInteraction(playState)) {
    return playState;
  }
  if (playState.travel && !playState.isTravelPaused) {
    return playState;
  }

  const huntHours = normalizeHuntHours(requestedHours);
  if (huntHours <= 0) {
    return playState;
  }

  const maxStamina = normalizeStaminaValue(playState.maxStamina, DEFAULT_MAX_STAMINA);
  const stamina = Math.min(maxStamina, normalizeStaminaValue(playState.stamina, maxStamina));
  if (stamina <= 0) {
    return {
      ...playState,
      pendingRestChoice: true,
      latestHuntFeedback: {
        type: "hint",
        text: "Du saknar ork för jakt. Vila först.",
      },
    };
  }

  const context = resolveHuntContext(playState, world);
  if (!context.available) {
    return {
      ...playState,
      latestHuntFeedback: {
        type: "hint",
        text: context.reason,
      },
    };
  }

  const currentJourneyHours = normalizeElapsedHours(playState.journeyElapsedHours);
  const recoveredArea = recoverHuntAreaState(
    playState.huntAreaStates,
    context,
    currentJourneyHours,
  );
  const runId = normalizeActionCounter(playState.nextHuntRunId);
  const hasTravel = Boolean(playState.travel);
  const wasTravelPaused = Boolean(playState.isTravelPaused);
  const priorPauseReason = playState.travelPauseReason ?? null;
  const startTimeOfDay = normalizeTimeOfDayHours(playState.timeOfDayHours);
  const outlook = describeHuntOutlook(
    context,
    recoveredArea.areaState,
    startTimeOfDay,
    playState.vapenTraffsakerhet,
  );

  return {
    ...playState,
    hoveredNodeId: null,
    pressedNodeId: null,
    maxStamina,
    stamina,
    isTravelPaused: hasTravel ? true : false,
    travelPauseReason: hasTravel ? "hunting" : null,
    pendingRestChoice: false,
    rest: null,
    hunt: {
      runId,
      seed: `${String(world?.params?.seed ?? "seed")}:hunt:${runId}:${context.areaKey}`,
      hours: huntHours,
      elapsedHours: 0,
      completedHours: 0,
      successfulHours: 0,
      totalMeatGained: 0,
      areaKey: context.areaKey,
      areaLabel: context.areaLabel,
      areaType: context.areaType,
      biomeKey: context.biomeKey,
      areaCapacity: context.areaCapacity,
      worldSeed: context.worldSeed,
      startedAtJourneyHours: currentJourneyHours,
      startedTimeOfDayHours: startTimeOfDay,
      resumeTravelOnFinish: hasTravel && !wasTravelPaused,
      priorWasTravelPaused: wasTravelPaused,
      priorTravelPauseReason: priorPauseReason,
      lastMessage: outlook,
    },
    latestHuntFeedback: {
      type: "hint",
      text: outlook,
    },
    huntAreaStates: recoveredArea.huntAreaStates,
    nextHuntRunId: runId + 1,
  };
}

export function cancelHunt(
  playState: PlayStateLike,
  world: WorldLike,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return playState;
  }

  const huntState = playState.hunt;
  const totalHours = normalizeHuntHours(huntState.hours);
  const elapsedHours = normalizeElapsedHours(huntState.elapsedHours);
  const roundedTargetHours = clamp(Math.round(elapsedHours), 0, totalHours);

  let nextState: PlayState = playState;
  if (roundedTargetHours > normalizeCompletedHours(huntState.completedHours)) {
    nextState = resolveHuntHours(nextState, world, roundedTargetHours);
  }
  if (!nextState.hunt) {
    return nextState;
  }

  return completeHunt(nextState, {
    type: "stopped",
    text:
      roundedTargetHours > 0
        ? `Du avbryter jakten. ${roundedTargetHours}h räknas.`
        : "Du avbryter jakten innan någon full timme har passerat.",
  });
}

export function advanceHunt(
  playState: PlayStateLike,
  world: WorldLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }

  const huntState = playState.hunt;
  const totalHours = normalizeHuntHours(huntState.hours);
  const previousElapsed = Math.floor(
    normalizeElapsedHours(huntState.elapsedHours),
  );
  const nextElapsed = Math.min(totalHours, previousElapsed + safeElapsedHours);
  const completedHours = Math.floor(nextElapsed + 1e-9);

  let nextState: PlayState = {
    ...playState,
    hunt: {
      ...huntState,
      hours: totalHours,
      elapsedHours: nextElapsed,
    },
  };

  nextState = resolveHuntHours(nextState, world, completedHours);
  if (!nextState.hunt) {
    return nextState;
  }

  if (nextElapsed >= totalHours - 1e-6) {
    return completeHunt(nextState, {
      type: "completed",
      text: "Jakten är avslutad för den planerade tiden.",
    });
  }

  return nextState;
}

export function describeHuntSituation(
  playState: PlayStateLike,
  world: WorldLike,
): {
  available: boolean;
  reason: string | null;
  outlook: string;
  areaLabel: string | null;
} {
  if (!playState || !world) {
    return {
      available: false,
      reason: HUNT_UNAVAILABLE_REASON,
      outlook: HUNT_UNAVAILABLE_REASON,
      areaLabel: null,
    };
  }

  const context = resolveHuntContext(playState, world);
  if (!context.available) {
    return {
      available: false,
      reason: context.reason,
      outlook: context.reason,
      areaLabel: context.areaLabel ?? null,
    };
  }

  const currentJourneyHours = normalizeElapsedHours(playState.journeyElapsedHours);
  const previewState = previewRecoveredHuntAreaState(
    playState.huntAreaStates,
    context,
    currentJourneyHours,
  );
  const outlook = describeHuntOutlook(
    context,
    previewState,
    playState.timeOfDayHours,
    playState.vapenTraffsakerhet,
  );

  return {
    available: true,
    reason: null,
    outlook,
    areaLabel: context.areaLabel,
  };
}

function resolveHuntHours(
  playState: PlayState,
  world: WorldLike,
  targetCompletedHours: number | null | undefined,
): PlayState {
  if (!playState?.hunt || !world) {
    return playState;
  }

  const huntState = playState.hunt;
  const totalHours = normalizeHuntHours(huntState.hours);
  const normalizedTarget = clamp(Math.floor(targetCompletedHours), 0, totalHours);
  let nextState = playState;
  let completedHours = normalizeCompletedHours(huntState.completedHours);
  while (completedHours < normalizedTarget) {
    completedHours += 1;
    nextState = resolveSingleHuntHour(nextState, world, completedHours);
    if (!nextState?.hunt) {
      break;
    }
  }
  return nextState;
}

function resolveSingleHuntHour(
  playState: PlayState,
  world: WorldLike,
  hourNumber: number,
): PlayState {
  if (!playState?.hunt || !world) {
    return playState;
  }

  const huntState = playState.hunt;
  const context: HuntContextAvailable = {
    available: true,
    areaKey: String(huntState.areaKey ?? "unknown-area"),
    areaLabel: String(huntState.areaLabel ?? "Okänt område"),
    areaType:
      huntState.areaType === "node" ||
      huntState.areaType === "wild" ||
      huntState.areaType === "stretch"
        ? huntState.areaType
        : "wild",
    biomeKey: huntState.biomeKey ?? "plains",
    areaCapacity: normalizeAreaCapacity(huntState.areaCapacity),
    worldSeed: String(huntState.worldSeed ?? "seed"),
  };
  const boundaryJourneyHours =
    normalizeElapsedHours(huntState.startedAtJourneyHours) + hourNumber;
  const boundaryTimeOfDayHours = normalizeTimeOfDayHours(
    normalizeTimeOfDayHours(huntState.startedTimeOfDayHours) + hourNumber,
  );
  const recovered = recoverHuntAreaState(
    playState.huntAreaStates,
    context,
    boundaryJourneyHours,
    { allowRecovery: false },
  );
  const areaState = recovered.areaState;
  const chance = resolveHuntSuccessChance(
    context,
    areaState,
    boundaryTimeOfDayHours,
    playState.vapenTraffsakerhet,
  );
  const hourRng = createRng(`${huntState.seed}:hour:${hourNumber}`);
  const success = hourRng.float() < chance;

  const maxStamina = normalizeStaminaValue(playState.maxStamina, DEFAULT_MAX_STAMINA);
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const nextStamina = Math.max(0, currentStamina - STAMINA_PER_HUNT_HOUR);

  const densityDrop = success
    ? resolveSuccessfulHuntDensityDrop(areaState, context, hourRng)
    : resolveFailedHuntDensityDrop(areaState, context, hourRng);
  const nextDensity = clamp(
    areaState.density - densityDrop,
    0,
    context.areaCapacity,
  );
  const nextAreaState = {
    ...areaState,
    density: nextDensity,
    lastUpdatedHours: boundaryJourneyHours,
  };
  const nextHuntAreaStates = {
    ...(recovered.huntAreaStates ?? {}),
    [context.areaKey]: nextAreaState,
  };

  const meatFound = success
    ? resolveHuntMeatYield(
        context,
        areaState,
        playState.vapenTraffsakerhet,
        boundaryTimeOfDayHours,
        hourRng,
      )
    : 0;
  const addedMeat = addMeatToInventory(
    playState.inventory,
    meatFound,
    huntState.runId,
    hourNumber,
  );

  const nextState = {
    ...playState,
    maxStamina,
    stamina: nextStamina,
    inventory: addedMeat.inventory,
    huntAreaStates: nextHuntAreaStates,
    hunt: {
      ...huntState,
      completedHours: hourNumber,
      successfulHours:
        normalizeCompletedHours(huntState.successfulHours) + (success ? 1 : 0),
      totalMeatGained:
        normalizeStackCount(huntState.totalMeatGained) + addedMeat.gainedMeat,
    },
  };

  if (nextStamina > 0) {
    return nextState;
  }

  return completeHunt(nextState, {
    type: "exhausted",
    text: "Jakten avbryts - du är helt slut och behöver vila.",
  });
}

function completeHunt(
  playState: PlayStateLike,
  feedback: HuntFeedback = null,
): PlayStateLike {
  if (!playState?.hunt) {
    return playState;
  }
  const huntState = playState.hunt;
  const isExhausted = feedback?.type === "exhausted";
  const shouldResumeTravel = shouldResumeTravelAfterHunt(huntState) && !isExhausted;

  const nextState: PlayState = {
    ...playState,
    hunt: null,
    pendingRestChoice: isExhausted,
    isTravelPaused: shouldResumeTravel
      ? false
      : Boolean(huntState.priorWasTravelPaused || isExhausted),
    travelPauseReason: shouldResumeTravel
      ? null
      : isExhausted
        ? "exhausted"
        : huntState.priorWasTravelPaused
          ? (huntState.priorTravelPauseReason ?? "manual")
          : null,
  };

  if (!feedback?.text) {
    return nextState;
  }
  const totalHours = normalizeHuntHours(huntState.hours);
  const completedHours = normalizeCompletedHours(huntState.completedHours);
  const successfulHours = normalizeCompletedHours(huntState.successfulHours);
  const totalMeatGained = normalizeStackCount(huntState.totalMeatGained);
  const summaryText = `Jaktresultat: ${successfulHours}/${completedHours} lyckade timmar, +${totalMeatGained} kött.`;
  const statusText =
    feedback?.type === "completed"
      ? "Jakten är avslutad."
      : feedback?.type === "stopped"
        ? `Jakten avbröts efter ${completedHours}h.`
        : feedback?.type === "exhausted"
          ? "Du är utmattad och måste vila."
          : feedback?.text;
  return {
    ...nextState,
    latestHuntFeedback: {
      type: "result",
      text: statusText ? `${summaryText} ${statusText}` : summaryText,
      runId: huntState.runId,
      hour: totalHours,
    },
  };
}

function resolveHuntContext(
  playState: PlayStateLike,
  world: WorldLike,
): HuntContext {
  if (!playState || !world) {
    return {
      available: false,
      reason: HUNT_UNAVAILABLE_REASON,
    };
  }

  if (playState.travel) {
    const routeType = playState.travel.routeType ?? "road";
    if (routeType === "sea-route") {
      return {
        available: false,
        reason: HUNT_SEA_ROUTE_REASON,
      };
    }

    const startNodeId = playState.travel.startNodeId ?? null;
    const targetNodeId = playState.travel.targetNodeId ?? null;
    const nodes = getWorldNodes(world);
    const startNode = startNodeId == null ? null : nodes[startNodeId] ?? null;
    const targetNode = targetNodeId == null ? null : nodes[targetNodeId] ?? null;
    const settlementWeight =
      (nodeSettlementWeight(startNode) + nodeSettlementWeight(targetNode)) / 2;
    const areaCapacityBase = clamp(0.74 - settlementWeight * 0.22, 0.2, 0.9);
    const biomeKey = biomeKeyAtPoint(world, playState.position) ?? "plains";
    const biomeFactor = biomeHuntFactor(biomeKey);
    const areaCapacity = clamp(
      areaCapacityBase * (0.62 + biomeFactor * 0.6),
      0.16,
      0.93,
    );
    const sortedNodeIds = [startNodeId, targetNodeId]
      .filter((value): value is number => Number.isInteger(value))
      .sort((a, b) => a - b);
    return {
      available: true,
      areaKey: `stretch:${routeType}:${sortedNodeIds.join(":")}`,
      areaLabel: "Sträckan du färdas på",
      areaType: "stretch",
      biomeKey,
      areaCapacity,
      worldSeed: String(world?.params?.seed ?? "seed"),
    };
  }

  const nodes = getWorldNodes(world);
  const currentNode =
    playState.currentNodeId == null ? null : nodes[playState.currentNodeId] ?? null;
  if (currentNode) {
    const biomeKey = getBiomeKeyByCell(world, currentNode.cell) ?? "plains";
    const biomeFactor = biomeHuntFactor(biomeKey);
    const markerWeight = nodeSettlementWeight(currentNode);
    const baseCapacity = clamp(0.58 - markerWeight * 0.3, 0.13, 0.72);
    const areaCapacity = clamp(baseCapacity * (0.6 + biomeFactor * 0.55), 0.11, 0.86);
    return {
      available: true,
      areaKey: `node:${currentNode.id}`,
      areaLabel: getNodeTitle(currentNode),
      areaType: "node",
      biomeKey,
      areaCapacity,
      worldSeed: String(world?.params?.seed ?? "seed"),
    };
  }

  const biomeKey = biomeKeyAtPoint(world, playState.position) ?? "plains";
  const biomeFactor = biomeHuntFactor(biomeKey);
  return {
    available: true,
    areaKey: `wild:${biomeKey}:${playState.lastRegionId ?? "region"}`,
    areaLabel: "Vildmarken",
    areaType: "wild",
    biomeKey,
    areaCapacity: clamp(0.63 * (0.65 + biomeFactor * 0.55), 0.18, 0.9),
    worldSeed: String(world?.params?.seed ?? "seed"),
  };
}

function getWorldNodes(
  world: WorldLike,
): Array<(NodeLike & { id?: number; cell?: number }) | undefined> {
  const features = (world as HuntWorldLike | null | undefined)?.features as
    | { nodes?: Array<(NodeLike & { id?: number; cell?: number }) | undefined> }
    | null
    | undefined;
  return Array.isArray(features?.nodes) ? features.nodes : [];
}

function getBiomeKeyByCell(
  world: WorldLike,
  cell: number | null | undefined,
): string | number | null {
  if (!Number.isInteger(cell) || cell == null || cell < 0) {
    return null;
  }
  const climate = (world as HuntWorldLike | null | undefined)?.climate as
    | { biome?: Array<string | number> | Uint8Array }
    | undefined;
  const biomeArray = climate?.biome;
  if (!biomeArray || cell >= biomeArray.length) {
    return null;
  }
  return biomeArray[cell] ?? null;
}

function recoverHuntAreaState(
  huntAreaStates: Record<string, HuntAreaState> | null | undefined,
  context: HuntContextAvailable,
  currentJourneyHours: number | null | undefined,
  options: { allowRecovery?: boolean } = {},
): {
  huntAreaStates: Record<string, HuntAreaState>;
  areaState: HuntAreaState;
} {
  const allowRecovery = options.allowRecovery !== false;
  const allStates = { ...(huntAreaStates ?? {}) };
  const existingState = allStates[context.areaKey];
  const baseState =
    existingState ??
    createInitialHuntAreaState(context, {
      currentJourneyHours,
    });

  const safeCurrentHours = normalizeElapsedHours(currentJourneyHours);
  const previousHours = normalizeElapsedHours(baseState.lastUpdatedHours);
  const elapsedSinceLast = Math.max(0, safeCurrentHours - previousHours);
  const nextDensity = allowRecovery
    ? Math.min(
        context.areaCapacity,
        baseState.density +
          elapsedSinceLast * HUNT_AREA_RECOVERY_PER_HOUR * context.areaCapacity,
      )
    : baseState.density;
  const nextState = {
    ...baseState,
    density: clamp(nextDensity, 0, context.areaCapacity),
    areaCapacity: context.areaCapacity,
    lastUpdatedHours: safeCurrentHours,
  };
  allStates[context.areaKey] = nextState;
  return {
    huntAreaStates: allStates,
    areaState: nextState,
  };
}

function previewRecoveredHuntAreaState(
  huntAreaStates: Record<string, HuntAreaState> | null | undefined,
  context: HuntContextAvailable,
  currentJourneyHours: number | null | undefined,
): HuntAreaState {
  const existingState = huntAreaStates?.[context.areaKey];
  const baseState =
    existingState ??
    createInitialHuntAreaState(context, {
      currentJourneyHours,
    });
  const safeCurrentHours = normalizeElapsedHours(currentJourneyHours);
  const previousHours = normalizeElapsedHours(baseState.lastUpdatedHours);
  const elapsedSinceLast = Math.max(0, safeCurrentHours - previousHours);
  const recoveredDensity = Math.min(
    context.areaCapacity,
    baseState.density +
      elapsedSinceLast * HUNT_AREA_RECOVERY_PER_HOUR * context.areaCapacity,
  );
  return {
    ...baseState,
    areaCapacity: context.areaCapacity,
    density: clamp(recoveredDensity, 0, context.areaCapacity),
    lastUpdatedHours: safeCurrentHours,
  };
}

function createInitialHuntAreaState(
  context: HuntContextAvailable,
  options: { currentJourneyHours?: number } = {},
) {
  const seed = [
    String(context.worldSeed ?? "seed"),
    String(context.areaKey ?? "area"),
    String(context.biomeKey ?? "biome"),
    String(context.areaType ?? "type"),
  ].join(":");
  const rng = createRng(seed);
  const areaCapacity = normalizeAreaCapacity(context.areaCapacity);
  const initialDensity = areaCapacity * (0.48 + rng.float() * 0.48);
  return {
    areaCapacity,
    density: clamp(initialDensity, 0, areaCapacity),
    lastUpdatedHours: normalizeElapsedHours(options.currentJourneyHours),
  };
}

function resolveHuntSuccessChance(
  context: HuntContextAvailable,
  areaState: HuntAreaState,
  timeOfDayHours: number | null | undefined,
  weaponAccuracy: number | null | undefined,
) {
  const capacity = normalizeAreaCapacity(context.areaCapacity);
  const normalizedDensity = capacity > 0 ? areaState.density / capacity : 0;
  const abundanceComponent = clamp(areaState.density, 0, 1);
  const timeFactor = huntTimeOfDayFactor(timeOfDayHours).factor;
  const biomeFactor = biomeHuntFactor(context.biomeKey);
  const skillFactor = clamp(
    (normalizeWeaponAccuracy(weaponAccuracy) - 25) / 75,
    0,
    1,
  );
  const chance =
    0.06 +
    abundanceComponent * 0.39 +
    normalizedDensity * 0.14 +
    timeFactor * 0.15 +
    biomeFactor * 0.12 +
    skillFactor * 0.19;
  return clamp(chance, HUNT_SUCCESS_MIN_CHANCE, HUNT_SUCCESS_MAX_CHANCE);
}

function resolveSuccessfulHuntDensityDrop(
  _areaState: HuntAreaState,
  context: HuntContextAvailable,
  rng: RngLike,
) {
  const swing = 0.78 + rng.float() * 0.6;
  const base = context.areaCapacity * 0.13 * swing;
  const pressure = context.areaType === "node" ? 1.12 : 1;
  return clamp(base * pressure, 0.02, context.areaCapacity * 0.45);
}

function resolveFailedHuntDensityDrop(
  _areaState: HuntAreaState,
  context: HuntContextAvailable,
  rng: RngLike,
) {
  const base = context.areaCapacity * (0.015 + rng.float() * 0.02);
  return clamp(base, 0.002, context.areaCapacity * 0.08);
}

function resolveHuntMeatYield(
  context: HuntContextAvailable,
  areaState: HuntAreaState,
  weaponAccuracy: number | null | undefined,
  timeOfDayHours: number | null | undefined,
  rng: RngLike,
) {
  const capacity = normalizeAreaCapacity(context.areaCapacity);
  const normalizedDensity = capacity > 0 ? areaState.density / capacity : 0;
  let yieldCount = 1;
  if (normalizedDensity > 0.6 && rng.float() < 0.58) {
    yieldCount += 1;
  }
  if (normalizedDensity > 0.82 && rng.float() < 0.36) {
    yieldCount += 1;
  }
  if (normalizeWeaponAccuracy(weaponAccuracy) >= 72 && rng.float() < 0.32) {
    yieldCount += 1;
  }
  if (huntTimeOfDayFactor(timeOfDayHours).factor >= 0.8 && rng.float() < 0.27) {
    yieldCount += 1;
  }
  if (context.areaType === "node" && rng.float() < 0.45) {
    yieldCount = Math.max(1, yieldCount - 1);
  }
  return clamp(Math.floor(yieldCount), 1, 4);
}

function addMeatToInventory(
  inventory: InventoryState | null | undefined,
  meatCount: number | null | undefined,
  runId: number | null | undefined,
  hourNumber: number | null | undefined,
) {
  const safeMeatCount = Number.isFinite(meatCount)
    ? Math.max(0, Math.floor(meatCount))
    : 0;
  if (!inventory || safeMeatCount <= 0) {
    return {
      inventory,
      gainedMeat: 0,
    };
  }

  const lootInventory = {
    columns: HUNT_MEAT_LOOT_COLUMNS,
    rows: HUNT_MEAT_LOOT_ROWS,
    items: [
      {
        id: `hunt-${runId}-${hourNumber}`,
        type: "meat",
        name: "Köttbit",
        symbol: "meat",
        width: 1,
        height: 1,
        count: safeMeatCount,
        column: 0,
        row: 0,
      },
    ],
  };
  const transferred = transferAllInventoryItems(lootInventory, inventory);
  const remainingCount = transferred.sourceInventory?.items?.[0]?.count ?? 0;
  const gainedMeat = Math.max(0, safeMeatCount - normalizeStackCount(remainingCount));
  return {
    inventory: transferred.targetInventory,
    gainedMeat,
  };
}

function describeHuntOutlook(
  context: HuntContextAvailable,
  areaState: HuntAreaState,
  timeOfDayHours: number | null | undefined,
  weaponAccuracy: number | null | undefined,
) {
  const chance = resolveHuntSuccessChance(
    context,
    areaState,
    timeOfDayHours,
    weaponAccuracy,
  );
  if (chance >= 0.7) {
    return "Bra läge";
  }
  if (chance >= 0.42) {
    return "Medelläge";
  }
  return "Svagt läge";
}

function huntTimeOfDayFactor(timeOfDayHours: number | null | undefined) {
  const normalized = normalizeTimeOfDayHours(timeOfDayHours);
  for (const band of HUNT_TIME_OF_DAY_MODIFIERS) {
    if (normalized >= band.start && normalized < band.end) {
      return band;
    }
  }
  return HUNT_TIME_OF_DAY_MODIFIERS[0];
}

function biomeHuntFactor(biomeKey: string | number | null | undefined) {
  const normalizedKey = String(biomeKey ?? "plains");
  const factor =
    HUNT_BIOME_FACTORS[normalizedKey as keyof typeof HUNT_BIOME_FACTORS];
  if (Number.isFinite(factor)) {
    return clamp(factor, 0.1, 1);
  }
  return 0.58;
}

function nodeSettlementWeight(node: NodeLike | null | undefined) {
  const marker = String(node?.marker ?? "");
  if (marker === "settlement") {
    return 1;
  }
  if (marker === "signpost") {
    return 0.5;
  }
  if (marker === "abandoned") {
    return 0.3;
  }
  return 0.45;
}

function hasBlockingActionInteraction(playState: PlayStateLike): boolean {
  return Boolean(playState?.pendingJourneyEvent);
}

function shouldResumeTravelAfterHunt(
  huntState: PlayHuntState | null | undefined,
): boolean {
  return Boolean(huntState?.resumeTravelOnFinish);
}
