import { clamp } from "@fardvag/shared/utils";

export function buildTerrainProvinces(rng) {
  const provinces = [];
  const count = rng.int(5, 9);
  for (let index = 0; index < count; index += 1) {
    const rx = rng.range(0.16, 0.42);
    const ry = rng.range(0.14, 0.34);
    provinces.push({
      x: rng.range(-0.68, 0.68),
      y: rng.range(-0.54, 0.54),
      rx,
      ry,
      invRx: 1 / rx,
      invRy: 1 / ry,
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

export function sampleInteriorFeatures(features, x, y, out = null) {
  const target =
    out ??
    {
      heightBias: 0,
      mountainBias: 0,
      moistureBias: 0,
      heatBias: 0,
      centerWeight: 0,
    };
  let heightBias = 0;
  let mountainBias = 0;
  let moistureBias = 0;
  let heatBias = 0;
  let total = 0;
  let centerWeight = 0;

  for (const feature of features) {
    const dx = x - feature.x;
    const dy = y - feature.y;
    const rx = (dx * feature.rotationCos - dy * feature.rotationSin) * feature.invRx;
    const ry = (dx * feature.rotationSin + dy * feature.rotationCos) * feature.invRy;
    const influence = Math.exp(-(rx * rx + ry * ry) * 1.6);
    if (influence < 0.02) {
      continue;
    }
    total += influence;
    heightBias += feature.heightBias * influence;
    mountainBias += feature.mountainBias * influence;
    moistureBias += feature.moistureBias * influence;
    heatBias += feature.heatBias * influence;
    centerWeight += feature.centerBias * influence;
  }

  if (total <= 0) {
    target.heightBias = 0;
    target.mountainBias = 0;
    target.moistureBias = 0;
    target.heatBias = 0;
    target.centerWeight = 0;
    return target;
  }

  target.heightBias = clamp(heightBias / total, -0.5, 0.25);
  target.mountainBias = clamp(mountainBias / total, -0.5, 0.2);
  target.moistureBias = clamp(moistureBias / total, -0.42, 0.42);
  target.heatBias = clamp(heatBias / total, -0.18, 0.18);
  target.centerWeight = clamp(centerWeight / total, 0, 1);
  return target;
}

export function sampleTerrainProvince(provinces, x, y, out = null) {
  const target =
    out ??
    {
      heightBias: 0,
      roughness: 0.2,
      mountainBias: 0,
      noiseOffsetX: 0,
      noiseOffsetY: 0,
    };
  let heightBias = 0;
  let roughness = 0;
  let mountainBias = 0;
  let noiseOffsetX = 0;
  let noiseOffsetY = 0;
  let total = 0;

  for (const province of provinces) {
    const dx = (x - province.x) * province.invRx;
    const dy = (y - province.y) * province.invRy;
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
    target.heightBias = 0;
    target.roughness = 0.2;
    target.mountainBias = 0;
    target.noiseOffsetX = 0;
    target.noiseOffsetY = 0;
    return target;
  }

  target.heightBias = heightBias / total;
  target.roughness = roughness / total;
  target.mountainBias = mountainBias / total;
  target.noiseOffsetX = noiseOffsetX / total;
  target.noiseOffsetY = noiseOffsetY / total;
  return target;
}

function createInteriorFeature(kind, rng) {
  const rotation = rng.range(0, Math.PI);
  const rx = rng.range(0.12, 0.24);
  const ry = rng.range(0.1, 0.2);
  const common = {
    kind,
    x: rng.range(-0.42, 0.42),
    y: rng.range(-0.32, 0.32),
    rotation,
    rotationCos: Math.cos(rotation),
    rotationSin: Math.sin(rotation),
    noise: rng.range(-0.15, 0.15),
    rx,
    ry,
    invRx: 1 / rx,
    invRy: 1 / ry,
    centerBias: 0,
  };
  common.centerBias = 1 - Math.min(1, Math.hypot(common.x, common.y) / 0.58);

  switch (kind) {
    case "basin":
      return {
        ...common,
        heightBias: rng.range(-0.42, -0.18),
        mountainBias: rng.range(-0.46, -0.2),
        moistureBias: rng.range(0.08, 0.28),
        heatBias: rng.range(-0.05, 0.06)
      };
    case "valley":
      common.rx = rng.range(0.22, 0.42);
      common.ry = rng.range(0.05, 0.11);
      common.invRx = 1 / common.rx;
      common.invRy = 1 / common.ry;
      return {
        ...common,
        heightBias: rng.range(-0.3, -0.12),
        mountainBias: rng.range(-0.3, -0.12),
        moistureBias: rng.range(0.04, 0.18),
        heatBias: rng.range(-0.04, 0.05)
      };
    case "wet-pocket":
      common.rx = rng.range(0.12, 0.22);
      common.ry = rng.range(0.1, 0.18);
      common.invRx = 1 / common.rx;
      common.invRy = 1 / common.ry;
      return {
        ...common,
        heightBias: rng.range(-0.14, 0.02),
        mountainBias: rng.range(-0.18, 0),
        moistureBias: rng.range(0.18, 0.38),
        heatBias: rng.range(-0.08, 0.02)
      };
    case "dry-pocket":
      common.rx = rng.range(0.12, 0.22);
      common.ry = rng.range(0.1, 0.18);
      common.invRx = 1 / common.rx;
      common.invRy = 1 / common.ry;
      return {
        ...common,
        heightBias: rng.range(-0.04, 0.08),
        mountainBias: rng.range(-0.08, 0.04),
        moistureBias: rng.range(-0.34, -0.12),
        heatBias: rng.range(0.02, 0.12)
      };
    case "forest-belt":
      common.rx = rng.range(0.18, 0.32);
      common.ry = rng.range(0.07, 0.14);
      common.invRx = 1 / common.rx;
      common.invRy = 1 / common.ry;
      return {
        ...common,
        heightBias: rng.range(-0.08, 0.06),
        mountainBias: rng.range(-0.14, 0.02),
        moistureBias: rng.range(0.14, 0.32),
        heatBias: rng.range(-0.04, 0.02)
      };
    case "plateau":
    default:
      common.rx = rng.range(0.14, 0.26);
      common.ry = rng.range(0.1, 0.2);
      common.invRx = 1 / common.rx;
      common.invRy = 1 / common.ry;
      return {
        ...common,
        heightBias: rng.range(0.08, 0.18),
        mountainBias: rng.range(0.02, 0.1),
        moistureBias: rng.range(-0.08, 0.06),
        heatBias: rng.range(-0.02, 0.06)
      };
  }
}
