import {
  addInventoryItemsByType,
  consumeInventoryItemsByType,
  countInventoryItemsByType,
  createInitialInventory,
} from "./inventory";
import { createGeneratedAgentProfile } from "./agentFactory";
import {
  STAMINA_PER_HUNT_HOUR,
  STAMINA_PER_REST_HOUR,
} from "./travel/constants";
import { createRng } from "@fardvag/shared/random";
import type { InventoryState } from "@fardvag/shared/types/inventory";
import type {
  PlaySettlementAgent,
  PlaySettlementState,
  PlayState,
} from "@fardvag/shared/types/play";
import type { SettlementData, World } from "@fardvag/shared/types/world";

const MIN_SETTLEMENT_AGENTS = 1;
const MAX_SETTLEMENT_AGENTS = 3;
const AGENT_REST_HOURS_AFTER_HUNT = 8;
const DEFAULT_AGENT_CLICK_RADIUS = 1.25;
const SETTLEMENT_BASE_MEAT = 10;
const SETTLEMENT_MEAT_PER_AGENT = 8;
const DEFAULT_CAMPFIRE_OFFSET_Y = -0.95;
const AGENT_GREETINGS = Object.freeze([
  "God dag, resenär.",
  "Elden håller oss varma i natt.",
  "Vägarna är lugna just nu.",
  "Hoppas du hittar gott om mat där ute.",
  "Håll dig nära ljuset när mörkret faller.",
]);
const AGENT_FIRST_NAMES = Object.freeze([
  "Alva",
  "Bryn",
  "Caro",
  "Dag",
  "Eira",
  "Folke",
  "Greta",
  "Hedda",
  "Ivar",
  "Jora",
  "Knut",
  "Lova",
  "Mira",
  "Nils",
  "Oda",
  "Pär",
  "Runa",
  "Siv",
  "Tage",
  "Yrsa",
]);
const AGENT_LAST_NAMES = Object.freeze([
  "Berg",
  "Lind",
  "Storm",
  "Ek",
  "Vik",
  "Rask",
  "Frost",
  "Skog",
  "Dal",
  "Strand",
  "Malm",
  "Torn",
]);

interface SettlementAgentSeed {
  id: string;
}

export interface SettlementAgentRenderEntry {
  id: string;
  settlementId: number;
  x: number;
  y: number;
  state: string;
  campfireOffsetX: number;
  campfireOffsetY: number;
}

export interface SettlementAgentHit {
  settlementId: number;
  agentId: string;
  greeting: string;
}

export function createInitialSettlementStates(
  world: World | null | undefined,
): Record<string, PlaySettlementState> {
  const settlements = Array.isArray(world?.settlements) ? world.settlements : [];
  if (!settlements.length) {
    return {};
  }

  const result: Record<string, PlaySettlementState> = {};
  for (const settlement of settlements) {
    const state = buildSettlementState(world, settlement);
    result[String(settlement.id)] = state;
  }
  return result;
}

export function advanceSettlementAgentsOneHour(
  playState: PlayState | null | undefined,
  world: World | null | undefined,
): PlayState | null | undefined {
  if (!playState || !world) {
    return playState;
  }

  const settlements = Array.isArray(world.settlements) ? world.settlements : [];
  if (!settlements.length) {
    return playState;
  }

  const currentStates =
    playState.settlementStates ?? createInitialSettlementStates(world);
  const nextStates: Record<string, PlaySettlementState> = {};

  for (const settlement of settlements) {
    const settlementKey = String(settlement.id);
    const currentState =
      currentStates[settlementKey] ?? buildSettlementState(world, settlement);
    let settlementInventory = currentState.inventory;
    const nextAgents: PlaySettlementAgent[] = [];
    for (const agent of currentState.agents ?? []) {
      const advanced = advanceSingleAgentHour(
        agent,
        settlementInventory,
        settlement.id,
      );
      settlementInventory = advanced.settlementInventory;
      if (advanced.agent) {
        nextAgents.push(advanced.agent);
      }
    }
    nextStates[settlementKey] = {
      settlementId: settlement.id,
      inventory: settlementInventory,
      agents: nextAgents,
    };
  }

  return {
    ...playState,
    settlementStates: nextStates,
  };
}

export function collectSettlementAgentRenderEntries(
  playState: PlayState | null | undefined,
  world: World | null | undefined,
): SettlementAgentRenderEntry[] {
  if (!playState || !world || !playState.settlementStates) {
    return [];
  }
  const settlements = Array.isArray(world.settlements) ? world.settlements : [];
  const entries: SettlementAgentRenderEntry[] = [];

  for (const settlement of settlements) {
    const state = playState.settlementStates[String(settlement.id)];
    if (!state || !Array.isArray(state.agents)) {
      continue;
    }
    for (const agent of state.agents) {
      if (!agent?.id) {
        continue;
      }
      entries.push({
        id: String(agent.id),
        settlementId: settlement.id,
        x: settlement.x,
        y: settlement.y,
        state: String(agent.state ?? "resting"),
        campfireOffsetX: Number.isFinite(agent.campfireOffsetX)
          ? Number(agent.campfireOffsetX)
          : 0,
        campfireOffsetY: Number.isFinite(agent.campfireOffsetY)
          ? Number(agent.campfireOffsetY)
          : DEFAULT_CAMPFIRE_OFFSET_Y,
      });
    }
  }

  return entries;
}

export function findRestingSettlementAgentAtWorldPoint(
  playState: PlayState | null | undefined,
  world: World | null | undefined,
  worldX: number,
  worldY: number,
  radius = DEFAULT_AGENT_CLICK_RADIUS,
): SettlementAgentHit | null {
  if (!playState || !world || !playState.settlementStates) {
    return null;
  }
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
    return null;
  }

  const settlements = Array.isArray(world.settlements) ? world.settlements : [];
  let best: { distance: number; hit: SettlementAgentHit } | null = null;

  for (const settlement of settlements) {
    const state = playState.settlementStates[String(settlement.id)];
    if (!state || !Array.isArray(state.agents)) {
      continue;
    }
    for (const agent of state.agents) {
      if (!agent || agent.state !== "resting") {
        continue;
      }
      const health = Number.isFinite(agent.health) ? Number(agent.health) : 0;
      if (health <= 0) {
        continue;
      }
      const agentX =
        settlement.x + (Number.isFinite(agent.campfireOffsetX) ? Number(agent.campfireOffsetX) : 0);
      const agentY =
        settlement.y +
        (Number.isFinite(agent.campfireOffsetY)
          ? Number(agent.campfireOffsetY)
          : DEFAULT_CAMPFIRE_OFFSET_Y);
      const distance = Math.hypot(worldX - agentX, worldY - agentY);
      if (
        distance <= radius &&
        (!best || distance < best.distance)
      ) {
        best = {
          distance,
          hit: {
            settlementId: settlement.id,
            agentId: String(agent.id),
            greeting: String(agent.greeting ?? "Hej."),
          },
        };
      }
    }
  }

  return best?.hit ?? null;
}

function buildSettlementState(
  world: World | null | undefined,
  settlement: SettlementData,
): PlaySettlementState {
  const settlementId = Number(settlement?.id ?? -1);
  const baseSeed = String(world?.params?.seed ?? "seed");
  const agentSeeds = resolveAgentSeeds(world, settlement);
  const inventorySeed = `${baseSeed}:settlement:${settlementId}:inventory`;
  let settlementInventory = createInitialInventory({ seed: inventorySeed });

  const targetMeat = SETTLEMENT_BASE_MEAT + agentSeeds.length * SETTLEMENT_MEAT_PER_AGENT;
  const currentMeat = countInventoryItemsByType(settlementInventory, "meat");
  if (currentMeat < targetMeat) {
    settlementInventory = addInventoryItemsByType(
      settlementInventory,
      "meat",
      targetMeat - currentMeat,
      {
        idPrefix: `settlement-${settlementId}-meat`,
      },
    ).inventory as InventoryState;
  }

  const agents: PlaySettlementAgent[] = [];
  for (const [index, seed] of agentSeeds.entries()) {
    const agentKey = `settlement:${settlementId}:agent:${seed.id}`;
    const profile = createGeneratedAgentProfile(world, agentKey, {
      randomizeCurrentStamina: true,
      inventorySeedSuffix: "npc",
    });
    const spawnRng = createRng(`${baseSeed}:${agentKey}:spawn`);
    const greeting = AGENT_GREETINGS[
      spawnRng.int(0, AGENT_GREETINGS.length - 1)
    ];
    const name = createAgentName(spawnRng.fork("name"));
    const campfireOffset = createCampfireOffset(
      spawnRng.fork("campfire-offset"),
      index,
      agentSeeds.length,
    );
    const extractedMeat = countInventoryItemsByType(profile.inventory, "meat");
    let agentInventory = profile.inventory;
    if (extractedMeat > 0) {
      const removed = consumeInventoryItemsByType(
        agentInventory,
        "meat",
        extractedMeat,
      );
      agentInventory = removed.inventory as InventoryState;
      settlementInventory = addInventoryItemsByType(
        settlementInventory,
        "meat",
        removed.consumed,
        {
          idPrefix: `settlement-${settlementId}-meat`,
        },
      ).inventory as InventoryState;
    }
    const restHoursRemaining = Math.max(
      1,
      Math.ceil((profile.maxStamina - profile.stamina) / STAMINA_PER_REST_HOUR),
    );

    agents.push({
      id: seed.id,
      name,
      settlementId,
      state: "resting",
      greeting,
      initiative: profile.initiative,
      vitality: profile.vitality,
      vapenTraffsakerhet: profile.vapenTraffsakerhet,
      maxHealth: profile.maxHealth,
      health: profile.health,
      maxStamina: profile.maxStamina,
      stamina: profile.stamina,
      staminaElapsedHours: profile.staminaElapsedHours,
      hungerElapsedHours: profile.hungerElapsedHours,
      restHoursRemaining,
      campfireOffsetX: campfireOffset.x,
      campfireOffsetY: campfireOffset.y,
      inventory: agentInventory,
    });
  }

  return {
    settlementId,
    inventory: settlementInventory,
    agents,
  };
}

function resolveAgentSeeds(
  world: World | null | undefined,
  settlement: SettlementData,
): SettlementAgentSeed[] {
  const settlementId = Number(settlement?.id ?? 0);
  const baseSeed = String(world?.params?.seed ?? "seed");
  const listedAgents = Array.isArray(settlement?.agents)
    ? settlement.agents
    : [];
  const cleaned = listedAgents
    .map((entry, index) => {
      const id = String(entry?.id ?? "").trim();
      return {
        id: id || `settlement-${settlementId}-agent-${index + 1}`,
      };
    })
    .filter((entry) => entry.id.length > 0);
  if (cleaned.length > 0) {
    return cleaned;
  }

  const rng = createRng(`${baseSeed}:settlement:${settlementId}:agents`);
  const count = rng.int(MIN_SETTLEMENT_AGENTS, MAX_SETTLEMENT_AGENTS);
  const fallback: SettlementAgentSeed[] = [];
  for (let index = 0; index < count; index += 1) {
    fallback.push({
      id: `settlement-${settlementId}-agent-${index + 1}`,
    });
  }
  return fallback;
}

function createAgentName(rng): string {
  const firstName = AGENT_FIRST_NAMES[
    rng.int(0, AGENT_FIRST_NAMES.length - 1)
  ];
  const lastName = AGENT_LAST_NAMES[
    rng.int(0, AGENT_LAST_NAMES.length - 1)
  ];
  return `${firstName} ${lastName}`;
}

function createCampfireOffset(
  rng,
  index: number,
  total: number,
): { x: number; y: number } {
  const spread = Math.max(0.3, Math.min(1.9, 0.65 + total * 0.18));
  const angleJitter = rng.float(-0.42, 0.42);
  const baseAngle = Math.PI * (1.08 + (index / Math.max(1, total)) * 0.84);
  const radius = rng.float(0.25, spread);
  const x = Math.cos(baseAngle + angleJitter) * radius;
  const y = -Math.max(0.52, Math.abs(Math.sin(baseAngle + angleJitter)) * radius + 0.62);
  return { x, y };
}

function advanceSingleAgentHour(
  agent: PlaySettlementAgent,
  settlementInventory: InventoryState,
  settlementId: number,
): {
  agent: PlaySettlementAgent | null;
  settlementInventory: InventoryState;
} {
  const currentState = String(agent?.state ?? "resting");
  if (currentState === "hunting") {
    return advanceHuntingAgentHour(agent, settlementInventory, settlementId);
  }
  return advanceRestingAgentHour(agent, settlementInventory, settlementId);
}

function advanceRestingAgentHour(
  agent: PlaySettlementAgent,
  settlementInventory: InventoryState,
  settlementId: number,
): {
  agent: PlaySettlementAgent | null;
  settlementInventory: InventoryState;
} {
  const maxHealth = Math.max(1, Math.floor(Number(agent.maxHealth ?? 1)));
  const maxStamina = Math.max(1, Math.floor(Number(agent.maxStamina ?? 1)));
  const currentHealth = Math.max(0, Math.floor(Number(agent.health ?? maxHealth)));
  const currentStamina = Math.max(0, Math.floor(Number(agent.stamina ?? maxStamina)));
  const currentHungerElapsed = Math.max(
    0,
    Math.floor(Number(agent.hungerElapsedHours ?? 0)),
  );
  const currentRestHours = Math.max(
    0,
    Math.floor(Number(agent.restHoursRemaining ?? 0)),
  );

  const hunger = consumeInventoryItemsByType(settlementInventory, "meat", 1);
  const nextSettlementInventory = hunger.inventory as InventoryState;
  const nextHealth = Math.max(0, currentHealth - hunger.missing);
  if (nextHealth <= 0) {
    return {
      agent: null,
      settlementInventory: nextSettlementInventory,
    };
  }

  const recoveredStamina = Math.min(
    maxStamina,
    currentStamina + STAMINA_PER_REST_HOUR,
  );
  const nextRestHours = Math.max(0, currentRestHours - 1);
  let nextAgent: PlaySettlementAgent = {
    ...agent,
    state: "resting",
    maxHealth,
    health: nextHealth,
    maxStamina,
    stamina: recoveredStamina,
    hungerElapsedHours: currentHungerElapsed + 1,
    restHoursRemaining: nextRestHours,
    staminaElapsedHours: 0,
  };

  if (nextRestHours > 0 || recoveredStamina <= 0) {
    return {
      agent: nextAgent,
      settlementInventory: nextSettlementInventory,
    };
  }

  const requiredHuntHours = Math.max(
    1,
    Math.ceil(recoveredStamina / STAMINA_PER_HUNT_HOUR),
  );
  const carriedFood = countInventoryItemsByType(nextAgent.inventory, "meat");
  const shortfall = Math.max(0, requiredHuntHours - carriedFood);
  const packed = transferFood(
    nextSettlementInventory,
    nextAgent.inventory as InventoryState,
    shortfall,
    `agent-${settlementId}-${nextAgent.id}-food`,
  );
  nextAgent = {
    ...nextAgent,
    state: "hunting",
    inventory: packed.targetInventory,
    restHoursRemaining: 0,
  };

  return {
    agent: nextAgent,
    settlementInventory: packed.sourceInventory,
  };
}

function advanceHuntingAgentHour(
  agent: PlaySettlementAgent,
  settlementInventory: InventoryState,
  settlementId: number,
): {
  agent: PlaySettlementAgent | null;
  settlementInventory: InventoryState;
} {
  const maxHealth = Math.max(1, Math.floor(Number(agent.maxHealth ?? 1)));
  const maxStamina = Math.max(1, Math.floor(Number(agent.maxStamina ?? 1)));
  const currentHealth = Math.max(0, Math.floor(Number(agent.health ?? maxHealth)));
  const currentStamina = Math.max(0, Math.floor(Number(agent.stamina ?? maxStamina)));
  const currentHungerElapsed = Math.max(
    0,
    Math.floor(Number(agent.hungerElapsedHours ?? 0)),
  );
  const currentStaminaElapsed = Math.max(
    0,
    Math.floor(Number(agent.staminaElapsedHours ?? 0)),
  );

  const hunger = consumeInventoryItemsByType(agent.inventory, "meat", 1);
  const nextAgentInventory = hunger.inventory as InventoryState;
  const nextHealth = Math.max(0, currentHealth - hunger.missing);
  if (nextHealth <= 0) {
    return {
      agent: null,
      settlementInventory,
    };
  }

  const nextStamina = Math.max(0, currentStamina - STAMINA_PER_HUNT_HOUR);
  let nextAgent: PlaySettlementAgent = {
    ...agent,
    state: "hunting",
    maxHealth,
    health: nextHealth,
    maxStamina,
    stamina: nextStamina,
    hungerElapsedHours: currentHungerElapsed + 1,
    staminaElapsedHours: currentStaminaElapsed + 1,
    inventory: nextAgentInventory,
  };

  if (nextStamina > 0) {
    return {
      agent: nextAgent,
      settlementInventory,
    };
  }

  const carriedMeat = countInventoryItemsByType(nextAgent.inventory, "meat");
  const returned = transferFood(
    nextAgent.inventory as InventoryState,
    settlementInventory,
    carriedMeat,
    `settlement-${settlementId}-returned-meat`,
  );

  nextAgent = {
    ...nextAgent,
    state: "resting",
    inventory: returned.sourceInventory,
    restHoursRemaining: AGENT_REST_HOURS_AFTER_HUNT,
  };

  return {
    agent: nextAgent,
    settlementInventory: returned.targetInventory,
  };
}

function transferFood(
  sourceInventory: InventoryState,
  targetInventory: InventoryState,
  count: number,
  idPrefix: string,
): {
  sourceInventory: InventoryState;
  targetInventory: InventoryState;
  moved: number;
} {
  const requested = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (requested <= 0) {
    return {
      sourceInventory,
      targetInventory,
      moved: 0,
    };
  }

  const consumed = consumeInventoryItemsByType(sourceInventory, "meat", requested);
  if (consumed.consumed <= 0) {
    return {
      sourceInventory: consumed.inventory as InventoryState,
      targetInventory,
      moved: 0,
    };
  }

  const added = addInventoryItemsByType(
    targetInventory,
    "meat",
    consumed.consumed,
    { idPrefix },
  );
  let nextSource = consumed.inventory as InventoryState;
  if (added.missing > 0) {
    nextSource = addInventoryItemsByType(
      nextSource,
      "meat",
      added.missing,
      {
        idPrefix: `${idPrefix}-overflow`,
      },
    ).inventory as InventoryState;
  }

  return {
    sourceInventory: nextSource,
    targetInventory: added.inventory as InventoryState,
    moved: added.added,
  };
}
