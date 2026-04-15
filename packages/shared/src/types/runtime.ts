import type { World } from "./world";
import type { PlayState } from "./play";
import type { AppRefs, AppState, CameraState, PlayProfilerLike } from "./app";

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
  refs: AppRefs;
  state: AppState;
  syncModeUi: () => void;
}

export interface PlayControllerDeps {
  playCanvas: HTMLCanvasElement;
  tooltip: HTMLElement | null;
  state: AppState;
  profiler: PlayProfilerLike;
  renderPlayWorld: () => void;
  createPlayCamera: () => CameraState;
  getValidTargetIds: (playState: PlayState) => number[];
  inspectWorldAt: (...args: unknown[]) => unknown;
  clearHover: (tooltip: HTMLElement | null) => void;
  showHoverHit: (...args: unknown[]) => void;
}

export interface PlaySubViewDeps {
  refs: AppRefs;
  state: AppState;
  journeyScene: {
    update: (
      playState: PlayState | null | undefined,
      options?: { showSnow?: boolean; world?: unknown; debug?: boolean },
    ) => void;
    getDebugSnapshot: () => Record<string, unknown>;
    getPresentationSnapshot?: () => Record<string, unknown>;
  };
  profiler: PlayProfilerLike;
}

export type RenderWorldFn = (
  canvas: HTMLCanvasElement,
  world: World,
  options?: RenderOptions,
) => ViewportLike & { mountainGlyphHits: unknown[] };
