import { BIOME_KEYS } from "../keys.js";

export const desertBiome = {
  id: BIOME_KEYS.DESERT,
  key: "desert",
  label: "Öken",
  baseColor: "#c9b07b",
  render: {
    tonePalette: [
      [183, 156, 104],
      [201, 176, 123],
      [214, 191, 139],
    ],
    vegetation: {
      type: "cactus",
      density: 0.01,
      minSpacing: 17.5,
      minSize: 4,
      sizeRange: 2.4,
      fill: "rgba(104, 116, 82, 0.58)",
      stroke: "rgba(74, 82, 58, 0.72)",
    },
  },
  labels: {
    mapRegion: {
      fontFamily: 'Baskerville, "Palatino Linotype", Georgia, serif',
      fontStyle: "italic",
      fontWeight: 400,
      lineWidth: 4,
      fillStyle: "rgba(124, 92, 50, 0.84)",
      strokeStyle: "rgba(244, 235, 214, 0.84)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.55,
      amplitude: 0.1,
      wavelength1: 280,
      wavelength2: 140,
      sharpness: 0.75,
    },
  },
  generation: {
    roadTravelCost: 1.28,
    settlementHabitability: 0.16,
  },
  naming: {
    regionSuffixes: ["ödemark", "sand", "mo", "vidder"],
  },
};
