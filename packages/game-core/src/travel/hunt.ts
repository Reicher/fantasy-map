import { clamp } from "@fardvag/shared/utils";
import { normalizeTimeOfDayHours } from "../timeOfDay";
import { getNodeTitle } from "@fardvag/shared/node/model";
import { biomeKeyAtPoint } from "./biomeBands";
import { withPlayActionMode } from "./actionMode";
import {
  DEFAULT_MAX_STAMINA,
  HUNT_BIOME_FACTORS,
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
  normalizeStaminaValue,
  normalizeWeaponAccuracy,
} from "./normalizers";
import type {
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
type HuntFeedback =
  | Pick<PlayHuntFeedback, "type" | "text">
  | null;

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
    return withPlayActionMode(playState);
  }
  if (playState.hunt || playState.rest || hasBlockingActionInteraction(playState)) {
    return withPlayActionMode(playState);
  }
  if (playState.travel && !playState.isTravelPaused) {
    return withPlayActionMode(playState);
  }

  const huntHours = normalizeHuntHours(requestedHours);
  if (huntHours <= 0) {
    return withPlayActionMode(playState);
  }

  const maxStamina = normalizeStaminaValue(playState.maxStamina, DEFAULT_MAX_STAMINA);
  const stamina = Math.min(maxStamina, normalizeStaminaValue(playState.stamina, maxStamina));
  if (stamina <= 0) {
    return withPlayActionMode({
      ...playState,
      pendingRestChoice: true,
      latestHuntFeedback: {
        type: "hint",
        text: "Du saknar ork för jakt. Vila först.",
      },
    });
  }

  const context = resolveHuntContext(playState, world);
  if (!context.available) {
    return withPlayActionMode({
      ...playState,
      latestHuntFeedback: {
        type: "hint",
        text: context.reason,
      },
    });
  }

  const currentJourneyHours = normalizeElapsedHours(playState.journeyElapsedHours);
  const runId = normalizeActionCounter(playState.nextHuntRunId);
  const hasTravel = Boolean(playState.travel);
  const wasTravelPaused = Boolean(playState.isTravelPaused);
  const priorPauseReason = playState.travelPauseReason ?? null;
  const startTimeOfDay = normalizeTimeOfDayHours(playState.timeOfDayHours);
  const outlook = describeHuntOutlook(
    context,
    startTimeOfDay,
    playState.vapenTraffsakerhet,
  );

  return withPlayActionMode({
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
    nextHuntRunId: runId + 1,
  });
}

export function cancelHunt(
  playState: PlayStateLike,
  world: WorldLike,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return withPlayActionMode(playState);
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
    return withPlayActionMode(nextState);
  }

  return withPlayActionMode(completeHunt(nextState, {
    type: "stopped",
    text:
      roundedTargetHours > 0
        ? `Du avbryter jakten. ${roundedTargetHours}h räknas.`
        : "Du avbryter jakten innan någon full timme har passerat.",
  }));
}

export function advanceHunt(
  playState: PlayStateLike,
  world: WorldLike,
  elapsedHours: number | null | undefined,
): PlayStateLike {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return withPlayActionMode(playState);
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, Math.floor(elapsedHours))
    : 0;
  if (safeElapsedHours <= 0) {
    return withPlayActionMode(playState);
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
    return withPlayActionMode(nextState);
  }

  if (nextElapsed >= totalHours - 1e-6) {
    return withPlayActionMode(completeHunt(nextState, {
      type: "completed",
      text: "Jakten är avslutad för den planerade tiden.",
    }));
  }

  return withPlayActionMode(nextState);
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

  const outlook = describeHuntOutlook(
    context,
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
  const maxStamina = normalizeStaminaValue(playState.maxStamina, DEFAULT_MAX_STAMINA);
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const nextStamina = Math.max(0, currentStamina - STAMINA_PER_HUNT_HOUR);

  const nextState = {
    ...playState,
    maxStamina,
    stamina: nextStamina,
    hunt: {
      ...huntState,
      completedHours: hourNumber,
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
    return withPlayActionMode(playState);
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
    return withPlayActionMode(nextState);
  }
  const totalHours = normalizeHuntHours(huntState.hours);
  const completedHours = normalizeCompletedHours(huntState.completedHours);
  const summaryText = `Jaktpass: ${completedHours}/${totalHours}h genomförda.`;
  const statusText =
    feedback?.type === "completed"
      ? "Jakten är avslutad."
      : feedback?.type === "stopped"
        ? `Jakten avbröts efter ${completedHours}h.`
        : feedback?.type === "exhausted"
          ? "Du är utmattad och måste vila."
          : feedback?.text;
  return withPlayActionMode({
    ...nextState,
    latestHuntFeedback: {
      type: "result",
      text: statusText ? `${summaryText} ${statusText}` : summaryText,
      runId: huntState.runId,
      hour: totalHours,
    },
  });
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

function resolveHuntSuccessChance(
  context: HuntContextAvailable,
  timeOfDayHours: number | null | undefined,
  weaponAccuracy: number | null | undefined,
) {
  const areaQuality = clamp(normalizeAreaCapacity(context.areaCapacity), 0.08, 1);
  const timeFactor = huntTimeOfDayFactor(timeOfDayHours).factor;
  const biomeFactor = biomeHuntFactor(context.biomeKey);
  const skillFactor = clamp(
    (normalizeWeaponAccuracy(weaponAccuracy) - 20) / 80,
    0,
    1,
  );
  const chance =
    0.28 +
    areaQuality * 0.34 +
    timeFactor * 0.12 +
    biomeFactor * 0.14 +
    skillFactor * 0.18;
  return clamp(chance, HUNT_SUCCESS_MIN_CHANCE, HUNT_SUCCESS_MAX_CHANCE);
}

function describeHuntOutlook(
  context: HuntContextAvailable,
  timeOfDayHours: number | null | undefined,
  weaponAccuracy: number | null | undefined,
) {
  const chance = resolveHuntSuccessChance(
    context,
    timeOfDayHours,
    weaponAccuracy,
  );
  if (chance >= 0.72) {
    return "Bra läge";
  }
  if (chance >= 0.5) {
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
