import {
  canMoveInventoryItem,
  getInventorySignature,
  moveInventoryItem,
} from "../game/inventory.js?v=20260412d";

export function createInventoryGridController({
  root,
  getInventory,
  onInventoryChange,
}) {
  let activeDragItemId = null;
  let selectedItemId = null;
  let dropTargetKey = "";
  let lastRenderSignature = null;

  if (root) {
    root.classList.add("play-inventory-grid");
    root.setAttribute("role", "grid");
    root.setAttribute("aria-label", "Inventarie");
    bindInteractions();
  }

  return {
    reset,
    render,
  };

  function reset() {
    activeDragItemId = null;
    selectedItemId = null;
    dropTargetKey = "";
    lastRenderSignature = null;
    render(true);
  }

  function render(force = false) {
    if (!root) {
      return "";
    }

    const inventory = getInventory?.();
    if (!inventory) {
      if (root.innerHTML) {
        root.innerHTML = "";
      }
      lastRenderSignature = "";
      return "";
    }

    const inventorySignature = getInventorySignature(inventory);
    const renderSignature = [
      inventorySignature,
      `drag:${activeDragItemId ?? ""}`,
      `selected:${selectedItemId ?? ""}`,
      `target:${dropTargetKey}`,
    ].join("|");

    if (!force && renderSignature === lastRenderSignature) {
      return renderSignature;
    }

    const columns = normalizeDimension(inventory.columns, 4);
    const rows = normalizeDimension(inventory.rows, 4);

    root.style.setProperty("--inventory-columns", String(columns));
    root.style.setProperty("--inventory-rows", String(rows));
    root.innerHTML = "";

    const itemMap = buildTopLeftItemMap(inventory);
    const activeItemForHighlight = activeDragItemId || selectedItemId;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cellKey = buildCellKey(column, row);
        const slot = document.createElement("div");
        slot.className = "play-inventory-slot";
        slot.dataset.column = String(column);
        slot.dataset.row = String(row);
        slot.dataset.cellKey = cellKey;
        slot.setAttribute("role", "gridcell");

        if (
          activeItemForHighlight &&
          dropTargetKey === cellKey &&
          canMoveInventoryItem(inventory, activeItemForHighlight, column, row)
        ) {
          slot.classList.add("is-drop-target");
        }

        const item = itemMap.get(cellKey);
        if (item) {
          slot.appendChild(createItemElement(item, item.id === selectedItemId));
        }

        root.appendChild(slot);
      }
    }

    lastRenderSignature = renderSignature;
    return renderSignature;
  }

  function bindInteractions() {
    root.addEventListener("dragstart", (event) => {
      const itemElement = event.target.closest(".play-inventory-item");
      if (!(itemElement instanceof HTMLElement)) {
        return;
      }

      const itemId = itemElement.dataset.itemId;
      if (!itemId) {
        return;
      }

      activeDragItemId = itemId;
      selectedItemId = itemId;
      dropTargetKey = "";
      itemElement.classList.add("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", itemId);
        event.dataTransfer.setDragImage(
          itemElement,
          Math.round(itemElement.clientWidth / 2),
          Math.round(itemElement.clientHeight / 2),
        );
      }
    });

    root.addEventListener("dragend", (event) => {
      const itemElement = event.target.closest(".play-inventory-item");
      if (itemElement instanceof HTMLElement) {
        itemElement.classList.remove("is-dragging");
      }
      activeDragItemId = null;
      dropTargetKey = "";
      render(true);
    });

    root.addEventListener("dragover", (event) => {
      const slot = event.target.closest(".play-inventory-slot");
      if (!(slot instanceof HTMLElement)) {
        return;
      }

      const dragItemId = activeDragItemId;
      if (!dragItemId) {
        return;
      }

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      const inventory = getInventory?.();
      if (!inventory || !canMoveInventoryItem(inventory, dragItemId, column, row)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      const nextDropTargetKey = buildCellKey(column, row);
      if (nextDropTargetKey !== dropTargetKey) {
        dropTargetKey = nextDropTargetKey;
        render(true);
      }
    });

    root.addEventListener("dragleave", (event) => {
      const slot = event.target.closest(".play-inventory-slot");
      if (!(slot instanceof HTMLElement)) {
        return;
      }
      const slotKey = slot.dataset.cellKey ?? "";
      if (slotKey && slotKey === dropTargetKey) {
        dropTargetKey = "";
        render(true);
      }
    });

    root.addEventListener("drop", (event) => {
      const slot = event.target.closest(".play-inventory-slot");
      if (!(slot instanceof HTMLElement)) {
        return;
      }

      event.preventDefault();

      const dropItemId =
        activeDragItemId ||
        event.dataTransfer?.getData("text/plain") ||
        selectedItemId;
      if (!dropItemId) {
        return;
      }

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      tryMoveItem(dropItemId, column, row);

      activeDragItemId = null;
      dropTargetKey = "";
      render(true);
    });

    root.addEventListener("click", (event) => {
      const itemElement = event.target.closest(".play-inventory-item");
      if (itemElement instanceof HTMLElement) {
        const itemId = itemElement.dataset.itemId;
        if (!itemId) {
          return;
        }
        selectedItemId = selectedItemId === itemId ? null : itemId;
        dropTargetKey = "";
        render(true);
        return;
      }

      const slot = event.target.closest(".play-inventory-slot");
      if (!(slot instanceof HTMLElement) || !selectedItemId) {
        return;
      }

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      tryMoveItem(selectedItemId, column, row);
      dropTargetKey = "";
      render(true);
    });
  }

  function tryMoveItem(itemId, column, row) {
    const inventory = getInventory?.();
    if (!inventory) {
      return;
    }

    const nextInventory = moveInventoryItem(inventory, itemId, column, row);
    if (nextInventory === inventory) {
      return;
    }

    onInventoryChange?.(nextInventory);
  }
}

function createItemElement(item, isSelected) {
  const itemButton = document.createElement("button");
  itemButton.type = "button";
  itemButton.className = `play-inventory-item play-inventory-item--${item.type || "generic"}`;
  if (isSelected) {
    itemButton.classList.add("is-selected");
  }
  itemButton.dataset.itemId = String(item.id ?? "");
  itemButton.draggable = true;
  const label = item.name || "Foremal";
  const width = Number.isFinite(item.width) ? Math.max(1, Math.floor(item.width)) : 1;
  const height = Number.isFinite(item.height) ? Math.max(1, Math.floor(item.height)) : 1;
  itemButton.title = `${label} (${width}x${height})`;
  itemButton.setAttribute("aria-label", itemButton.title);

  const symbol = document.createElement("span");
  symbol.className = `play-inventory-item-symbol play-inventory-item-symbol--${item.symbol || "generic"}`;
  symbol.setAttribute("aria-hidden", "true");

  itemButton.appendChild(symbol);

  return itemButton;
}

function buildTopLeftItemMap(inventory) {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  const map = new Map();

  for (const item of items) {
    if (!item) {
      continue;
    }

    const column = Number.isFinite(item.column) ? Math.floor(item.column) : Number.NaN;
    const row = Number.isFinite(item.row) ? Math.floor(item.row) : Number.NaN;
    if (!Number.isInteger(column) || !Number.isInteger(row)) {
      continue;
    }

    map.set(buildCellKey(column, row), item);
  }

  return map;
}

function buildCellKey(column, row) {
  return `${column}:${row}`;
}

function normalizeDimension(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}
