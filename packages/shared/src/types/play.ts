import type { InventoryState } from "./inventory";

export type PlayViewMode = "map" | "journey";

export type PlayActionMode =
  | "game-over"
  | "event"
  | "idle"
  | "travel-active"
  | "travel-paused"
  | "resting"
  | "hunting";

export type TravelPauseReason =
  | "manual"
  | "exhausted"
  | "resting"
  | "hunting"
  | "encounter";

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
  maxEastDistance?: number;
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
  encounterId?: string;
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
  requiresDestinationChoice?: boolean;
}

export interface PlayJourneyEventAgentGreeting extends PlayJourneyEventBase {
  type: "agent-greeting";
  agentId?: string;
}

export interface PlayJourneyEventEncounterTurn extends PlayJourneyEventBase {
  type: "encounter-turn";
  canAttack?: boolean;
}

export interface PlayJourneyEventEncounterLoot extends PlayJourneyEventBase {
  type: "encounter-loot";
  inventory?: InventoryState | null;
}

export type PlayJourneyEvent =
  | PlayJourneyEventAbandonedLoot
  | PlayJourneyEventAbandonedEmpty
  | PlayJourneyEventSignpostDirections
  | PlayJourneyEventAgentGreeting
  | PlayJourneyEventEncounterTurn
  | PlayJourneyEventEncounterLoot;

export type PlayEncounterType = "rabbit" | "wolf" | "settlement-group";

export type PlayEncounterDisposition =
  | "friendly"
  | "neutral"
  | "hostile"
  | "fleeing";

export type PlayEncounterTurn = "player" | "opponent";

export type PlayEncounterPhase = "approaching" | "active";

export type PlayerHungerStatus =
  | "fed"
  | "peckish"
  | "hungry"
  | "starving";

export type PlayerInjuryStatus =
  | "healthy"
  | "injured"
  | "severely-injured";

export type PlayEncounterOutcome =
  | "player-fled"
  | "opponent-fled"
  | "player-died"
  | "opponent-died";

export interface PlayEncounterOpponentMember {
  id: string;
  name: string;
  damageMin: number;
  damageMax: number;
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
}

export interface PlayEncounterState {
  id: string;
  type: PlayEncounterType;
  disposition: PlayEncounterDisposition;
  turn: PlayEncounterTurn;
  entryStyle?: "travel-static" | "slide-right";
  phase?: PlayEncounterPhase;
  targetTravelProgress?: number;
  round: number;
  rollIndex?: number;
  opponentInitiative: number;
  opponentDamageMin: number;
  opponentDamageMax: number;
  opponentMaxHealth: number;
  opponentHealth: number;
  opponentMaxStamina: number;
  opponentStamina: number;
  opponentMembers?: PlayEncounterOpponentMember[];
  activeOpponentMemberId?: string | null;
  settlementId?: number | null;
  settlementName?: string | null;
}

export interface PlayEncounterResolution {
  encounterId?: string;
  type?: PlayEncounterType;
  outcome?: PlayEncounterOutcome;
  targetTravelProgress?: number;
}

export interface PlayPosition {
  x: number;
  y: number;
  nodeId?: number;
}

export type SettlementAgentState = "resting" | "hunting";

export interface PlaySettlementAgent {
  id: string;
  name?: string;
  settlementId: number;
  state: SettlementAgentState;
  greeting?: string;
  initiative?: number;
  vitality?: number;
  vapenTraffsakerhet?: number;
  maxHealth?: number;
  health?: number;
  maxStamina?: number;
  stamina?: number;
  staminaElapsedHours?: number;
  hungerElapsedHours?: number;
  restHoursRemaining?: number;
  campfireOffsetX?: number;
  campfireOffsetY?: number;
  inventory?: InventoryState;
}

export interface PlaySettlementState {
  settlementId: number;
  inventory: InventoryState;
  agents: PlaySettlementAgent[];
}

export interface PlayState {
  actionMode?: PlayActionMode;
  gameOver?: PlayGameOverState | null;
  viewMode?: PlayViewMode;
  travel?: PlayTravelState | null;
  isTravelPaused?: boolean;
  rest?: PlayRestState | null;
  hunt?: PlayHuntState | null;
  pendingRestChoice?: boolean;
  pendingJourneyEvent?: PlayJourneyEvent | null;
  encounter?: PlayEncounterState | null;
  latestEncounterResolution?: PlayEncounterResolution | null;
  abandonedLootByNodeId?: Record<string, InventoryState | null>;
  currentNodeId?: number | null;
  lastRegionId?: number | null;
  hoveredNodeId?: number | null;
  pressedNodeId?: number | null;
  latestHuntFeedback?: PlayHuntFeedback | null;
  latestAgentInteraction?: string | null;
  position?: PlayPosition | null;
  discoveredCells?: Uint8Array;
  discoveredNodeIds?: Uint8Array;
  revealedNodeIds?: Uint8Array;
  fogDirty?: boolean;
  travelPauseReason?: TravelPauseReason | null;
  inventory?: InventoryState;
  runStats?: PlayRunStats;
  graph?: PlayGraph;
  timeOfDayHours?: number;
  journeyElapsedHours?: number;
  hungerElapsedHours?: number;
  hungerStatus?: PlayerHungerStatus;
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
  injuryStatus?: PlayerInjuryStatus;
  huntAreaStates?: Record<string, PlayHuntAreaState>;
  nextHuntRunId?: number;
  settlementStates?: Record<string, PlaySettlementState>;
}
