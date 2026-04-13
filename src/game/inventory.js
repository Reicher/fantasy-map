const DEFAULT_COLUMNS = 4;
const DEFAULT_ROWS = 4;
const STARTING_MEAT_COUNT = 6;
const DEFAULT_MAX_STACK_COUNT = 10;

export function createInitialInventory() {
  return {
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    items: createStartingMeatItems(),
  };
}

export function moveInventoryItem(inventory, itemId, column, row) {
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

export function canMoveInventoryItem(inventory, itemId, column, row) {
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

export function getInventorySignature(inventory) {
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

export function consumeInventoryItemsByType(inventory, type, count = 1) {
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
  sourceInventory,
  targetInventory,
  itemId,
  column,
  row,
) {
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

export function transferInventoryItem(
  sourceInventory,
  targetInventory,
  itemId,
  column,
  row,
) {
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

export function transferAllInventoryItems(sourceInventory, targetInventory) {
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

export function isInventoryEmpty(inventory) {
  if (!inventory || !Array.isArray(inventory.items)) {
    return true;
  }

  return !inventory.items.some((item) => getItemCount(item) > 0);
}

function canPlaceItem(inventory, item, column, row) {
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

function findItemAtCell(items, column, row, excludedItemId = null) {
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

function rectanglesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function normalizeCellCoordinate(value) {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return Math.floor(value);
}

function normalizeDimension(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function getItemCount(item) {
  if (!Number.isFinite(item?.count)) {
    return 1;
  }
  return Math.max(1, Math.floor(item.count));
}

function getStackMaxCount(item) {
  return isStackableItem(item) ? DEFAULT_MAX_STACK_COUNT : 1;
}

function isStackableItem(item) {
  return normalizeDimension(item?.width, 1) === 1 && normalizeDimension(item?.height, 1) === 1;
}

function canMergeStackItems(sourceItem, targetItem) {
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

function getItemTopLeftCell(item) {
  return {
    column: normalizeCellCoordinate(item?.column),
    row: normalizeCellCoordinate(item?.row),
  };
}

function findFirstAvailablePlacement(inventory, item) {
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

function ensureUniqueItemId(items, preferredId) {
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

function createStartingMeatItems() {
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
  ];
}
