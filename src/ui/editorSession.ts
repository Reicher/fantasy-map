import { RENDER_HEIGHT, RENDER_WIDTH } from "../config";
import { inspectWorldAt } from "../inspector";
import {
  clampEditorCamera,
  createEditorCamera,
  getAdjacentEditorZoom,
  isDefaultEditorCamera,
  zoomCameraAroundPoint as buildZoomedCamera,
} from "./cameraState";
import { clearHover, showHoverHit } from "./hoverPanel";
import { attachEditorController } from "./editorController";
import { renderEditorWorld } from "../render/renderer";
import { createMapAtlasCacheManager } from "./mapAtlasCache";
import { createPlayState } from "../game/travel";
import { findNodeAtWorldPoint } from "../game/playQueries";
import type { AppRefs, AppState } from "../types/app";

interface EditorSessionDeps {
  refs: AppRefs;
  state: AppState;
  syncViewUi: () => void;
}

interface FeatureNode {
  id?: number;
  x: number;
  y: number;
}

export function createEditorSession({ refs, state, syncViewUi }: EditorSessionDeps) {
  const mapCache = createMapAtlasCacheManager({
    canvas: refs.canvas,
    getWorld: () => state.currentWorld,
    getCameraState: () => state.cameraState,
    renderStaticScene: renderEditorWorld,
    getStaticKey(
      renderOptions: {
        showSnow?: boolean;
        showBiomeLabels?: boolean;
        showNodeLabels?: boolean;
        playerStart?: { nodeId?: number; x?: number; y?: number } | null;
      } = {},
    ) {
      const playerStart = renderOptions.playerStart;
      return [
        renderOptions.showSnow ? 1 : 0,
        renderOptions.showBiomeLabels ? 1 : 0,
        renderOptions.showNodeLabels ? 1 : 0,
        playerStart?.nodeId ?? "-",
        playerStart?.x?.toFixed?.(2) ?? "-",
        playerStart?.y?.toFixed?.(2) ?? "-",
      ].join(":");
    },
    getAtlasPadding(world, cameraState) {
      const zoom = cameraState?.zoom ?? 1;
      const visibleWidth = world.terrain.width / zoom;
      const visibleHeight = world.terrain.height / zoom;
      return {
        x: Math.max(12, visibleWidth * 0.24),
        y: Math.max(10, visibleHeight * 0.24),
      };
    },
  });

  attachEditorController({
    canvas: refs.canvas,
    tooltip: refs.tooltip,
    state,
    inspectWorldAt,
    clearHover,
    showHoverHit,
    rerenderCurrentWorld,
    scheduleInteractiveRender,
    syncViewUi,
    clampCamera,
    findEditorNodeAtEvent,
    setEditorPlayerStart,
  });

  return {
    rerenderCurrentWorld,
    scheduleInteractiveRender,
    createDefaultCamera,
    isDefaultCamera,
    clampCamera,
    zoomCameraAroundPoint,
    stepZoom,
    setZoom,
  };

  function rerenderCurrentWorld() {
    if (!state.currentWorld) {
      return;
    }

    const renderOptions = {
      ...state.renderOptions,
      cameraState: state.cameraState,
      playerStart: getEditorPlayerStart(),
    };
    mapCache.ensure(renderOptions);
    state.currentViewport = mapCache.draw(state.cameraState);
  }

  function scheduleInteractiveRender() {
    if (state.pendingInteractiveRender || !state.currentWorld) {
      return;
    }

    state.pendingInteractiveRender = true;
    requestAnimationFrame(() => {
      state.pendingInteractiveRender = false;
      const renderOptions = {
        ...state.renderOptions,
        cameraState: state.cameraState,
        interactive: true,
        playerStart: getEditorPlayerStart(),
      };
      mapCache.ensure(renderOptions);
      state.currentViewport = mapCache.draw(state.cameraState);
    });
  }

  function createDefaultCamera() {
    return createEditorCamera(state.currentWorld);
  }

  function clampCamera(camera) {
    return clampEditorCamera(state.currentWorld, camera);
  }

  function zoomCameraAroundPoint(worldX, worldY, canvasX, canvasY, zoom) {
    return buildZoomedCamera(
      state.currentWorld,
      state.currentViewport,
      worldX,
      worldY,
      canvasX,
      canvasY,
      zoom,
    );
  }

  function isDefaultCamera(camera) {
    return isDefaultEditorCamera(state.currentWorld, camera);
  }

  function stepZoom(direction) {
    if (!state.currentWorld || !state.currentViewport) {
      return;
    }

    const zoom = getAdjacentEditorZoom(state.cameraState.zoom, direction);
    if (Math.abs(zoom - state.cameraState.zoom) < 0.001) {
      return;
    }

    const canvasX = RENDER_WIDTH * 0.5;
    const canvasY = RENDER_HEIGHT * 0.5;
    const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
    state.cameraState = clampCamera(
      zoomCameraAroundPoint(worldPoint.x, worldPoint.y, canvasX, canvasY, zoom),
    );
    syncViewUi();
    rerenderCurrentWorld();
  }

  function setZoom(targetZoom) {
    if (!state.currentWorld) {
      return;
    }

    if (Math.abs(targetZoom - state.cameraState.zoom) < 0.001) {
      return;
    }

    if (!state.currentViewport) {
      state.cameraState = clampCamera({
        ...state.cameraState,
        zoom: targetZoom,
      });
      syncViewUi();
      return;
    }

    const canvasX = RENDER_WIDTH * 0.5;
    const canvasY = RENDER_HEIGHT * 0.5;
    const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
    state.cameraState = clampCamera(
      zoomCameraAroundPoint(
        worldPoint.x,
        worldPoint.y,
        canvasX,
        canvasY,
        targetZoom,
      ),
    );
    syncViewUi();
    rerenderCurrentWorld();
  }

  function findEditorNodeAtEvent(event) {
    if (!state.currentWorld || !state.currentViewport) {
      return null;
    }

    const rect = refs.canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * RENDER_WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * RENDER_HEIGHT;
    const worldPoint = state.currentViewport.canvasToWorld(canvasX, canvasY);
    const nodeIds = new Set<number>(
      getFeatureNodes(state.currentWorld)
        .map((node) => Number(node?.id))
        .filter((id) => Number.isFinite(id)),
    );
    return findNodeAtWorldPoint(
      state.currentWorld,
      nodeIds,
      worldPoint.x,
      worldPoint.y,
    );
  }

  function setEditorPlayerStart(nodeId) {
    if (!state.currentWorld || nodeId == null) {
      return false;
    }

    const nodes = getFeatureNodes(state.currentWorld);
    const node = nodes[nodeId];
    if (!node) {
      return false;
    }

    state.currentWorld.playerStart = {
      nodeId,
      x: node.x,
      y: node.y,
    };
    state.playState = createPlayState(state.currentWorld);
    return true;
  }

  function getEditorPlayerStart() {
    if (state.currentWorld?.playerStart) {
      return state.currentWorld.playerStart;
    }

    const currentNodeId = state.playState?.currentNodeId;
    if (currentNodeId != null) {
      const nodes = state.currentWorld
        ? getFeatureNodes(state.currentWorld)
        : [];
      const node = nodes?.[currentNodeId];
      if (node) {
        return {
          nodeId: node.id,
          x: node.x,
          y: node.y,
        };
      }
    }

    return null;
  }

  function getFeatureNodes(world: AppState["currentWorld"]): FeatureNode[] {
    if (!world) {
      return [];
    }
    const features = world.features as { nodes?: unknown[] } | null | undefined;
    const nodes = features?.nodes ?? [];
    return nodes.filter(
      (node): node is FeatureNode =>
        Boolean(node) &&
        typeof (node as { x?: unknown }).x === "number" &&
        typeof (node as { y?: unknown }).y === "number",
    );
  }
}
