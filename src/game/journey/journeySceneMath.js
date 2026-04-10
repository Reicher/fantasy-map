export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampValue(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function tintRgbWithSky(rgb, haze, skyRgb) {
  const [r, g, b] = rgb;
  const [skyR, skyG, skyB] = skyRgb;
  return [
    r * (1 - haze) + skyR * haze,
    g * (1 - haze) + skyG * haze,
    b * (1 - haze) + skyB * haze,
  ];
}

export function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function rgbCssFromArray(rgb) {
  return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}
