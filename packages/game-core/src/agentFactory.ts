import { createInitialInventory } from "./inventory";
import { createRng } from "@fardvag/shared/random";

interface AgentStatRange {
  min: number;
  max: number;
}

interface AgentArchetypeProfile {
  initiative: AgentStatRange;
  maxHealth: AgentStatRange;
  maxStamina: AgentStatRange;
  weaponAccuracy: AgentStatRange;
  damageMin?: AgentStatRange;
  damageMax?: AgentStatRange;
}

export type GeneratedAgentArchetype = "player" | "settler" | "rabbit" | "wolf";

const AGENT_ARCHETYPES: Readonly<Record<GeneratedAgentArchetype, AgentArchetypeProfile>> =
  Object.freeze({
    player: Object.freeze({
      initiative: Object.freeze({ min: 5, max: 10 }),
      maxHealth: Object.freeze({ min: 8, max: 16 }),
      maxStamina: Object.freeze({ min: 36, max: 84 }),
      weaponAccuracy: Object.freeze({ min: 40, max: 90 }),
    }),
    settler: Object.freeze({
      initiative: Object.freeze({ min: 5, max: 10 }),
      maxHealth: Object.freeze({ min: 8, max: 16 }),
      maxStamina: Object.freeze({ min: 36, max: 84 }),
      weaponAccuracy: Object.freeze({ min: 40, max: 90 }),
    }),
    rabbit: Object.freeze({
      initiative: Object.freeze({ min: 4, max: 4 }),
      maxHealth: Object.freeze({ min: 4, max: 4 }),
      maxStamina: Object.freeze({ min: 14, max: 14 }),
      weaponAccuracy: Object.freeze({ min: 0, max: 0 }),
      damageMin: Object.freeze({ min: 1, max: 1 }),
      damageMax: Object.freeze({ min: 2, max: 2 }),
    }),
    wolf: Object.freeze({
      initiative: Object.freeze({ min: 9, max: 9 }),
      maxHealth: Object.freeze({ min: 12, max: 12 }),
      maxStamina: Object.freeze({ min: 20, max: 20 }),
      weaponAccuracy: Object.freeze({ min: 0, max: 0 }),
      damageMin: Object.freeze({ min: 4, max: 4 }),
      damageMax: Object.freeze({ min: 8, max: 8 }),
    }),
  });

interface GeneratedAgentOptions {
  archetype?: GeneratedAgentArchetype;
  randomizeCurrentStamina?: boolean;
  inventorySeedSuffix?: string;
}

export interface GeneratedAgentProfile {
  initiative: number;
  vapenTraffsakerhet: number;
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
  staminaElapsedHours: number;
  hungerElapsedHours: number;
  damageMin: number;
  damageMax: number;
  inventory: ReturnType<typeof createInitialInventory>;
}

export function createGeneratedAgentProfile(
  world,
  key: string,
  options: GeneratedAgentOptions = {},
): GeneratedAgentProfile {
  const baseSeed = String(world?.params?.seed ?? "seed");
  const profileSeed = `${baseSeed}:agent:${String(key ?? "unknown")}`;
  const rng = createRng(profileSeed);
  const archetype = options.archetype ?? "settler";
  const archetypeProfile = AGENT_ARCHETYPES[archetype] ?? AGENT_ARCHETYPES.settler;
  const maxHealth = rollRange(rng, "health", archetypeProfile.maxHealth);
  const maxStamina = rollRange(rng, "stamina", archetypeProfile.maxStamina);
  const stamina = options.randomizeCurrentStamina
    ? rng.fork("current-stamina").int(0, maxStamina)
    : maxStamina;
  const damageMin = archetypeProfile.damageMin
    ? rollRange(rng, "damage-min", archetypeProfile.damageMin)
    : Math.max(1, Math.floor(maxHealth * 0.28));
  const damageMax = Math.max(
    damageMin,
    archetypeProfile.damageMax
      ? rollRange(rng, "damage-max", archetypeProfile.damageMax)
      : Math.ceil(maxHealth * 0.52),
  );

  return {
    initiative: rollRange(rng, "initiative", archetypeProfile.initiative),
    vapenTraffsakerhet: rollRange(
      rng,
      "weapon-accuracy",
      archetypeProfile.weaponAccuracy,
    ),
    maxHealth,
    health: maxHealth,
    maxStamina,
    stamina,
    staminaElapsedHours: 0,
    hungerElapsedHours: 0,
    damageMin,
    damageMax,
    inventory: createInitialInventory({
      seed: `${profileSeed}:inventory:${String(options.inventorySeedSuffix ?? "default")}`,
    }),
  };
}

function rollRange(
  rng: ReturnType<typeof createRng>,
  label: string,
  range: AgentStatRange,
): number {
  const min = Number.isFinite(range?.min) ? Math.floor(Number(range.min)) : 0;
  const max = Number.isFinite(range?.max) ? Math.floor(Number(range.max)) : min;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return rng.fork(label).int(low, high);
}
