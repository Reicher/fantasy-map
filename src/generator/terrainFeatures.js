import { clamp } from "../utils.js";

export function buildTerrainProvinces(rng) {
  const provinces = [];
  const count = rng.int(5, 9);
  for (let index = 0; index < count; index += 1) {
    provinces.push({
      x: rng.range(-0.68, 0.68),
      y: rng.range(-0.54, 0.54),
      rx: rng.range(0.16, 0.42),
      ry: rng.range(0.14, 0.34),
      heightBias: rng.range(-0.38, 0.4),
      roughness: rng.range(0.05, 1),
      mountainBias: rng.range(-0.22, 0.46),
      noiseOffsetX: rng.range(-3, 3),
      noiseOffsetY: rng.range(-3, 3)
    });
  }
  return provinces;
}

export function buildInteriorFeatures(rng) {
  const features = [];
  const guaranteedKinds = ["basin", "valley", "wet-pocket", "dry-pocket", "forest-belt"];
  for (const kind of guaranteedKinds) {
    features.push(createInteriorFeature(kind, rng));
  }

  const extraCount = rng.int(3, 6);
  const kinds = ["basin", "valley", "wet-pocket", "dry-pocket", "plateau", "forest-belt"];
  for (let index = 0; index < extraCount; index += 1) {
    features.push(createInteriorFeature(rng.pick(kinds), rng));
  }

  return features;
}

export function sampleInteriorFeatures(features, x, y) {
  let heightBias = 0;
  let mountainBias = 0;
  let moistureBias = 0;
  let heatBias = 0;
  let total = 0;
  let centerWeight = 0;

  for (const feature of features) {
    const dx = x - feature.x;
    const dy = y - feature.y;
    const cos = Math.cos(feature.rotation);
    const sin = Math.sin(feature.rotation);
    const rx = (dx * cos - dy * sin) / feature.rx;
    const ry = (dx * sin + dy * cos) / feature.ry;
    const influence = Math.exp(-(rx * rx + ry * ry) * 1.6);
    if (influence < 0.02) {
      continue;
    }
    total += influence;
    heightBias += feature.heightBias * influence;
    mountainBias += feature.mountainBias * influence;
    moistureBias += feature.moistureBias * influence;
    heatBias += feature.heatBias * influence;
    centerWeight += (1 - Math.min(1, Math.hypot(feature.x, feature.y) / 0.58)) * influence;
  }

  if (total <= 0) {
    return {
      heightBias: 0,
      mountainBias: 0,
      moistureBias: 0,
      heatBias: 0,
      centerWeight: 0
    };
  }

  return {
    heightBias: clamp(heightBias / total, -0.5, 0.25),
    mountainBias: clamp(mountainBias / total, -0.5, 0.2),
    moistureBias: clamp(moistureBias / total, -0.42, 0.42),
    heatBias: clamp(heatBias / total, -0.18, 0.18),
    centerWeight: clamp(centerWeight / total, 0, 1)
  };
}

export function sampleTerrainProvince(provinces, x, y) {
  let heightBias = 0;
  let roughness = 0;
  let mountainBias = 0;
  let noiseOffsetX = 0;
  let noiseOffsetY = 0;
  let total = 0;

  for (const province of provinces) {
    const dx = (x - province.x) / province.rx;
    const dy = (y - province.y) / province.ry;
    const influence = Math.exp(-(dx * dx + dy * dy) * 1.6);
    if (influence < 0.02) {
      continue;
    }
    total += influence;
    heightBias += province.heightBias * influence;
    roughness += province.roughness * influence;
    mountainBias += province.mountainBias * influence;
    noiseOffsetX += province.noiseOffsetX * influence;
    noiseOffsetY += province.noiseOffsetY * influence;
  }

  if (total <= 0) {
    return {
      heightBias: 0,
      roughness: 0.2,
      mountainBias: 0,
      noiseOffsetX: 0,
      noiseOffsetY: 0
    };
  }

  return {
    heightBias: heightBias / total,
    roughness: roughness / total,
    mountainBias: mountainBias / total,
    noiseOffsetX: noiseOffsetX / total,
    noiseOffsetY: noiseOffsetY / total
  };
}

function createInteriorFeature(kind, rng) {
  const common = {
    kind,
    x: rng.range(-0.42, 0.42),
    y: rng.range(-0.32, 0.32),
    rotation: rng.range(0, Math.PI),
    noise: rng.range(-0.15, 0.15)
  };

  switch (kind) {
    case "basin":
      return {
        ...common,
        rx: rng.range(0.12, 0.24),
        ry: rng.range(0.1, 0.2),
        heightBias: rng.range(-0.42, -0.18),
        mountainBias: rng.range(-0.46, -0.2),
        moistureBias: rng.range(0.08, 0.28),
        heatBias: rng.range(-0.05, 0.06)
      };
    case "valley":
      return {
        ...common,
        rx: rng.range(0.22, 0.42),
        ry: rng.range(0.05, 0.11),
        heightBias: rng.range(-0.3, -0.12),
        mountainBias: rng.range(-0.3, -0.12),
        moistureBias: rng.range(0.04, 0.18),
        heatBias: rng.range(-0.04, 0.05)
      };
    case "wet-pocket":
      return {
        ...common,
        rx: rng.range(0.12, 0.22),
        ry: rng.range(0.1, 0.18),
        heightBias: rng.range(-0.14, 0.02),
        mountainBias: rng.range(-0.18, 0),
        moistureBias: rng.range(0.18, 0.38),
        heatBias: rng.range(-0.08, 0.02)
      };
    case "dry-pocket":
      return {
        ...common,
        rx: rng.range(0.12, 0.22),
        ry: rng.range(0.1, 0.18),
        heightBias: rng.range(-0.04, 0.08),
        mountainBias: rng.range(-0.08, 0.04),
        moistureBias: rng.range(-0.34, -0.12),
        heatBias: rng.range(0.02, 0.12)
      };
    case "forest-belt":
      return {
        ...common,
        rx: rng.range(0.18, 0.32),
        ry: rng.range(0.07, 0.14),
        heightBias: rng.range(-0.08, 0.06),
        mountainBias: rng.range(-0.14, 0.02),
        moistureBias: rng.range(0.14, 0.32),
        heatBias: rng.range(-0.04, 0.02)
      };
    case "plateau":
    default:
      return {
        ...common,
        rx: rng.range(0.14, 0.26),
        ry: rng.range(0.1, 0.2),
        heightBias: rng.range(0.08, 0.18),
        mountainBias: rng.range(0.02, 0.1),
        moistureBias: rng.range(-0.08, 0.06),
        heatBias: rng.range(-0.02, 0.06)
      };
  }
}
