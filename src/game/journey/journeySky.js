import {
  DEFAULT_TIME_OF_DAY_HOURS,
  normalizeTimeOfDayHours,
} from "../timeOfDay.js";
import {
  clamp01,
  clampValue,
  lerpRgb,
  rgbCssFromArray,
} from "./journeySceneMath.js";

const GROUND_TOP_FRAC = 0.67;
const OCEAN_HORIZON_TOP_FRAC = 0.45;

const DAY_SKY_TOP_RGB = [140, 197, 236];
const DAY_SKY_BOTTOM_RGB = [210, 228, 240];
const TWILIGHT_SKY_TOP_RGB = [79, 109, 171];
const TWILIGHT_SKY_BOTTOM_RGB = [246, 170, 120];
const NIGHT_SKY_TOP_RGB = [14, 24, 48];
const NIGHT_SKY_BOTTOM_RGB = [49, 70, 104];

const LUNAR_CYCLE_DAYS = 29.530588;
const LUNAR_PHASE_COUNT = 8;
const TAU = Math.PI * 2;

export function drawSky(ctx, viewW, viewH, skyState) {
  const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.78);
  grad.addColorStop(0, rgbCssFromArray(skyState.topRgb));
  grad.addColorStop(0.62, rgbCssFromArray(skyState.middleRgb));
  grad.addColorStop(1, rgbCssFromArray(skyState.bottomRgb));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH);

  drawStars(ctx, viewW, skyState);
  drawSun(ctx, skyState);
  drawMoon(ctx, skyState);
  drawClouds(ctx, viewW, viewH, skyState);
}

export function drawOceanHorizon(ctx, viewW, viewH, skyState) {
  const top = Math.round(viewH * OCEAN_HORIZON_TOP_FRAC);
  const bottom = Math.round(viewH * GROUND_TOP_FRAC);
  const h = bottom - top;
  const horizon = skyState.horizonRgb;
  const daylight = skyState.daylight;
  const night = skyState.night;
  const twilight = skyState.twilight;
  const moonlight = skyState.moonlight;
  const cloudCover = skyState.cloudCover;
  const cloudDim = 1 - cloudCover * 0.58;
  const dawnWarmth = skyState.morningWarmth;
  const duskWarmth = skyState.eveningWarmth;

  const nearHorizonBase = lerpRgb(
    lerpRgb(horizon, [108, 136, 178], night * 0.54),
    [182, 216, 232],
    daylight * (0.58 + cloudDim * 0.28) + twilight * 0.28 + moonlight * 0.2,
  );
  const nearHorizon = lerpRgb(
    nearHorizonBase,
    [255, 140, 98],
    dawnWarmth * 0.44 + duskWarmth * 0.24,
  );

  const midOcean = lerpRgb(
    [14, 36, 80],
    [70, 156, 182],
    daylight * (0.7 + cloudDim * 0.26) + twilight * 0.17 + moonlight * 0.24,
  );
  const deepOcean = lerpRgb(
    [9, 22, 56],
    [46, 112, 154],
    daylight * (0.65 + cloudDim * 0.24) + twilight * 0.15 + moonlight * 0.17,
  );
  const floorOcean = lerpRgb(
    [6, 15, 40],
    [20, 78, 126],
    daylight * (0.62 + cloudDim * 0.2) + twilight * 0.12 + moonlight * 0.1,
  );

  const ocean = ctx.createLinearGradient(0, top, 0, bottom);
  ocean.addColorStop(0, rgbCssFromArray(horizon));
  ocean.addColorStop(0.12, rgbCssFromArray(nearHorizon));
  ocean.addColorStop(0.38, rgbCssFromArray(midOcean));
  ocean.addColorStop(0.7, rgbCssFromArray(deepOcean));
  ocean.addColorStop(1, rgbCssFromArray(floorOcean));
  ctx.fillStyle = ocean;
  ctx.fillRect(0, top, viewW, h);

  if (bottom < viewH) {
    ctx.fillStyle = rgbCssFromArray(floorOcean);
    ctx.fillRect(0, bottom, viewW, viewH - bottom);
  }

  const bandCount = 7;
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const bandT = (bandIndex + 1) / (bandCount + 1);
    const y = top + h * (0.1 + bandT * 0.76);
    const amplitude =
      (3.8 + bandIndex * 0.9) *
      (0.55 + daylight * 0.62 + twilight * 0.18 + moonlight * 0.46);
    const waveLength = Math.max(112, viewW * (0.14 + bandIndex * 0.06));
    const alpha =
      (0.03 + daylight * 0.055 + twilight * 0.055 + moonlight * 0.11) *
      (1 - bandT * 0.4) *
      (0.8 + cloudDim * 0.36);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= viewW + 8; x += 8) {
      const wave = Math.sin(
        (x / waveLength) * TAU +
          bandIndex * 0.8 +
          skyState.absoluteHours * 0.24,
      );
      ctx.lineTo(x, y + wave * amplitude);
    }
    ctx.strokeStyle = `rgba(214, 238, 246, ${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const glareY = top + Math.round(h * 0.1);
  const glare = ctx.createLinearGradient(0, glareY - 1, 0, glareY + 3);
  glare.addColorStop(0, "rgba(255, 255, 255, 0)");
  glare.addColorStop(
    0.4,
    `rgba(255, 255, 255, ${
      0.08 +
      daylight * 0.26 +
      twilight * 0.16 +
      moonlight * 0.17 -
      night * 0.04
    })`,
  );
  glare.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, glareY - 1, viewW, 4);

  const shoreY = bottom - 2;
  const shore = ctx.createLinearGradient(0, shoreY - 4, 0, shoreY + 2);
  shore.addColorStop(0, "rgba(255,255,255,0)");
  shore.addColorStop(
    0.58,
    `rgba(246, 244, 230, ${
      0.1 +
      twilight * 0.12 +
      daylight * 0.14 +
      moonlight * 0.11 +
      dawnWarmth * 0.12
    })`,
  );
  shore.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shore;
  ctx.fillRect(0, shoreY - 4, viewW, 8);
}

export function drawNightVeil(ctx, viewW, viewH, skyState) {
  const moonRelief = skyState.moonlight * (1 - skyState.cloudCover * 0.42);
  const alpha = clamp01(
    skyState.night * (0.64 + skyState.cloudCover * 0.2 - moonRelief * 0.78) +
      skyState.twilight * 0.07,
  );
  if (alpha <= 0.01) return;

  const veil = ctx.createLinearGradient(0, 0, 0, viewH);
  veil.addColorStop(0, `rgba(5, 9, 22, ${alpha * 0.76})`);
  veil.addColorStop(1, `rgba(7, 11, 24, ${alpha})`);
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, viewW, viewH);
}

export function createSkyState(timeOfDayHours, viewW, viewH, options = {}) {
  const hour = normalizeTimeOfDayHours(
    Number.isFinite(timeOfDayHours)
      ? timeOfDayHours
      : DEFAULT_TIME_OF_DAY_HOURS,
  );
  const elapsedHours = Number.isFinite(options.elapsedHours)
    ? Math.max(0, options.elapsedHours)
    : hour;
  const skySeed = hashStringSeed(options.skySeed ?? "journey-sky");

  const horizonY = Math.round(viewH * GROUND_TOP_FRAC);
  const orbitCenterX = viewW / 2;
  const orbitRadiusX = Math.max(80, viewW * 0.5 - Math.max(18, viewW * 0.02));
  const orbitRadiusY = Math.max(64, horizonY - Math.max(54, viewH * 0.065));

  const angle = ((hour - 12) / 24) * TAU - Math.PI / 2;
  const sunPos = {
    x: orbitCenterX + Math.cos(angle) * orbitRadiusX,
    y: horizonY + Math.sin(angle) * orbitRadiusY,
  };
  const moonAngle = angle + Math.PI;
  const moonPos = {
    x: orbitCenterX + Math.cos(moonAngle) * orbitRadiusX,
    y: horizonY + Math.sin(moonAngle) * orbitRadiusY,
  };

  const sunAltitude = clampValue((horizonY - sunPos.y) / orbitRadiusY, -1, 1);
  const moonAltitude = clampValue(
    (horizonY - moonPos.y) / orbitRadiusY,
    -1,
    1,
  );
  const daylight = clamp01((sunAltitude + 0.16) / 1.16);
  const night = 1 - daylight;
  const twilight = clamp01(1 - Math.abs(sunAltitude) * 2.35);

  const morningWarmth = clamp01(1 - Math.abs(hour - 6.1) / 2.35);
  const eveningWarmth = clamp01(1 - Math.abs(hour - 18.1) / 2.2);
  const cloudCover = sampleCloudCover(elapsedHours, skySeed);

  const cloudyDayTop = [105, 141, 178];
  const cloudyDayBottom = [182, 198, 213];
  const dayTop = lerpRgb(DAY_SKY_TOP_RGB, cloudyDayTop, cloudCover * 0.82);
  const dayBottom = lerpRgb(
    DAY_SKY_BOTTOM_RGB,
    cloudyDayBottom,
    cloudCover * 0.76,
  );

  const twilightTopWeight = twilight * (0.3 + night * 0.15) * (1 - cloudCover * 0.25);
  const twilightBottomWeight = twilight * (0.62 + night * 0.2) * (1 - cloudCover * 0.18);
  const baseTop = lerpRgb(NIGHT_SKY_TOP_RGB, dayTop, daylight);
  const baseBottom = lerpRgb(NIGHT_SKY_BOTTOM_RGB, dayBottom, daylight);

  const dawnTwilightBottom = lerpRgb(TWILIGHT_SKY_BOTTOM_RGB, [255, 142, 108], 0.46);
  const duskTwilightBottom = lerpRgb(TWILIGHT_SKY_BOTTOM_RGB, [236, 132, 104], 0.34);
  const twilightBottomTarget = lerpRgb(
    duskTwilightBottom,
    dawnTwilightBottom,
    clamp01((morningWarmth * 1.14) / (morningWarmth * 1.14 + eveningWarmth + 1e-6)),
  );

  let topRgb = lerpRgb(baseTop, TWILIGHT_SKY_TOP_RGB, twilightTopWeight);
  let bottomRgb = lerpRgb(baseBottom, twilightBottomTarget, twilightBottomWeight);

  topRgb = lerpRgb(topRgb, [126, 146, 168], cloudCover * (0.22 + daylight * 0.2));
  bottomRgb = lerpRgb(
    bottomRgb,
    [174, 169, 170],
    cloudCover * (0.16 + twilight * 0.2),
  );

  const middleRgb = lerpRgb(topRgb, bottomRgb, 0.5);
  const warmHorizonWeight = clamp01(
    morningWarmth * 0.72 + eveningWarmth * 0.44 + twilight * 0.22,
  );
  const warmHorizonColor = lerpRgb([244, 150, 112], [255, 124, 86], morningWarmth * 0.74);
  let horizonRgb = lerpRgb(bottomRgb, warmHorizonColor, warmHorizonWeight);
  horizonRgb = lerpRgb(
    horizonRgb,
    [160, 172, 188],
    cloudCover * (0.34 + daylight * 0.2),
  );

  const sunVisible =
    clamp01((sunAltitude + 0.18) / 0.48) * (1 - cloudCover * 0.34 + twilight * 0.15);

  const moonCycleProgress = positiveMod(
    elapsedHours / (24 * LUNAR_CYCLE_DAYS) + hash01(skySeed * 0.0137 + 1.93),
    1,
  );
  const moonIllumination = 0.5 - 0.5 * Math.cos(moonCycleProgress * TAU);
  const moonPhaseIndex =
    Math.floor(moonCycleProgress * LUNAR_PHASE_COUNT + 0.5) % LUNAR_PHASE_COUNT;

  const moonVisible =
    clamp01((moonAltitude + 0.2) / 0.54) *
    (0.28 + night * 0.88) *
    (0.18 + moonIllumination * 0.94) *
    (1 - cloudCover * 0.52 + twilight * 0.18);

  const moonlight =
    clamp01((moonAltitude + 0.08) / 1.04) * moonIllumination * moonVisible * night;

  return {
    hour,
    absoluteHours: elapsedHours,
    daylight,
    night,
    twilight,
    horizonY,
    topRgb,
    middleRgb,
    bottomRgb,
    horizonRgb,
    cloudCover,
    cloudDriftHours: elapsedHours,
    skySeed,
    morningWarmth,
    eveningWarmth,
    moonlight,
    sun: {
      ...sunPos,
      visible: sunVisible,
      radius: Math.max(14, viewH * 0.024),
    },
    moon: {
      ...moonPos,
      visible: moonVisible,
      radius: Math.max(10, viewH * 0.017),
      cycleProgress: moonCycleProgress,
      illumination: moonIllumination,
      phaseIndex: moonPhaseIndex,
    },
  };
}

function drawStars(ctx, viewW, skyState) {
  const starAlpha = clamp01(
    skyState.night * 1.08 +
      skyState.twilight * 0.18 -
      0.06 -
      skyState.cloudCover * 0.68,
  );
  if (starAlpha <= 0.01) {
    return;
  }

  const skyTop = Math.max(48, skyState.horizonY * 0.9);
  const starCount = Math.max(32, Math.round((viewW * skyTop) / 14800));
  for (let index = 0; index < starCount; index += 1) {
    const x = hash01(index * 17.31 + viewW * 0.023) * viewW;
    const y = Math.pow(hash01(index * 43.81 + 0.217), 1.52) * skyTop;
    const size = 0.5 + hash01(index * 97.12 + 0.71) * 1.7;
    const twinkle =
      0.48 +
      0.52 *
        Math.sin(
          ((skyState.hour / 24) * TAU + index * 0.62) *
            (0.88 + hash01(index * 29.44 + 1.2) * 0.35),
        );
    const alpha =
      clamp01(0.2 + hash01(index * 58.44 + 0.1) * 0.86) *
      starAlpha *
      (0.64 + twinkle * 0.36);
    if (alpha <= 0.012) {
      continue;
    }

    const warmMix = hash01(index * 12.3 + 0.29);
    const coreRgb = lerpRgb([206, 221, 255], [255, 242, 206], warmMix * 0.4);
    ctx.fillStyle = `rgba(${coreRgb[0]}, ${coreRgb[1]}, ${coreRgb[2]}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();

    if (size > 1.35) {
      ctx.strokeStyle = `rgba(232, 241, 255, ${alpha * 0.5})`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x - size * 1.7, y);
      ctx.lineTo(x + size * 1.7, y);
      ctx.moveTo(x, y - size * 1.7);
      ctx.lineTo(x, y + size * 1.7);
      ctx.stroke();
    }
  }
}

function drawSun(ctx, skyState) {
  const sun = skyState.sun;
  if (sun.visible <= 0.001) return;

  const cloudDim = 1 - skyState.cloudCover * 0.55;
  const glowRadius = sun.radius * (3.35 + skyState.twilight * 0.92);
  const glow = ctx.createRadialGradient(
    sun.x,
    sun.y,
    0,
    sun.x,
    sun.y,
    glowRadius,
  );
  glow.addColorStop(
    0,
    `rgba(255, 244, 206, ${(0.5 * sun.visible + 0.22 * skyState.daylight) * cloudDim})`,
  );
  glow.addColorStop(
    0.5,
    `rgba(255, 186, 116, ${0.35 * sun.visible * cloudDim})`,
  );
  glow.addColorStop(1, "rgba(255, 172, 94, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 240, 196, ${(0.72 + sun.visible * 0.24) * (1 - skyState.cloudCover * 0.22)})`;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.radius, 0, TAU);
  ctx.fill();
}

function drawMoon(ctx, skyState) {
  const moon = skyState.moon;
  if (moon.visible <= 0.001) return;

  const glowRadius = moon.radius * 3.1;
  const glow = ctx.createRadialGradient(
    moon.x,
    moon.y,
    0,
    moon.x,
    moon.y,
    glowRadius,
  );
  glow.addColorStop(
    0,
    `rgba(237, 244, 255, ${(0.14 + moon.visible * 0.32) * (0.42 + moon.illumination * 0.92)})`,
  );
  glow.addColorStop(1, "rgba(215, 231, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, glowRadius, 0, TAU);
  ctx.fill();

  drawMoonDiskWithPhase(ctx, moon, skyState);
}

function drawMoonDiskWithPhase(ctx, moon, skyState) {
  const litAlpha = (0.34 + moon.visible * 0.56) * (0.16 + moon.illumination * 0.96);
  ctx.fillStyle = `rgba(235, 243, 255, ${litAlpha})`;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radius, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radius, 0, TAU);
  ctx.clip();

  const shadowAlpha = (0.48 + (1 - moon.illumination) * 0.42) * moon.visible;
  ctx.fillStyle = `rgba(10, 19, 36, ${shadowAlpha})`;

  switch (moon.phaseIndex) {
    case 0: {
      // Nymåne
      ctx.fillRect(
        moon.x - moon.radius - 2,
        moon.y - moon.radius - 2,
        moon.radius * 2 + 4,
        moon.radius * 2 + 4,
      );
      break;
    }
    case 1: {
      // Tilltagande skära
      ctx.beginPath();
      ctx.ellipse(
        moon.x - moon.radius * 0.55,
        moon.y,
        moon.radius * 1.02,
        moon.radius,
        0,
        0,
        TAU,
      );
      ctx.fill();
      break;
    }
    case 2: {
      // Första kvarteret
      ctx.fillRect(
        moon.x - moon.radius - 2,
        moon.y - moon.radius - 2,
        moon.radius + 2,
        moon.radius * 2 + 4,
      );
      break;
    }
    case 3: {
      // Tilltagande gibbe
      ctx.beginPath();
      ctx.ellipse(
        moon.x - moon.radius * 1.24,
        moon.y,
        moon.radius,
        moon.radius,
        0,
        0,
        TAU,
      );
      ctx.fill();
      break;
    }
    case 4:
      // Fullmåne
      break;
    case 5: {
      // Avtagande gibbe
      ctx.beginPath();
      ctx.ellipse(
        moon.x + moon.radius * 1.24,
        moon.y,
        moon.radius,
        moon.radius,
        0,
        0,
        TAU,
      );
      ctx.fill();
      break;
    }
    case 6: {
      // Sista kvarteret
      ctx.fillRect(
        moon.x,
        moon.y - moon.radius - 2,
        moon.radius + 2,
        moon.radius * 2 + 4,
      );
      break;
    }
    default: {
      // Avtagande skära
      ctx.beginPath();
      ctx.ellipse(
        moon.x + moon.radius * 0.55,
        moon.y,
        moon.radius * 1.02,
        moon.radius,
        0,
        0,
        TAU,
      );
      ctx.fill();
      break;
    }
  }

  // Subtila kratrar när månen är synlig.
  if (moon.illumination > 0.1) {
    ctx.fillStyle = `rgba(198, 214, 236, ${(0.08 + moon.visible * 0.12) * moon.illumination})`;
    ctx.beginPath();
    ctx.arc(
      moon.x - moon.radius * 0.28,
      moon.y - moon.radius * 0.2,
      moon.radius * 0.16,
      0,
      TAU,
    );
    ctx.arc(
      moon.x + moon.radius * 0.24,
      moon.y + moon.radius * 0.08,
      moon.radius * 0.12,
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.restore();
}

function drawClouds(ctx, viewW, viewH, skyState) {
  const cover = skyState.cloudCover;
  if (cover <= 0.02) {
    return;
  }

  const skyTop = Math.max(48, skyState.horizonY * 0.83);
  const cloudCount = Math.max(
    4,
    Math.round((viewW / 220) * (1.3 + cover * 2.8)),
  );
  const minY = Math.max(12, viewH * 0.02);
  const maxY = Math.max(minY + 4, skyTop - 14);

  const warmCloudTint = lerpRgb(
    [212, 202, 194],
    [255, 224, 198],
    clamp01(skyState.morningWarmth * 0.84 + skyState.eveningWarmth * 0.54),
  );
  const cloudLightRgb = lerpRgb(
    [192, 205, 220],
    warmCloudTint,
    clamp01(skyState.daylight * 0.62 + skyState.twilight * 0.34),
  );
  const cloudShadowRgb = lerpRgb(
    [116, 130, 152],
    [154, 146, 142],
    clamp01(skyState.daylight * 0.46 + skyState.twilight * 0.24),
  );

  for (let index = 0; index < cloudCount; index += 1) {
    const baseSeed = skyState.skySeed * 0.0013 + index * 11.43;
    const size =
      (46 + hash01(baseSeed + 0.8) * 132) *
      (0.74 + cover * 0.78 + hash01(baseSeed + 1.9) * 0.16);
    const y =
      minY +
      Math.pow(hash01(baseSeed + 2.7), 1.22) * Math.max(1, maxY - minY);

    const direction = hash01(baseSeed + 3.9) < 0.25 ? -1 : 1;
    const speed = 12 + hash01(baseSeed + 4.8) * 30;
    const span = viewW + size * 2 + 180;
    const offset = hash01(baseSeed + 5.6) * span;
    const travel = skyState.cloudDriftHours * speed * direction;
    const x = positiveMod(offset + travel, span) - size - 90;

    const alpha =
      (0.06 + cover * 0.33) *
      (0.5 + hash01(baseSeed + 7.3) * 0.58) *
      (0.34 + skyState.daylight * 0.88 + skyState.twilight * 0.52 + skyState.moonlight * 0.34);

    if (alpha <= 0.01) {
      continue;
    }

    drawCloudCluster(ctx, x, y, size, alpha, cloudLightRgb, cloudShadowRgb, baseSeed);
  }
}

function drawCloudCluster(
  ctx,
  x,
  y,
  size,
  alpha,
  cloudLightRgb,
  cloudShadowRgb,
  baseSeed,
) {
  const puffCount = 4 + Math.floor(hash01(baseSeed + 3.2) * 4);
  const baseRadiusX = size * 0.22;

  for (let puffIndex = 0; puffIndex < puffCount; puffIndex += 1) {
    const puffSeed = baseSeed + puffIndex * 5.77;
    const t = puffCount <= 1 ? 0.5 : puffIndex / (puffCount - 1);
    const px = x + (t - 0.5) * size * 0.88 + (hash01(puffSeed + 0.7) - 0.5) * size * 0.14;
    const py = y + (hash01(puffSeed + 1.1) - 0.5) * size * 0.1;
    const rx = baseRadiusX * (0.72 + hash01(puffSeed + 1.8) * 0.62);
    const ry = rx * (0.56 + hash01(puffSeed + 2.4) * 0.34);

    ctx.fillStyle = `rgba(${cloudShadowRgb[0]}, ${cloudShadowRgb[1]}, ${cloudShadowRgb[2]}, ${alpha * 0.62})`;
    ctx.beginPath();
    ctx.ellipse(px, py + ry * 0.38, rx * 1.05, ry, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = `rgba(${cloudLightRgb[0]}, ${cloudLightRgb[1]}, ${cloudLightRgb[2]}, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
}

function sampleCloudCover(elapsedHours, skySeed) {
  const slow = Math.sin(elapsedHours * 0.041 + hash01(skySeed * 0.002 + 0.24) * TAU);
  const mid = Math.sin(elapsedHours * 0.097 + hash01(skySeed * 0.004 + 1.33) * TAU);
  const drift = Math.sin(elapsedHours * 0.19 + hash01(skySeed * 0.006 + 2.17) * TAU);
  return clamp01(0.42 + slow * 0.26 + mid * 0.2 + drift * 0.08);
}

function hash01(seed) {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return raw - Math.floor(raw);
}

function hashStringSeed(value) {
  const text = String(value ?? "journey-sky");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function positiveMod(value, mod) {
  const remainder = value % mod;
  return remainder < 0 ? remainder + mod : remainder;
}
