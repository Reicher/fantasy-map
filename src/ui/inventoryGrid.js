import {
  canMoveInventoryItem,
  getInventorySignature,
  moveInventoryItem,
} from "../game/inventory.js?v=20260412e";

const INVENTORY_DRAG_MIME = "application/x-fantasy-map-inventory-item";
let globalDragPayload = null;

export function createInventoryGridController({
  root,
  gridId = "inventory",
  getInventory,
  onInventoryChange,
  canDropExternalItem,
  onDropExternalItem,
}) {
  let activeDragItemId = null;
  let selectedItemId = null;
  let dropTargetKey = "";
  let lastRenderSignature = null;
  const normalizedGridId =
    typeof gridId === "string" && gridId.trim() ? gridId.trim() : "inventory";

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

        if (dropTargetKey === cellKey) {
          const canHighlight = activeItemForHighlight
            ? canMoveInventoryItem(
                inventory,
                activeItemForHighlight,
                column,
                row,
              )
            : true;
          if (canHighlight) {
            slot.classList.add("is-drop-target");
          }
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
      const payload = {
        gridId: normalizedGridId,
        itemId,
      };
      globalDragPayload = payload;

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(INVENTORY_DRAG_MIME, JSON.stringify(payload));
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
      if (globalDragPayload?.gridId === normalizedGridId) {
        globalDragPayload = null;
      }
      render(true);
    });

    root.addEventListener("dragover", (event) => {
      const slot = event.target.closest(".play-inventory-slot");
      if (!(slot instanceof HTMLElement)) {
        return;
      }

      const dragPayload = getDragPayloadFromEvent(event, {
        fallbackGridId: normalizedGridId,
        fallbackItemId: activeDragItemId,
      });
      if (!dragPayload) {
        return;
      }

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      if (!canDropPayload(dragPayload, column, row)) {
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

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      const payload =
        getDragPayloadFromEvent(event, {
          fallbackGridId: normalizedGridId,
          fallbackItemId: activeDragItemId ?? selectedItemId,
        }) ?? null;
      if (!payload) {
        return;
      }

      if (payload.gridId === normalizedGridId) {
        tryMoveItem(payload.itemId, column, row);
      } else {
        onDropExternalItem?.(payload, column, row);
      }

      activeDragItemId = null;
      dropTargetKey = "";
      if (globalDragPayload?.gridId === payload.gridId) {
        globalDragPayload = null;
      }
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

  function canDropPayload(payload, column, row) {
    if (!payload?.itemId) {
      return false;
    }

    if (payload.gridId === normalizedGridId) {
      const inventory = getInventory?.();
      if (!inventory) {
        return false;
      }
      return canMoveInventoryItem(inventory, payload.itemId, column, row);
    }

    return Boolean(canDropExternalItem?.(payload, column, row));
  }

  function tryMoveItem(itemId, column, row) {
    const inventory = getInventory?.();
    if (!inventory) {
      return false;
    }

    const nextInventory = moveInventoryItem(inventory, itemId, column, row);
    if (nextInventory === inventory) {
      return false;
    }

    onInventoryChange?.(nextInventory);
    return true;
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
  const count = normalizeItemCount(item?.count);
  itemButton.title =
    count > 1
      ? `${label} x${count} (${width}x${height})`
      : `${label} (${width}x${height})`;
  itemButton.setAttribute("aria-label", itemButton.title);

  const symbol = document.createElement("span");
  symbol.className = `play-inventory-item-symbol play-inventory-item-symbol--${item.symbol || "generic"}`;
  symbol.setAttribute("aria-hidden", "true");

  itemButton.appendChild(symbol);

  if (count > 1) {
    const countBadge = document.createElement("span");
    countBadge.className = "play-inventory-item-count";
    countBadge.textContent = String(count);
    countBadge.setAttribute("aria-hidden", "true");
    itemButton.appendChild(countBadge);
  }

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

function getDragPayloadFromEvent(
  event,
  { fallbackGridId = "", fallbackItemId = null } = {},
) {
  if (fallbackItemId) {
    return {
      gridId: fallbackGridId || "inventory",
      itemId: fallbackItemId,
    };
  }

  const payload = parseDragPayload(event?.dataTransfer?.getData(INVENTORY_DRAG_MIME));
  if (payload) {
    return payload;
  }

  return parseDragPayloadFromGlobal();
}

function parseDragPayload(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const gridId =
      typeof parsed.gridId === "string" && parsed.gridId.trim()
        ? parsed.gridId.trim()
        : null;
    const itemId =
      typeof parsed.itemId === "string" && parsed.itemId.trim()
        ? parsed.itemId.trim()
        : null;
    if (!gridId || !itemId) {
      return null;
    }
    return { gridId, itemId };
  } catch {
    return null;
  }
}

function parseDragPayloadFromGlobal() {
  const gridId =
    typeof globalDragPayload?.gridId === "string" &&
    globalDragPayload.gridId.trim()
      ? globalDragPayload.gridId.trim()
      : null;
  const itemId =
    typeof globalDragPayload?.itemId === "string" &&
    globalDragPayload.itemId.trim()
      ? globalDragPayload.itemId.trim()
      : null;
  if (!gridId || !itemId) {
    return null;
  }
  return { gridId, itemId };
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

function normalizeItemCount(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}
