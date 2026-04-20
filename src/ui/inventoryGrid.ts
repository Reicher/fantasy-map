import {
  canMoveInventoryItem,
  getInventorySignature,
  moveInventoryItem,
} from "@fardvag/game-core";
import type {
  InventoryDragPayload,
  InventoryItem,
  InventoryState,
} from "@fardvag/shared/types/inventory";

const INVENTORY_DRAG_MIME = "application/x-fardvag-inventory-item";

interface InventoryGridControllerOptions {
  root: HTMLElement | null;
  gridId?: string;
  getInventory?: () => InventoryState | null | undefined;
  onInventoryChange?: (nextInventory: InventoryState) => void;
  canDropExternalItem?: (
    payload: InventoryDragPayload,
    column: number,
    row: number,
  ) => boolean;
  onDropExternalItem?: (
    payload: InventoryDragPayload,
    column: number,
    row: number,
  ) => void;
}

interface InventoryGridController {
  reset: () => void;
  render: (force?: boolean) => string;
}

let globalDragPayload: InventoryDragPayload | null = null;

export function createInventoryGridController({
  root,
  gridId = "inventory",
  getInventory,
  onInventoryChange,
  canDropExternalItem,
  onDropExternalItem,
}: InventoryGridControllerOptions): InventoryGridController {
  let activeDragItemId: string | null = null;
  let selectedItemId: string | null = null;
  let dropTargetKey = "";
  let lastRenderSignature: string | null = null;
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

  function reset(): void {
    activeDragItemId = null;
    selectedItemId = null;
    dropTargetKey = "";
    lastRenderSignature = null;
    render(true);
  }

  function render(force = false): string {
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

    const inventorySignature = String(getInventorySignature(inventory));
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
            ? Boolean(
                canMoveInventoryItem(
                  inventory,
                  activeItemForHighlight,
                  column,
                  row,
                ),
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

  function bindInteractions(): void {
    if (!root) {
      return;
    }

    root.addEventListener("dragstart", (event) => {
      const itemElement = getClosestHtmlElement(
        event.target,
        ".play-inventory-item",
      );
      if (!itemElement) {
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

      const payload: InventoryDragPayload = {
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
      const itemElement = getClosestHtmlElement(
        event.target,
        ".play-inventory-item",
      );
      itemElement?.classList.remove("is-dragging");
      activeDragItemId = null;
      dropTargetKey = "";
      if (globalDragPayload?.gridId === normalizedGridId) {
        globalDragPayload = null;
      }
      render(true);
    });

    root.addEventListener("dragover", (event) => {
      const slot = getClosestHtmlElement(event.target, ".play-inventory-slot");
      if (!slot) {
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
      const slot = getClosestHtmlElement(event.target, ".play-inventory-slot");
      if (!slot) {
        return;
      }

      const slotKey = slot.dataset.cellKey ?? "";
      if (slotKey && slotKey === dropTargetKey) {
        dropTargetKey = "";
        render(true);
      }
    });

    root.addEventListener("drop", (event) => {
      const slot = getClosestHtmlElement(event.target, ".play-inventory-slot");
      if (!slot) {
        return;
      }

      event.preventDefault();

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      const payload =
        getDragPayloadFromEvent(event, {
          fallbackGridId: normalizedGridId,
          fallbackItemId: activeDragItemId,
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
      const itemElement = getClosestHtmlElement(
        event.target,
        ".play-inventory-item",
      );
      if (itemElement) {
        const itemId = itemElement.dataset.itemId;
        if (!itemId) {
          return;
        }
        selectedItemId = selectedItemId === itemId ? null : itemId;
        dropTargetKey = "";
        render(true);
        return;
      }

      const slot = getClosestHtmlElement(event.target, ".play-inventory-slot");
      if (!slot || !selectedItemId) {
        return;
      }

      const column = Number(slot.dataset.column);
      const row = Number(slot.dataset.row);
      tryMoveItem(selectedItemId, column, row);
      dropTargetKey = "";
      render(true);
    });
  }

  function canDropPayload(
    payload: InventoryDragPayload,
    column: number,
    row: number,
  ): boolean {
    if (!payload?.itemId) {
      return false;
    }

    if (payload.gridId === normalizedGridId) {
      const inventory = getInventory?.();
      if (!inventory) {
        return false;
      }
      return Boolean(canMoveInventoryItem(inventory, payload.itemId, column, row));
    }

    return Boolean(canDropExternalItem?.(payload, column, row));
  }

  function tryMoveItem(itemId: string, column: number, row: number): boolean {
    const inventory = getInventory?.();
    if (!inventory) {
      return false;
    }

    const nextInventory = moveInventoryItem(
      inventory,
      itemId,
      column,
      row,
    );
    if (nextInventory === inventory) {
      return false;
    }

    onInventoryChange?.(nextInventory);
    return true;
  }
}

function createItemElement(item: InventoryItem, isSelected: boolean): HTMLButtonElement {
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
  const height = Number.isFinite(item.height)
    ? Math.max(1, Math.floor(item.height))
    : 1;
  const count = normalizeItemCount(item?.count);

  const baseTitle =
    count > 1
      ? `${label} x${count} (${width}x${height})`
      : `${label} (${width}x${height})`;
  const normalizedType = String(item.type ?? "").trim().toLowerCase();
  const letterContent =
    normalizedType === "letter" ? String(item["letterContent"] ?? "").trim() : "";
  itemButton.title = letterContent
    ? `${label}\n${letterContent}`
    : normalizedType === "medicine"
      ? `${baseTitle} - Måste vila för att använda.`
      : baseTitle;
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

function buildTopLeftItemMap(inventory: InventoryState): Map<string, InventoryItem> {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  const map = new Map<string, InventoryItem>();

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
  event?: Pick<DragEvent, "dataTransfer"> | null,
  {
    fallbackGridId = "",
    fallbackItemId = null,
  }: { fallbackGridId?: string; fallbackItemId?: string | null } = {},
): InventoryDragPayload | null {
  const payload = parseDragPayload(event?.dataTransfer?.getData(INVENTORY_DRAG_MIME));
  if (payload) {
    return payload;
  }

  const globalPayload = parseDragPayloadFromGlobal();
  if (globalPayload) {
    return globalPayload;
  }

  if (fallbackItemId) {
    return {
      gridId: fallbackGridId || "inventory",
      itemId: fallbackItemId,
    };
  }

  return null;
}

function parseDragPayload(rawValue: string | undefined): InventoryDragPayload | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<InventoryDragPayload> | null;
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

function parseDragPayloadFromGlobal(): InventoryDragPayload | null {
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

function getClosestHtmlElement(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const match = target.closest(selector);
  return match instanceof HTMLElement ? match : null;
}

function buildCellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function normalizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeItemCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}
