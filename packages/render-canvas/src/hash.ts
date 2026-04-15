export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextHash(value: number): number {
  let current = value + 0x6d2b79f5;
  current = Math.imul(current ^ (current >>> 15), current | 1);
  current ^= current + Math.imul(current ^ (current >>> 7), current | 61);
  return (current ^ (current >>> 14)) >>> 0;
}

export function glyphNoise(value: number): number {
  return (nextHash(value) % 1000) / 1000;
}
