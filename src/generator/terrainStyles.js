import { clamp } from "../utils.js";

export const STYLE_BUILDERS = {
  shield: createShieldProfile,
  twin: createTwinProfile,
  crescent: createCrescentProfile,
  shattered: createShatteredProfile,
  spine: createSpineProfile
};

export function blendStyles(primaryStyle, secondaryStyle, primaryKey, secondaryKey, rng) {
  const blend = rng.range(0.26, 0.46);
  const positiveBlobs = [...primaryStyle.positiveBlobs];
  const extraPositive = rng.shuffle(secondaryStyle.positiveBlobs).slice(
    0,
    Math.max(1, Math.round(secondaryStyle.positiveBlobs.length * blend))
  );
  const negativeBlobs = [...primaryStyle.negativeBlobs];
  const extraNegative = rng.shuffle(secondaryStyle.negativeBlobs).slice(
    0,
    Math.max(1, Math.round(Math.max(1, secondaryStyle.negativeBlobs.length) * blend))
  );

  return {
    name: primaryKey,
    secondaryName: secondaryKey,
    targetLandRatio: primaryStyle.targetLandRatio * (1 - blend * 0.4) + secondaryStyle.targetLandRatio * (blend * 0.4),
    seaBias: primaryStyle.seaBias * (1 - blend) + secondaryStyle.seaBias * blend,
    noiseScale: primaryStyle.noiseScale * (1 - blend) + secondaryStyle.noiseScale * blend,
    mountainBase: primaryStyle.mountainBase * (1 - blend) + secondaryStyle.mountainBase * blend,
    positiveBlobs: positiveBlobs.concat(extraPositive),
    negativeBlobs: negativeBlobs.concat(extraNegative)
  };
}

function createShieldProfile(rng, sizeFactor) {
  const positiveBlobs = [
    createBlob(0.02, -0.02, rng.range(0.38, 0.5), 1.38),
    createBlob(rng.range(-0.22, -0.06), rng.range(-0.24, 0.24), rng.range(0.18, 0.26), 0.86),
    createBlob(rng.range(0.08, 0.24), rng.range(-0.2, 0.24), rng.range(0.16, 0.24), 0.82)
  ];
  if (rng.chance(0.55)) {
    positiveBlobs.push(
      createBlob(rng.range(-0.2, 0.2), rng.range(-0.18, 0.18), rng.range(0.12, 0.2), 0.46)
    );
  }

  return {
    name: "shield",
    targetLandRatio: 0.25 + sizeFactor * 0.16,
    seaBias: 0.3,
    noiseScale: 2.15,
    mountainBase: 2.4,
    positiveBlobs,
    negativeBlobs: [
      createBlob(rng.range(-0.16, 0.16), rng.range(-0.16, 0.16), rng.range(0.14, 0.22), 0.24, 1.8)
    ]
  };
}

function createTwinProfile(rng, sizeFactor) {
  const offset = rng.range(0.16, 0.28);
  return {
    name: "twin",
    targetLandRatio: 0.22 + sizeFactor * 0.15,
    seaBias: 0.35,
    noiseScale: 2.45,
    mountainBase: 3.1,
    positiveBlobs: [
      createBlob(-offset, rng.range(-0.14, 0.14), rng.range(0.24, 0.34), 1.12),
      createBlob(offset, rng.range(-0.14, 0.14), rng.range(0.22, 0.32), 1.06),
      createBlob(rng.range(-0.06, 0.06), rng.range(-0.1, 0.1), rng.range(0.14, 0.22), 0.54)
    ],
    negativeBlobs: [
      createBlob(rng.range(-0.02, 0.02), rng.range(-0.08, 0.08), rng.range(0.11, 0.18), 0.42, 2.1)
    ]
  };
}

function createCrescentProfile(rng, sizeFactor) {
  const positiveBlobs = [];
  const arcRadius = rng.range(0.26, 0.4);
  const startAngle = rng.range(0.35, 1.2);
  const arcSpan = rng.range(1.6, 2.45);
  const count = rng.int(4, 6);

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const angle = startAngle + arcSpan * t;
    positiveBlobs.push(
      createBlob(
        Math.cos(angle) * arcRadius * 0.78,
        Math.sin(angle) * arcRadius * 0.56,
        rng.range(0.18, 0.26),
        rng.range(0.7, 1.02)
      )
    );
  }

  return {
    name: "crescent",
    targetLandRatio: 0.19 + sizeFactor * 0.14,
    seaBias: 0.42,
    noiseScale: 2.7,
    mountainBase: 3.3,
    positiveBlobs,
    negativeBlobs: [createBlob(0.04, 0.02, rng.range(0.22, 0.34), 0.72, 2.2)]
  };
}

function createShatteredProfile(rng, sizeFactor) {
  const positiveBlobs = [];
  const count = rng.int(6, 11);
  for (let i = 0; i < count; i += 1) {
    positiveBlobs.push(
      createBlob(
        rng.range(-0.44, 0.44),
        rng.range(-0.32, 0.32),
        rng.range(0.12, 0.22),
        rng.range(0.48, 0.82)
      )
    );
  }

  const negativeBlobs = [];
  for (let i = 0; i < 3; i += 1) {
    negativeBlobs.push(
      createBlob(
        rng.range(-0.3, 0.3),
        rng.range(-0.24, 0.24),
        rng.range(0.14, 0.22),
        rng.range(0.18, 0.34),
        2.2
      )
    );
  }

  return {
    name: "shattered",
    targetLandRatio: 0.18 + sizeFactor * 0.12,
    seaBias: 0.44,
    noiseScale: 2.95,
    mountainBase: 2.6,
    positiveBlobs,
    negativeBlobs
  };
}

function createSpineProfile(rng, sizeFactor) {
  const tilt = rng.range(-0.6, 0.6);
  const positiveBlobs = [];
  const count = rng.int(4, 6);
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    positiveBlobs.push(
      createBlob(
        -0.38 + t * 0.76 + rng.range(-0.05, 0.05),
        (-0.22 + t * 0.44) * tilt + rng.range(-0.14, 0.14),
        rng.range(0.18, 0.28),
        rng.range(0.76, 1.08)
      )
    );
  }

  return {
    name: "spine",
    targetLandRatio: 0.24 + sizeFactor * 0.15,
    seaBias: 0.34,
    noiseScale: 2.3,
    mountainBase: 3.6,
    positiveBlobs,
    negativeBlobs: [
      createBlob(rng.range(-0.15, 0.15), rng.range(-0.18, 0.18), rng.range(0.12, 0.18), 0.3, 2.4)
    ]
  };
}

function createBlob(x, y, radius, strength, tightness = 1.6) {
  return { x, y, radius, strength, tightness };
}
