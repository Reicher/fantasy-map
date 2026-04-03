import { BIOME_INFO } from "../../config.js";

export function buildDecorations(stripId, biomeKey, stripWidth, trackHeight) {
  const nodes = [];
  const spec = getDecorationSpec(biomeKey);
  const activeHeight = Math.max(120, trackHeight * 0.9);

  for (let slot = 0; slot < Math.max(1, Math.ceil(stripWidth / spec.stoneStride)); slot += 1) {
    if (hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:spawn`) > spec.stoneProbability) {
      continue;
    }

    const slotStart = slot * spec.stoneStride;
    const x = Math.min(
      Math.max(12, slotStart + 6 + hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:x`) * (spec.stoneStride - 12)),
      Math.max(12, stripWidth - 12)
    );
    const y = 10 + hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:y`) * activeHeight;
    const size = spec.stoneMin + hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:size`) * spec.stoneRange;
    const stone = document.createElement("span");
    stone.className = "play-ground-stone";
    stone.style.left = `${x.toFixed(1)}px`;
    stone.style.bottom = `${y.toFixed(1)}px`;
    stone.style.width = `${size.toFixed(1)}px`;
    stone.style.height = `${Math.max(3.5, size * 0.7).toFixed(1)}px`;
    stone.style.opacity = `${0.5 + hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:alpha`) * 0.34}`;
    stone.style.transform = `rotate(${(-18 + hash01(`${biomeKey}:${stripId}:stone-slot:${slot}:rot`) * 36).toFixed(1)}deg)`;
    nodes.push(stone);
  }

  for (let slot = 0; slot < Math.max(1, Math.ceil(stripWidth / spec.plantStride)); slot += 1) {
    if (hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:spawn`) > spec.plantProbability) {
      continue;
    }

    const slotStart = slot * spec.plantStride;
    const x = Math.min(
      Math.max(16, slotStart + 6 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:x`) * (spec.plantStride - 12)),
      Math.max(16, stripWidth - 16)
    );
    const y = 8 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:y`) * activeHeight;
    nodes.push(
      createGroundPlant({
        biomeKey,
        stripId,
        slot,
        x,
        y,
        type: spec.plantType
      })
    );
  }

  return nodes;
}

export function getStripColors(biomeKey) {
  const normalizedBiomeKey = normalizeBiomeKey(biomeKey);
  const baseHex =
    Object.values(BIOME_INFO).find((entry) => entry.key === normalizedBiomeKey)?.color ?? "#b9b27f";
  const base = hexToRgb(baseHex);
  const light = mixRgb(base, [235, 225, 193], 0.22);
  const deep = mixRgb(base, [92, 76, 51], 0.24);
  const stone = mixRgb(base, [96, 83, 64], 0.44);
  const tuft = mixRgb(base, [92, 90, 57], 0.36);

  return {
    light: rgbToCss(light),
    base: rgbToCss(base),
    deep: rgbToCss(deep),
    stone: rgbaToCss(stone, 0.58),
    tuft: rgbaToCss(tuft, 0.62)
  };
}

export function getBackdropColors(biomeKey, layerDepth = "near") {
  const normalizedBiomeKey = normalizeBiomeKey(biomeKey);
  const baseHex =
    Object.values(BIOME_INFO).find((entry) => entry.key === normalizedBiomeKey)?.color ?? "#b9b27f";
  const base = hexToRgb(baseHex);
  const mixTarget = layerDepth === "far" ? [86, 82, 68] : [96, 89, 70];
  const mixAmount = layerDepth === "far" ? 0.44 : 0.36;
  const fill = mixRgb(base, mixTarget, mixAmount);

  return {
    fill: rgbToCss(fill)
  };
}

export function buildBackdropShape({
  biomeKey,
  stripWidth,
  worldStart = 0,
  entryY = null
}) {
  const normalizedBiomeKey = normalizeBiomeKey(biomeKey) ?? "plains";
  const spec = getBackdropSpec(normalizedBiomeKey);
  const points = ["0% 100%"];
  const phaseOffset = hash01(`${normalizedBiomeKey}:phase`) * spec.primaryWavelength;
  const secondaryPhase = hash01(`${normalizedBiomeKey}:phase:secondary`) * spec.secondaryWavelength;
  const initialY =
    entryY == null
      ? sampleBackdropY(spec, phaseOffset, secondaryPhase, worldStart)
      : entryY;
  const blendWidth = Math.max(spec.sampleStep * 4, Math.min(140, stripWidth * 0.4));
  points.push(`0% ${initialY.toFixed(3)}%`);

  for (let x = spec.sampleStep; x <= stripWidth; x += spec.sampleStep) {
    const clampedX = Math.min(stripWidth, x);
    const xRatio = stripWidth <= 0 ? 1 : clampedX / stripWidth;
    const globalX = worldStart + clampedX;
    const targetY = sampleBackdropY(spec, phaseOffset, secondaryPhase, globalX);
    const blendT = entryY == null || clampedX >= blendWidth ? 1 : smoothstep(clampedX / blendWidth);
    const y = entryY == null ? targetY : initialY + (targetY - initialY) * blendT;
    points.push(`${(xRatio * 100).toFixed(3)}% ${y.toFixed(3)}%`);
  }

  let exitY = initialY;
  if (stripWidth > 0) {
    const edgeTargetY = sampleBackdropY(spec, phaseOffset, secondaryPhase, worldStart + stripWidth);
    const edgeBlendT = entryY == null || stripWidth >= blendWidth ? 1 : smoothstep(stripWidth / blendWidth);
    exitY = entryY == null ? edgeTargetY : initialY + (edgeTargetY - initialY) * edgeBlendT;
    points.push(`100% ${exitY.toFixed(3)}%`);
  }

  points.push("100% 100%");
  return {
    clipPath: `polygon(${points.join(", ")})`,
    exitY
  };
}

export function normalizeBiomeKey(biomeKey) {
  if (typeof biomeKey === "number") {
    return BIOME_INFO[biomeKey]?.key ?? null;
  }

  return biomeKey ?? null;
}

function getDecorationSpec(biomeKey) {
  switch (biomeKey) {
    case "desert":
      return {
        stoneStride: 48,
        stoneProbability: 0.22,
        stoneMin: 3.5,
        stoneRange: 3.5,
        plantStride: 38,
        plantProbability: 0.3,
        plantType: "dune"
      };
    case "forest":
      return {
        stoneStride: 42,
        stoneProbability: 0.18,
        stoneMin: 4.5,
        stoneRange: 4,
        plantStride: 30,
        plantProbability: 0.38,
        plantType: "tuft"
      };
    case "rainforest":
      return {
        stoneStride: 46,
        stoneProbability: 0.14,
        stoneMin: 4,
        stoneRange: 3.5,
        plantStride: 28,
        plantProbability: 0.42,
        plantType: "shrub"
      };
    case "tundra":
      return {
        stoneStride: 34,
        stoneProbability: 0.26,
        stoneMin: 4.5,
        stoneRange: 4.5,
        plantStride: 34,
        plantProbability: 0.24,
        plantType: "scrub"
      };
    case "highlands":
    case "mountain":
      return {
        stoneStride: 30,
        stoneProbability: 0.34,
        stoneMin: 5,
        stoneRange: 5,
        plantStride: 44,
        plantProbability: 0.16,
        plantType: "scrub"
      };
    default:
      return {
        stoneStride: 38,
        stoneProbability: 0.2,
        stoneMin: 4,
        stoneRange: 4,
        plantStride: 34,
        plantProbability: 0.28,
        plantType: "shrub"
      };
  }
}

function createGroundPlant({ biomeKey, stripId, slot, x, y, type }) {
  switch (type) {
    case "dune":
      return createDune({ biomeKey, stripId, slot, x, y });
    case "scrub":
      return createShrub({ biomeKey, stripId, slot, x, y, className: "play-ground-scrub" });
    case "shrub":
      return createShrub({ biomeKey, stripId, slot, x, y, className: "play-ground-shrub" });
    default:
      return createTuft({ biomeKey, stripId, slot, x, y });
  }
}

function createTuft({ biomeKey, stripId, slot, x, y }) {
  const height = 10 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:height`) * 9;
  const tuft = document.createElement("span");
  tuft.className = "play-ground-tuft";
  tuft.style.left = `${x.toFixed(1)}px`;
  tuft.style.bottom = `${y.toFixed(1)}px`;
  tuft.style.height = `${height.toFixed(1)}px`;
  tuft.style.width = `${(height * 1.02).toFixed(1)}px`;
  tuft.style.opacity = `${0.56 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:alpha`) * 0.24}`;

  for (let bladeIndex = 0; bladeIndex < 3; bladeIndex += 1) {
    const blade = document.createElement("span");
    blade.className = "play-ground-blade";
    blade.style.left = `${bladeIndex * 28 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:blade:${bladeIndex}`) * 10}%`;
    blade.style.height = `${68 + bladeIndex * 10}%`;
    blade.style.transform = `rotate(${(-28 + bladeIndex * 28).toFixed(1)}deg)`;
    tuft.append(blade);
  }

  return tuft;
}

function createShrub({ biomeKey, stripId, slot, x, y, className }) {
  const size = 8 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:size`) * 8;
  const shrub = document.createElement("span");
  shrub.className = className;
  shrub.style.left = `${x.toFixed(1)}px`;
  shrub.style.bottom = `${y.toFixed(1)}px`;
  shrub.style.width = `${size.toFixed(1)}px`;
  shrub.style.height = `${Math.max(6, size * 0.72).toFixed(1)}px`;
  shrub.style.opacity = `${0.56 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:alpha`) * 0.22}`;
  return shrub;
}

function createDune({ biomeKey, stripId, slot, x, y }) {
  const width = 12 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:width`) * 14;
  const height = Math.max(4, width * 0.24);
  const dune = document.createElement("span");
  dune.className = "play-ground-dune";
  dune.style.left = `${x.toFixed(1)}px`;
  dune.style.bottom = `${y.toFixed(1)}px`;
  dune.style.width = `${width.toFixed(1)}px`;
  dune.style.height = `${height.toFixed(1)}px`;
  dune.style.opacity = `${0.46 + hash01(`${biomeKey}:${stripId}:plant-slot:${slot}:alpha`) * 0.18}`;
  return dune;
}

function getBackdropSpec(biomeKey) {
  switch (biomeKey) {
    case "forest":
      return {
        baseY: 56,
        sampleStep: 18,
        primaryWavelength: 210,
        secondaryWavelength: 118,
        primaryAmplitude: 16,
        secondaryAmplitude: 5,
        primarySharpness: 1.5,
        secondarySharpness: 1.2
      };
    case "rainforest":
      return {
        baseY: 54,
        sampleStep: 16,
        primaryWavelength: 188,
        secondaryWavelength: 104,
        primaryAmplitude: 18,
        secondaryAmplitude: 6,
        primarySharpness: 1.42,
        secondarySharpness: 1.18
      };
    case "desert":
      return {
        baseY: 66,
        sampleStep: 22,
        primaryWavelength: 300,
        secondaryWavelength: 168,
        primaryAmplitude: 7,
        secondaryAmplitude: 2.5,
        primarySharpness: 1.9,
        secondarySharpness: 1.4
      };
    case "highlands":
    case "mountain":
      return {
        baseY: 60,
        sampleStep: 18,
        primaryWavelength: 224,
        secondaryWavelength: 128,
        primaryAmplitude: 22,
        secondaryAmplitude: 6,
        primarySharpness: 1.65,
        secondarySharpness: 1.3
      };
    case "tundra":
      return {
        baseY: 64,
        sampleStep: 20,
        primaryWavelength: 244,
        secondaryWavelength: 144,
        primaryAmplitude: 10,
        secondaryAmplitude: 3,
        primarySharpness: 1.7,
        secondarySharpness: 1.35
      };
    default:
      return {
        baseY: 68,
        sampleStep: 22,
        primaryWavelength: 276,
        secondaryWavelength: 168,
        primaryAmplitude: 9,
        secondaryAmplitude: 2.5,
        primarySharpness: 1.85,
        secondarySharpness: 1.45
      };
  }
}

function sampleBackdropY(spec, phaseOffset, secondaryPhase, x) {
  const primaryWave = 0.5 + 0.5 * Math.sin(((x + phaseOffset) / spec.primaryWavelength) * Math.PI * 2);
  const secondaryWave = 0.5 + 0.5 * Math.sin(((x + secondaryPhase) / spec.secondaryWavelength) * Math.PI * 2);
  const shapedPrimary = Math.pow(primaryWave, spec.primarySharpness);
  const shapedSecondary = Math.pow(secondaryWave, spec.secondarySharpness);
  return spec.baseY - spec.primaryAmplitude * shapedPrimary - spec.secondaryAmplitude * shapedSecondary;
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

function mixRgb(base, target, amount) {
  return base.map((channel, index) => Math.round(channel * (1 - amount) + target[index] * amount));
}

function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function rgbaToCss(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 100000) / 100000;
}
