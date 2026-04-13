import { getBiomeDefinitionById } from "../biomes/index.js";
import {
  createInitialInventory,
  consumeInventoryItemsByType,
  transferAllInventoryItems,
} from "./inventory.js?v=20260413a";
import { isSnowCell } from "../generator/models/surfaceModel.js?v=20260402b";
import { clamp, dedupePoints } from "../utils.js";
import { regionAtCell, regionAtPosition } from "./playQueries.js";
import {
  DEFAULT_TIME_OF_DAY_HOURS,
  normalizeTimeOfDayHours,
} from "./timeOfDay.js";
import { createRng } from "../random.js";
import { getNodeTitle } from "../node/model.js";

const TRAVEL_SPEED = 3.75;
const DEFAULT_MAX_HEALTH = 3;
const DEFAULT_MAX_STAMINA = 15;
const STAMINA_PER_TRAVEL_HOUR = 1;
const STAMINA_PER_HUNT_HOUR = 2;
const STAMINA_PER_REST_HOUR = 3;
const PLAYER_INITIATIVE_RANGE = Object.freeze({ min: 5, max: 10 });
const PLAYER_VITALITY_RANGE = Object.freeze({ min: 2, max: 5 });
const PLAYER_STAMINA_RANGE = Object.freeze({ min: 10, max: 25 });
const PLAYER_WEAPON_ACCURACY_RANGE = Object.freeze({ min: 40, max: 90 });
const ACTION_HOUR_OPTIONS = Object.freeze([1, 3, 8]);
const REST_HOUR_OPTIONS = ACTION_HOUR_OPTIONS;
const HUNT_HOUR_OPTIONS = ACTION_HOUR_OPTIONS;
const EVENT_LOOT_COLUMNS = 4;
const EVENT_LOOT_ROWS = 4;
const HUNT_MEAT_LOOT_COLUMNS = 1;
const HUNT_MEAT_LOOT_ROWS = 1;
const HUNT_AREA_RECOVERY_PER_HOUR = 0.024;
const HUNT_SUCCESS_MIN_CHANCE = 0.04;
const HUNT_SUCCESS_MAX_CHANCE = 0.93;
const HUNT_SEA_ROUTE_REASON = "Det finns inget jaktbart vilt ute på öppet hav.";
const HUNT_UNAVAILABLE_REASON = "Här finns inga tydliga jaktspår just nu.";
const HUNT_TIME_OF_DAY_MODIFIERS = Object.freeze([
  { start: 0, end: 4, factor: 0.5, label: "Djup natt" },
  { start: 4, end: 7, factor: 0.88, label: "Gryning" },
  { start: 7, end: 11, factor: 0.64, label: "Morgon" },
  { start: 11, end: 16, factor: 0.48, label: "Mitt på dagen" },
  { start: 16, end: 20, factor: 0.85, label: "Skymning" },
  { start: 20, end: 24, factor: 0.63, label: "Sen kväll" },
]);
const HUNT_BIOME_FACTORS = Object.freeze({
  forest: 0.92,
  rainforest: 0.88,
  plains: 0.68,
  highlands: 0.72,
  mountain: 0.45,
  tundra: 0.43,
  desert: 0.31,
  lake: 0.5,
  ocean: 0.16,
});
const TRAVEL_BIOME_BANDS = {
  near: 0,
  mid: 5,
  far: 10,
};

export function createPlayState(world) {
  const playerStats = createPlayerStats(world);
  const currentNodeId =
    world.playerStart?.nodeId ?? world.features?.nodes?.[0]?.id ?? null;
  const currentNode =
    currentNodeId == null ? null : world.features?.nodes?.[currentNodeId];
  const lastRegionId =
    currentNode && currentNode.cell != null
      ? (regionAtCell(world, currentNode.cell)?.id ?? null)
      : null;
  const discoveredCells = new Uint8Array(
    world.terrain.width * world.terrain.height,
  );
  const discoveredNodeIds = createDiscoveredNodeFlags(world, currentNodeId);
  revealAroundPosition(
    world,
    discoveredCells,
    currentNode ? { x: currentNode.x, y: currentNode.y } : null,
  );

  return {
    graph: world.travelGraph,
    viewMode: "map",
    timeOfDayHours: DEFAULT_TIME_OF_DAY_HOURS,
    currentNodeId,
    position: currentNode ? { x: currentNode.x, y: currentNode.y } : null,
    lastRegionId,
    hoveredNodeId: null,
    pressedNodeId: null,
    travel: null,
    pendingJourneyEvent: null,
    inventory: createInitialInventory(),
    hungerElapsedHours: 0,
    journeyElapsedHours: 0,
    initiative: playerStats.initiative,
    vitality: playerStats.vitality,
    vapenTraffsakerhet: playerStats.vapenTraffsakerhet,
    maxHealth: playerStats.vitality,
    health: playerStats.vitality,
    maxStamina: playerStats.maxStamina,
    stamina: playerStats.maxStamina,
    staminaElapsedHours: 0,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    huntAreaStates: {},
    nextHuntRunId: 1,
    gameOver: null,
    discoveredCells,
    discoveredNodeIds,
    fogDirty: true,
  };
}

export function applyHourlyHunger(playState, elapsedHours) {
  if (!playState || playState.gameOver) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours) ? Math.max(0, elapsedHours) : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }

  const previousElapsed = Number.isFinite(playState.hungerElapsedHours)
    ? Math.max(0, playState.hungerElapsedHours)
    : 0;
  const nextElapsed = previousElapsed + safeElapsedHours;
  const mealsNeeded = Math.max(
    0,
    Math.floor(nextElapsed + 1e-9) - Math.floor(previousElapsed + 1e-9),
  );

  if (mealsNeeded === 0) {
    return {
      ...playState,
      hungerElapsedHours: nextElapsed,
    };
  }

  const { inventory, missing } = consumeInventoryItemsByType(
    playState.inventory,
    "meat",
    mealsNeeded,
  );
  const maxHealth = normalizeHealthValue(
    playState.maxHealth,
    DEFAULT_MAX_HEALTH,
  );
  const currentHealth = normalizeHealthValue(playState.health, maxHealth);
  const nextHealth = Math.max(0, currentHealth - missing);

  const nextState = {
    ...playState,
    inventory,
    hungerElapsedHours: nextElapsed,
    maxHealth,
    health: nextHealth,
  };
  if (nextHealth <= 0) {
    return {
      ...nextState,
      travel: null,
      pendingJourneyEvent: null,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      hoveredNodeId: null,
      pressedNodeId: null,
      gameOver: {
        reason: "starved",
        message: "Du svalt ihjäl.",
      },
    };
  }

  return nextState;
}

export function applyHourlyTravelStamina(playState, elapsedHours) {
  if (!playState || playState.gameOver) {
    return playState;
  }
  if (
    !playState.travel ||
    playState.isTravelPaused ||
    playState.rest ||
    playState.hunt
  ) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, elapsedHours)
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }

  const previousElapsed = normalizeElapsedHours(playState.staminaElapsedHours);
  const nextElapsed = previousElapsed + safeElapsedHours;
  const staminaTicks = Math.max(
    0,
    Math.floor(nextElapsed + 1e-9) - Math.floor(previousElapsed + 1e-9),
  );

  if (staminaTicks <= 0) {
    return {
      ...playState,
      staminaElapsedHours: nextElapsed,
    };
  }

  const maxStamina = normalizeStaminaValue(
    playState.maxStamina,
    DEFAULT_MAX_STAMINA,
  );
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const spentStamina = staminaTicks * STAMINA_PER_TRAVEL_HOUR;
  const nextStamina = Math.max(0, currentStamina - spentStamina);
  const nextState = {
    ...playState,
    maxStamina,
    stamina: nextStamina,
    staminaElapsedHours: nextElapsed,
  };

  if (nextStamina > 0) {
    return nextState;
  }

  return {
    ...nextState,
    viewMode: "journey",
    isTravelPaused: true,
    travelPauseReason: "exhausted",
    pendingRestChoice: true,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    hoveredNodeId: null,
    pressedNodeId: null,
  };
}

export function getValidTargetIds(playState) {
  if (!playState) {
    return [];
  }

  if (
    playState.travel ||
    playState.rest ||
    playState.hunt
  ) {
    return [];
  }

  return [...(playState.graph.get(playState.currentNodeId)?.keys() ?? [])];
}

export function beginTravel(playState, targetNodeId, world = null) {
  if (!playState) {
    return playState;
  }

  if (
    playState.travel ||
    playState.gameOver ||
    playState.rest ||
    playState.hunt
  ) {
    return playState;
  }

  const availableStamina = normalizeStaminaValue(
    playState.stamina,
    playState.maxStamina,
  );
  if (availableStamina <= 0) {
    return {
      ...playState,
      viewMode: "journey",
      isTravelPaused: true,
      travelPauseReason: "exhausted",
      pendingRestChoice: true,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      hoveredNodeId: null,
      pressedNodeId: null,
    };
  }

  const path = playState.graph.get(playState.currentNodeId)?.get(targetNodeId);
  if (!path) {
    return playState;
  }

  const biomeBandSegments = world
    ? buildTravelBiomeBandSegments(world, path.points)
    : createEmptyTravelBiomeBands();

  return {
    ...playState,
    travel: createTravel(
      playState.currentNodeId,
      targetNodeId,
      path.points,
      path.routeType,
      biomeBandSegments,
    ),
    hoveredNodeId: null,
    pressedNodeId: null,
    pendingJourneyEvent: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
  };
}

export function advanceTravel(playState, world, deltaMs) {
  if (
    !playState?.travel ||
    !playState.position ||
    playState.isTravelPaused ||
    playState.rest ||
    playState.hunt
  ) {
    return playState;
  }

  const nextProgress = Math.min(
    playState.travel.totalLength,
    playState.travel.progress + (deltaMs / 1000) * TRAVEL_SPEED,
  );
  const sample = samplePath(
    playState.travel.points,
    playState.travel.segmentLengths,
    nextProgress,
  );
  const sampledRegionId = regionAtPosition(world, sample.point)?.id ?? null;
  const lastRegionId = sampledRegionId ?? playState.lastRegionId ?? null;
  const discoveredCells =
    playState.discoveredCells ??
    new Uint8Array(world.terrain.width * world.terrain.height);
  const discoveredNodeIds = ensureDiscoveredNodeFlags(playState, world);
  const revealed = revealAroundPosition(world, discoveredCells, sample.point);

  if (nextProgress >= playState.travel.totalLength - 0.0001) {
    const targetNodeId = playState.travel.targetNodeId;
    const targetNode = world.features?.nodes?.[targetNodeId];
    const finalPosition = targetNode
      ? { x: targetNode.x, y: targetNode.y }
      : sample.point;
    const finalReveal = revealAroundPosition(
      world,
      discoveredCells,
      finalPosition,
    );
    markNodeDiscovered(discoveredNodeIds, targetNodeId);
    if (targetNode?.marker === "signpost") {
      discoverSignpostNeighborNodes(
        discoveredNodeIds,
        playState.graph,
        targetNodeId,
      );
    }
    return {
      ...playState,
      currentNodeId: targetNodeId,
      position: finalPosition,
      lastRegionId:
        targetNode && targetNode.cell != null
          ? (regionAtCell(world, targetNode.cell)?.id ?? lastRegionId)
          : lastRegionId,
      travel: null,
      pendingJourneyEvent: createNodeArrivalEvent(
        targetNodeId,
        world,
        playState.graph,
      ),
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      discoveredCells,
      discoveredNodeIds,
      fogDirty: playState.fogDirty || revealed || finalReveal,
    };
  }

  return {
    ...playState,
    position: sample.point,
    lastRegionId,
    discoveredCells,
    discoveredNodeIds,
    fogDirty: playState.fogDirty || revealed,
    travel: {
      ...playState.travel,
      progress: nextProgress,
    },
  };
}

export function toggleTravelPause(playState) {
  if (!playState || playState.gameOver || !playState.travel) {
    return playState;
  }
  if (playState.rest || playState.hunt) {
    return playState;
  }

  if (playState.isTravelPaused) {
    const stamina = normalizeStaminaValue(playState.stamina, 0);
    if (stamina <= 0) {
      return {
        ...playState,
        viewMode: "journey",
        isTravelPaused: true,
        travelPauseReason: "exhausted",
        pendingRestChoice: true,
        hoveredNodeId: null,
        pressedNodeId: null,
      };
    }
    return {
      ...playState,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
    };
  }

  return {
    ...playState,
    viewMode: "journey",
    isTravelPaused: true,
    travelPauseReason: "manual",
    pendingRestChoice: false,
    rest: null,
    latestHuntFeedback: null,
  };
}

export function beginRest(playState, requestedHours) {
  if (!playState || playState.gameOver) {
    return playState;
  }
  if (playState.rest || playState.hunt || hasBlockingActionInteraction(playState)) {
    return playState;
  }
  if (playState.travel && !playState.isTravelPaused && !playState.pendingRestChoice) {
    return playState;
  }

  const restHours = normalizeRestHours(requestedHours);
  if (restHours <= 0) {
    return playState;
  }
  const hasTravel = Boolean(playState.travel);
  const wasTravelPaused = Boolean(playState.isTravelPaused);
  const priorPauseReason = playState.travelPauseReason ?? null;

  return {
    ...playState,
    hoveredNodeId: null,
    pressedNodeId: null,
    isTravelPaused: hasTravel ? true : false,
    travelPauseReason: hasTravel ? "resting" : null,
    pendingRestChoice: false,
    latestHuntFeedback: null,
    rest: {
      hours: restHours,
      elapsedHours: 0,
      staminaGain: restHours * STAMINA_PER_REST_HOUR,
      resumeTravelOnFinish: hasTravel && !wasTravelPaused,
      priorWasTravelPaused: wasTravelPaused,
      priorTravelPauseReason: priorPauseReason,
    },
  };
}

export function beginHunt(playState, world, requestedHours) {
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

export function cancelHunt(playState, world) {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return playState;
  }

  const huntState = playState.hunt;
  const totalHours = normalizeHuntHours(huntState.hours);
  const elapsedHours = normalizeElapsedHours(huntState.elapsedHours);
  const roundedTargetHours = clamp(Math.round(elapsedHours), 0, totalHours);

  let nextState = playState;
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

export function cancelRest(playState) {
  if (!playState || playState.gameOver || !playState.rest) {
    return playState;
  }

  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const elapsedHours = normalizeElapsedHours(playState.rest.elapsedHours);
  const roundedTargetHours = clamp(Math.round(elapsedHours), 0, totalRestHours);
  return finishRest(playState, roundedTargetHours, {
    completed: false,
  });
}

export function advanceHunt(playState, world, elapsedHours) {
  if (!playState || playState.gameOver || !playState.hunt || !world) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, elapsedHours)
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }

  const huntState = playState.hunt;
  const totalHours = normalizeHuntHours(huntState.hours);
  const previousElapsed = normalizeElapsedHours(huntState.elapsedHours);
  const nextElapsed = Math.min(totalHours, previousElapsed + safeElapsedHours);
  const completedHours = Math.floor(nextElapsed + 1e-9);

  let nextState = {
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

export function advanceRest(playState, elapsedHours) {
  if (!playState || playState.gameOver || !playState.rest) {
    return playState;
  }

  const safeElapsedHours = Number.isFinite(elapsedHours)
    ? Math.max(0, elapsedHours)
    : 0;
  if (safeElapsedHours <= 0) {
    return playState;
  }

  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const previousElapsed = normalizeElapsedHours(playState.rest.elapsedHours);
  const nextElapsed = Math.min(totalRestHours, previousElapsed + safeElapsedHours);

  if (nextElapsed < totalRestHours - 1e-6) {
    return {
      ...playState,
      rest: {
        ...playState.rest,
        hours: totalRestHours,
        elapsedHours: nextElapsed,
      },
    };
  }

  return finishRest(playState, totalRestHours, { completed: true });
}

export function describeHuntSituation(playState, world) {
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

function resolveHuntHours(playState, world, targetCompletedHours) {
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

function resolveSingleHuntHour(playState, world, hourNumber) {
  if (!playState?.hunt || !world) {
    return playState;
  }

  const huntState = playState.hunt;
  const context = {
    available: true,
    areaKey: huntState.areaKey,
    areaLabel: huntState.areaLabel,
    areaType: huntState.areaType,
    biomeKey: huntState.biomeKey,
    areaCapacity: normalizeAreaCapacity(huntState.areaCapacity),
    worldSeed: huntState.worldSeed,
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

function completeHunt(playState, feedback = null) {
  if (!playState?.hunt) {
    return playState;
  }
  const huntState = playState.hunt;
  const isExhausted = feedback?.type === "exhausted";
  const shouldResumeTravel = shouldResumeTravelAfterHunt(huntState) && !isExhausted;

  const nextState = {
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

function resolveHuntContext(playState, world) {
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
    const nodes = world.features?.nodes ?? [];
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
      .filter((value) => Number.isInteger(value))
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

  const nodes = world.features?.nodes ?? [];
  const currentNode =
    playState.currentNodeId == null ? null : nodes[playState.currentNodeId] ?? null;
  if (currentNode) {
    const biomeKey =
      currentNode.cell != null ? world.climate.biome[currentNode.cell] : "plains";
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

function recoverHuntAreaState(
  huntAreaStates,
  context,
  currentJourneyHours,
  options = {},
) {
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

function previewRecoveredHuntAreaState(huntAreaStates, context, currentJourneyHours) {
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

function createInitialHuntAreaState(context, options = {}) {
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

function resolveHuntSuccessChance(context, areaState, timeOfDayHours, weaponAccuracy) {
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

function resolveSuccessfulHuntDensityDrop(areaState, context, rng) {
  const swing = 0.78 + rng.float() * 0.6;
  const base = context.areaCapacity * 0.13 * swing;
  const pressure = context.areaType === "node" ? 1.12 : 1;
  return clamp(base * pressure, 0.02, context.areaCapacity * 0.45);
}

function resolveFailedHuntDensityDrop(areaState, context, rng) {
  const base = context.areaCapacity * (0.015 + rng.float() * 0.02);
  return clamp(base, 0.002, context.areaCapacity * 0.08);
}

function resolveHuntMeatYield(
  context,
  areaState,
  weaponAccuracy,
  timeOfDayHours,
  rng,
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

function addMeatToInventory(inventory, meatCount, runId, hourNumber) {
  const safeMeatCount = Number.isFinite(meatCount) ? Math.max(0, Math.floor(meatCount)) : 0;
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

function describeHuntOutlook(context, areaState, timeOfDayHours, weaponAccuracy) {
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

function describeHuntPressure(areaState, context) {
  const capacity = normalizeAreaCapacity(context.areaCapacity);
  const densityRatio = capacity > 0 ? areaState.density / capacity : 0;
  if (densityRatio >= 0.82) {
    return "Terrängen bär tydliga viltspår.";
  }
  if (densityRatio >= 0.58) {
    return "Det finns en del färska spår.";
  }
  if (densityRatio >= 0.34) {
    return "Spåren är spridda och gamla.";
  }
  return "Området känns utjagat.";
}

function huntTimeOfDayFactor(timeOfDayHours) {
  const normalized = normalizeTimeOfDayHours(timeOfDayHours);
  for (const band of HUNT_TIME_OF_DAY_MODIFIERS) {
    if (normalized >= band.start && normalized < band.end) {
      return band;
    }
  }
  return HUNT_TIME_OF_DAY_MODIFIERS[0];
}

function biomeHuntFactor(biomeKey) {
  const factor = HUNT_BIOME_FACTORS[biomeKey];
  if (Number.isFinite(factor)) {
    return clamp(factor, 0.1, 1);
  }
  return 0.58;
}

function nodeSettlementWeight(node) {
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

function hasBlockingActionInteraction(playState) {
  return Boolean(playState?.pendingJourneyEvent);
}

function shouldResumeTravelAfterRest(restState) {
  return Boolean(restState?.resumeTravelOnFinish);
}

function shouldResumeTravelAfterHunt(huntState) {
  return Boolean(huntState?.resumeTravelOnFinish);
}

function finishRest(playState, countedRestHours, options = {}) {
  if (!playState?.rest) {
    return playState;
  }
  const totalRestHours = normalizeRestHours(playState.rest.hours);
  const countedHours = clamp(
    Number.isFinite(countedRestHours) ? Math.floor(countedRestHours) : 0,
    0,
    totalRestHours,
  );
  const maxStamina = normalizeStaminaValue(
    playState.maxStamina,
    DEFAULT_MAX_STAMINA,
  );
  const currentStamina = Math.min(
    maxStamina,
    normalizeStaminaValue(playState.stamina, maxStamina),
  );
  const requestedGain = countedHours * STAMINA_PER_REST_HOUR;
  const nextStamina = Math.min(maxStamina, currentStamina + requestedGain);
  const actualGain = Math.max(0, nextStamina - currentStamina);

  return {
    ...playState,
    maxStamina,
    stamina: nextStamina,
    rest: null,
    isTravelPaused: shouldResumeTravelAfterRest(playState.rest)
      ? false
      : Boolean(playState.rest.priorWasTravelPaused),
    travelPauseReason: shouldResumeTravelAfterRest(playState.rest)
      ? null
      : playState.rest.priorWasTravelPaused
        ? (playState.rest.priorTravelPauseReason ?? "manual")
        : null,
    pendingRestChoice: false,
    latestHuntFeedback: {
      type: "result",
      text: options.completed
        ? `Vila klar: ${countedHours}h, +${actualGain} stamina.`
        : countedHours > 0
          ? `Vila avbruten: ${countedHours}h räknas, +${actualGain} stamina.`
          : "Vila avbruten: ingen full timme räknas (+0 stamina).",
    },
  };
}

function normalizeActionCounter(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeHuntHours(value) {
  const wholeHours = Number.isFinite(value) ? Math.floor(value) : 0;
  if (!HUNT_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}

function normalizeCompletedHours(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeStackCount(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeAreaCapacity(value) {
  if (!Number.isFinite(value)) {
    return 0.25;
  }
  return clamp(value, 0.08, 1);
}

function normalizeWeaponAccuracy(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, 100);
}

export function isNodeDiscovered(playState, nodeId) {
  if (nodeId == null || nodeId < 0) {
    return false;
  }

  const discoveredNodeIds = playState?.discoveredNodeIds;
  if (
    discoveredNodeIds &&
    nodeId < discoveredNodeIds.length &&
    discoveredNodeIds[nodeId]
  ) {
    return true;
  }

  return playState?.currentNodeId === nodeId;
}

export function getDiscoveredNodeIds(playState) {
  return [...collectDiscoveredNodeIdSet(playState)].sort((a, b) => a - b);
}

export function getVisibleNodeIds(playState) {
  if (!playState) {
    return [];
  }

  const discoveredNodeIds = collectDiscoveredNodeIdSet(playState);
  const visibleNodeIds = new Set(discoveredNodeIds);
  for (const nodeId of discoveredNodeIds) {
    const neighbors = playState.graph?.get(nodeId);
    if (!neighbors) {
      continue;
    }
    for (const neighborId of neighbors.keys()) {
      if (neighborId != null) {
        visibleNodeIds.add(neighborId);
      }
    }
  }

  if (playState.currentNodeId != null) {
    visibleNodeIds.add(playState.currentNodeId);
  }

  return [...visibleNodeIds].sort((a, b) => a - b);
}

function createNodeArrivalEvent(nodeId, world, graph = null) {
  const node = nodeId == null ? null : world?.features?.nodes?.[nodeId];
  if (node?.marker === "abandoned") {
    return createAbandonedLootEvent(nodeId, world);
  }
  if (node?.marker === "signpost") {
    return createSignpostDirectionsEvent(nodeId, world, graph);
  }

  return null;
}

function createAbandonedLootEvent(nodeId, world) {
  const inventory = createAbandonedLootInventory(world, nodeId);
  return {
    type: "abandoned-loot",
    nodeId: nodeId == null ? null : nodeId,
    message: "Du hittar ett övergivet förråd.",
    requiresAcknowledgement: false,
    inventory,
  };
}

function createSignpostDirectionsEvent(nodeId, world, graph = null) {
  const neighborNodeIds = getNeighborNodeIds(graph, nodeId);
  const names = neighborNodeIds
    .map((neighborNodeId) => world?.features?.nodes?.[neighborNodeId] ?? null)
    .filter(Boolean)
    .map((node) => getNodeTitle(node))
    .filter((name) => typeof name === "string" && name.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "sv"));

  return {
    type: "signpost-directions",
    nodeId: nodeId == null ? null : nodeId,
    neighborNodeIds,
    message: buildSignpostDirectionsMessage(names),
    requiresAcknowledgement: false,
  };
}

function buildSignpostDirectionsMessage(names) {
  if (!names?.length) {
    return "Vägposten är svårläst och visar inga tydliga riktningar.";
  }
  if (names.length === 1) {
    return `Vägposten pekar mot ${names[0]}.`;
  }
  if (names.length === 2) {
    return `Vägposten pekar mot ${names[0]} och ${names[1]}.`;
  }
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1];
  return `Vägposten pekar mot ${head} och ${tail}.`;
}

function discoverSignpostNeighborNodes(discoveredNodeIds, graph, nodeId) {
  const neighborNodeIds = getNeighborNodeIds(graph, nodeId);
  for (const neighborNodeId of neighborNodeIds) {
    markNodeDiscovered(discoveredNodeIds, neighborNodeId);
  }
}

function getNeighborNodeIds(graph, nodeId) {
  if (!graph || nodeId == null) {
    return [];
  }
  const neighbors = graph.get(nodeId);
  if (!neighbors) {
    return [];
  }
  return [...neighbors.keys()].filter((neighborNodeId) =>
    Number.isInteger(neighborNodeId),
  );
}

function createAbandonedLootInventory(world, nodeId) {
  const baseSeed = String(world?.params?.seed ?? "seed");
  const eventSeed = `${baseSeed}:abandoned-loot:${nodeId ?? "unknown"}`;
  const rng = createRng(eventSeed);
  const entries = [
    createLootEntry("meat", "Köttbit", "meat", rng.int(1, 5)),
    createLootEntry("bullets", "Kulor", "bullets", rng.int(0, 3)),
    createLootEntry("medicine", "Medicin", "medicine", rng.int(1, 2)),
    createLootEntry("tobacco", "Tobak", "tobacco", rng.int(1, 2)),
    createLootEntry("coffee", "Kaffe", "coffee", rng.int(1, 2)),
  ].filter((entry) => entry != null);

  const items = [];
  let itemIndex = 1;
  let column = 0;
  let row = 0;
  for (const entry of entries) {
    if (row >= EVENT_LOOT_ROWS) {
      break;
    }
    items.push({
      id: `abandoned-${nodeId ?? "x"}-${entry.type}-${itemIndex}`,
      type: entry.type,
      name: entry.name,
      symbol: entry.symbol,
      width: 1,
      height: 1,
      count: entry.count,
      column,
      row,
    });
    itemIndex += 1;
    column += 1;
    if (column >= EVENT_LOOT_COLUMNS) {
      column = 0;
      row += 1;
    }
  }

  return {
    columns: EVENT_LOOT_COLUMNS,
    rows: EVENT_LOOT_ROWS,
    items,
  };
}

function createLootEntry(type, name, symbol, count) {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  return {
    type,
    name,
    symbol,
    count: Math.max(1, Math.min(10, Math.floor(count))),
  };
}

function createTravel(
  startNodeId,
  targetNodeId,
  points,
  routeType = "road",
  biomeBandSegments = createEmptyTravelBiomeBands(),
) {
  const normalizedPoints = dedupePoints(points);
  const segmentLengths = [];
  let totalLength = 0;

  for (let index = 1; index < normalizedPoints.length; index += 1) {
    const prev = normalizedPoints[index - 1];
    const next = normalizedPoints[index];
    const segmentLength = Math.hypot(next.x - prev.x, next.y - prev.y);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }

  return {
    startNodeId,
    targetNodeId,
    routeType,
    points: normalizedPoints,
    segmentLengths,
    totalLength,
    progress: 0,
    biomeBandSegments,
    biomeSegments: biomeBandSegments.near.segments,
    midDistantBiomeSegments: biomeBandSegments.mid.segments,
    farDistantBiomeSegments: biomeBandSegments.far.segments,
  };
}

function createDiscoveredNodeFlags(world, initiallyDiscoveredNodeId = null) {
  const discoveredNodeIds = new Uint8Array(world?.features?.nodes?.length ?? 0);
  markNodeDiscovered(discoveredNodeIds, initiallyDiscoveredNodeId);
  return discoveredNodeIds;
}

function ensureDiscoveredNodeFlags(playState, world) {
  const nodeCount = world?.features?.nodes?.length ?? 0;
  const currentNodeId = playState?.currentNodeId ?? null;
  const existing = playState?.discoveredNodeIds;

  if (existing && existing.length === nodeCount) {
    markNodeDiscovered(existing, currentNodeId);
    return existing;
  }

  const discoveredNodeIds = new Uint8Array(nodeCount);
  if (existing?.length) {
    const copyLength = Math.min(existing.length, discoveredNodeIds.length);
    for (let index = 0; index < copyLength; index += 1) {
      discoveredNodeIds[index] = existing[index];
    }
  }
  markNodeDiscovered(discoveredNodeIds, currentNodeId);
  return discoveredNodeIds;
}

function markNodeDiscovered(discoveredNodeIds, nodeId) {
  if (
    !discoveredNodeIds ||
    nodeId == null ||
    nodeId < 0 ||
    nodeId >= discoveredNodeIds.length
  ) {
    return;
  }
  discoveredNodeIds[nodeId] = 1;
}

function normalizeHealthValue(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeStaminaValue(value, fallback) {
  const fallbackValue = Number.isFinite(fallback)
    ? Math.max(0, Math.floor(fallback))
    : 0;
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeElapsedHours(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function normalizeRestHours(value) {
  const wholeHours = Number.isFinite(value) ? Math.floor(value) : 0;
  if (!REST_HOUR_OPTIONS.includes(wholeHours)) {
    return 0;
  }
  return wholeHours;
}

function createPlayerStats(world) {
  const baseSeed = String(world?.params?.seed ?? "seed");
  const rng = createRng(`${baseSeed}:player-stats`);
  const vitality = rng
    .fork("vitality")
    .int(PLAYER_VITALITY_RANGE.min, PLAYER_VITALITY_RANGE.max);

  return {
    initiative: rng
      .fork("initiative")
      .int(PLAYER_INITIATIVE_RANGE.min, PLAYER_INITIATIVE_RANGE.max),
    vitality,
    maxStamina: rng
      .fork("stamina")
      .int(PLAYER_STAMINA_RANGE.min, PLAYER_STAMINA_RANGE.max),
    vapenTraffsakerhet: rng
      .fork("weapon-accuracy")
      .int(
        PLAYER_WEAPON_ACCURACY_RANGE.min,
        PLAYER_WEAPON_ACCURACY_RANGE.max,
      ),
  };
}

function collectDiscoveredNodeIdSet(playState) {
  const discoveredNodeIds = new Set();
  const marks = playState?.discoveredNodeIds;
  if (marks?.length) {
    for (let nodeId = 0; nodeId < marks.length; nodeId += 1) {
      if (marks[nodeId]) {
        discoveredNodeIds.add(nodeId);
      }
    }
  }

  if (playState?.currentNodeId != null) {
    discoveredNodeIds.add(playState.currentNodeId);
  }
  return discoveredNodeIds;
}

function buildOffsetTravelBiomeSegments(
  world,
  points,
  offsetDistance = TRAVEL_BIOME_BANDS.mid,
) {
  const normalizedPoints = dedupePoints(points);
  const offsetPoints = normalizedPoints.map((point, index) =>
    offsetPointLeft(normalizedPoints, index, offsetDistance),
  );
  return buildBiomeSegmentsFromPoints(world, offsetPoints);
}

export function buildTravelBiomeBandSegments(world, points) {
  const normalizedPoints = dedupePoints(points);
  return {
    near: createTravelBiomeBand(
      "near",
      TRAVEL_BIOME_BANDS.near,
      buildBiomeSegmentsFromPoints(world, normalizedPoints),
    ),
    mid: createTravelBiomeBand(
      "mid",
      TRAVEL_BIOME_BANDS.mid,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.mid,
      ),
    ),
    far: createTravelBiomeBand(
      "far",
      TRAVEL_BIOME_BANDS.far,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.far,
      ),
    ),
  };
}

export function sampleTravelBiomeBandPoints(travel) {
  if (!travel?.points?.length) {
    return null;
  }

  const progress = Math.max(
    0,
    Math.min(travel.totalLength ?? 0, travel.progress ?? 0),
  );
  const sample = samplePath(
    travel.points,
    travel.segmentLengths ?? [],
    progress,
  );
  const bands = travel.biomeBandSegments ?? createEmptyTravelBiomeBands();

  return {
    near: createTravelBandPointSample(
      "near",
      bands.near?.offsetDistance ?? 0,
      sample.point,
    ),
    mid: createTravelBandPointSample(
      "mid",
      bands.mid?.offsetDistance ?? TRAVEL_BIOME_BANDS.mid,
      offsetSamplePointLeft(
        travel.points,
        sample,
        bands.mid?.offsetDistance ?? TRAVEL_BIOME_BANDS.mid,
      ),
    ),
    far: createTravelBandPointSample(
      "far",
      bands.far?.offsetDistance ?? TRAVEL_BIOME_BANDS.far,
      offsetSamplePointLeft(
        travel.points,
        sample,
        bands.far?.offsetDistance ?? TRAVEL_BIOME_BANDS.far,
      ),
    ),
  };
}

function buildBiomeSegmentsFromPoints(world, points) {
  if (!world || !points?.length) {
    return [];
  }

  const segments = [];
  let current = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const biomeKey = biomeKeyAtPoint(world, point) ?? "plains";
    const biomeInfo = getBiomeDefinitionById(biomeKey);
    const isSnow = isSnowAtPoint(world, point, biomeKey);
    const nextPoint = points[index + 1];
    const distance = nextPoint
      ? Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y)
      : 0;

    if (
      !current ||
      current.biome !== biomeInfo.key ||
      Boolean(current.isSnow) !== isSnow
    ) {
      current = {
        biome: biomeInfo.key,
        label: biomeInfo.label,
        isSnow,
        distance: 0,
      };
      segments.push(current);
    }

    current.distance += distance;
  }

  const totalDistance = segments.reduce(
    (sum, segment) => sum + segment.distance,
    0,
  );
  return segments.map((segment) => ({
    ...segment,
    share: totalDistance > 0 ? segment.distance / totalDistance : 0,
  }));
}

function createTravelBiomeBand(name, offsetDistance, segments) {
  return {
    name,
    offsetDistance,
    segments,
  };
}

function createTravelBandPointSample(name, offsetDistance, point) {
  return {
    name,
    offsetDistance,
    point,
  };
}

function createEmptyTravelBiomeBands() {
  return {
    near: createTravelBiomeBand("near", TRAVEL_BIOME_BANDS.near, []),
    mid: createTravelBiomeBand("mid", TRAVEL_BIOME_BANDS.mid, []),
    far: createTravelBiomeBand("far", TRAVEL_BIOME_BANDS.far, []),
  };
}

function samplePath(points, segmentLengths, distance) {
  if (points.length <= 1) {
    return {
      point: points[0] ?? { x: 0, y: 0 },
      segmentIndex: 0,
      segmentT: 0,
    };
  }

  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (
      distance <= traversed + segmentLength ||
      index === segmentLengths.length - 1
    ) {
      const local =
        segmentLength <= 0 ? 0 : (distance - traversed) / segmentLength;
      const t = Math.max(0, Math.min(1, local));
      const start = points[index];
      const end = points[index + 1];
      return {
        point: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        },
        segmentIndex: index,
        segmentT: t,
      };
    }
    traversed += segmentLength;
  }

  return {
    point: points[points.length - 1],
    segmentIndex: segmentLengths.length - 1,
    segmentT: 1,
  };
}

function offsetPointLeft(points, index, offsetDistance) {
  const current = points[index];
  const previous = points[index - 1] ?? current;
  const next = points[index + 1] ?? current;
  const tangentX = next.x - previous.x;
  const tangentY = next.y - previous.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return { x: current.x, y: current.y };
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;

  return {
    x: current.x + normalX * offsetDistance,
    y: current.y + normalY * offsetDistance,
  };
}

function offsetSamplePointLeft(points, sample, offsetDistance) {
  if (!sample?.point || !points?.length || Math.abs(offsetDistance) <= 0.0001) {
    return sample?.point ?? null;
  }

  const startIndex = Math.max(
    0,
    Math.min(points.length - 1, sample.segmentIndex ?? 0),
  );
  const endIndex = Math.max(0, Math.min(points.length - 1, startIndex + 1));
  const start = points[startIndex] ?? sample.point;
  const end = points[endIndex] ?? sample.point;
  const tangentX = end.x - start.x;
  const tangentY = end.y - start.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return sample.point;
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;
  return {
    x: sample.point.x + normalX * offsetDistance,
    y: sample.point.y + normalY * offsetDistance,
  };
}

function biomeKeyAtPoint(world, position) {
  const cellIndex = getCellIndexAtPoint(world, position);
  if (cellIndex == null) {
    return null;
  }
  return world.climate.biome[cellIndex];
}

function isSnowAtPoint(world, position, biomeKey = null) {
  const cellIndex = getCellIndexAtPoint(world, position);
  if (cellIndex == null) {
    return false;
  }

  return isSnowCell(
    biomeKey ?? world.climate.biome[cellIndex],
    world.terrain.elevation[cellIndex],
    world.terrain.mountainField[cellIndex],
    world.climate.temperature[cellIndex],
    true,
  );
}

function getCellIndexAtPoint(world, position) {
  if (!world || !position) {
    return null;
  }

  const x = Math.max(
    0,
    Math.min(world.terrain.width - 1, Math.floor(position.x)),
  );
  const y = Math.max(
    0,
    Math.min(world.terrain.height - 1, Math.floor(position.y)),
  );
  return y * world.terrain.width + x;
}

function revealAroundPosition(world, discoveredCells, position) {
  if (!world || !discoveredCells || !position) {
    return false;
  }

  const baseRadius = Math.max(1, Number(world.params?.fogVisionRadius ?? 18));
  const radius = Math.max(1, Math.round(baseRadius * 1.5));
  const radiusSq = (radius + 0.35) * (radius + 0.35);
  const minX = Math.max(0, Math.floor(position.x - radius));
  const maxX = Math.min(
    world.terrain.width - 1,
    Math.ceil(position.x + radius),
  );
  const minY = Math.max(0, Math.floor(position.y - radius));
  const maxY = Math.min(
    world.terrain.height - 1,
    Math.ceil(position.y + radius),
  );
  let changed = false;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - position.x;
      const dy = y + 0.5 - position.y;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const index = y * world.terrain.width + x;
      if (discoveredCells[index]) {
        continue;
      }
      discoveredCells[index] = 1;
      changed = true;
    }
  }

  return changed;
}
