import { createInitialInventory } from "./inventory";
import { createRng } from "@fardvag/shared/random";

const AGENT_INITIATIVE_RANGE = Object.freeze({ min: 5, max: 10 });
const AGENT_VITALITY_RANGE = Object.freeze({ min: 8, max: 16 });
const AGENT_STAMINA_RANGE = Object.freeze({ min: 36, max: 84 });
const AGENT_WEAPON_ACCURACY_RANGE = Object.freeze({ min: 40, max: 90 });

interface GeneratedAgentOptions {
  randomizeCurrentStamina?: boolean;
  inventorySeedSuffix?: string;
}

export interface GeneratedAgentProfile {
  initiative: number;
  vitality: number;
  vapenTraffsakerhet: number;
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
  staminaElapsedHours: number;
  hungerElapsedHours: number;
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
  const vitality = rng
    .fork("vitality")
    .int(AGENT_VITALITY_RANGE.min, AGENT_VITALITY_RANGE.max);
  const maxStamina = rng
    .fork("stamina")
    .int(AGENT_STAMINA_RANGE.min, AGENT_STAMINA_RANGE.max);
  const stamina = options.randomizeCurrentStamina
    ? rng.fork("current-stamina").int(0, maxStamina)
    : maxStamina;

  return {
    initiative: rng
      .fork("initiative")
      .int(AGENT_INITIATIVE_RANGE.min, AGENT_INITIATIVE_RANGE.max),
    vitality,
    vapenTraffsakerhet: rng
      .fork("weapon-accuracy")
      .int(
        AGENT_WEAPON_ACCURACY_RANGE.min,
        AGENT_WEAPON_ACCURACY_RANGE.max,
      ),
    maxHealth: vitality,
    health: vitality,
    maxStamina,
    stamina,
    staminaElapsedHours: 0,
    hungerElapsedHours: 0,
    inventory: createInitialInventory({
      seed: `${profileSeed}:inventory:${String(options.inventorySeedSuffix ?? "default")}`,
    }),
  };
}
