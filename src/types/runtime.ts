import type { World } from "./world";
import type { PlayState } from "./play";

export interface ViewportLike {
  margin: number;
  innerWidth: number;
  innerHeight: number;
  leftWorld: number;
  topWorld: number;
  visibleWidth: number;
  visibleHeight: number;
  scaleX: number;
  scaleY: number;
  worldToCanvas: (x: number, y: number) => { x: number; y: number };
  canvasToWorld: (x: number, y: number) => { x: number; y: number };
  [key: string]: unknown;
}

export interface RoadOverlay {
  roads?: Array<{
    id?: number;
    type?: string;
    points?: Array<{ x: number; y: number }>;
  }>;
}

export interface NodeOverlay {
  validNodeIds?: number[];
  visibleNodeIds?: number[];
  unknownNodeIds?: number[];
  nodeLabelVisibleNodeIds?: number[];
  onlyValid?: boolean;
  hoveredNodeId?: number | null;
  pressedNodeId?: number | null;
  [key: string]: unknown;
}

export interface FogOfWarOverlay {
  enabled?: boolean;
  playState?: PlayState;
  radiusCells?: number;
  [key: string]: unknown;
}

export interface TravelDebugOverlay {
  enabled?: boolean;
  samples?: unknown;
  [key: string]: unknown;
}

export interface RenderOptions {
  viewport?: ViewportLike;
  cameraState?: {
    zoom: number;
    centerX: number;
    centerY: number;
    [key: string]: unknown;
  };
  renderWidth?: number;
  renderHeight?: number;
  showMonochrome?: boolean;
  showSnow?: boolean;
  showBiomeLabels?: boolean;
  showNodeLabels?: boolean;
  roadOverlay?: RoadOverlay;
  nodeOverlay?: NodeOverlay;
  fogOfWar?: FogOfWarOverlay;
  travelDebug?: TravelDebugOverlay;
  playerStart?: { nodeId?: number; x: number; y: number } | null;
  discoveredCells?: Uint8Array;
  visibleNodeIds?: number[];
  nodeLabelVisibleNodeIds?: number[];
  [key: string]: unknown;
}

export interface SceneOptions {
  showPaper?: boolean;
  showTerrainTextures?: boolean;
  showLabels?: boolean;
  showFrame?: boolean;
  showPlayerMarker?: boolean;
  showNodes?: boolean;
  showRoads?: boolean;
  showOceanWaves?: boolean;
  showLakeWaves?: boolean;
  showBiomeBorders?: boolean;
  showShorelines?: boolean;
  showEnvironmentGlyphs?: boolean;
  showFogOfWar?: boolean;
}

export interface PlaySessionDeps {
  refs: any;
  state: any;
  syncModeUi: () => void;
}

export interface PlayControllerDeps {
  playCanvas: HTMLCanvasElement;
  tooltip: HTMLElement | null;
  state: any;
  profiler: any;
  renderPlayWorld: () => void;
  createPlayCamera: () => any;
  beginTravel: (playState: PlayState, targetNodeId: number, world?: World) => PlayState;
  advanceTravel: (playState: PlayState, world: World, delta: number) => PlayState;
  getValidTargetIds: (playState: PlayState) => number[];
  inspectWorldAt: (...args: any[]) => any;
  clearHover: (tooltip: HTMLElement | null) => void;
  showHoverHit: (...args: any[]) => void;
}

export interface PlaySubViewDeps {
  refs: any;
  state: any;
  journeyScene: any;
  profiler: any;
}

export type RenderWorldFn = (
  canvas: HTMLCanvasElement,
  world: World,
  options?: RenderOptions,
) => ViewportLike & { mountainGlyphHits: unknown[] };
