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
}

export function drawOceanHorizon(ctx, viewW, viewH, skyState) {
  const top = Math.round(viewH * OCEAN_HORIZON_TOP_FRAC);
  const bottom = Math.round(viewH * GROUND_TOP_FRAC);
  const h = bottom - top;
  const horizon = skyState.horizonRgb;
  const daylight = skyState.daylight;
  const night = skyState.night;
  const twilight = skyState.twilight;
  const nearHorizon = lerpRgb(
    lerpRgb(horizon, [116, 146, 190], night * 0.42),
    [175, 211, 224],
    daylight * 0.56 + twilight * 0.24,
  );
  const midOcean = lerpRgb(
    [18, 50, 92],
    [70, 152, 176],
    daylight * 0.9 + twilight * 0.14,
  );
  const deepOcean = lerpRgb(
    [12, 31, 70],
    [44, 108, 148],
    daylight * 0.84 + twilight * 0.13,
  );
  const floorOcean = lerpRgb(
    [8, 20, 52],
    [23, 84, 130],
    daylight * 0.78 + twilight * 0.11,
  );

  const ocean = ctx.createLinearGradient(0, top, 0, bottom);
  ocean.addColorStop(0.0, rgbCssFromArray(horizon));
  ocean.addColorStop(0.12, rgbCssFromArray(nearHorizon));
  ocean.addColorStop(0.38, rgbCssFromArray(midOcean));
  ocean.addColorStop(0.7, rgbCssFromArray(deepOcean));
  ocean.addColorStop(1.0, rgbCssFromArray(floorOcean));
  ctx.fillStyle = ocean;
  ctx.fillRect(0, top, viewW, h);

  const bandCount = 6;
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const bandT = (bandIndex + 1) / (bandCount + 1);
    const y = top + h * (0.12 + bandT * 0.72);
    const amplitude = (4 + bandIndex * 0.8) * (0.65 + daylight * 0.48);
    const waveLength = Math.max(120, viewW * (0.16 + bandIndex * 0.06));
    const alpha = (0.04 + daylight * 0.06 + twilight * 0.04) * (1 - bandT * 0.42);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= viewW + 8; x += 8) {
      const wave = Math.sin((x / waveLength) * TAU + bandIndex * 0.8 + skyState.hour * 0.11);
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
    `rgba(255, 255, 255, ${0.11 + daylight * 0.2 + twilight * 0.1 - night * 0.07})`,
  );
  glare.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, glareY - 1, viewW, 4);
}

export function drawNightVeil(ctx, viewW, viewH, skyState) {
  const alpha = clamp01(skyState.night * 0.46 + skyState.twilight * 0.08);
  if (alpha <= 0.01) return;
  const veil = ctx.createLinearGradient(0, 0, 0, viewH);
  veil.addColorStop(0, `rgba(6, 11, 24, ${alpha * 0.72})`);
  veil.addColorStop(1, `rgba(8, 14, 26, ${alpha})`);
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, viewW, viewH);
}

export function createSkyState(timeOfDayHours, viewW, viewH) {
  const hour = normalizeTimeOfDayHours(
    Number.isFinite(timeOfDayHours)
      ? timeOfDayHours
      : DEFAULT_TIME_OF_DAY_HOURS,
  );
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
  const moonAltitude = clampValue((horizonY - moonPos.y) / orbitRadiusY, -1, 1);
  const daylight = clamp01((sunAltitude + 0.16) / 1.16);
  const night = 1 - daylight;
  const twilight = clamp01(1 - Math.abs(sunAltitude) * 2.4);
  const twilightTopWeight = twilight * (0.3 + night * 0.15);
  const twilightBottomWeight = twilight * (0.62 + night * 0.2);
  const baseTop = lerpRgb(NIGHT_SKY_TOP_RGB, DAY_SKY_TOP_RGB, daylight);
  const baseBottom = lerpRgb(
    NIGHT_SKY_BOTTOM_RGB,
    DAY_SKY_BOTTOM_RGB,
    daylight,
  );
  const topRgb = lerpRgb(baseTop, TWILIGHT_SKY_TOP_RGB, twilightTopWeight);
  const bottomRgb = lerpRgb(
    baseBottom,
    TWILIGHT_SKY_BOTTOM_RGB,
    twilightBottomWeight,
  );
  const middleRgb = lerpRgb(topRgb, bottomRgb, 0.5);
  const horizonRgb = lerpRgb(
    bottomRgb,
    [248, 206, 150],
    twilight * (0.34 + daylight * 0.16),
  );
  const sunVisible = clamp01((sunAltitude + 0.18) / 0.48);
  const moonVisible =
    clamp01((moonAltitude + 0.2) / 0.54) * (0.35 + night * 0.72);

  return {
    hour,
    daylight,
    night,
    twilight,
    horizonY,
    topRgb,
    middleRgb,
    bottomRgb,
    horizonRgb,
    sun: {
      ...sunPos,
      visible: sunVisible,
      radius: Math.max(14, viewH * 0.024),
    },
    moon: {
      ...moonPos,
      visible: moonVisible,
      radius: Math.max(10, viewH * 0.017),
    },
  };
}

function drawStars(ctx, viewW, skyState) {
  const starAlpha = clamp01(skyState.night * 1.08 + skyState.twilight * 0.18 - 0.06);
  if (starAlpha <= 0.01) {
    return;
  }

  const skyTop = Math.max(48, skyState.horizonY * 0.9);
  const starCount = Math.max(38, Math.round((viewW * skyTop) / 14000));
  for (let index = 0; index < starCount; index += 1) {
    const x = hash01(index * 17.31 + viewW * 0.023) * viewW;
    const y = Math.pow(hash01(index * 43.81 + 0.217), 1.52) * skyTop;
    const size = 0.55 + hash01(index * 97.12 + 0.71) * 1.75;
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
  const glowRadius = sun.radius * (3.4 + skyState.twilight * 0.8);
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
    `rgba(255, 246, 208, ${0.5 * sun.visible + 0.2 * skyState.daylight})`,
  );
  glow.addColorStop(0.5, `rgba(255, 198, 128, ${0.35 * sun.visible})`);
  glow.addColorStop(1, "rgba(255, 182, 102, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 242, 201, ${0.72 + sun.visible * 0.22})`;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.radius, 0, TAU);
  ctx.fill();
}

function hash01(seed) {
  const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return raw - Math.floor(raw);
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
  glow.addColorStop(0, `rgba(237, 244, 255, ${0.18 + moon.visible * 0.3})`);
  glow.addColorStop(1, "rgba(215, 231, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, glowRadius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = `rgba(235, 243, 255, ${0.44 + moon.visible * 0.5})`;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.radius, 0, TAU);
  ctx.fill();
}
