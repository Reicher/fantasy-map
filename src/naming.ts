import { getBiomeRegionSuffixesById } from "./biomes/index";
import { createRng } from "./random";
import { titleCase } from "./utils";

const ONSET_GROUPS = [
  [
    "b",
    "bj",
    "br",
    "d",
    "dr",
    "f",
    "fj",
    "g",
    "gr",
    "h",
    "j",
    "k",
    "kl",
    "kn",
    "l",
    "m",
    "n",
    "r",
    "s",
    "sk",
    "sl",
    "sn",
    "st",
    "sv",
    "t",
    "tr",
    "v",
  ],
  [
    "b",
    "bl",
    "d",
    "f",
    "g",
    "gl",
    "h",
    "k",
    "l",
    "m",
    "n",
    "r",
    "s",
    "sj",
    "sk",
    "sm",
    "sp",
    "st",
    "t",
    "tj",
    "v",
  ],
  [
    "b",
    "br",
    "d",
    "f",
    "g",
    "h",
    "j",
    "k",
    "l",
    "m",
    "n",
    "r",
    "s",
    "sk",
    "st",
    "t",
    "v",
  ],
];

const VOWEL_GROUPS = [
  ["a", "e", "i", "o", "u", "y", "å", "ä", "ö"],
  ["a", "e", "i", "o", "u", "å", "ä", "ö", "au", "ei"],
  ["a", "e", "i", "o", "u", "y", "å", "ä", "ö", "ia", "io"],
];

const CODA_GROUPS = [
  ["", "", "", "k", "l", "m", "n", "nd", "ng", "r", "rd", "s", "sk", "t"],
  ["", "", "", "d", "g", "k", "l", "m", "n", "nn", "r", "rk", "s", "t"],
  ["", "", "", "d", "ld", "m", "n", "ng", "r", "s", "st", "t", "v"],
];

const WORLD_ENDINGS = {
  shield: ["övärld", "rike", "skär"],
  twin: ["tvillingöar", "sund", "skärgård"],
  crescent: ["båge", "vikland", "hamnland"],
  shattered: ["skär", "ytteröar", "bruten kust"],
  spine: ["rygg", "kedja", "åsland"],
};

const SETTLEMENT_SUFFIXES = {
  coastal: ["hamn", "vik", "näs", "skans", "sund"],
  river: ["bro", "åby", "vad", "näs", "torp"],
  inland: ["by", "torp", "stad", "köping"],
};

const RIVER_PATTERNS = [
  (root) => `${root}ån`,
  (root) => `${root}älven`,
  (root) => `${root}ström`,
  (root) => `${root}fors`,
  (root) => `${root}å`,
];

const LAKE_PATTERNS = [
  (root) => `${root}sjön`,
  (root) => `${root}tjärn`,
  (root) => `${root}träsk`,
  (root) => `${root}vattnet`,
];

const MOUNTAIN_PATTERNS = [
  (root) => `${root}bergen`,
  (root) => `${root}åsen`,
  (root) => `${root}kammen`,
  (root) => `${root}höjder`,
];

const SETTLEMENT_SUFFIX_ROOTS = new Set([
  "hamn",
  "vik",
  "näs",
  "skans",
  "sund",
  "bro",
  "åby",
  "vad",
  "torp",
  "by",
  "stad",
  "köping",
]);

const NODE_NAME_MARKERS = new Set([
  "settlement",
  "abandoned",
  "signpost",
]);

const FAMILY_NAMES = [
  "Andersson",
  "Berg",
  "Björk",
  "Boman",
  "Dahl",
  "Ek",
  "Fors",
  "Gran",
  "Hansson",
  "Holm",
  "Johansson",
  "Karlsson",
  "Larsson",
  "Lind",
  "Ljung",
  "Malm",
  "Nilsson",
  "Nyberg",
  "Olsson",
  "Persson",
  "Rask",
  "Reicher",
  "Ström",
  "Svensson",
  "Söder",
  "Torn",
  "Westman",
  "Wik",
  "Yıldız",
  "Demir",
  "Kaya",
  "Aydin",
  "Korkmaz",
  "Amini",
  "Rahimi",
  "Karimi",
  "Haddad",
  "Khalil",
  "Mansour",
  "Nasser",
  "Darwish",
  "Aziz",
  "Bakr",
  "Farah",
  "Mahfouz",
  "Schneider",
  "Müller",
  "Weber",
  "Fischer",
  "Keller",
  "Bauer",
  "Hoffmann",
  "Wagner",
  "Becker",
];

const GROUP_NAMES = [
  "resande",
  "nybyggarna",
  "handelslaget",
  "vagnslaget",
  "arbetslaget",
  "karavanen",
  "följet",
  "utpostfolket",
];

const CRASH_EVENT = [
  "haveri",
  "stopp",
  "nödlandning",
  "tvärstopp",
  "dikesfärd",
  "sammanbrott",
  "omkullkörning",
];

const CRASH_OBJECT = [
  "vraket",
  "kärran",
  "den trasiga vagnen",
  "det förlorade lasset",
  "det övergivna ekipaget",
  "vagnresterna",
  "hjulstället",
];

const ABANDONED_PLACE = [
  "ödelägret",
  "den övergivna utposten",
  "den tomma rastplatsen",
  "det gamla lägret",
  "den tysta stugan",
  "den gamla tältplatsen",
  "den övergivna bryggan",
  "de tomma bodarna",
];

const SETTLEMENT_PLACE = [
  "kyrkan",
  "tältlägret",
  "stugan",
  "utposten",
  "eldplatsen",
  "vagnlägret",
  "rastplatsen",
  "kapellet",
  "bryggan",
  "förrådet",
  "boden",
  "lägerplatsen",
];

const SETTLEMENT_PERSONAL = [
  "Familjen {family}",
  "{family}s förråd",
  "{family}s rastplats",
  "{family}s kök",
  "{family}s tältplats",
  "{family}s läger",
  "{family}s utpost",
  "{family}s brygga",
];

const SETTLEMENT_GROUP = [
  "{group} läger",
  "{group} rastplats",
  "{group} utpost",
  "{group} brygga",
  "{group} förråd",
];

const SETTLEMENT_INSTITUTION = [
  "{adj} {place}",
  "{adj} kapellet",
  "{adj} samlingsstugan",
  "{adj} utposten",
];

const SETTLEMENT_ADJ = [
  "Norra",
  "Södra",
  "Västra",
  "Östra",
  "Gamla",
  "Nya",
  "Lilla",
  "Övre",
  "Nedre",
  "Bortre",
];

export function createNameGenerator(seed) {
  const profileRng = createRng(`${seed}::language`);
  const profile = {
    onsets: profileRng.pick(ONSET_GROUPS),
    vowels: profileRng.pick(VOWEL_GROUPS),
    codas: profileRng.pick(CODA_GROUPS),
    liquidChance: profileRng.range(0.02, 0.12),
  };

  const usedNames = new Set();

  return {
    worldName(styleKey) {
      const rng = createRng(`${seed}::world-name:${styleKey}`);
      const root = createRoot(profile, rng, 2 + rng.int(0, 1), 10);
      const ending = rng.pick(WORLD_ENDINGS[styleKey] ?? ["mark"]);
      return uniqueName(titleCase(`${root} ${ending}`));
    },

    settlementName(index, context: { coastal?: boolean; river?: boolean } = {}) {
      const rng = createRng(`${seed}::settlement:${index}`);
      const root = createSettlementRoot(profile, rng);
      const suffixes = context.coastal
        ? SETTLEMENT_SUFFIXES.coastal
        : context.river
          ? SETTLEMENT_SUFFIXES.river
          : SETTLEMENT_SUFFIXES.inland;

      return uniqueName(titleCase(joinNameParts(root, rng.pick(suffixes))));
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

    nodeName(marker, key = 0) {
      const normalizedMarker = normalizeNodeNameMarker(marker);

      if (normalizedMarker === "signpost") {
        return "";
      }

      const rng = createRng(`${seed}::node:${normalizedMarker}:${key}`);

      if (normalizedMarker === "abandoned") {
        return uniqueName(generateCrashSiteName(rng));
      }

      return uniqueName(generateSettlementNodeName(rng));
    },

    biomeRegionName(index, biome) {
      const rng = createRng(`${seed}::biome:${biome}:${index}`);
      const root = createRoot(profile, rng, 2, 9);
      const suffix = rng.pick(getBiomeRegionSuffixesById(biome) ?? ["mark"]);
      return uniqueName(titleCase(joinNameParts(root, suffix)));
    },
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

  word = sanitizeGeneratedWord(word);

  if (word.length > maxLength) {
    word = word.slice(0, maxLength);
  }

  return word[0].toUpperCase() + word.slice(1);
}

function createSettlementRoot(profile, rng) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const root = createRoot(profile, rng, 1 + rng.int(0, 1), 6);
    if (root.length >= 3 && !SETTLEMENT_SUFFIX_ROOTS.has(root.toLowerCase())) {
      return root;
    }
  }

  return createRoot(profile, rng, 2, 6);
}

function sanitizeGeneratedWord(word) {
  return word
    .replace(/aa+/g, "a")
    .replace(/ee+/g, "e")
    .replace(/ii+/g, "i")
    .replace(/oo+/g, "o")
    .replace(/uu+/g, "u")
    .replace(/yy+/g, "y")
    .replace(/åå+/g, "å")
    .replace(/ää+/g, "ä")
    .replace(/öö+/g, "ö")
    .replace(/([bcdfghjklmnpqrstvwxzyåäö])\1+/g, "$1")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/x/g, "ks");
}

function joinNameParts(root, suffix) {
  const left = root.toLowerCase();
  const right = suffix.toLowerCase();

  if (left.endsWith("a") && right.startsWith("a"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("e") && right.startsWith("e"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("i") && right.startsWith("i"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("o") && right.startsWith("o"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("u") && right.startsWith("u"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("y") && right.startsWith("y"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("å") && right.startsWith("å"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("ä") && right.startsWith("ä"))
    return `${root}${suffix.slice(1)}`;
  if (left.endsWith("ö") && right.startsWith("ö"))
    return `${root}${suffix.slice(1)}`;

  return `${root}${suffix}`;
}

function normalizeNodeNameMarker(marker) {
  return NODE_NAME_MARKERS.has(marker) ? marker : "settlement";
}

function generateCrashSiteName(rng) {
  const family = rng.pick(FAMILY_NAMES);
  const group = rng.pick(GROUP_NAMES);
  const event = rng.pick(CRASH_EVENT);
  const object = rng.pick(CRASH_OBJECT);
  const abandoned = rng.pick(ABANDONED_PLACE);
  const mode = rng.int(0, 8);

  switch (mode) {
    case 0:
      return `${family}s ${event}`;
    case 1:
      return `${family}s ${object}`;
    case 2:
      return `${group} vid vraket`;
    case 3:
      return `${object} vid vägen`;
    case 4:
      return `${object} vid diket`;
    case 5:
      return abandoned;
    case 6:
      return `${abandoned} vid leden`;
    case 7:
      return `${family}s övergivna läger`;
    default:
      return `${group} gamla rastplats`;
  }
}

function generateSettlementNodeName(rng) {
  const family = rng.pick(FAMILY_NAMES);
  const group = rng.pick(GROUP_NAMES);
  const place = rng.pick(SETTLEMENT_PLACE);
  const adj = rng.pick(SETTLEMENT_ADJ);
  const mode = rng.int(0, 6);

  if (mode <= 1) {
    return fillTemplate(rng.pick(SETTLEMENT_PERSONAL), {
      family,
      group,
      place,
      adj,
    });
  }

  if (mode === 2) {
    return fillTemplate(rng.pick(SETTLEMENT_GROUP), {
      family,
      group,
      place,
      adj,
    });
  }

  if (mode === 3) {
    return fillTemplate(rng.pick(SETTLEMENT_INSTITUTION), {
      family,
      group,
      place,
      adj,
    });
  }

  if (mode === 4) {
    return `${adj} ${place}`;
  }

  if (mode === 5) {
    return `Familjen ${family}`;
  }

  return `${group} läger`;
}

function fillTemplate(template, values) {
  return template
    .replaceAll("{family}", values.family)
    .replaceAll("{group}", values.group)
    .replaceAll("{place}", values.place)
    .replaceAll("{adj}", values.adj);
}
