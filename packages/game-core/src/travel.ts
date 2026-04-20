import {
  countInventoryItemsByType,
  isInventoryEmpty,
} from "./inventory";
import { createGeneratedAgentProfile } from "./agentFactory";
import { createInitialSettlementStates } from "./settlementAgents";
import { maybeActivateEncounterFromTravelProgress } from "./travel/encounter";
import { dedupePoints } from "@fardvag/shared/utils";
import { regionAtCell, regionAtPosition } from "./playQueries";
import {
  DEFAULT_TIME_OF_DAY_HOURS,
  normalizeTimeOfDayHours,
} from "./timeOfDay";
import { createRng } from "@fardvag/shared/random";
import { getNodeTitle } from "@fardvag/shared/node/model";
import {
  buildTravelBiomeBandSegments,
  createEmptyTravelBiomeBands,
  samplePath,
} from "./travel/biomeBands";
import { withPlayActionMode } from "./travel/actionMode";
import { normalizeStaminaValue } from "./travel/normalizers";
import {
  createInitialRunStats,
  formatDistanceWithUnit,
  normalizeRunStats,
} from "./travel/runStats";
import { measureGraphPathDistance } from "./travel/pathGeometry";
import type {
  PlayEncounterOpponentMember,
  PlayJourneyEventSignpostDirections,
  PlayState,
} from "@fardvag/shared/types/play";

export {
  buildTravelBiomeBandSegments,
  sampleTravelBiomeBandPoints,
} from "./travel/biomeBands";
export {
  getValidTargetIds,
  getDiscoveredNodeIds,
  getVisibleNodeIds,
  isNodeDiscovered,
} from "./travel/selectors";
export {
  toggleTravelPause,
} from "./travel/pause";
export {
  applyHourlyHunger,
  applyHourlyTravelStamina,
  finalizeHourlySurvival,
} from "./travel/survival";
export {
  beginRest,
  cancelRest,
  advanceRest,
} from "./travel/rest";
export {
  beginHunt,
  cancelHunt,
  advanceHunt,
  describeHuntSituation,
} from "./travel/hunt";

const TRAVEL_SPEED = 3.75;
const EVENT_LOOT_COLUMNS = 4;
const EVENT_LOOT_ROWS = 4;
type NodeArrivalResult = {
  event: PlayState["pendingJourneyEvent"];
  abandonedLootByNodeId: NonNullable<PlayState["abandonedLootByNodeId"]>;
  encounter: PlayState["encounter"];
};

export function createPlayState(world): PlayState {
  const playerProfile = createGeneratedAgentProfile(world, "player", {
    inventorySeedSuffix: "player",
  });
  const settlementStates = createInitialSettlementStates(world);
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
  const revealedNodeIds = createRevealedNodeFlags(
    world,
    currentNodeId,
    world.travelGraph,
  );
  revealAroundPosition(
    world,
    discoveredCells,
    currentNode ? { x: currentNode.x, y: currentNode.y } : null,
  );

  const basePlayState: PlayState = {
    graph: world.travelGraph,
    viewMode: "map",
    timeOfDayHours: normalizeTimeOfDayHours(
      world?.params?.startTimeOfDayHours ?? DEFAULT_TIME_OF_DAY_HOURS,
    ),
    currentNodeId,
    position: currentNode ? { x: currentNode.x, y: currentNode.y } : null,
    lastRegionId,
    hoveredNodeId: null,
    pressedNodeId: null,
    travel: null,
    pendingJourneyEvent: null,
    encounter: null,
    latestEncounterResolution: null,
    abandonedLootByNodeId: {},
    inventory: playerProfile.inventory,
    hungerElapsedHours: playerProfile.hungerElapsedHours,
    journeyElapsedHours: 0,
    runStats: createInitialRunStats(),
    initiative: playerProfile.initiative,
    vitality: playerProfile.vitality,
    vapenTraffsakerhet: playerProfile.vapenTraffsakerhet,
    maxHealth: playerProfile.maxHealth,
    health: playerProfile.health,
    maxStamina: playerProfile.maxStamina,
    stamina: playerProfile.stamina,
    staminaElapsedHours: playerProfile.staminaElapsedHours,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
    latestAgentInteraction: null,
    huntAreaStates: {},
    nextHuntRunId: 1,
    settlementStates,
    gameOver: null,
    discoveredCells,
    discoveredNodeIds,
    revealedNodeIds,
    fogDirty: true,
  };

  const initialArrival: NodeArrivalResult =
    currentNode?.marker === "settlement"
      ? createNodeArrivalResult(
          currentNodeId,
          world,
          world.travelGraph,
          basePlayState,
        )
      : {
          event: null,
          abandonedLootByNodeId: normalizeAbandonedLootByNodeId(
            basePlayState.abandonedLootByNodeId,
          ),
          encounter: null,
        };

  return withPlayActionMode(
    {
      ...basePlayState,
      pendingJourneyEvent: initialArrival.event ?? null,
      encounter: initialArrival.encounter ?? null,
      abandonedLootByNodeId: initialArrival.abandonedLootByNodeId,
      latestEncounterResolution: null,
    },
    { force: true },
  );
}

export function beginTravel(playState, targetNodeId, world = null) {
  if (!playState) {
    return withPlayActionMode(playState);
  }

  const hasBlockingEncounter = Boolean(
    playState.encounter && playState.encounter.disposition === "hostile",
  );

  if (
    playState.travel ||
    playState.gameOver ||
    playState.rest ||
    playState.hunt ||
    hasBlockingEncounter
  ) {
    return withPlayActionMode(playState);
  }

  const availableStamina = normalizeStaminaValue(
    playState.stamina,
    playState.maxStamina,
  );
  if (availableStamina <= 0) {
    return withPlayActionMode({
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
    });
  }

  const path = playState.graph.get(playState.currentNodeId)?.get(targetNodeId);
  if (!path) {
    return withPlayActionMode(playState);
  }

  const biomeBandSegments = world
    ? buildTravelBiomeBandSegments(world, path.points)
    : createEmptyTravelBiomeBands();

  return withPlayActionMode({
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
    encounter: null,
    latestEncounterResolution: null,
    isTravelPaused: false,
    travelPauseReason: null,
    pendingRestChoice: false,
    rest: null,
    hunt: null,
    latestHuntFeedback: null,
  });
}

export function advanceTravel(playState, world, deltaMs) {
  if (
    !playState?.travel ||
    !playState.position ||
    playState.isTravelPaused ||
    playState.rest ||
    playState.hunt
  ) {
    return withPlayActionMode(playState);
  }

  let nextProgress = Math.min(
    playState.travel.totalLength,
    playState.travel.progress + (deltaMs / 1000) * TRAVEL_SPEED,
  );
  const currentProgress = Number.isFinite(playState.travel.progress)
    ? playState.travel.progress
    : 0;
  if (
    playState.encounter?.phase === "approaching" &&
    Number.isFinite(playState.encounter?.targetTravelProgress)
  ) {
    nextProgress = Math.min(
      nextProgress,
      Math.max(
        currentProgress,
        Number(playState.encounter.targetTravelProgress),
      ),
    );
  }
  const distanceDelta = Math.max(0, nextProgress - currentProgress);
  const normalizedRunStats = normalizeRunStats(playState.runStats);
  const sample = samplePath(
    playState.travel.points,
    playState.travel.segmentLengths,
    nextProgress,
  );
  const sampleEastDistance = resolveEastDistanceFromStart(world, sample.point?.x);
  const nextMaxEastDistance = Math.max(
    normalizedRunStats.maxEastDistance,
    sampleEastDistance,
  );
  const runStatsChanged =
    distanceDelta > 0 ||
    nextMaxEastDistance > normalizedRunStats.maxEastDistance + 1e-9;
  const runStats = runStatsChanged
    ? {
        ...normalizedRunStats,
        distanceTraveled: normalizedRunStats.distanceTraveled + distanceDelta,
        maxEastDistance: nextMaxEastDistance,
      }
    : playState.runStats;
  const sampledRegionId = regionAtPosition(world, sample.point)?.id ?? null;
  const lastRegionId = sampledRegionId ?? playState.lastRegionId ?? null;
  const discoveredCells =
    playState.discoveredCells ??
    new Uint8Array(world.terrain.width * world.terrain.height);
  const discoveredNodeIds = ensureDiscoveredNodeFlags(playState, world);
  const revealedNodeIds = ensureRevealedNodeFlags(playState, world);
  const revealed = revealAroundPosition(world, discoveredCells, sample.point);

  if (nextProgress >= playState.travel.totalLength - 0.0001) {
    const targetNodeId = playState.travel.targetNodeId;
    const targetNode = world.features?.nodes?.[targetNodeId];
    const finalPosition = targetNode
      ? { x: targetNode.x, y: targetNode.y }
      : sample.point;
    const arrivalEastDistance = resolveEastDistanceFromStart(world, finalPosition?.x);
    const arrivalMaxEastDistance = Math.max(nextMaxEastDistance, arrivalEastDistance);
    const arrivalRunStats =
      arrivalMaxEastDistance > nextMaxEastDistance + 1e-9
        ? {
            ...normalizeRunStats(runStats),
            maxEastDistance: arrivalMaxEastDistance,
          }
        : runStats;
    const finalReveal = revealAroundPosition(
      world,
      discoveredCells,
      finalPosition,
    );
    markNodeDiscovered(discoveredNodeIds, targetNodeId);
    markNodeRevealed(revealedNodeIds, targetNodeId);
    revealNeighborNodes(revealedNodeIds, playState.graph, targetNodeId);
    if (targetNode?.marker === "signpost") {
      discoverSignpostNeighborNodes(
        discoveredNodeIds,
        playState.graph,
        targetNodeId,
      );
    }
    const arrival = createNodeArrivalResult(
      targetNodeId,
      world,
      playState.graph,
      playState,
    );
    return withPlayActionMode({
      ...playState,
      currentNodeId: targetNodeId,
      position: finalPosition,
      lastRegionId:
        targetNode && targetNode.cell != null
          ? (regionAtCell(world, targetNode.cell)?.id ?? lastRegionId)
          : lastRegionId,
      travel: null,
      encounter: arrival.encounter ?? null,
      pendingJourneyEvent: arrival.event,
      latestEncounterResolution: null,
      abandonedLootByNodeId: arrival.abandonedLootByNodeId,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      runStats: arrivalRunStats,
      discoveredCells,
      discoveredNodeIds,
      revealedNodeIds,
      fogDirty: playState.fogDirty || revealed || finalReveal,
    });
  }

  const progressedState = withPlayActionMode({
    ...playState,
    position: sample.point,
    lastRegionId,
    runStats,
    discoveredCells,
    discoveredNodeIds,
    revealedNodeIds,
    fogDirty: playState.fogDirty || revealed,
    travel: {
      ...playState.travel,
      progress: nextProgress,
    },
  });
  if (playState.encounter?.phase === "approaching") {
    return withPlayActionMode(
      maybeActivateEncounterFromTravelProgress(progressedState),
      { force: true },
    );
  }
  return progressedState;
}

export function updateAbandonedLootInventory(playState, nextLootInventory) {
  if (!playState) {
    return withPlayActionMode(playState);
  }

  const lootEvent = getPendingLootEvent(playState);
  if (!lootEvent) {
    return withPlayActionMode(playState);
  }

  if (lootEvent.type === "encounter-loot") {
    if (!nextLootInventory || isInventoryEmpty(nextLootInventory)) {
      const shouldStayPaused = Boolean(playState.travel);
      const nextPauseReason = shouldStayPaused
        ? playState.rest
          ? "resting"
          : playState.hunt
            ? "hunting"
            : "encounter"
        : playState.travelPauseReason;
      return withPlayActionMode({
        ...playState,
        pendingJourneyEvent: null,
        isTravelPaused: shouldStayPaused ? true : playState.isTravelPaused,
        travelPauseReason: nextPauseReason,
      });
    }
    return withPlayActionMode({
      ...playState,
      pendingJourneyEvent: {
        ...lootEvent,
        inventory: cloneInventorySnapshot(nextLootInventory),
      },
    });
  }

  const nextAbandonedLootByNodeId = setAbandonedLootInventoryForNode(
    playState.abandonedLootByNodeId,
    lootEvent.nodeId,
    nextLootInventory,
  );
  if (!nextLootInventory || isInventoryEmpty(nextLootInventory)) {
    return withPlayActionMode({
      ...playState,
      pendingJourneyEvent: null,
      abandonedLootByNodeId: nextAbandonedLootByNodeId,
    });
  }
  return withPlayActionMode({
    ...playState,
    pendingJourneyEvent: {
      ...lootEvent,
      inventory: cloneInventorySnapshot(nextLootInventory),
    },
    abandonedLootByNodeId: nextAbandonedLootByNodeId,
  });
}

function createNodeArrivalResult(
  nodeId,
  world,
  graph = null,
  playState = null,
): NodeArrivalResult {
  const node = nodeId == null ? null : world?.features?.nodes?.[nodeId];
  if (node?.marker === "abandoned") {
    return createAbandonedLootArrivalResult(nodeId, world, playState);
  }
  if (node?.marker === "settlement") {
    return createSettlementEncounterArrivalResult(nodeId, world, playState);
  }
  if (node?.marker === "signpost") {
    return {
      event: createSignpostDirectionsEvent(nodeId, world, graph),
      abandonedLootByNodeId: normalizeAbandonedLootByNodeId(
        playState?.abandonedLootByNodeId,
      ),
      encounter: null,
    };
  }

  return {
    event: null,
    abandonedLootByNodeId: normalizeAbandonedLootByNodeId(
      playState?.abandonedLootByNodeId,
    ),
    encounter: null,
  };
}

function createSettlementEncounterArrivalResult(
  nodeId,
  world,
  playState = null,
): NodeArrivalResult {
  const abandonedLootByNodeId = normalizeAbandonedLootByNodeId(
    playState?.abandonedLootByNodeId,
  );
  const settlementNode = nodeId == null ? null : world?.features?.nodes?.[nodeId] ?? null;
  const settlementId = Number.isFinite(settlementNode?.id)
    ? Number(settlementNode.id)
    : Number(nodeId);
  const settlementState =
    playState?.settlementStates?.[String(settlementId)] ?? null;
  const agents = Array.isArray(settlementState?.agents)
    ? settlementState.agents.filter(
        (agent) =>
          normalizeSettlementStat(agent?.health, 0) > 0 &&
          String(agent?.state ?? "resting") === "resting",
      )
    : [];
  if (!agents.length) {
    return {
      event: null,
      abandonedLootByNodeId,
      encounter: null,
    };
  }

  const opponentMembers: PlayEncounterOpponentMember[] = agents.map((agent, index) => {
    const fallbackName = `Bosättare ${index + 1}`;
    const name = String(agent?.name ?? "").trim() || fallbackName;
    const vitality = normalizeSettlementStat(agent?.vitality, 9);
    const maxHealth = Math.max(4, normalizeSettlementStat(agent?.maxHealth, 12));
    const health = Math.max(
      1,
      Math.min(maxHealth, normalizeSettlementStat(agent?.health, maxHealth)),
    );
    const maxStamina = Math.max(
      4,
      normalizeSettlementStat(agent?.maxStamina, 12),
    );
    const stamina = Math.max(
      1,
      Math.min(maxStamina, normalizeSettlementStat(agent?.stamina, maxStamina)),
    );
    const damageMin = Math.max(1, Math.floor(vitality * 0.28));
    const damageMax = Math.max(damageMin, Math.ceil(vitality * 0.52));
    return {
      id: String(agent?.id ?? `settlement-member-${settlementId}-${index + 1}`),
      name,
      damageMin,
      damageMax,
      maxHealth,
      health,
      maxStamina,
      stamina,
    };
  });
  const memberCount = Math.max(1, opponentMembers.length);
  const averageInitiative = normalizeSettlementStat(
    averageSettlementStat(agents, "initiative", 0),
    0,
  );
  const totalMaxHealth = opponentMembers.reduce((sum, member) => sum + member.maxHealth, 0);
  const totalHealth = opponentMembers.reduce((sum, member) => sum + member.health, 0);
  const averageMaxStamina = Math.max(
    1,
    Math.floor(
      opponentMembers.reduce((sum, member) => sum + member.maxStamina, 0) / memberCount,
    ),
  );
  const averageStamina = Math.max(
    1,
    Math.floor(
      opponentMembers.reduce((sum, member) => sum + member.stamina, 0) / memberCount,
    ),
  );
  const averageDamageMin = Math.max(
    1,
    Math.floor(
      opponentMembers.reduce((sum, member) => sum + member.damageMin, 0) / memberCount,
    ),
  );
  const averageDamageMax = Math.max(
    averageDamageMin,
    Math.ceil(
      opponentMembers.reduce((sum, member) => sum + member.damageMax, 0) / memberCount,
    ),
  );
  const settlementName = String(
    settlementNode?.name ??
      world?.settlements?.find((entry) => Number(entry?.id) === settlementId)?.name ??
      "okänd bosättning",
  ).trim();
  const worldSeed = String(world?.params?.seed ?? "seed");
  const hourIndex = Number.isFinite(playState?.journeyElapsedHours)
    ? Math.max(0, Math.floor(Number(playState.journeyElapsedHours)))
    : 0;
  const encounterRng = createRng(
    `${worldSeed}:settlement-encounter:${settlementId}:${hourIndex}`,
  );
  const encounterId = `settlement-encounter-${settlementId}-${hourIndex}-${encounterRng.int(100, 999)}`;
  const playerInitiative = normalizeSettlementStat(playState?.initiative, 0);
  const settlementWinsInitiative = averageInitiative > playerInitiative;
  const canAttack = countInventoryItemsByType(playState?.inventory, "bullets") > 0;
  const participantNames = opponentMembers
    .map((member) => String(member?.name ?? "").trim())
    .filter((name) => name.length > 0);
  const participantLabel =
    formatSettlementEncounterParticipantNames(participantNames) ||
    (agents.length === 1 ? "en bosättare" : `${agents.length} bosättare`);
  const messageLines = [
    settlementName.length > 0
      ? `Du möter ${participantLabel} från ${settlementName}.`
      : `Du möter ${participantLabel}.`,
  ];
  if (settlementWinsInitiative) {
    messageLines.push("De står lugnt och tittar på dig.");
  } else {
    messageLines.push("Du vinner initiativet.");
  }

  return {
    event: {
      type: "encounter-turn",
      encounterId,
      message: messageLines.join("\n"),
      requiresAcknowledgement: true,
      canAttack,
    },
    abandonedLootByNodeId,
    encounter: {
      id: encounterId,
      type: "settlement-group",
      disposition: "friendly",
      turn: "player",
      entryStyle: "travel-static",
      phase: "active",
      round: 1,
      rollIndex: 0,
      opponentInitiative: averageInitiative,
      opponentDamageMin: averageDamageMin,
      opponentDamageMax: averageDamageMax,
      opponentMaxHealth: totalMaxHealth,
      opponentHealth: totalHealth,
      opponentMaxStamina: averageMaxStamina,
      opponentStamina: averageStamina,
      opponentMembers,
      activeOpponentMemberId: null,
      settlementId,
      settlementName: settlementName.length > 0 ? settlementName : null,
    },
  };
}

function createAbandonedLootArrivalResult(
  nodeId,
  world,
  playState,
): NodeArrivalResult {
  const key = getAbandonedLootNodeKey(nodeId);
  const abandonedLootByNodeId = normalizeAbandonedLootByNodeId(
    playState?.abandonedLootByNodeId,
  );
  const hasTrackedLoot = Object.prototype.hasOwnProperty.call(
    abandonedLootByNodeId,
    key,
  );
  const trackedInventory = hasTrackedLoot ? abandonedLootByNodeId[key] : null;
  const baseInventory = hasTrackedLoot
    ? cloneInventorySnapshot(trackedInventory)
    : createAbandonedLootInventory(world, nodeId);
  const inventory = normalizeLootInventory(baseInventory);
  const nextAbandonedLootByNodeId = hasTrackedLoot
    ? abandonedLootByNodeId
    : setAbandonedLootInventoryForNode(
        abandonedLootByNodeId,
        nodeId,
        inventory,
      );

  if (!inventory || isInventoryEmpty(inventory)) {
    return {
      event: {
        type: "abandoned-empty",
        nodeId: nodeId == null ? null : nodeId,
        message: "Platsen är redan länsad.",
        requiresAcknowledgement: false,
      },
      abandonedLootByNodeId: setAbandonedLootInventoryForNode(
        nextAbandonedLootByNodeId,
        nodeId,
        null,
      ),
      encounter: null,
    };
  }

  return {
    event: {
      type: "abandoned-loot",
      nodeId: nodeId == null ? null : nodeId,
      message: "Du hittar ett övergivet förråd.",
      requiresAcknowledgement: false,
      inventory,
    },
    abandonedLootByNodeId: setAbandonedLootInventoryForNode(
      nextAbandonedLootByNodeId,
      nodeId,
      inventory,
    ),
    encounter: null,
  };
}

function createSignpostDirectionsEvent(
  nodeId,
  world,
  graph = null,
): PlayJourneyEventSignpostDirections {
  const neighborNodeIds = getNeighborNodeIds(graph, nodeId);
  const entries = neighborNodeIds
    .map((neighborNodeId) => {
      const node = world?.features?.nodes?.[neighborNodeId] ?? null;
      if (!node) {
        return null;
      }
      const name = getNodeTitle(node);
      if (typeof name !== "string" || name.trim().length <= 0) {
        return null;
      }
      return {
        name,
        distance: measureGraphPathDistance(graph, nodeId, neighborNodeId),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  return {
    type: "signpost-directions",
    nodeId: nodeId == null ? null : nodeId,
    neighborNodeIds,
    message: buildSignpostDirectionsMessage(entries),
    requiresAcknowledgement: false,
  };
}

function buildSignpostDirectionsMessage(entries) {
  if (!entries?.length) {
    return "Vägposten är svårläst och visar inga tydliga riktningar.";
  }
  const labels = entries.map((entry) =>
    formatDirectionEntryLabel(entry.name, entry.distance),
  );
  return `Vägposten pekar mot:\n${labels.join("\n")}`;
}

function formatDirectionEntryLabel(name, distance) {
  const distanceLabel = formatDistanceWithUnit(distance);
  if (!distanceLabel) {
    return name;
  }
  return `${name} (${distanceLabel})`;
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

function normalizeAbandonedLootByNodeId(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value;
}

function getAbandonedLootNodeKey(nodeId) {
  return String(nodeId ?? "unknown");
}

function setAbandonedLootInventoryForNode(
  abandonedLootByNodeId,
  nodeId,
  inventory,
) {
  const key = getAbandonedLootNodeKey(nodeId);
  const next = {
    ...normalizeAbandonedLootByNodeId(abandonedLootByNodeId),
  };
  const normalizedInventory = normalizeLootInventory(inventory);
  next[key] =
    normalizedInventory && !isInventoryEmpty(normalizedInventory)
      ? normalizedInventory
      : null;
  return next;
}

function normalizeLootInventory(inventory) {
  const snapshot = cloneInventorySnapshot(inventory);
  if (!snapshot || isInventoryEmpty(snapshot)) {
    return null;
  }
  return snapshot;
}

function cloneInventorySnapshot(inventory) {
  if (!inventory || typeof inventory !== "object") {
    return null;
  }
  const columns = Number.isFinite(inventory.columns)
    ? Math.max(1, Math.floor(inventory.columns))
    : EVENT_LOOT_COLUMNS;
  const rows = Number.isFinite(inventory.rows)
    ? Math.max(1, Math.floor(inventory.rows))
    : EVENT_LOOT_ROWS;
  const items = Array.isArray(inventory.items)
    ? inventory.items
        .filter(Boolean)
        .map((item) => ({
          ...item,
          count: Number.isFinite(item?.count)
            ? Math.max(1, Math.floor(item.count))
            : 1,
        }))
    : [];

  return {
    columns,
    rows,
    items,
  };
}

function resolveEastDistanceFromStart(world, currentX) {
  if (!Number.isFinite(currentX)) {
    return 0;
  }
  const startNodeId = Number.isFinite(world?.playerStart?.nodeId)
    ? Number(world.playerStart.nodeId)
    : 0;
  const startNode = world?.features?.nodes?.[startNodeId] ?? null;
  const startX = Number(startNode?.x);
  if (!Number.isFinite(startX)) {
    return 0;
  }
  return Math.max(0, Number(currentX) - startX);
}

function averageSettlementStat(agents, key, fallback = 0) {
  if (!Array.isArray(agents) || agents.length <= 0) {
    return fallback;
  }
  let total = 0;
  let count = 0;
  for (const agent of agents) {
    const value = Number(agent?.[key]);
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }
  if (count <= 0) {
    return fallback;
  }
  return total / count;
}

function normalizeSettlementStat(value, fallback = 0) {
  const fallbackValue = Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 0;
  if (!Number.isFinite(value)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(Number(value)));
}

function formatSettlementEncounterParticipantNames(names) {
  if (!Array.isArray(names) || names.length <= 0) {
    return "";
  }
  const filteredNames = names
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
  if (filteredNames.length <= 0) {
    return "";
  }
  if (filteredNames.length === 1) {
    return filteredNames[0];
  }
  if (filteredNames.length === 2) {
    return `${filteredNames[0]} och ${filteredNames[1]}`;
  }
  return `${filteredNames.slice(0, -1).join(", ")} och ${
    filteredNames[filteredNames.length - 1]
  }`;
}

function getPendingLootEvent(playState) {
  const event = playState?.pendingJourneyEvent;
  return event?.type === "abandoned-loot" || event?.type === "encounter-loot"
    ? event
    : null;
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

function createRevealedNodeFlags(
  world,
  initiallyRevealedNodeId = null,
  graph = null,
) {
  const revealedNodeIds = new Uint8Array(world?.features?.nodes?.length ?? 0);
  markNodeRevealed(revealedNodeIds, initiallyRevealedNodeId);
  revealNeighborNodes(revealedNodeIds, graph, initiallyRevealedNodeId);
  return revealedNodeIds;
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

function ensureRevealedNodeFlags(playState, world) {
  const nodeCount = world?.features?.nodes?.length ?? 0;
  const currentNodeId = playState?.currentNodeId ?? null;
  const graph = playState?.graph ?? world?.travelGraph;
  const existing = playState?.revealedNodeIds;

  if (existing && existing.length === nodeCount) {
    markNodeRevealed(existing, currentNodeId);
    revealNeighborNodes(existing, graph, currentNodeId);
    return existing;
  }

  const revealedNodeIds = new Uint8Array(nodeCount);
  if (existing?.length) {
    const copyLength = Math.min(existing.length, revealedNodeIds.length);
    for (let index = 0; index < copyLength; index += 1) {
      revealedNodeIds[index] = existing[index];
    }
  } else if (playState?.discoveredNodeIds?.length) {
    const copyLength = Math.min(
      playState.discoveredNodeIds.length,
      revealedNodeIds.length,
    );
    for (let index = 0; index < copyLength; index += 1) {
      revealedNodeIds[index] = playState.discoveredNodeIds[index];
    }
  }

  markNodeRevealed(revealedNodeIds, currentNodeId);
  revealNeighborNodes(revealedNodeIds, graph, currentNodeId);
  return revealedNodeIds;
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

function markNodeRevealed(revealedNodeIds, nodeId) {
  if (
    !revealedNodeIds ||
    nodeId == null ||
    nodeId < 0 ||
    nodeId >= revealedNodeIds.length
  ) {
    return;
  }
  revealedNodeIds[nodeId] = 1;
}

function revealNeighborNodes(revealedNodeIds, graph, nodeId) {
  const neighborNodeIds = getNeighborNodeIds(graph, nodeId);
  for (const neighborNodeId of neighborNodeIds) {
    markNodeRevealed(revealedNodeIds, neighborNodeId);
  }
}

function revealAroundPosition(world, discoveredCells, position) {
  if (!world || !discoveredCells || !position) {
    return false;
  }

  const baseRadius = Math.max(1, Number(world.params?.fogVisionRadius ?? 18));
  const radius = Math.max(1, Math.round(baseRadius));
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
