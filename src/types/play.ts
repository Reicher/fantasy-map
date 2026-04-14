import type { InventoryState } from "./inventory";

export interface PlayPathPoint {
  x: number;
  y: number;
}

export interface PlayPathData {
  points?: PlayPathPoint[];
  [key: string]: unknown;
}

export interface PlayTravelState {
  progress?: number;
  totalLength?: number;
  targetNodeId?: number;
  routeType?: string;
  isTravelPaused?: boolean;
  [key: string]: unknown;
}

export interface PlayGameOverState {
  reason?: string;
  message?: string;
  stats?: unknown;
  [key: string]: unknown;
}

export interface PlayRunStats {
  meatEaten?: number;
  travelHours?: number;
  huntHours?: number;
  restHours?: number;
  distanceTraveled?: number;
  [key: string]: unknown;
}

export interface PlayGraph {
  get: (nodeId: number) => Map<number, PlayPathData> | undefined;
  [key: string]: unknown;
}

export interface PlayState {
  gameOver?: PlayGameOverState | null;
  viewMode?: string;
  travel?: PlayTravelState | null;
  isTravelPaused?: boolean;
  rest?: unknown;
  hunt?: unknown;
  pendingRestChoice?: unknown;
  currentNodeId?: number | null;
  lastRegionId?: number | null;
  hoveredNodeId?: number | null;
  pressedNodeId?: number | null;
  latestHuntFeedback?: { type?: string } | null;
  position?: { x: number; y: number; nodeId?: number } | null;
  discoveredCells?: Uint8Array;
  travelPauseReason?: string | null;
  inventory?: InventoryState;
  runStats?: PlayRunStats;
  graph?: PlayGraph;
  timeOfDayHours?: number;
  journeyElapsedHours?: number;
  hungerElapsedHours?: number;
  renderTimeOfDayHours?: number;
  renderElapsedWorldHours?: number;
  discoveredNodeIds?: Uint8Array;
  [key: string]: unknown;
}
