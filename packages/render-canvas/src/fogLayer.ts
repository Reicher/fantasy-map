import { RENDER_HEIGHT, RENDER_WIDTH } from "@fardvag/shared/config";
import { hashSeed, nextHash } from "./hash";
import type { FogOfWarOverlay, ViewportLike } from "@fardvag/shared/types/runtime";
import type { World } from "@fardvag/shared/types/world";

let fogCanvas: HTMLCanvasElement | null = null;
let fogCtx: CanvasRenderingContext2D | null = null;

export function drawFogOfWar(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: ViewportLike,
  fogState: FogOfWarOverlay = {},
): void {
  const discoveredCells = fogState.playState?.discoveredCells;
  if (!world || !viewport || !discoveredCells) {
    return;
  }

  const overlay = getFogCanvas();
  const overlayCtx = fogCtx;
  if (!overlayCtx) {
    return;
  }

  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  overlayCtx.fillStyle = "rgba(108, 106, 101, 0.96)";
  overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
  drawFogTexture(overlayCtx, world.params.seed);

  overlayCtx.save();
  overlayCtx.globalCompositeOperation = "destination-out";
  clearDiscoveredArea(overlayCtx, world, viewport, discoveredCells);
  overlayCtx.restore();

  ctx.drawImage(overlay, 0, 0, RENDER_WIDTH, RENDER_HEIGHT);
}

function clearDiscoveredArea(
  overlayCtx: CanvasRenderingContext2D,
  world: World,
  viewport: ViewportLike,
  discoveredCells: Uint8Array,
): void {
  const minX = Math.max(0, Math.floor(viewport.leftWorld) - 1);
  const maxX = Math.min(
    world.terrain.width - 1,
    Math.ceil(viewport.leftWorld + viewport.visibleWidth) + 1,
  );
  const minY = Math.max(0, Math.floor(viewport.topWorld) - 1);
  const maxY = Math.min(
    world.terrain.height - 1,
    Math.ceil(viewport.topWorld + viewport.visibleHeight) + 1,
  );
  const cellWidth = viewport.scaleX;
  const cellHeight = viewport.scaleY;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * world.terrain.width + x;
      if (!discoveredCells[index]) {
        continue;
      }

      const center = viewport.worldToCanvas(x, y);
      const left = Math.floor(center.x - cellWidth * 0.5 - 1);
      const top = Math.floor(center.y - cellHeight * 0.5 - 1);
      const width = Math.ceil(cellWidth + 2);
      const height = Math.ceil(cellHeight + 2);
      overlayCtx.clearRect(left, top, width, height);
    }
  }
}

function drawFogTexture(overlayCtx: CanvasRenderingContext2D, seed: string): void {
  const seedKey = String(seed);
  let hash = hashSeed(`${seedKey}-fog-texture`);
  overlayCtx.fillStyle = "rgba(82, 80, 76, 0.18)";
  for (let y = 16; y < RENDER_HEIGHT; y += 34) {
    for (let x = 14; x < RENDER_WIDTH; x += 38) {
      hash = nextHash(hash);
      const offsetX = (hash % 17) - 8;
      hash = nextHash(hash);
      const offsetY = (hash % 15) - 7;
      hash = nextHash(hash);
      const width = 8 + (hash % 8);
      hash = nextHash(hash);
      const height = 3 + (hash % 4);
      overlayCtx.fillRect(x + offsetX, y + offsetY, width, height);
    }
  }

  hash = hashSeed(`${seedKey}-fog-specks`);
  overlayCtx.fillStyle = "rgba(228, 226, 220, 0.06)";
  for (let index = 0; index < 280; index += 1) {
    hash = nextHash(hash);
    const x = hash % RENDER_WIDTH;
    hash = nextHash(hash);
    const y = hash % RENDER_HEIGHT;
    hash = nextHash(hash);
    const size = 1 + (hash % 2);
    overlayCtx.fillRect(x, y, size, size);
  }
}

function getFogCanvas(): HTMLCanvasElement {
  if (!fogCanvas) {
    fogCanvas = document.createElement("canvas");
    fogCtx = fogCanvas.getContext("2d");
  }
  if (fogCanvas.width !== RENDER_WIDTH || fogCanvas.height !== RENDER_HEIGHT) {
    fogCanvas.width = RENDER_WIDTH;
    fogCanvas.height = RENDER_HEIGHT;
  }
  return fogCanvas;
}
