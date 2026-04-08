import { BIOME_INFO } from "../../config.js";

const BIOME_COLOR_BY_KEY = Object.fromEntries(
  Object.values(BIOME_INFO)
    .filter((entry) => entry?.key && entry?.color)
    .map((entry) => [entry.key, entry.color]),
);

// ---------------------------------------------------------------------------
// Biome color helpers
// ---------------------------------------------------------------------------

export function getBiomeColor(biomeKey) {
  const normalizedKey = normalizeBiomeKey(biomeKey);
  return BIOME_COLOR_BY_KEY[normalizedKey] ?? "#b9b27f";
}

/** Returns the depth-tinted biome colour as an [r, g, b] array.
 * Near = darker, warmer, richer. Far = lighter, cooler, atmospheric haze. */
export function getBiomeLayerColorRgb(biomeKey, layerDepth) {
  const hex = getBiomeColor(biomeKey);
  const base = hexToRgb(hex);
  switch (layerDepth) {
    // Close layers: mix toward deep warm shadow for strong presence
    case "foreground":
      return mixRgb(base, [18, 14,  8], 0.42);
    case "near1":
      return mixRgb(base, [28, 22, 14], 0.32);
    case "near2":
      return mixRgb(base, [45, 42, 35], 0.18);
    // Distant layers: mix toward cool light atmospheric haze so they recede
    case "mid":
      return mixRgb(base, [152, 158, 168], 0.32);
    case "far":
      return mixRgb(base, [192, 200, 214], 0.54);
    default:
      return base; // "ground": raw biome colour
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
  const samples = new Float32Array(Math.max(1, Math.ceil(stripWidthPx) + 1));
  for (let x = 0; x < samples.length; x++) {
    samples[x] = sampleSilhouetteY(spec, worldOffsetPx + x);
  }
  return samples;
}

/**
 * Sample the silhouette top-edge y-fraction at a single global strip position.
 * Returns a value in [0, 1] (0 = top of layer band, 1 = bottom).
 */
export function sampleSilhouetteAtX(biomeKey, globalX, layerDepth) {
  const spec = getSilhouetteSpec(
    normalizeBiomeKey(biomeKey) ?? "plains",
    layerDepth,
  );
  return sampleSilhouetteY(spec, globalX);
}

// ---------------------------------------------------------------------------
// Silhouette specs
// ---------------------------------------------------------------------------

function getSilhouetteSpec(biomeKey, layerDepth) {
  // Negative = more jagged (foreground), positive = smoother (far background)
  const depthFactor =
    { foreground: -1.0, near1: 0, near2: 1.5, mid: 3.2, far: 5.5 }[layerDepth] ?? 0;
  const p1 = hash01(`${biomeKey}:${layerDepth}:p1`) * 1000;
  const p2 = hash01(`${biomeKey}:${layerDepth}:p2`) * 600;
  const base = getBiomeBaseSpec(biomeKey);
  // smoothing < 1 → shorter wavelengths + bigger amplitude (more detail)
  // smoothing > 1 → longer wavelengths + smaller amplitude (smoother)
  const smoothing = Math.max(0.55, 1 + depthFactor * 0.26);
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
    case "ocean":
    case "lake":
      // Flat horizon – barely any silhouette visible above the ground line
      return {
        baseY: 0.97,
        amplitude: 0.02,
        wavelength1: 800,
        wavelength2: 400,
        sharpness: 0.5,
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
