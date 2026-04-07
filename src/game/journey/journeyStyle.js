import { BIOME_INFO } from "../../config.js";

// ---------------------------------------------------------------------------
// Biome color helpers
// ---------------------------------------------------------------------------

export function getBiomeColor(biomeKey) {
  const normalizedKey = normalizeBiomeKey(biomeKey);
  return (
    Object.values(BIOME_INFO).find((entry) => entry.key === normalizedKey)
      ?.color ?? "#b9b27f"
  );
}

export function getBiomeLayerColor(biomeKey, layerDepth) {
  const hex = getBiomeColor(biomeKey);
  const base = hexToRgb(hex);

  switch (layerDepth) {
    case "ground":
      return rgbToCss(base);
    case "foreground": {
      const fg = mixRgb(base, [40, 32, 20], 0.28);
      return rgbToCss(fg);
    }
    case "near1": {
      const near1 = mixRgb(base, [50, 42, 28], 0.22);
      return rgbToCss(near1);
    }
    case "near2": {
      const near2 = mixRgb(base, [62, 55, 40], 0.3);
      return rgbToCss(near2);
    }
    case "mid": {
      const mid = mixRgb(base, [72, 66, 54], 0.38);
      return rgbToCss(mid);
    }
    case "far": {
      const far = mixRgb(base, [82, 76, 66], 0.46);
      return rgbToCss(far);
    }
    default:
      return rgbToCss(base);
  }
}

// ---------------------------------------------------------------------------
// Silhouette top-edge sampling
// Returns a Float32Array of y-fractions (0=top of layer band, 1=bottom).
// layerDepth: 'foreground' | 'near1' | 'near2' | 'mid' | 'far'
// ---------------------------------------------------------------------------

export function buildSilhouetteTopEdge(
  biomeKey,
  stripWidthPx,
  worldOffsetPx,
  layerDepth,
) {
  const spec = getSilhouetteSpec(
    normalizeBiomeKey(biomeKey) ?? "plains",
    layerDepth,
  );
  const samples = new Float32Array(Math.max(1, Math.ceil(stripWidthPx)));
  for (let x = 0; x < samples.length; x++) {
    samples[x] = sampleSilhouetteY(spec, worldOffsetPx + x);
  }
  return samples;
}

// Build a canvas polygon from a top-edge array.
// The polygon fills from layerBottomY up to the silhouette edge.
export function buildSilhouettePolygon(
  topEdgeSamples,
  x0,
  layerTopY,
  layerBottomY,
) {
  const width = topEdgeSamples.length;
  const layerHeight = Math.max(1, layerBottomY - layerTopY);
  const points = [];
  points.push([x0, layerBottomY]);
  for (let x = 0; x < width; x++) {
    const yFraction = topEdgeSamples[x];
    const y = layerTopY + yFraction * layerHeight;
    points.push([x0 + x, y]);
  }
  points.push([x0 + width + 1, layerBottomY]);
  return points;
}

// ---------------------------------------------------------------------------
// Silhouette specs
// ---------------------------------------------------------------------------

function getSilhouetteSpec(biomeKey, layerDepth) {
  const depthFactor =
    { foreground: 0, near1: 1, near2: 2, mid: 3, far: 4 }[layerDepth] ?? 1;
  const p1 = hash01(`${biomeKey}:${layerDepth}:p1`) * 1000;
  const p2 = hash01(`${biomeKey}:${layerDepth}:p2`) * 600;
  const base = getBiomeBaseSpec(biomeKey);
  const smoothing = 1 + depthFactor * 0.22;
  return {
    baseY: base.baseY,
    amplitude: base.amplitude / smoothing,
    wavelength1: base.wavelength1 * smoothing,
    wavelength2: base.wavelength2 * smoothing,
    sharpness: base.sharpness,
    phase1: p1,
    phase2: p2,
  };
}

function getBiomeBaseSpec(biomeKey) {
  switch (biomeKey) {
    case "forest":
      return {
        baseY: 0.38,
        amplitude: 0.18,
        wavelength1: 120,
        wavelength2: 54,
        sharpness: 1.7,
      };
    case "rainforest":
      return {
        baseY: 0.34,
        amplitude: 0.2,
        wavelength1: 100,
        wavelength2: 48,
        sharpness: 1.6,
      };
    case "desert":
      return {
        baseY: 0.55,
        amplitude: 0.1,
        wavelength1: 280,
        wavelength2: 140,
        sharpness: 0.75,
      };
    case "mountain":
      return {
        baseY: 0.28,
        amplitude: 0.26,
        wavelength1: 160,
        wavelength2: 68,
        sharpness: 2.1,
      };
    case "highlands":
      return {
        baseY: 0.4,
        amplitude: 0.2,
        wavelength1: 180,
        wavelength2: 80,
        sharpness: 1.4,
      };
    case "tundra":
      return {
        baseY: 0.5,
        amplitude: 0.12,
        wavelength1: 220,
        wavelength2: 100,
        sharpness: 1.1,
      };
    case "plains":
    default:
      return {
        baseY: 0.58,
        amplitude: 0.08,
        wavelength1: 260,
        wavelength2: 120,
        sharpness: 0.9,
      };
  }
}

function sampleSilhouetteY(spec, x) {
  const wave1 =
    0.5 + 0.5 * Math.sin(((x + spec.phase1) / spec.wavelength1) * Math.PI * 2);
  const wave2 =
    0.5 + 0.5 * Math.sin(((x + spec.phase2) / spec.wavelength2) * Math.PI * 2);
  const shaped1 = Math.pow(Math.max(0, wave1), spec.sharpness);
  const shaped2 = Math.pow(
    Math.max(0, wave2),
    Math.max(0.5, spec.sharpness * 0.6),
  );
  const raw = spec.baseY - spec.amplitude * (shaped1 * 0.7 + shaped2 * 0.3);
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// POI marker – matches the map renderer dot style
// ---------------------------------------------------------------------------

export function drawPoiMarkerOnCanvas(
  ctx,
  x,
  y,
  outerRadius = 6,
  innerRadius = 3,
) {
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = "rgba(247, 239, 218, 0.96)";
  ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(70, 48, 33, 0.9)";
  ctx.lineWidth = Math.max(0.9, outerRadius * 0.18);
  ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(72, 43, 31, 0.94)";
  ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Player figure (canvas-drawn silhouette walking figure)
// ---------------------------------------------------------------------------

export function drawPlayerFigure(ctx, cx, groundY, frameIndex) {
  const alt = (frameIndex ?? 0) % 2 === 1;
  ctx.save();
  ctx.fillStyle = "#16110b";

  // head
  ctx.beginPath();
  ctx.arc(cx, groundY - 48, 7, 0, Math.PI * 2);
  ctx.fill();

  // torso
  ctx.fillRect(cx - 3.5, groundY - 40, 7, 20);

  // pack
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cx - 12, groundY - 38, 9, 14, 4);
  ctx.fill();
  ctx.restore();

  // arms
  drawLimb(ctx, cx, groundY - 32, alt ? 0.5 : -0.3, 12, 3.5, 0.85);
  drawLimb(ctx, cx, groundY - 32, alt ? -0.3 : 0.5, 12, 3.5, 1.0);

  // legs
  drawLimb(ctx, cx, groundY - 20, alt ? 0.7 : -0.5, 14, 4, 0.85);
  drawLimb(ctx, cx, groundY - 20, alt ? -0.5 : 0.7, 14, 4, 1.0);

  ctx.restore();
}

function drawLimb(ctx, px, py, angle, length, thickness, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillRect(-thickness / 2, 0, thickness, length);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function normalizeBiomeKey(biomeKey) {
  if (typeof biomeKey === "number") {
    return BIOME_INFO[biomeKey]?.key ?? null;
  }
  return biomeKey ?? null;
}

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function mixRgb(base, target, amount) {
  return base.map((channel, index) =>
    Math.round(channel * (1 - amount) + target[index] * amount),
  );
}

export function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}
