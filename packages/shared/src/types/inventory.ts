export interface InventoryItem {
  id: string;
  type?: string;
  symbol?: string;
  name?: string;
  column: number;
  row: number;
  width?: number;
  height?: number;
  count?: number;
  [key: string]: unknown;
}

export interface InventoryState {
  columns: number;
  rows: number;
  items: InventoryItem[];
  [key: string]: unknown;
}

export interface InventoryDragPayload {
  gridId: string;
  itemId: string;
}

export interface InventoryTransferResult {
  sourceInventory: InventoryState | null | undefined;
  targetInventory: InventoryState | null | undefined;
  moved: boolean;
}

export interface InventoryConsumeResult {
  inventory: InventoryState | null | undefined;
  consumed: number;
  missing: number;
}
