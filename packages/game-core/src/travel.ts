import {
  createInitialInventory,
  isInventoryEmpty,
} from "./inventory";
import { dedupePoints } from "@fardvag/shared/utils";
import { regionAtCell, regionAtPosition } from "./playQueries";
import { DEFAULT_TIME_OF_DAY_HOURS } from "./timeOfDay";
import { createRng } from "@fardvag/shared/random";
import { getNodeTitle } from "@fardvag/shared/node/model";
import {
  buildTravelBiomeBandSegments,
  createEmptyTravelBiomeBands,
  samplePath,
} from "./travel/biomeBands";
import { normalizeStaminaValue } from "./travel/normalizers";
import {
  createInitialRunStats,
  formatDistanceWithUnit,
  normalizeRunStats,
} from "./travel/runStats";
import { measureGraphPathDistance } from "./travel/pathGeometry";
import type { PlayState } from "@fardvag/shared/types/play";

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
const PLAYER_INITIATIVE_RANGE = Object.freeze({ min: 5, max: 10 });
const PLAYER_VITALITY_RANGE = Object.freeze({ min: 2, max: 5 });
const PLAYER_STAMINA_RANGE = Object.freeze({ min: 10, max: 25 });
const PLAYER_WEAPON_ACCURACY_RANGE = Object.freeze({ min: 40, max: 90 });
const EVENT_LOOT_COLUMNS = 4;
const EVENT_LOOT_ROWS = 4;

export function createPlayState(world): PlayState {
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
    abandonedLootByNodeId: {},
    inventory: createInitialInventory(),
    hungerElapsedHours: 0,
    journeyElapsedHours: 0,
    runStats: createInitialRunStats(),
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
    revealedNodeIds,
    fogDirty: true,
  };
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
  const currentProgress = Number.isFinite(playState.travel.progress)
    ? playState.travel.progress
    : 0;
  const distanceDelta = Math.max(0, nextProgress - currentProgress);
  const normalizedRunStats = normalizeRunStats(playState.runStats);
  const runStats =
    distanceDelta > 0
      ? {
          ...normalizedRunStats,
          distanceTraveled: normalizedRunStats.distanceTraveled + distanceDelta,
        }
      : playState.runStats;
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
  const revealedNodeIds = ensureRevealedNodeFlags(playState, world);
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
    return {
      ...playState,
      currentNodeId: targetNodeId,
      position: finalPosition,
      lastRegionId:
        targetNode && targetNode.cell != null
          ? (regionAtCell(world, targetNode.cell)?.id ?? lastRegionId)
          : lastRegionId,
      travel: null,
      pendingJourneyEvent: arrival.event,
      abandonedLootByNodeId: arrival.abandonedLootByNodeId,
      isTravelPaused: false,
      travelPauseReason: null,
      pendingRestChoice: false,
      rest: null,
      hunt: null,
      latestHuntFeedback: null,
      runStats,
      discoveredCells,
      discoveredNodeIds,
      revealedNodeIds,
      fogDirty: playState.fogDirty || revealed || finalReveal,
    };
  }

  return {
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
  };
}

export function updateAbandonedLootInventory(playState, nextLootInventory) {
  if (!playState) {
    return playState;
  }

  const lootEvent = getPendingAbandonedLootEvent(playState);
  if (!lootEvent) {
    return playState;
  }

  const nextAbandonedLootByNodeId = setAbandonedLootInventoryForNode(
    playState.abandonedLootByNodeId,
    lootEvent.nodeId,
    nextLootInventory,
  );
  if (!nextLootInventory || isInventoryEmpty(nextLootInventory)) {
    return {
      ...playState,
      pendingJourneyEvent: null,
      abandonedLootByNodeId: nextAbandonedLootByNodeId,
    };
  }

  return {
    ...playState,
    pendingJourneyEvent: {
      ...lootEvent,
      inventory: cloneInventorySnapshot(nextLootInventory),
    },
    abandonedLootByNodeId: nextAbandonedLootByNodeId,
  };
}

function createNodeArrivalResult(nodeId, world, graph = null, playState = null) {
  const node = nodeId == null ? null : world?.features?.nodes?.[nodeId];
  if (node?.marker === "abandoned") {
    return createAbandonedLootArrivalResult(nodeId, world, playState);
  }
  if (node?.marker === "signpost") {
    return {
      event: createSignpostDirectionsEvent(nodeId, world, graph),
      abandonedLootByNodeId: normalizeAbandonedLootByNodeId(
        playState?.abandonedLootByNodeId,
      ),
    };
  }

  return {
    event: null,
    abandonedLootByNodeId: normalizeAbandonedLootByNodeId(
      playState?.abandonedLootByNodeId,
    ),
  };
}

function createAbandonedLootArrivalResult(nodeId, world, playState) {
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
  };
}

function createSignpostDirectionsEvent(nodeId, world, graph = null) {
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

function getPendingAbandonedLootEvent(playState) {
  const event = playState?.pendingJourneyEvent;
  return event?.type === "abandoned-loot" ? event : null;
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
