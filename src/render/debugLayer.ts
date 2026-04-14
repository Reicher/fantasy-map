interface DebugPoint {
  x: number;
  y: number;
}

interface TravelDebugSample {
  point?: DebugPoint;
}

interface TravelDebugSamples {
  near?: TravelDebugSample;
  mid?: TravelDebugSample;
  far?: TravelDebugSample;
  [key: string]: TravelDebugSample | undefined;
}

import type { TravelDebugOverlay } from "../types/runtime";

interface ViewportLike {
  worldToCanvas: (x: number, y: number) => { x: number; y: number };
}

export function drawTravelDebugOverlay(
  ctx: CanvasRenderingContext2D,
  viewport: ViewportLike,
  debug: TravelDebugOverlay | undefined,
): void {
  const samples = asTravelDebugSamples(debug?.samples);
  if (!samples) {
    return;
  }

  const nearPoint = samples.near?.point;
  const palette = {
    near: {
      fill: "rgba(255,255,255,0.96)",
      stroke: "rgba(20,22,25,0.98)",
      radius: 5,
    },
    mid: {
      fill: "rgba(255,196,84,0.98)",
      stroke: "rgba(92,57,13,0.98)",
      radius: 5,
    },
    far: {
      fill: "rgba(255,106,148,0.98)",
      stroke: "rgba(92,22,43,0.98)",
      radius: 5,
    },
  } as const;

  for (const bandName of ["far", "mid", "near"] as const) {
    const sample = samples[bandName];
    if (!sample?.point) {
      continue;
    }

    const canvasPoint = viewport.worldToCanvas(sample.point.x, sample.point.y);
    const style = palette[bandName];

    if (nearPoint && bandName !== "near") {
      const nearCanvasPoint = viewport.worldToCanvas(nearPoint.x, nearPoint.y);
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(nearCanvasPoint.x, nearCanvasPoint.y);
      ctx.lineTo(canvasPoint.x, canvasPoint.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, style.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function asTravelDebugSamples(value: unknown): TravelDebugSamples | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as TravelDebugSamples;
}
