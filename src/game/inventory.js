const DEFAULT_COLUMNS = 4;
const DEFAULT_ROWS = 4;
const STARTING_MEAT_COUNT = 6;

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
      remaining -= 1;
      consumed += 1;
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

function createStartingMeatItems() {
  const items = [];
  for (let index = 0; index < STARTING_MEAT_COUNT; index += 1) {
    items.push({
      id: `meat-${index + 1}`,
      type: "meat",
      name: "Köttbit",
      symbol: "meat",
      width: 1,
      height: 1,
      column: index % DEFAULT_COLUMNS,
      row: Math.floor(index / DEFAULT_COLUMNS),
    });
  }
  return items;
}
