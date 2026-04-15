import {
  getBiomeDefinitionByKey,
  normalizeBiomeKeyName,
} from "@fardvag/shared/biomes";
import {
  capToGamePalette,
  DEPTH_SHADE_BY_LAYER,
  WORLD_RGB,
  capToBiomePalette,
  getBiomeBaseHex,
  hexToRgb,
  mixRgb,
} from "@fardvag/shared/colorSystem";
import { drawNodeMarkerGlyph } from "../nodeGlyph";

const SNOW_GROUND_RGB = WORLD_RGB.snow;
const JOURNEY_SIGNPOST_IMAGE = createJourneySignpostImage();
const JOURNEY_PLAYER_ANIMATION_SRC = new URL(
  "../../../../src/assets/journey/horse.png",
  import.meta.url,
).href;
const JOURNEY_PLAYER_ANIMATION_IMAGE = createJourneyPlayerAnimationImage();
const JOURNEY_PLAYER_SPRITESHEET_FRAME_COUNT = 8;
const JOURNEY_PLAYER_ANIMATION_FRAME_MS = 90;
const JOURNEY_PLAYER_SPRITESHEET = {
  frames: null,
  groundAnchorFrac: 1,
};
const JOURNEY_PLAYER_VISUAL_HEIGHT_PX = 112;
const JOURNEY_PLAYER_VERTICAL_OFFSET_PX = 6;
const JOURNEY_SIGNPOST_MIN_HEIGHT_PX = 104;
const JOURNEY_SIGNPOST_VERTICAL_OFFSET_PX = 18;
const JOURNEY_NODE_MIN_HEIGHT_BY_MARKER = {
  settlement: 118,
  abandoned: 108,
};
const JOURNEY_NODE_WIDTH_SCALE_BY_MARKER = {
  settlement: 1,
  abandoned: 0.88,
};
const JOURNEY_NODE_SPRITESHEET_BY_MARKER = {
  settlement: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/settlement-nodes.png", import.meta.url).href,
  ),
  abandoned: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/crash-site-nodes.png", import.meta.url).href,
  ),
};
const JOURNEY_NODE_VARIANT_COUNT_BY_MARKER = {
  settlement: 3,
  abandoned: 4,
};
const JOURNEY_TREE_SPRITESHEET_BY_FAMILY = {
  pine: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/journey-pines.png", import.meta.url).href,
  ),
  dead: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/journey-dead-trees.png", import.meta.url)
      .href,
  ),
  cactus: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/journey-cacti.png", import.meta.url).href,
  ),
  tuft: createJourneySpritesheet(
    new URL("../../../../src/assets/journey/journey-plains-tufts.png", import.meta.url)
      .href,
  ),
};
const JOURNEY_TREE_VARIANT_COUNT_BY_FAMILY = {
  pine: 5,
  dead: 3,
  cactus: 2,
  tuft: 4,
};
const SPRITE_CHROMA_TOLERANCE = 24;
const SNOW_AFFECTED_LAYERS = new Set([
  "ground",
  "near1",
  "near2",
  "foreground",
]);
const JOURNEY_NEAR_LIGHTEN_FRAC = {
  near1: 0.08,
  near2: 0.16,
};
const SILHOUETTE_BIOME_SMOOTHING_BY_BIOME = Object.freeze({
  forest: 1.34,
  rainforest: 1.4,
});
const journeyNodeVariantsByMarker = new Map();
const journeyTreeVariantsByFamily = new Map();

type JourneyMarker = "settlement" | "abandoned" | "signpost" | "unknown";
type JourneyTreeFamily = "pine" | "dead" | "cactus" | "tuft";
type SpriteCanvas = HTMLCanvasElement & { groundAnchorFrac?: number };

interface DrawNodeMarkerOptions {
  marker?: JourneyMarker | null;
  minVisualHeightPx?: number;
  groundY?: number;
  verticalOffsetPx?: number;
  highlighted?: boolean;
  variantSeed?: number | string | null;
  scale?: number;
}

interface DrawJourneyTreeOptions {
  heightPx?: number;
  upwardOffsetPx?: number;
  treeFamily?: JourneyTreeFamily | string;
  alpha?: number;
  preferFallback?: boolean;
  variantIndex?: number;
}

interface DrawFallbackTreeOptions {
  treeFamily?: JourneyTreeFamily | string;
  isSnowTree?: boolean;
  alpha?: number;
}

interface DrawJourneySignpostImageOptions {
  highlighted?: boolean;
}

interface DrawJourneyNodeImageOptions {
  highlighted?: boolean;
  groundY?: number;
  minVisualHeightPx?: number;
  variantSeed?: number | string | null;
  verticalOffsetPx?: number;
}

/** Returns the depth-tinted biome colour as an [r, g, b] array.
 * Near = darker, warmer, richer. Far = lighter, cooler, atmospheric haze. */
export function getBiomeLayerColorRgb(
  biomeKey,
  layerDepth,
  { isSnow = false } = {},
) {
  const normalizedBiome = normalizeBiomeKeyName(biomeKey) ?? "plains";
  const biomeBase = hexToRgb(getBiomeBaseHex(normalizedBiome));
  if (isSnow && layerDepth === "ground") {
    return SNOW_GROUND_RGB;
  }
  if (layerDepth === "ground") {
    return biomeBase;
  }
  if (layerDepth === "near1" || layerDepth === "near2") {
    const nearBase = isSnow ? SNOW_GROUND_RGB : biomeBase;
    const nearLightenFrac = JOURNEY_NEAR_LIGHTEN_FRAC[layerDepth] ?? 0;
    return mixRgb(nearBase, [255, 255, 255], nearLightenFrac);
  }

  const base =
    isSnow && SNOW_AFFECTED_LAYERS.has(layerDepth)
      ? SNOW_GROUND_RGB
      : biomeBase;
  const shade = DEPTH_SHADE_BY_LAYER[layerDepth] ?? DEPTH_SHADE_BY_LAYER.ground;
  if (!shade.target) {
    return isSnow
      ? capToGamePalette(base)
      : capToBiomePalette(base, normalizedBiome);
  }
  const mixed = mixRgb(base, shade.target, shade.amount);
  return isSnow
    ? capToGamePalette(mixed)
    : capToBiomePalette(mixed, normalizedBiome);
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
    normalizeBiomeKeyName(biomeKey) ?? "plains",
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
    normalizeBiomeKeyName(biomeKey) ?? "plains",
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
    { foreground: -1.0, near1: 0, near2: 1.5, mid: 3.2, far: 5.5 }[
      layerDepth
    ] ?? 0;
  const p1 = hash01(`${biomeKey}:${layerDepth}:p1`) * 1000;
  const p2 = hash01(`${biomeKey}:${layerDepth}:p2`) * 600;
  const base = getBiomeBaseSpec(biomeKey);
  const biomeSmoothing = Math.max(
    1,
    Number(SILHOUETTE_BIOME_SMOOTHING_BY_BIOME[biomeKey] ?? 1),
  );
  // smoothing < 1 → shorter wavelengths + bigger amplitude (more detail)
  // smoothing > 1 → longer wavelengths + smaller amplitude (smoother)
  const smoothing = Math.max(0.55, 1 + depthFactor * 0.26);
  const totalSmoothing = smoothing * biomeSmoothing;
  const amplitudeDamping = Math.pow(biomeSmoothing, 0.32);
  const softenedSharpness = Math.max(
    0.7,
    base.sharpness / Math.pow(biomeSmoothing, 0.28),
  );
  return {
    baseY: base.baseY,
    amplitude: base.amplitude / (smoothing * amplitudeDamping),
    wavelength1: base.wavelength1 * totalSmoothing,
    wavelength2: base.wavelength2 * totalSmoothing,
    sharpness: softenedSharpness,
    phase1: p1,
    phase2: p2,
  };
}

function getBiomeBaseSpec(biomeKey) {
  const normalizedBiome = normalizeBiomeKeyName(biomeKey) ?? "plains";
  const biomeDefinition = getBiomeDefinitionByKey(normalizedBiome);
  return (
    biomeDefinition?.journey?.silhouette ??
    getBiomeDefinitionByKey("plains").journey.silhouette
  );
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
// Node marker – matches the map renderer dot style
// ---------------------------------------------------------------------------

export function drawNodeMarkerOnCanvas(
  ctx,
  x,
  y,
  options: DrawNodeMarkerOptions = {},
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
    drawNodeMarkerGlyph(ctx, x, groundY, marker, {
      scale: fallbackScale,
      iconLift: 4.6 * fallbackScale,
      highlighted: options.highlighted ?? true,
      hovered: false,
      pressed: false,
    });
    return;
  }

  if (
    drawJourneyNodeImage(ctx, x, y, marker, {
      highlighted: options.highlighted ?? true,
      groundY: options.groundY,
      minVisualHeightPx: options.minVisualHeightPx,
      variantSeed: options.variantSeed,
      verticalOffsetPx: options.verticalOffsetPx,
    })
  ) {
    return;
  }

  drawNodeMarkerGlyph(ctx, x, y, options.marker, {
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
  options: DrawJourneyTreeOptions = {},
) {
  const targetHeight = Math.max(18, Number(options.heightPx ?? 64));
  const upwardOffset = Math.max(0, Number(options.upwardOffsetPx ?? 0));
  const treeFamily = resolveTreeFamily(options.treeFamily);
  const treeAlpha = clamp(Number(options.alpha ?? 1), 0, 1, 1);
  const preferFallback = options.preferFallback === true;
  const isSnowTree =
    treeFamily === "pine" && Number(options.variantIndex ?? 0) >= 3;
  if (preferFallback) {
    drawFallbackJourneyTree(ctx, x, groundY, targetHeight, upwardOffset, {
      isSnowTree,
      treeFamily,
      alpha: treeAlpha,
    });
    return;
  }
  const variants =
    getJourneyTreeVariants(treeFamily) ?? getJourneyTreeVariants("pine");
  if (!variants?.length) {
    drawFallbackJourneyTree(ctx, x, groundY, targetHeight, upwardOffset, {
      isSnowTree,
      treeFamily,
      alpha: treeAlpha,
    });
    return;
  }

  const rawIndex = Number.isFinite(options.variantIndex)
    ? Math.floor(options.variantIndex)
    : 0;
  const variantIndex =
    ((rawIndex % variants.length) + variants.length) % variants.length;
  const sprite = variants[variantIndex];
  if (!sprite) {
    drawFallbackJourneyTree(ctx, x, groundY, targetHeight, upwardOffset, {
      isSnowTree,
      treeFamily,
      alpha: treeAlpha,
    });
    return;
  }

  const targetWidth = targetHeight * (sprite.width / sprite.height);
  const groundAnchorFrac = clamp(Number(sprite.groundAnchorFrac), 0.5, 1, 1);
  const drawLeft = Math.round(x - targetWidth * 0.5);
  const drawTop = Math.round(
    groundY - targetHeight * groundAnchorFrac - upwardOffset,
  );

  ctx.save();
  if (treeAlpha < 1) {
    ctx.globalAlpha *= treeAlpha;
  }
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
  options: DrawFallbackTreeOptions = {},
) {
  const treeFamily = resolveTreeFamily(options.treeFamily);
  const isSnowTree = Boolean(options.isSnowTree);
  const alpha = clamp(Number(options.alpha ?? 1), 0, 1, 1);
  const baseY = Math.round(groundY - upwardOffset);
  const h = Math.round(targetHeight);
  const w = Math.round(h * 0.58);
  const trunkH = Math.max(8, Math.round(h * 0.24));
  const crownTop = baseY - h;
  const crownBottom = baseY - trunkH;

  ctx.save();
  if (alpha < 1) {
    ctx.globalAlpha *= alpha;
  }

  if (treeFamily === "cactus") {
    const trunkW = Math.max(3, Math.round(w * 0.22));
    const armW = Math.max(2, Math.round(trunkW * 0.8));
    const armH = Math.max(4, Math.round(h * 0.28));
    const trunkTop = baseY - h;
    ctx.fillStyle = "#486f3f";
    ctx.fillRect(Math.round(x - trunkW / 2), trunkTop, trunkW, h);
    ctx.fillRect(
      Math.round(x - trunkW / 2 - armW),
      Math.round(trunkTop + h * 0.34),
      armW,
      armH,
    );
    ctx.fillRect(
      Math.round(x + trunkW / 2),
      Math.round(trunkTop + h * 0.46),
      armW,
      armH,
    );
    ctx.restore();
    return;
  }

  if (treeFamily === "tuft") {
    ctx.strokeStyle = "rgba(77,106,62,0.88)";
    ctx.lineWidth = Math.max(1, Math.round(h * 0.055));
    ctx.beginPath();
    ctx.moveTo(x - w * 0.22, baseY);
    ctx.lineTo(x - w * 0.09, baseY - h * 0.62);
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - h);
    ctx.moveTo(x + w * 0.22, baseY);
    ctx.lineTo(x + w * 0.1, baseY - h * 0.58);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (treeFamily === "dead") {
    ctx.strokeStyle = "rgba(88,69,49,0.9)";
    ctx.lineWidth = Math.max(1, Math.round(h * 0.07));
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, crownTop + h * 0.18);
    ctx.moveTo(x, crownTop + h * 0.38);
    ctx.lineTo(x - w * 0.22, crownTop + h * 0.22);
    ctx.moveTo(x, crownTop + h * 0.5);
    ctx.lineTo(x + w * 0.2, crownTop + h * 0.35);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.fillStyle = "#5a3a1f";
  ctx.fillRect(
    Math.round(x - w * 0.08),
    crownBottom,
    Math.max(2, Math.round(w * 0.16)),
    trunkH,
  );

  ctx.beginPath();
  ctx.moveTo(x, crownTop);
  ctx.lineTo(x - w * 0.5, crownBottom);
  ctx.lineTo(x + w * 0.5, crownBottom);
  ctx.closePath();
  ctx.fillStyle = isSnowTree ? "#dfe0dd" : "#2f6b2d";
  ctx.fill();

  if (isSnowTree) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(
      Math.round(x - w * 0.26),
      Math.round(crownTop + h * 0.24),
      Math.round(w * 0.52),
      Math.max(2, Math.round(h * 0.08)),
    );
  }
  ctx.restore();
}

function drawJourneySignpostImage(
  ctx,
  x,
  groundY,
  minVisualHeightPx,
  { highlighted = true }: DrawJourneySignpostImageOptions = {},
) {
  const sourceWidth = JOURNEY_SIGNPOST_IMAGE.naturalWidth;
  const sourceHeight = JOURNEY_SIGNPOST_IMAGE.naturalHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const targetHeight = Math.max(
    JOURNEY_SIGNPOST_MIN_HEIGHT_PX,
    minVisualHeightPx,
  );
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

function drawJourneyNodeImage(
  ctx,
  x,
  y,
  marker,
  {
    highlighted = true,
    groundY,
    minVisualHeightPx,
    variantSeed,
    verticalOffsetPx = 0,
  }: DrawJourneyNodeImageOptions = {},
) {
  const normalizedMarker =
    marker === "abandoned" || marker === "settlement" ? marker : null;
  if (!normalizedMarker) return false;

  const variants = getJourneyNodeVariants(normalizedMarker);
  if (!variants?.length) return false;

  const variantIndex = resolveJourneyNodeVariantIndex(
    normalizedMarker,
    variantSeed,
    variants.length,
  );
  const sprite = variants[variantIndex] ?? variants[0];
  if (!sprite || sprite.width <= 0 || sprite.height <= 0) return false;

  const minHeight =
    JOURNEY_NODE_MIN_HEIGHT_BY_MARKER[normalizedMarker] ??
    JOURNEY_NODE_MIN_HEIGHT_BY_MARKER.settlement;
  const targetHeight = Math.max(
    minHeight,
    Math.round(minVisualHeightPx ?? minHeight),
  );
  const widthScale = clamp(
    JOURNEY_NODE_WIDTH_SCALE_BY_MARKER[normalizedMarker] ?? 1,
    0.72,
    1.2,
    1,
  );
  const targetWidth =
    targetHeight * (sprite.width / sprite.height) * widthScale;
  const baseGroundY = Number.isFinite(groundY) ? groundY : y;
  const groundedY = baseGroundY - Math.max(0, Number(verticalOffsetPx));
  const groundAnchorFrac = clamp(Number(sprite.groundAnchorFrac), 0.55, 1, 1);
  const drawLeft = Math.round(x - targetWidth * 0.5);
  const drawTop = Math.round(groundedY - targetHeight * groundAnchorFrac);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (highlighted) {
    ctx.shadowColor = "rgba(255, 208, 128, 0.28)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
  }
  ctx.drawImage(
    sprite,
    drawLeft,
    drawTop,
    Math.round(targetWidth),
    Math.round(targetHeight),
  );
  ctx.restore();
  return true;
}

function createJourneySignpostImage() {
  if (typeof Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = new URL(
    "../../../../src/assets/journey/signpost-marker.png",
    import.meta.url,
  ).href;
  return image;
}

function createJourneyPlayerAnimationImage() {
  if (typeof Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", () => {
    JOURNEY_PLAYER_SPRITESHEET.frames = null;
    JOURNEY_PLAYER_SPRITESHEET.groundAnchorFrac = 1;
    getJourneyPlayerSpritesheetFrames();
  });
  image.src = JOURNEY_PLAYER_ANIMATION_SRC;
  return image;
}

function getJourneyPlayerSpritesheetFrames() {
  if (JOURNEY_PLAYER_SPRITESHEET.frames?.length) {
    return JOURNEY_PLAYER_SPRITESHEET.frames;
  }
  const image = JOURNEY_PLAYER_ANIMATION_IMAGE;
  if (
    !image ||
    !image.complete ||
    image.naturalWidth <= 0 ||
    image.naturalHeight <= 0 ||
    typeof document === "undefined"
  ) {
    return null;
  }

  const frames = buildJourneyPlayerFramesFromSpritesheet(
    image,
    JOURNEY_PLAYER_SPRITESHEET_FRAME_COUNT,
  );
  if (!frames?.length) {
    return null;
  }

  JOURNEY_PLAYER_SPRITESHEET.frames = frames;
  updatePlayerGroundAnchorFromCanvas(frames[0]);
  return frames;
}

function buildJourneyPlayerFramesFromSpritesheet(sheetImage, frameCount) {
  if (typeof document === "undefined") return null;
  const sourceW = sheetImage.naturalWidth;
  const sourceH = sheetImage.naturalHeight;
  const safeFrameCount = Math.max(1, Math.floor(frameCount));
  if (sourceW <= 0 || sourceH <= 0) return null;

  const baseFrameW = Math.floor(sourceW / safeFrameCount);
  if (baseFrameW <= 0) return null;

  const frames = [];
  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    const sx = frameIndex * baseFrameW;
    const sw =
      frameIndex === safeFrameCount - 1
        ? Math.max(1, sourceW - sx)
        : baseFrameW;
    if (sw <= 0) continue;
    const canvas = document.createElement("canvas") as SpriteCanvas;
    canvas.width = sw;
    canvas.height = sourceH;
    const frameCtx = canvas.getContext("2d");
    if (!frameCtx) continue;
    frameCtx.drawImage(sheetImage, sx, 0, sw, sourceH, 0, 0, sw, sourceH);
    frames.push(canvas);
  }
  return frames.length ? frames : null;
}

function getJourneyPlayerMovingFrame(nowMs) {
  const frames = getJourneyPlayerSpritesheetFrames();
  if (!frames?.length) {
    return null;
  }
  const frameIndex =
    Math.floor(Math.max(0, nowMs) / JOURNEY_PLAYER_ANIMATION_FRAME_MS) %
    frames.length;
  return frames[frameIndex] ?? frames[0];
}

function createJourneySpritesheet(src) {
  if (typeof Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
}

function getJourneyNodeVariants(marker) {
  if (journeyNodeVariantsByMarker.has(marker)) {
    return journeyNodeVariantsByMarker.get(marker);
  }
  const sheet = JOURNEY_NODE_SPRITESHEET_BY_MARKER[marker];
  const variantCount = JOURNEY_NODE_VARIANT_COUNT_BY_MARKER[marker];
  if (
    !sheet ||
    !sheet.complete ||
    sheet.naturalWidth <= 0 ||
    sheet.naturalHeight <= 0
  ) {
    return null;
  }
  const variants = sliceJourneyNodeVariants(sheet, variantCount, marker);
  journeyNodeVariantsByMarker.set(marker, variants);
  return variants;
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
  const variants = sliceJourneyVariants(
    sheet,
    variantCount,
    SPRITE_CHROMA_TOLERANCE,
  );
  journeyTreeVariantsByFamily.set(family, variants);
  return variants;
}

function sliceJourneyVariants(sheetImage, variantCount, chromaTolerance = 24) {
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
    const canvas = document.createElement("canvas") as SpriteCanvas;
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
      if (distance <= chromaTolerance) {
        pixels[p + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    canvas.groundAnchorFrac = computeSpriteGroundAnchorFrac(imageData, sourceH);
    variants.push(canvas);
  }

  return variants;
}

function sliceJourneyNodeVariants(sheetImage, variantCount, marker) {
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

  const sourceData = sourceCtx.getImageData(0, 0, sourceW, sourceH);
  const pixels = sourceData.data;
  const corner = sourceCtx.getImageData(1, 1, 1, 1).data;
  const keyR = corner[0];
  const keyG = corner[1];
  const keyB = corner[2];
  for (let p = 0; p < pixels.length; p += 4) {
    const dr = pixels[p] - keyR;
    const dg = pixels[p + 1] - keyG;
    const db = pixels[p + 2] - keyB;
    if (Math.hypot(dr, dg, db) <= SPRITE_CHROMA_TOLERANCE) {
      pixels[p + 3] = 0;
    }
  }
  sourceCtx.putImageData(sourceData, 0, 0);

  if (marker === "abandoned") {
    const gridVariants = sliceJourneyVariantsFromGrid(
      sourceCanvas,
      2,
      2,
      variantCount,
    );
    if (gridVariants.length === variantCount) {
      return gridVariants;
    }
  }

  const columnHasOpaque = new Array(sourceW).fill(false);
  for (let x = 0; x < sourceW; x += 1) {
    for (let y = 0; y < sourceH; y += 1) {
      const alpha = pixels[(y * sourceW + x) * 4 + 3];
      if (alpha > 8) {
        columnHasOpaque[x] = true;
        break;
      }
    }
  }

  const clusters = detectOpaqueColumnClusters(
    columnHasOpaque,
    variantCount,
    marker,
  );
  if (clusters.length !== variantCount) {
    return sliceJourneyVariants(
      sheetImage,
      variantCount,
      SPRITE_CHROMA_TOLERANCE,
    );
  }

  const padXByMarker = marker === "settlement" ? 20 : 16;
  const variants = [];
  for (const cluster of clusters) {
    const sx = Math.max(0, cluster.start - padXByMarker);
    const ex = Math.min(sourceW - 1, cluster.end + padXByMarker);
    const sw = Math.max(1, ex - sx + 1);
    const canvas = document.createElement("canvas") as SpriteCanvas;
    canvas.width = sw;
    canvas.height = sourceH;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(sourceCanvas, sx, 0, sw, sourceH, 0, 0, sw, sourceH);
    const imageData = ctx.getImageData(0, 0, sw, sourceH);
    canvas.groundAnchorFrac = computeSpriteGroundAnchorFrac(imageData, sourceH);
    variants.push(canvas);
  }

  return variants;
}

function sliceJourneyVariantsFromGrid(
  sourceCanvas,
  columns,
  rows,
  expectedCount,
) {
  const sourceW = sourceCanvas.width;
  const sourceH = sourceCanvas.height;
  if (
    sourceW <= 0 ||
    sourceH <= 0 ||
    columns <= 0 ||
    rows <= 0 ||
    expectedCount <= 0
  ) {
    return [];
  }

  const variants = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const sx = Math.round((col * sourceW) / columns);
      const ex = Math.round(((col + 1) * sourceW) / columns);
      const sy = Math.round((row * sourceH) / rows);
      const ey = Math.round(((row + 1) * sourceH) / rows);
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);
      const canvas = document.createElement("canvas") as SpriteCanvas;
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const imageData = ctx.getImageData(0, 0, sw, sh);
      canvas.groundAnchorFrac = computeSpriteGroundAnchorFrac(imageData, sh);
      variants.push(canvas);
      if (variants.length >= expectedCount) {
        return variants;
      }
    }
  }
  return variants;
}

function detectOpaqueColumnClusters(columnHasOpaque, targetCount, marker) {
  const width = columnHasOpaque.length;
  if (!width) return [];

  const gapMergePx = marker === "settlement" ? 28 : 22;
  const minClusterWidth = marker === "settlement" ? 44 : 34;
  const mergedMask = [...columnHasOpaque];

  let index = 0;
  while (index < width) {
    if (mergedMask[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < width && !mergedMask[end]) {
      end += 1;
    }
    const gapSize = end - index;
    const leftOpaque = index - 1 >= 0 && mergedMask[index - 1];
    const rightOpaque = end < width && mergedMask[end];
    if (leftOpaque && rightOpaque && gapSize <= gapMergePx) {
      for (let fill = index; fill < end; fill += 1) {
        mergedMask[fill] = true;
      }
    }
    index = end;
  }

  const clusters = [];
  index = 0;
  while (index < width) {
    if (!mergedMask[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < width && mergedMask[end]) {
      end += 1;
    }
    if (end - index >= minClusterWidth) {
      clusters.push({ start: index, end: end - 1 });
    }
    index = end;
  }

  if (clusters.length <= targetCount) {
    return clusters;
  }

  return clusters
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, targetCount)
    .sort((a, b) => a.start - b.start);
}

function computeSpriteGroundAnchorFrac(imageData, frameHeight) {
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
  if (treeFamily === "tuft") return "tuft";
  return "pine";
}

function resolveJourneyNodeVariantIndex(marker, variantSeed, variantCount) {
  const markerKey = typeof marker === "string" ? marker : "settlement";
  const seedKey =
    variantSeed == null || variantSeed === ""
      ? `${markerKey}:default`
      : `${markerKey}:${variantSeed}`;
  return hashString(seedKey) % Math.max(1, variantCount);
}

// ---------------------------------------------------------------------------
// Player figure
// ---------------------------------------------------------------------------

export function drawPlayerFigure(ctx, cx, groundY, isMoving = false) {
  const frames = getJourneyPlayerSpritesheetFrames();
  const idleFrame = frames?.[0] ?? null;
  const sprite = isMoving
    ? getJourneyPlayerMovingFrame(performance.now()) ?? idleFrame
    : idleFrame;
  if (sprite) {
    const sourceW = Math.max(1, sprite.naturalWidth ?? sprite.width ?? 1);
    const sourceH = Math.max(1, sprite.naturalHeight ?? sprite.height ?? 1);
    const targetHeight = JOURNEY_PLAYER_VISUAL_HEIGHT_PX;
    const targetWidth = targetHeight * (sourceW / sourceH);
    const groundedY =
      (Number.isFinite(groundY) ? groundY : 0) - JOURNEY_PLAYER_VERTICAL_OFFSET_PX;
    const groundAnchorFrac = clamp(
      Number(JOURNEY_PLAYER_SPRITESHEET.groundAnchorFrac),
      0.55,
      1,
      1,
    );
    const drawLeft = Math.round(cx - targetWidth * 0.5);
    const drawTop = Math.round(groundedY - targetHeight * groundAnchorFrac);

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
    return;
  }

  drawFallbackPlayerFigure(ctx, cx, groundY, isMoving);
}

function updatePlayerGroundAnchorFromCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") return;
  const frameCtx = canvas.getContext("2d");
  if (!frameCtx) return;
  try {
    const imageData = frameCtx.getImageData(0, 0, canvas.width, canvas.height);
    JOURNEY_PLAYER_SPRITESHEET.groundAnchorFrac = computeSpriteGroundAnchorFrac(
      imageData,
      canvas.height,
    );
  } catch {
    JOURNEY_PLAYER_SPRITESHEET.groundAnchorFrac = 1;
  }
}

function drawFallbackPlayerFigure(ctx, cx, groundY, isMoving = false) {
  const alt = isMoving && Math.floor(performance.now() / 220) % 2 === 1;
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
  return normalizeBiomeKeyName(biomeKey);
}

export function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function hash01(text) {
  return (hashString(text) % 100000) / 100000;
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value, min, max, fallback = min) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
