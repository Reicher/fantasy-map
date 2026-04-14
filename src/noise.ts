import { hashString } from "./random";
import { lerp, smootherstep } from "./utils";

interface NoiseOptions {
  octaves?: number;
  gain?: number;
  lacunarity?: number;
}

function hashedValue(ix: number, iy: number, seed: string): number {
  const h = hashString(`${seed}:${ix}:${iy}`);
  return h / 4294967295;
}

function valueNoise2D(x: number, y: number, seed: string): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const sx = smootherstep(0, 1, x - x0);
  const sy = smootherstep(0, 1, y - y0);

  const n00 = hashedValue(x0, y0, seed);
  const n10 = hashedValue(x1, y0, seed);
  const n01 = hashedValue(x0, y1, seed);
  const n11 = hashedValue(x1, y1, seed);

  const nx0 = lerp(n00, n10, sx);
  const nx1 = lerp(n01, n11, sx);
  return lerp(nx0, nx1, sy);
}

export function fractalNoise2D(
  x: number,
  y: number,
  seed: string,
  options: NoiseOptions = {},
): number {
  const octaves = options.octaves ?? 5;
  const gain = options.gain ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let totalAmplitude = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise2D(x * frequency, y * frequency, `${seed}:${octave}`);
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return totalAmplitude > 0 ? sum / totalAmplitude : 0;
}

export function ridgeNoise2D(
  x: number,
  y: number,
  seed: string,
  options: NoiseOptions = {},
): number {
  const base = fractalNoise2D(x, y, seed, options);
  return 1 - Math.abs(base * 2 - 1);
}
