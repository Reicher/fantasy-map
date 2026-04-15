import { BIOME_KEYS } from "../keys";
import type { BiomeDefinition } from "../../types/biome";

export const forestBiome: BiomeDefinition = {
  id: BIOME_KEYS.FOREST,
  key: "forest",
  label: "Skog",
  baseColor: "#7d9065",
  render: {
    tonePalette: [
      [95, 123, 85],
      [125, 144, 101],
    ],
    vegetation: {
      type: "tree",
      density: 0.215,
      minSpacing: 6.7,
      minSize: 8.4,
      sizeRange: 4.5,
      fill: "rgba(80, 97, 66, 0.74)",
      stroke: "rgba(54, 66, 41, 0.86)",
    },
  },
  labels: {
    mapRegion: {
      fontFamily: '"Palatino Linotype", Baskerville, Georgia, serif',
      fontStyle: "italic",
      fontWeight: 400,
      lineWidth: 4.1,
      fillStyle: "rgba(64, 79, 50, 0.84)",
      strokeStyle: "rgba(244, 238, 224, 0.96)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.32,
      amplitude: 0.26,
      wavelength1: 142,
      wavelength2: 68,
      sharpness: 1.45,
    },
  },
  generation: {
    roadTravelCost: 1.45,
    settlementHabitability: 0.84,
  },
  naming: {
    regionSuffixes: ["skog", "lund", "mark", "hage"],
  },
};
