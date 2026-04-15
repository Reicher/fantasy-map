import { BIOME_KEYS } from "../keys";
import type { BiomeDefinition } from "../../types/biome";

export const rainforestBiome: BiomeDefinition = {
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
      density: 0.33,
      minSpacing: 5.1,
      minSize: 10.6,
      sizeRange: 6.1,
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
      baseY: 0.29,
      amplitude: 0.28,
      wavelength1: 128,
      wavelength2: 62,
      sharpness: 1.4,
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
