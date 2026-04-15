import { PAPER_BASE } from "./constants";
import { hashSeed, nextHash } from "./hash";

export function drawPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: string,
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#efdfbb");
  gradient.addColorStop(0.55, PAPER_BASE);
  gradient.addColorStop(1, "#d7c29a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  let state = hashSeed(seed);
  for (let index = 0; index < 1800; index += 1) {
    state = nextHash(state);
    const x = (state % width) + 0.5;
    state = nextHash(state);
    const y = (state % height) + 0.5;
    state = nextHash(state);
    const radius = 0.4 + ((state % 1000) / 1000) * 1.8;
    const alpha = 0.015 + (((state >>> 8) % 1000) / 1000) * 0.02;
    ctx.fillStyle = `rgba(92, 69, 33, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawOcean(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "#8aa0a8";
  ctx.fillRect(0, 0, width, height);
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.strokeStyle = "rgba(66, 47, 24, 0.65)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(38, 38, width - 76, height - 76);
}
