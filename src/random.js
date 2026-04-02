function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return function next() {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  return xmur3(value)();
}

export function createRng(seed) {
  const hash = xmur3(seed);
  const rand = sfc32(hash(), hash(), hash(), hash());

  return {
    seed,
    float() {
      return rand();
    },
    range(min, max) {
      return min + (max - min) * rand();
    },
    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    },
    chance(probability) {
      return rand() < probability;
    },
    pick(list) {
      return list[Math.floor(rand() * list.length)];
    },
    weighted(items, weightOf) {
      let total = 0;
      for (const item of items) {
        total += Math.max(0, weightOf(item));
      }
      if (total <= 0) {
        return items[0];
      }

      let threshold = rand() * total;
      for (const item of items) {
        threshold -= Math.max(0, weightOf(item));
        if (threshold <= 0) {
          return item;
        }
      }

      return items[items.length - 1];
    },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    fork(label) {
      return createRng(`${seed}::${label}`);
    }
  };
}
