import { BIOME_INFO } from "../../config.js";
import {
  capToGamePalette,
  DEPTH_SHADE_BY_LAYER,
  WORLD_RGB,
  capToBiomePalette,
  getBiomeBaseHex,
  hexToRgb,
  mixRgb,
} from "../../palette/colorSystem.js";
import { drawPoiMarkerGlyph } from "../../render/poiGlyph.js?v=20260408b";

const SNOW_GROUND_RGB = WORLD_RGB.snow;
const JOURNEY_SIGNPOST_IMAGE = createJourneySignpostImage();
const JOURNEY_SIGNPOST_MIN_HEIGHT_PX = 104;
const JOURNEY_SIGNPOST_VERTICAL_OFFSET_PX = 18;
const JOURNEY_TREE_SPRITESHEET_BY_FAMILY = {
  pine: createJourneyTreeSpritesheet(
    new URL("../../assets/journey/journey-pines.png", import.meta.url).href,
  ),
  dead: createJourneyTreeSpritesheet(
    new URL("../../assets/journey/journey-dead-trees.png", import.meta.url).href,
  ),
  cactus: createJourneyTreeSpritesheet(
    new URL("../../assets/journey/journey-cacti.png", import.meta.url).href,
  ),
};
const JOURNEY_TREE_VARIANT_COUNT_BY_FAMILY = {
  pine: 5,
  dead: 3,
  cactus: 2,
};
const TREE_CHROMA_TOLERANCE = 24;
const SNOW_AFFECTED_LAYERS = new Set(["ground", "near1", "near2", "foreground"]);
const JOURNEY_NEAR_SHADE_SCALE = {
  near1: 0.36,
  near2: 0.34,
};
const journeyTreeVariantsByFamily = new Map();

/** Returns the depth-tinted biome colour as an [r, g, b] array.
 * Near = darker, warmer, richer. Far = lighter, cooler, atmospheric haze. */
export function getBiomeLayerColorRgb(
  biomeKey,
  layerDepth,
  { isSnow = false } = {},
) {
  const normalizedBiome = normalizeBiomeKey(biomeKey) ?? "plains";
  if (isSnow && layerDepth === "ground") {
    return SNOW_GROUND_RGB;
  }

  const base = isSnow && SNOW_AFFECTED_LAYERS.has(layerDepth)
    ? SNOW_GROUND_RGB
    : hexToRgb(getBiomeBaseHex(normalizedBiome));
  const shade = DEPTH_SHADE_BY_LAYER[layerDepth] ?? DEPTH_SHADE_BY_LAYER.ground;
  if (!shade.target) {
    return isSnow ? capToGamePalette(base) : capToBiomePalette(base, normalizedBiome);
  }
  const shadeScale = JOURNEY_NEAR_SHADE_SCALE[layerDepth] ?? 1;
  const mixed = mixRgb(base, shade.target, shade.amount * shadeScale);
  return isSnow ? capToGamePalette(mixed) : capToBiomePalette(mixed, normalizedBiome);
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
        baseY: 0.24,
        amplitude: 0.34,
        wavelength1: 108,
        wavelength2: 40,
        sharpness: 3.7,
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
  options = {},
) {
  const marker = options.marker;
  if (marker === "signpost") {
    const minVisualHeightPx = Math.max(
      JOURNEY_SIGNPOST_MIN_HEIGHT_PX,
      Math.round(options.minVisualHeightPx ?? JOURNEY_SIGNPOST_MIN_HEIGHT_PX),
    );
    const baseGroundY = Number.isFinite(options.groundY) ? options.groundY : y;
    const verticalOffset = Math.max(
      0,
      Number(options.verticalOffsetPx ?? JOURNEY_SIGNPOST_VERTICAL_OFFSET_PX),
    );
    const groundY = baseGroundY - verticalOffset;
    if (
      JOURNEY_SIGNPOST_IMAGE &&
      JOURNEY_SIGNPOST_IMAGE.complete &&
      JOURNEY_SIGNPOST_IMAGE.naturalWidth > 0 &&
      JOURNEY_SIGNPOST_IMAGE.naturalHeight > 0
    ) {
      drawJourneySignpostImage(ctx, x, groundY, minVisualHeightPx, {
        highlighted: options.highlighted ?? true,
      });
      return;
    }
    const fallbackScale = minVisualHeightPx / 9.2;
    drawPoiMarkerGlyph(ctx, x, groundY, marker, {
      scale: fallbackScale,
      iconLift: 4.6 * fallbackScale,
      highlighted: options.highlighted ?? true,
      hovered: false,
      pressed: false,
    });
    return;
  }

  drawPoiMarkerGlyph(ctx, x, y, options.marker, {
    scale: options.scale ?? 1.25,
    highlighted: options.highlighted ?? true,
    hovered: false,
    pressed: false,
  });
}

export function drawJourneyTreeOnCanvas(
  ctx,
  x,
  groundY,
  options = {},
) {
  const targetHeight = Math.max(18, Number(options.heightPx ?? 64));
  const upwardOffset = Math.max(0, Number(options.upwardOffsetPx ?? 0));
  const treeFamily = resolveTreeFamily(options.treeFamily);
  const isSnowTree =
    treeFamily === "pine" && Number(options.variantIndex ?? 0) >= 3;
  const variants =
    getJourneyTreeVariants(treeFamily) ?? getJourneyTreeVariants("pine");
  if (!variants?.length) {
    drawFallbackJourneyTree(ctx, x, groundY, targetHeight, upwardOffset, isSnowTree);
    return;
  }

  const rawIndex = Number.isFinite(options.variantIndex)
    ? Math.floor(options.variantIndex)
    : 0;
  const variantIndex = ((rawIndex % variants.length) + variants.length) % variants.length;
  const sprite = variants[variantIndex];
  if (!sprite) {
    drawFallbackJourneyTree(ctx, x, groundY, targetHeight, upwardOffset, isSnowTree);
    return;
  }

  const targetWidth = targetHeight * (sprite.width / sprite.height);
  const groundAnchorFrac = clamp(
    Number(sprite.groundAnchorFrac),
    0.5,
    1,
    1,
  );
  const drawLeft = Math.round(x - targetWidth * 0.5);
  const drawTop = Math.round(
    groundY - targetHeight * groundAnchorFrac - upwardOffset,
  );

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    sprite,
    drawLeft,
    drawTop,
    Math.round(targetWidth),
    Math.round(targetHeight),
  );
  ctx.restore();
}

function drawFallbackJourneyTree(
  ctx,
  x,
  groundY,
  targetHeight,
  upwardOffset,
  isSnowTree,
) {
  const baseY = Math.round(groundY - upwardOffset);
  const h = Math.round(targetHeight);
  const w = Math.round(h * 0.58);
  const trunkH = Math.max(8, Math.round(h * 0.2));
  const crownTop = baseY - h;
  const crownBottom = baseY - trunkH;

  ctx.save();
  ctx.fillStyle = "#5a3a1f";
  ctx.fillRect(Math.round(x - w * 0.08), crownBottom, Math.max(2, Math.round(w * 0.16)), trunkH);

  ctx.beginPath();
  ctx.moveTo(x, crownTop);
  ctx.lineTo(x - w * 0.5, crownBottom);
  ctx.lineTo(x + w * 0.5, crownBottom);
  ctx.closePath();
  ctx.fillStyle = isSnowTree ? "#dfe0dd" : "#2f6b2d";
  ctx.fill();

  if (isSnowTree) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(Math.round(x - w * 0.26), Math.round(crownTop + h * 0.24), Math.round(w * 0.52), Math.max(2, Math.round(h * 0.08)));
  }
  ctx.restore();
}

function drawJourneySignpostImage(
  ctx,
  x,
  groundY,
  minVisualHeightPx,
  { highlighted = true } = {},
) {
  const sourceWidth = JOURNEY_SIGNPOST_IMAGE.naturalWidth;
  const sourceHeight = JOURNEY_SIGNPOST_IMAGE.naturalHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const targetHeight = Math.max(JOURNEY_SIGNPOST_MIN_HEIGHT_PX, minVisualHeightPx);
  const targetWidth = targetHeight * (sourceWidth / sourceHeight);
  const drawLeft = Math.round(x - targetWidth * 0.5);
  const drawTop = Math.round(groundY - targetHeight);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (highlighted) {
    ctx.shadowColor = "rgba(255, 208, 128, 0.35)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
  }
  ctx.drawImage(
    JOURNEY_SIGNPOST_IMAGE,
    drawLeft,
    drawTop,
    Math.round(targetWidth),
    Math.round(targetHeight),
  );
  ctx.restore();
}

function createJourneySignpostImage() {
  if (typeof Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = new URL("../../assets/journey/signpost-marker.png", import.meta.url).href;
  return image;
}

function createJourneyTreeSpritesheet(src) {
  if (typeof Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
}

function getJourneyTreeVariants(treeFamily = "pine") {
  const family = resolveTreeFamily(treeFamily);
  if (journeyTreeVariantsByFamily.has(family)) {
    return journeyTreeVariantsByFamily.get(family);
  }
  const sheet = JOURNEY_TREE_SPRITESHEET_BY_FAMILY[family];
  const variantCount = JOURNEY_TREE_VARIANT_COUNT_BY_FAMILY[family];
  if (
    !sheet ||
    !sheet.complete ||
    sheet.naturalWidth <= 0 ||
    sheet.naturalHeight <= 0
  ) {
    return null;
  }
  const variants = sliceJourneyTreeVariants(
    sheet,
    variantCount,
  );
  journeyTreeVariantsByFamily.set(family, variants);
  return variants;
}

function sliceJourneyTreeVariants(sheetImage, variantCount) {
  if (typeof document === "undefined") return null;
  const sourceW = sheetImage.naturalWidth;
  const sourceH = sheetImage.naturalHeight;
  if (sourceW <= 0 || sourceH <= 0 || variantCount <= 0) return null;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW;
  sourceCanvas.height = sourceH;
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) return null;
  sourceCtx.drawImage(sheetImage, 0, 0);

  const corner = sourceCtx.getImageData(1, 1, 1, 1).data;
  const keyR = corner[0];
  const keyG = corner[1];
  const keyB = corner[2];

  const variants = [];
  const frameW = sourceW / variantCount;

  for (let index = 0; index < variantCount; index += 1) {
    const sx = frameW * index;
    const sw = Math.max(1, frameW);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = sourceH;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    ctx.drawImage(sheetImage, sx, 0, sw, sourceH, 0, 0, canvas.width, sourceH);
    const imageData = ctx.getImageData(0, 0, canvas.width, sourceH);
    const pixels = imageData.data;
    for (let p = 0; p < pixels.length; p += 4) {
      const dr = pixels[p] - keyR;
      const dg = pixels[p + 1] - keyG;
      const db = pixels[p + 2] - keyB;
      const distance = Math.hypot(dr, dg, db);
      if (distance <= TREE_CHROMA_TOLERANCE) {
        pixels[p + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    canvas.groundAnchorFrac = computeTreeGroundAnchorFrac(imageData, sourceH);
    variants.push(canvas);
  }

  return variants;
}

function computeTreeGroundAnchorFrac(imageData, frameHeight) {
  const pixels = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  let maxOpaqueY = -1;
  for (let y = height - 1; y >= 0; y -= 1) {
    let foundOpaqueInRow = false;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[rowStart + x * 4 + 3];
      if (alpha > 8) {
        foundOpaqueInRow = true;
        break;
      }
    }
    if (foundOpaqueInRow) {
      maxOpaqueY = y;
      break;
    }
  }
  if (maxOpaqueY < 0) return 1;
  return clamp((maxOpaqueY + 1) / Math.max(1, frameHeight), 0.5, 1, 1);
}

function resolveTreeFamily(treeFamily) {
  if (treeFamily === "dead") return "dead";
  if (treeFamily === "cactus") return "cactus";
  return "pine";
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

export function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function clamp(value, min, max, fallback = min) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
