import type {
  InventoryConsumeResult,
  InventoryItem,
  InventoryState,
  InventoryTransferResult,
} from "@fardvag/shared/types/inventory";
import { createRng } from "@fardvag/shared/random";

const DEFAULT_COLUMNS = 4;
const DEFAULT_ROWS = 4;
const STARTING_MEAT_COUNT = 11;
const STARTING_BULLETS_MIN = 3;
const STARTING_BULLETS_MAX = 6;
const STARTING_BULLETS_FALLBACK = 4;
const DEFAULT_MAX_STACK_COUNT = 10;
const STACK_MAX_COUNT_BY_TYPE: Readonly<Record<string, number>> = Object.freeze({
  meat: 12,
  bullets: 30,
  medicine: 6,
  letter: 1,
  tobacco: 12,
  coffee: 12,
});
const ITEM_METADATA_BY_TYPE = Object.freeze({
  meat: Object.freeze({ name: "Köttbit", symbol: "meat" }),
  bullets: Object.freeze({ name: "Kulor", symbol: "bullets" }),
  medicine: Object.freeze({ name: "Medicin", symbol: "medicine" }),
  letter: Object.freeze({ name: "Brev", symbol: "letter" }),
  tobacco: Object.freeze({ name: "Tobak", symbol: "tobacco" }),
  coffee: Object.freeze({ name: "Kaffe", symbol: "coffee" }),
});

export function createInitialInventory(
  options: { seed?: string } = {},
): InventoryState {
  const startingBullets = resolveStartingBulletsCount(options.seed);
  return {
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    items: createStartingItems(startingBullets),
  };
}

export function moveInventoryItem(
  inventory: InventoryState,
  itemId: string,
  column: number,
  row: number,
): InventoryState {
  if (!inventory || !Array.isArray(inventory.items)) {
    return inventory;
  }

  const nextColumn = normalizeCellCoordinate(column);
  const nextRow = normalizeCellCoordinate(row);
  if (!Number.isInteger(nextColumn) || !Number.isInteger(nextRow)) {
    return inventory;
  }

  const itemIndex = inventory.items.findIndex((item) => item?.id === itemId);
  if (itemIndex < 0) {
    return inventory;
  }

  const item = inventory.items[itemIndex];
  if (item.column === nextColumn && item.row === nextRow) {
    return inventory;
  }

  const targetItem = findItemAtCell(
    inventory.items,
    nextColumn,
    nextRow,
    item.id,
  );
  if (canMergeStackItems(item, targetItem)) {
    const itemCount = getItemCount(item);
    const targetCount = getItemCount(targetItem);
    const transferable = Math.min(
      itemCount,
      getStackMaxCount(targetItem) - targetCount,
    );
    if (transferable <= 0) {
      return inventory;
    }

    const nextItems = [];
    for (const entry of inventory.items) {
      if (!entry) {
        continue;
      }

      if (entry.id === targetItem.id) {
        nextItems.push({
          ...entry,
          count: targetCount + transferable,
        });
        continue;
      }

      if (entry.id === item.id) {
        const remaining = itemCount - transferable;
        if (remaining > 0) {
          nextItems.push({
            ...entry,
            count: remaining,
          });
        }
        continue;
      }

      nextItems.push(entry);
    }

    return {
      ...inventory,
      items: nextItems,
    };
  }

  if (!canPlaceItem(inventory, item, nextColumn, nextRow)) {
    return inventory;
  }

  const nextItems = inventory.items.map((entry, index) =>
    index === itemIndex
      ? {
          ...entry,
          column: nextColumn,
          row: nextRow,
        }
      : entry,
  );

  return {
    ...inventory,
    items: nextItems,
  };
}

export function canMoveInventoryItem(
  inventory: InventoryState,
  itemId: string,
  column: number,
  row: number,
): boolean {
  if (!inventory || !Array.isArray(inventory.items)) {
    return false;
  }
  const item = inventory.items.find((entry) => entry?.id === itemId);
  if (!item) {
    return false;
  }

  const nextColumn = normalizeCellCoordinate(column);
  const nextRow = normalizeCellCoordinate(row);
  if (!Number.isInteger(nextColumn) || !Number.isInteger(nextRow)) {
    return false;
  }

  const targetItem = findItemAtCell(inventory.items, nextColumn, nextRow, item.id);
  if (canMergeStackItems(item, targetItem)) {
    return getItemCount(targetItem) < getStackMaxCount(targetItem);
  }

  return canPlaceItem(inventory, item, nextColumn, nextRow);
}

export function getInventorySignature(
  inventory: InventoryState | null | undefined,
): string {
  if (!inventory) {
    return "";
  }

  const columns = Number.isFinite(inventory.columns)
    ? Math.max(1, Math.floor(inventory.columns))
    : DEFAULT_COLUMNS;
  const rows = Number.isFinite(inventory.rows)
    ? Math.max(1, Math.floor(inventory.rows))
    : DEFAULT_ROWS;

  const items = Array.isArray(inventory.items) ? [...inventory.items] : [];
  items.sort((left, right) => String(left?.id).localeCompare(String(right?.id)));

  const itemSignature = items
    .map((item) =>
      [
        item?.id ?? "",
        item?.type ?? "",
        item?.symbol ?? "",
        item?.column ?? 0,
        item?.row ?? 0,
        item?.width ?? 1,
        item?.height ?? 1,
        getItemCount(item),
      ].join(","),
    )
    .join(";");

  return `${columns}x${rows}|${itemSignature}`;
}

export function consumeInventoryItemsByType(
  inventory: InventoryState | null | undefined,
  type: string,
  count = 1,
): InventoryConsumeResult {
  const requestedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!inventory || !Array.isArray(inventory.items) || requestedCount === 0) {
    return {
      inventory,
      consumed: 0,
      missing: requestedCount,
    };
  }

  let remaining = requestedCount;
  let consumed = 0;
  const nextItems = [];

  for (const item of inventory.items) {
    if (remaining > 0 && item?.type === type) {
      const itemCount = getItemCount(item);
      const consumedFromItem = Math.min(itemCount, remaining);
      const nextCount = itemCount - consumedFromItem;
      remaining -= consumedFromItem;
      consumed += consumedFromItem;
      if (nextCount > 0) {
        nextItems.push({
          ...item,
          count: nextCount,
        });
      }
      continue;
    }
    nextItems.push(item);
  }

  if (consumed === 0) {
    return {
      inventory,
      consumed: 0,
      missing: requestedCount,
    };
  }

  return {
    inventory: {
      ...inventory,
      items: nextItems,
    },
    consumed,
    missing: remaining,
  };
}

export function canTransferInventoryItem(
  sourceInventory: InventoryState | null | undefined,
  targetInventory: InventoryState | null | undefined,
  itemId: string,
  column: number,
  row: number,
): boolean {
  if (
    !sourceInventory ||
    !targetInventory ||
    !Array.isArray(sourceInventory.items) ||
    !Array.isArray(targetInventory.items)
  ) {
    return false;
  }

  const nextColumn = normalizeCellCoordinate(column);
  const nextRow = normalizeCellCoordinate(row);
  if (!Number.isInteger(nextColumn) || !Number.isInteger(nextRow)) {
    return false;
  }

  const sourceItem = sourceInventory.items.find((entry) => entry?.id === itemId);
  if (!sourceItem) {
    return false;
  }

  const targetItem = findItemAtCell(targetInventory.items, nextColumn, nextRow);
  if (canMergeStackItems(sourceItem, targetItem)) {
    return getItemCount(targetItem) < getStackMaxCount(targetItem);
  }

  return canPlaceItem(
    targetInventory,
    { ...sourceItem, id: "__transfer-preview__" },
    nextColumn,
    nextRow,
  );
}

export function countInventoryItemsByType(
  inventory: InventoryState | null | undefined,
  type: string,
): number {
  const normalizedType = String(type ?? "").trim().toLowerCase();
  if (!inventory || !Array.isArray(inventory.items) || !normalizedType) {
    return 0;
  }
  let total = 0;
  for (const item of inventory.items) {
    if (!item || String(item.type ?? "").trim().toLowerCase() !== normalizedType) {
      continue;
    }
    total += getItemCount(item);
  }
  return total;
}

export function addInventoryItemsByType(
  inventory: InventoryState | null | undefined,
  type: string,
  count = 1,
  options: {
    name?: string;
    symbol?: string;
    idPrefix?: string;
  } = {},
): {
  inventory: InventoryState | null | undefined;
  added: number;
  missing: number;
} {
  const requestedCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0;
  const normalizedType = String(type ?? "").trim().toLowerCase();
  if (!inventory || requestedCount <= 0 || !normalizedType) {
    return {
      inventory,
      added: 0,
      missing: requestedCount,
    };
  }

  const metadata = ITEM_METADATA_BY_TYPE[normalizedType] ?? null;
  const itemName = String(options.name ?? metadata?.name ?? normalizedType).trim();
  const itemSymbol = String(
    options.symbol ?? metadata?.symbol ?? normalizedType,
  ).trim();
  const idPrefix = String(options.idPrefix ?? normalizedType).trim() || normalizedType;
  const nextInventory: InventoryState = {
    ...inventory,
    columns: normalizeDimension(inventory.columns, DEFAULT_COLUMNS),
    rows: normalizeDimension(inventory.rows, DEFAULT_ROWS),
    items: Array.isArray(inventory.items) ? [...inventory.items] : [],
  };

  let remaining = requestedCount;

  for (let index = 0; index < nextInventory.items.length && remaining > 0; index += 1) {
    const item = nextInventory.items[index];
    if (
      !item ||
      !isStackableItem(item) ||
      String(item.type ?? "").trim().toLowerCase() !== normalizedType
    ) {
      continue;
    }
    const itemCount = getItemCount(item);
    const stackCapacity = Math.max(0, getStackMaxCount(item) - itemCount);
    if (stackCapacity <= 0) {
      continue;
    }
    const addedToStack = Math.min(remaining, stackCapacity);
    remaining -= addedToStack;
    nextInventory.items[index] = {
      ...item,
      count: itemCount + addedToStack,
    };
  }

  const stackMax = getStackMaxCountByType(normalizedType);
  while (remaining > 0) {
    const stackCount = Math.min(remaining, stackMax);
    const draftItem: InventoryItem = {
      id: "__inventory-add__",
      type: normalizedType,
      name: itemName,
      symbol: itemSymbol,
      width: 1,
      height: 1,
      count: stackCount,
      column: 0,
      row: 0,
    };
    const placement = findFirstAvailablePlacement(nextInventory, draftItem);
    if (!placement) {
      break;
    }
    const preferredId = `${idPrefix}-${nextInventory.items.length + 1}`;
    nextInventory.items.push({
      ...draftItem,
      id: ensureUniqueItemId(nextInventory.items, preferredId),
      column: placement.column,
      row: placement.row,
    });
    remaining -= stackCount;
  }

  return {
    inventory: nextInventory,
    added: requestedCount - remaining,
    missing: remaining,
  };
}

export function transferInventoryItem(
  sourceInventory: InventoryState | null | undefined,
  targetInventory: InventoryState | null | undefined,
  itemId: string,
  column: number,
  row: number,
): InventoryTransferResult {
  if (
    !sourceInventory ||
    !targetInventory ||
    !Array.isArray(sourceInventory.items) ||
    !Array.isArray(targetInventory.items)
  ) {
    return {
      sourceInventory,
      targetInventory,
      moved: false,
    };
  }

  const nextColumn = normalizeCellCoordinate(column);
  const nextRow = normalizeCellCoordinate(row);
  if (!Number.isInteger(nextColumn) || !Number.isInteger(nextRow)) {
    return {
      sourceInventory,
      targetInventory,
      moved: false,
    };
  }

  const sourceItemIndex = sourceInventory.items.findIndex(
    (entry) => entry?.id === itemId,
  );
  if (sourceItemIndex < 0) {
    return {
      sourceInventory,
      targetInventory,
      moved: false,
    };
  }

  const sourceItem = sourceInventory.items[sourceItemIndex];
  const targetItem = findItemAtCell(targetInventory.items, nextColumn, nextRow);
  if (canMergeStackItems(sourceItem, targetItem)) {
    const sourceCount = getItemCount(sourceItem);
    const targetCount = getItemCount(targetItem);
    const transferable = Math.min(
      sourceCount,
      getStackMaxCount(targetItem) - targetCount,
    );

    if (transferable <= 0) {
      return {
        sourceInventory,
        targetInventory,
        moved: false,
      };
    }

    const nextSourceItems = [];
    for (let index = 0; index < sourceInventory.items.length; index += 1) {
      if (index !== sourceItemIndex) {
        nextSourceItems.push(sourceInventory.items[index]);
        continue;
      }

      const remaining = sourceCount - transferable;
      if (remaining > 0) {
        nextSourceItems.push({
          ...sourceItem,
          count: remaining,
        });
      }
    }

    const nextTargetItems = targetInventory.items.map((entry) =>
      entry?.id === targetItem.id
        ? {
            ...entry,
            count: targetCount + transferable,
          }
        : entry,
    );

    return {
      sourceInventory: {
        ...sourceInventory,
        items: nextSourceItems,
      },
      targetInventory: {
        ...targetInventory,
        items: nextTargetItems,
      },
      moved: true,
    };
  }

  if (
    !canPlaceItem(
      targetInventory,
      { ...sourceItem, id: "__transfer-preview__" },
      nextColumn,
      nextRow,
    )
  ) {
    return {
      sourceInventory,
      targetInventory,
      moved: false,
    };
  }

  const nextSourceItems = sourceInventory.items.filter(
    (_, index) => index !== sourceItemIndex,
  );
  const nextTargetItems = [...targetInventory.items];
  const preferredId = String(sourceItem.id ?? "");
  const movedItemId = ensureUniqueItemId(nextTargetItems, preferredId);
  nextTargetItems.push({
    ...sourceItem,
    id: movedItemId,
    column: nextColumn,
    row: nextRow,
  });

  return {
    sourceInventory: {
      ...sourceInventory,
      items: nextSourceItems,
    },
    targetInventory: {
      ...targetInventory,
      items: nextTargetItems,
    },
    moved: true,
  };
}

export function transferAllInventoryItems(
  sourceInventory: InventoryState | null | undefined,
  targetInventory: InventoryState | null | undefined,
): InventoryTransferResult {
  if (
    !sourceInventory ||
    !targetInventory ||
    !Array.isArray(sourceInventory.items) ||
    !Array.isArray(targetInventory.items)
  ) {
    return {
      sourceInventory,
      targetInventory,
      moved: false,
    };
  }

  let nextSource = sourceInventory;
  let nextTarget = targetInventory;
  let moved = false;

  const sourceItemIds = sourceInventory.items
    .map((item) => item?.id)
    .filter((itemId) => itemId != null);

  for (const itemId of sourceItemIds) {
    const sourceItem = nextSource.items.find((entry) => entry?.id === itemId);
    if (!sourceItem) {
      continue;
    }

    if (isStackableItem(sourceItem)) {
      for (const targetItem of [...nextTarget.items]) {
        if (!canMergeStackItems(sourceItem, targetItem)) {
          continue;
        }
        const stackCell = getItemTopLeftCell(targetItem);
        const stacked = transferInventoryItem(
          nextSource,
          nextTarget,
          itemId,
          stackCell.column,
          stackCell.row,
        );
        if (!stacked.moved) {
          continue;
        }
        nextSource = stacked.sourceInventory;
        nextTarget = stacked.targetInventory;
        moved = true;

        const remainingSourceItem = nextSource.items.find(
          (entry) => entry?.id === itemId,
        );
        if (!remainingSourceItem) {
          break;
        }
      }
    }

    const remainingSourceItem = nextSource.items.find((entry) => entry?.id === itemId);
    if (!remainingSourceItem) {
      continue;
    }

    const placement = findFirstAvailablePlacement(nextTarget, remainingSourceItem);
    if (!placement) {
      continue;
    }

    const transferred = transferInventoryItem(
      nextSource,
      nextTarget,
      itemId,
      placement.column,
      placement.row,
    );
    if (!transferred.moved) {
      continue;
    }
    nextSource = transferred.sourceInventory;
    nextTarget = transferred.targetInventory;
    moved = true;
  }

  return {
    sourceInventory: nextSource,
    targetInventory: nextTarget,
    moved,
  };
}

export function isInventoryEmpty(
  inventory: InventoryState | null | undefined,
): boolean {
  if (!inventory || !Array.isArray(inventory.items)) {
    return true;
  }

  return !inventory.items.some((item) => getItemCount(item) > 0);
}

function canPlaceItem(
  inventory: InventoryState,
  item: InventoryItem,
  column: number,
  row: number,
): boolean {
  const columns = Number.isFinite(inventory.columns)
    ? Math.max(1, Math.floor(inventory.columns))
    : DEFAULT_COLUMNS;
  const rows = Number.isFinite(inventory.rows)
    ? Math.max(1, Math.floor(inventory.rows))
    : DEFAULT_ROWS;
  const width = Number.isFinite(item.width) ? Math.max(1, Math.floor(item.width)) : 1;
  const height = Number.isFinite(item.height)
    ? Math.max(1, Math.floor(item.height))
    : 1;

  if (column < 0 || row < 0 || column + width > columns || row + height > rows) {
    return false;
  }

  const movingItemId = item.id;
  const items = Array.isArray(inventory.items) ? inventory.items : [];
  for (const other of items) {
    if (!other || other.id === movingItemId) {
      continue;
    }

    const otherColumn = Number.isFinite(other.column)
      ? Math.floor(other.column)
      : Number.NaN;
    const otherRow = Number.isFinite(other.row) ? Math.floor(other.row) : Number.NaN;
    const otherWidth = Number.isFinite(other.width)
      ? Math.max(1, Math.floor(other.width))
      : 1;
    const otherHeight = Number.isFinite(other.height)
      ? Math.max(1, Math.floor(other.height))
      : 1;

    if (!Number.isInteger(otherColumn) || !Number.isInteger(otherRow)) {
      continue;
    }

    if (
      rectanglesOverlap(
        { x: column, y: row, width, height },
        {
          x: otherColumn,
          y: otherRow,
          width: otherWidth,
          height: otherHeight,
        },
      )
    ) {
      return false;
    }
  }

  return true;
}

function findItemAtCell(
  items: InventoryItem[] | null | undefined,
  column: number,
  row: number,
  excludedItemId: string | null = null,
): InventoryItem | null {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    if (!item || (excludedItemId != null && item.id === excludedItemId)) {
      continue;
    }

    const itemColumn = normalizeCellCoordinate(item.column);
    const itemRow = normalizeCellCoordinate(item.row);
    const itemWidth = normalizeDimension(item.width, 1);
    const itemHeight = normalizeDimension(item.height, 1);
    if (!Number.isInteger(itemColumn) || !Number.isInteger(itemRow)) {
      continue;
    }
    if (
      column >= itemColumn &&
      column < itemColumn + itemWidth &&
      row >= itemRow &&
      row < itemRow + itemHeight
    ) {
      return item;
    }
  }

  return null;
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function normalizeCellCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return Math.floor(value);
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function getItemCount(item: InventoryItem | null | undefined): number {
  if (!Number.isFinite(item?.count)) {
    return 1;
  }
  return Math.max(1, Math.floor(item.count));
}

function getStackMaxCount(item: InventoryItem | null | undefined): number {
  if (!isStackableItem(item)) {
    return 1;
  }
  const itemType = String(item?.type ?? "").trim().toLowerCase();
  return getStackMaxCountByType(itemType);
}

function getStackMaxCountByType(itemType: string): number {
  const configuredMax = STACK_MAX_COUNT_BY_TYPE[itemType];
  if (Number.isFinite(configuredMax) && configuredMax > 0) {
    return Math.max(1, Math.floor(configuredMax));
  }
  return DEFAULT_MAX_STACK_COUNT;
}

function isStackableItem(item: InventoryItem | null | undefined): boolean {
  return (
    normalizeDimension(item?.width, 1) === 1 &&
    normalizeDimension(item?.height, 1) === 1
  );
}

function canMergeStackItems(
  sourceItem: InventoryItem | null | undefined,
  targetItem: InventoryItem | null | undefined,
): boolean {
  if (!sourceItem || !targetItem) {
    return false;
  }
  if (!isStackableItem(sourceItem) || !isStackableItem(targetItem)) {
    return false;
  }
  if ((sourceItem.type ?? "") !== (targetItem.type ?? "")) {
    return false;
  }
  if ((sourceItem.symbol ?? "") !== (targetItem.symbol ?? "")) {
    return false;
  }
  return (sourceItem.name ?? "") === (targetItem.name ?? "");
}

function getItemTopLeftCell(item: InventoryItem): { column: number; row: number } {
  return {
    column: normalizeCellCoordinate(item?.column),
    row: normalizeCellCoordinate(item?.row),
  };
}

function findFirstAvailablePlacement(
  inventory: InventoryState,
  item: InventoryItem,
): { column: number; row: number } | null {
  const columns = normalizeDimension(inventory?.columns, DEFAULT_COLUMNS);
  const rows = normalizeDimension(inventory?.rows, DEFAULT_ROWS);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (canPlaceItem(inventory, item, column, row)) {
        return { column, row };
      }
    }
  }

  return null;
}

function ensureUniqueItemId(
  items: Array<InventoryItem | null | undefined>,
  preferredId: string,
): string {
  const baseId = String(preferredId || "item").trim() || "item";
  const existing = new Set(
    (items ?? []).map((entry) => String(entry?.id ?? "")).filter(Boolean),
  );
  if (!existing.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existing.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

function createStartingItems(startingBullets: number): InventoryItem[] {
  return [
    {
      id: "meat-1",
      type: "meat",
      name: "Köttbit",
      symbol: "meat",
      width: 1,
      height: 1,
      count: STARTING_MEAT_COUNT,
      column: 0,
      row: 0,
    },
    {
      id: "bullets-1",
      type: "bullets",
      name: "Kulor",
      symbol: "bullets",
      width: 1,
      height: 1,
      count: startingBullets,
      column: 1,
      row: 0,
    },
  ];
}

function resolveStartingBulletsCount(seed: string | null | undefined): number {
  const safeSeed = String(seed ?? "").trim();
  if (!safeSeed) {
    return STARTING_BULLETS_FALLBACK;
  }
  const rng = createRng(`${safeSeed}:starting-bullets`);
  return rng.int(STARTING_BULLETS_MIN, STARTING_BULLETS_MAX);
}
