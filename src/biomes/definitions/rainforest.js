import { BIOME_KEYS } from "../keys.js";

export const rainforestBiome = {
  id: BIOME_KEYS.RAINFOREST,
  key: "rainforest",
  label: "Djupskog",
  baseColor: "#5f7b55",
  render: {
    tonePalette: [
      [80, 97, 66],
      [95, 123, 85],
    ],
    vegetation: {
      type: "tree",
      density: 0.29,
      minSpacing: 5.8,
      minSize: 8.8,
      sizeRange: 4.8,
      fill: "rgba(65, 87, 53, 0.8)",
      stroke: "rgba(42, 58, 34, 0.9)",
    },
  },
  labels: {
    mapRegion: {
      fontFamily: '"Palatino Linotype", Baskerville, Georgia, serif',
      fontStyle: "italic",
      fontWeight: 600,
      lineWidth: 4.2,
      fillStyle: "rgba(48, 66, 38, 0.88)",
      strokeStyle: "rgba(244, 238, 224, 0.96)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.34,
      amplitude: 0.2,
      wavelength1: 100,
      wavelength2: 48,
      sharpness: 1.6,
    },
  },
  generation: {
    roadTravelCost: 1.8,
    settlementHabitability: 0.64,
  },
  naming: {
    regionSuffixes: ["djupskog", "storskog", "lund", "mark"],
  },
};
