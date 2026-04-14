import type { InventoryState } from "./inventory";

export type PlayViewMode = "map" | "journey";

export type TravelPauseReason =
  | "manual"
  | "exhausted"
  | "resting"
  | "hunting";

export interface PlayPathPoint {
  x: number;
  y: number;
}

export interface PlayPathData {
  points?: PlayPathPoint[];
  routeType?: string;
}

export type PlayGraph = Map<number, Map<number, PlayPathData>>;

export interface PlayTravelBiomeBandSegment {
  biome?: string | number;
  label?: string;
  isSnow?: boolean;
  distance?: number;
  share?: number;
  biomeId?: number;
  length?: number;
}

export interface PlayTravelBiomeBand {
  name?: string;
  offsetDistance?: number;
  segments: PlayTravelBiomeBandSegment[];
}

export interface PlayTravelBiomeBandSet {
  near: PlayTravelBiomeBand;
  mid: PlayTravelBiomeBand;
  far: PlayTravelBiomeBand;
}

export interface PlayTravelState {
  startNodeId?: number | null;
  targetNodeId?: number | null;
  routeType?: string;
  points?: PlayPathPoint[];
  segmentLengths?: number[];
  totalLength?: number;
  progress?: number;
  biomeBandSegments?: PlayTravelBiomeBandSet;
  biomeSegments?: PlayTravelBiomeBandSegment[];
  midDistantBiomeSegments?: PlayTravelBiomeBandSegment[];
  farDistantBiomeSegments?: PlayTravelBiomeBandSegment[];
}

export interface PlayGameOverState {
  reason?: string;
  message?: string;
  stats?: PlayRunStats | null;
}

export interface PlayRunStats {
  meatEaten?: number;
  travelHours?: number;
  huntHours?: number;
  restHours?: number;
  distanceTraveled?: number;
}

export interface PlayRestState {
  hours?: number;
  elapsedHours?: number;
  staminaGain?: number;
  resumeTravelOnFinish?: boolean;
  priorWasTravelPaused?: boolean;
  priorTravelPauseReason?: TravelPauseReason | null;
}

export interface PlayHuntState {
  runId?: number;
  seed?: string;
  hours?: number;
  elapsedHours?: number;
  completedHours?: number;
  successfulHours?: number;
  totalMeatGained?: number;
  areaKey?: string;
  areaLabel?: string;
  areaType?: string;
  biomeKey?: string | number;
  areaCapacity?: number;
  worldSeed?: string;
  startedAtJourneyHours?: number;
  startedTimeOfDayHours?: number;
  resumeTravelOnFinish?: boolean;
  priorWasTravelPaused?: boolean;
  priorTravelPauseReason?: TravelPauseReason | null;
  lastMessage?: string;
}

export interface PlayHuntAreaState {
  areaCapacity?: number;
  density?: number;
  lastUpdatedHours?: number;
}

export interface PlayHuntFeedback {
  type?: "hint" | "result" | "stopped" | "completed" | "exhausted";
  text?: string;
  runId?: number;
  hour?: number;
}

interface PlayJourneyEventBase {
  nodeId?: number | null;
  message?: string;
  requiresAcknowledgement?: boolean;
}

export interface PlayJourneyEventAbandonedLoot extends PlayJourneyEventBase {
  type: "abandoned-loot";
  inventory?: InventoryState | null;
}

export interface PlayJourneyEventAbandonedEmpty extends PlayJourneyEventBase {
  type: "abandoned-empty";
}

export interface PlayJourneyEventSignpostDirections
  extends PlayJourneyEventBase {
  type: "signpost-directions";
  neighborNodeIds?: number[];
}

export type PlayJourneyEvent =
  | PlayJourneyEventAbandonedLoot
  | PlayJourneyEventAbandonedEmpty
  | PlayJourneyEventSignpostDirections;

export interface PlayPosition {
  x: number;
  y: number;
  nodeId?: number;
}

export interface PlayState {
  gameOver?: PlayGameOverState | null;
  viewMode?: PlayViewMode;
  travel?: PlayTravelState | null;
  isTravelPaused?: boolean;
  rest?: PlayRestState | null;
  hunt?: PlayHuntState | null;
  pendingRestChoice?: boolean;
  pendingJourneyEvent?: PlayJourneyEvent | null;
  abandonedLootByNodeId?: Record<string, InventoryState | null>;
  currentNodeId?: number | null;
  lastRegionId?: number | null;
  hoveredNodeId?: number | null;
  pressedNodeId?: number | null;
  latestHuntFeedback?: PlayHuntFeedback | null;
  position?: PlayPosition | null;
  discoveredCells?: Uint8Array;
  discoveredNodeIds?: Uint8Array;
  fogDirty?: boolean;
  travelPauseReason?: TravelPauseReason | null;
  inventory?: InventoryState;
  runStats?: PlayRunStats;
  graph?: PlayGraph;
  timeOfDayHours?: number;
  journeyElapsedHours?: number;
  hungerElapsedHours?: number;
  renderTimeOfDayHours?: number;
  renderElapsedWorldHours?: number;
  initiative?: number;
  vitality?: number;
  vapenTraffsakerhet?: number;
  maxHealth?: number;
  health?: number;
  maxStamina?: number;
  stamina?: number;
  staminaElapsedHours?: number;
  huntAreaStates?: Record<string, PlayHuntAreaState>;
  nextHuntRunId?: number;
}
