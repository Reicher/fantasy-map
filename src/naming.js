import { BIOME_KEYS } from "./config.js";
import { createRng } from "./random.js";
import { titleCase } from "./utils.js";

const ONSET_GROUPS = [
  ["b", "bj", "br", "d", "dr", "f", "fj", "g", "gr", "h", "j", "k", "kl", "kn", "l", "m", "n", "r", "s", "sk", "sl", "sn", "st", "sv", "t", "tr", "v"],
  ["b", "bl", "d", "f", "g", "gl", "h", "k", "l", "m", "n", "r", "s", "sj", "sk", "sm", "sp", "st", "t", "tj", "v"],
  ["b", "br", "d", "f", "g", "h", "j", "k", "l", "m", "n", "r", "s", "sk", "st", "t", "v"]
];

const VOWEL_GROUPS = [
  ["a", "e", "i", "o", "u", "y", "å", "ä", "ö"],
  ["a", "e", "i", "o", "u", "å", "ä", "ö", "au", "ei"],
  ["a", "e", "i", "o", "u", "y", "å", "ä", "ö", "ia", "io"]
];

const CODA_GROUPS = [
  ["", "", "", "k", "l", "m", "n", "nd", "ng", "r", "rd", "s", "sk", "t"],
  ["", "", "", "d", "g", "k", "l", "m", "n", "nn", "r", "rk", "s", "t"],
  ["", "", "", "d", "ld", "m", "n", "ng", "r", "s", "st", "t", "v"]
];

const BIOME_SUFFIXES = {
  [BIOME_KEYS.PLAINS]: ["slätt", "mark", "hed", "vall"],
  [BIOME_KEYS.FOREST]: ["skog", "lund", "mark", "hag"],
  [BIOME_KEYS.RAINFOREST]: ["storskog", "djupskog", "skog", "lund"],
  [BIOME_KEYS.DESERT]: ["sand", "ödemark", "hed", "mo"],
  [BIOME_KEYS.TUNDRA]: ["vidd", "frostmark", "fjällhed", "snömark"],
  [BIOME_KEYS.HIGHLANDS]: ["höjd", "ås", "utmark", "bergmark"],
  [BIOME_KEYS.MOUNTAIN]: ["bergen", "ås", "kam", "höjder"]
};

const WORLD_ENDINGS = {
  shield: ["övärld", "rike", "skär"],
  twin: ["tvillingöar", "sund", "skärgård"],
  crescent: ["båge", "vikbåge", "hamnland"],
  shattered: ["skär", "ytteröar", "bruten kust"],
  spine: ["rygg", "kedja", "åsland"]
};

const CITY_SUFFIXES = {
  coastal: ["hamn", "vik", "näs", "skans", "sund"],
  river: ["bro", "åby", "vad", "näs", "torp"],
  inland: ["by", "torp", "stad", "gård", "köping"]
};

const RIVER_PATTERNS = [
  (root) => `${root}ån`,
  (root) => `${root}älven`,
  (root) => `${root}ström`,
  (root) => `${root}fors`,
  (root) => `${root}å`
];

const LAKE_PATTERNS = [
  (root) => `${root}sjön`,
  (root) => `${root}tjärn`,
  (root) => `${root}träsk`,
  (root) => `${root}vattnet`
];

const MOUNTAIN_PATTERNS = [
  (root) => `${root}bergen`,
  (root) => `${root}åsen`,
  (root) => `${root}kammen`,
  (root) => `${root}höjder`
];

export function createNameGenerator(seed) {
  const profileRng = createRng(`${seed}::language`);
  const profile = {
    onsets: profileRng.pick(ONSET_GROUPS),
    vowels: profileRng.pick(VOWEL_GROUPS),
    codas: profileRng.pick(CODA_GROUPS),
    liquidChance: profileRng.range(0.02, 0.12)
  };
  const usedNames = new Set();

  return {
    worldName(styleKey) {
      const rng = createRng(`${seed}::world-name:${styleKey}`);
      const root = createRoot(profile, rng, 2 + rng.int(0, 1), 10);
      const ending = rng.pick(WORLD_ENDINGS[styleKey] ?? ["mark"]);
      return uniqueName(titleCase(`${root} ${ending}`));
    },
    cityName(index, context = {}) {
      const rng = createRng(`${seed}::city:${index}`);
      const root = createCityRoot(profile, rng);
      const suffixes = context.coastal
        ? CITY_SUFFIXES.coastal
        : context.river
          ? CITY_SUFFIXES.river
          : CITY_SUFFIXES.inland;
      return uniqueName(titleCase(`${root}${rng.pick(suffixes)}`));
    },
    riverName(index) {
      const rng = createRng(`${seed}::river:${index}`);
      const root = createRoot(profile, rng, 2, 9);
      return uniqueName(titleCase(rng.pick(RIVER_PATTERNS)(root)));
    },
    lakeName(index) {
      const rng = createRng(`${seed}::lake:${index}`);
      const root = createRoot(profile, rng, 2, 9);
      return uniqueName(titleCase(rng.pick(LAKE_PATTERNS)(root)));
    },
    mountainName(index) {
      const rng = createRng(`${seed}::mountain:${index}`);
      const root = createRoot(profile, rng, 2, 9);
      return uniqueName(titleCase(rng.pick(MOUNTAIN_PATTERNS)(root)));
    },
    biomeRegionName(index, biome) {
      const rng = createRng(`${seed}::biome:${biome}:${index}`);
      const root = createRoot(profile, rng, 2, 9);
      const suffix = rng.pick(BIOME_SUFFIXES[biome] ?? ["mark"]);
      return uniqueName(titleCase(`${root}${suffix}`));
    }
  };

  function uniqueName(name) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    let counter = 2;
    while (usedNames.has(`${name} ${counter}`)) {
      counter += 1;
    }
    const unique = `${name} ${counter}`;
    usedNames.add(unique);
    return unique;
  }
}

function createRoot(profile, rng, syllableCount, maxLength = 10) {
  let word = "";
  for (let i = 0; i < syllableCount; i += 1) {
    const onset = rng.pick(profile.onsets);
    const vowel = rng.pick(profile.vowels);
    const coda = rng.pick(profile.codas);
    word += onset + vowel + coda;
    if (rng.chance(profile.liquidChance) && i < syllableCount - 1) {
      word += rng.pick(["l", "r"]);
    }
  }

  word = word
    .replace(/aa+/g, "a")
    .replace(/ee+/g, "e")
    .replace(/ii+/g, "i")
    .replace(/oo+/g, "o")
    .replace(/uu+/g, "u")
    .replace(/åå+/g, "å")
    .replace(/ää+/g, "ä")
    .replace(/öö+/g, "ö")
    .replace(/([bcdfghjklmnpqrstvwxzyåäö])\1+/g, "$1");

  if (word.length > maxLength) {
    word = word.slice(0, maxLength);
  }

  return word[0].toUpperCase() + word.slice(1);
}

function createCityRoot(profile, rng) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const root = createRoot(profile, rng, 1 + rng.int(0, 1), 6);
    if (root.length >= 3 && !CITY_SUFFIX_ROOTS.has(root.toLowerCase())) {
      return root;
    }
  }
  return createRoot(profile, rng, 2, 6);
}

const CITY_SUFFIX_ROOTS = new Set(["hamn", "vik", "näs", "skans", "sund", "bro", "åby", "vad", "torp", "by", "stad", "gård", "köping"]);
