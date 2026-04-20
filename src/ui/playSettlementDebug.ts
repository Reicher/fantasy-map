import { getNodeTitle } from "@fardvag/shared/node/model";
import type { NodeLike } from "@fardvag/shared/node/model";
import type { InventoryState } from "@fardvag/shared/types/inventory";
import type { PlaySettlementState, PlayState } from "@fardvag/shared/types/play";
import type { World } from "@fardvag/shared/types/world";

interface SettlementDebugContext {
  node: NodeLike & { id?: number };
  settlementId: number;
  settlementState: PlaySettlementState;
  worldSeed: string | null;
}

export function getCurrentSettlementDebugContext(
  world: World | null | undefined,
  playState: PlayState | null | undefined,
): SettlementDebugContext | null {
  if (!world || !playState || playState.currentNodeId == null) {
    return null;
  }
  const features = world?.features as
    | { nodes?: Array<(NodeLike & { id?: number }) | undefined> }
    | null
    | undefined;
  const nodes = Array.isArray(features?.nodes) ? features.nodes : [];
  const node = nodes?.[playState.currentNodeId] ?? null;
  if (!node || node.marker !== "settlement") {
    return null;
  }
  const settlementId = Number.isFinite(node.id)
    ? Number(node.id)
    : Number(playState.currentNodeId);
  const settlementState = playState.settlementStates?.[String(settlementId)] ?? null;
  if (!settlementState) {
    return null;
  }
  return {
    node,
    settlementId,
    settlementState,
    worldSeed:
      typeof world?.params?.seed === "string" && world.params.seed.trim().length > 0
        ? world.params.seed.trim()
        : null,
  };
}

export function buildSettlementDebugSummary(context: SettlementDebugContext): string {
  const nodeName = getNodeTitle(context.node) || `Settlement ${context.settlementId + 1}`;
  const agents = Array.isArray(context?.settlementState?.agents)
    ? context.settlementState.agents
    : [];
  const inventory = context?.settlementState?.inventory ?? null;
  const inventorySummary = summarizeInventory(inventory);
  const residentLines = agents.length
    ? agents.map((agent, index) => {
        const name = String(agent?.name ?? "").trim() || `Agent ${index + 1}`;
        const health = normalizePositiveInteger(agent?.health);
        const maxHealth = Math.max(1, normalizePositiveInteger(agent?.maxHealth));
        const stamina = normalizePositiveInteger(agent?.stamina);
        const maxStamina = Math.max(1, normalizePositiveInteger(agent?.maxStamina));
        const carriedFood = countInventoryFood(agent?.inventory);
        const stateLabel = String(agent?.state ?? "okänd");
        return `- ${name} (${stateLabel})\n  Hälsa: ${health}/${maxHealth}  Liv: ${health}/${maxHealth}  Stamina: ${stamina}/${maxStamina}  Mat: ${carriedFood}`;
      })
    : ["- Inga boende kvar."];

  const inventoryLines = inventorySummary.length
    ? inventorySummary.map((entry) => `- ${entry.label}: ${entry.count}`)
    : ["- Tomt"];

  return [
    `${nodeName} (ID ${context.settlementId})`,
    `Seed: ${context.worldSeed ?? "okänd"}`,
    "",
    `Boende (${agents.length}):`,
    ...residentLines,
    "",
    "Settlement inventory:",
    ...inventoryLines,
  ].join("\n");
}

function summarizeInventory(
  inventory: InventoryState | null | undefined,
): Array<{ label: string; count: number }> {
  if (!inventory || !Array.isArray(inventory.items)) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const item of inventory.items) {
    if (!item) {
      continue;
    }
    const key = String(item.type ?? item.name ?? item.symbol ?? "okänd").trim() || "okänd";
    const count = Number.isFinite(item.count) ? Math.max(1, Math.floor(item.count)) : 1;
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  const labels = [...counts.keys()].sort((a, b) => a.localeCompare(b, "sv"));
  return labels.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
  }));
}

function countInventoryFood(inventory: InventoryState | null | undefined): number {
  if (!inventory || !Array.isArray(inventory.items)) {
    return 0;
  }
  let total = 0;
  for (const item of inventory.items) {
    if (!item) {
      continue;
    }
    const type = String(item.type ?? "").trim().toLowerCase();
    if (type !== "food" && type !== "meat") {
      continue;
    }
    const count = Number.isFinite(item.count) ? Math.max(1, Math.floor(item.count)) : 1;
    total += count;
  }
  return total;
}

function normalizePositiveInteger(value: unknown): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(Number(value)));
}
