import { BIOME_KEYS } from "../keys";
import type { BiomeDefinition } from "../../types/biome";

export const highlandsBiome: BiomeDefinition = {
  id: BIOME_KEYS.HIGHLANDS,
  key: "highlands",
  label: "Högland",
  baseColor: "#94856c",
  render: {
    tonePalette: [
      [137, 122, 101],
      [148, 133, 108],
      [160, 145, 118],
    ],
    vegetation: {
      type: "tree",
      density: 0.052,
      minSpacing: 11.6,
      minSize: 7.8,
      sizeRange: 3.7,
      fill: "rgba(92, 94, 80, 0.74)",
      stroke: "rgba(64, 58, 46, 0.9)",
    },
  },
  labels: {
    mapRegion: {
      fontFamily: 'Baskerville, "Palatino Linotype", Georgia, serif',
      fontStyle: "italic",
      fontWeight: 600,
      lineWidth: 4.2,
      fillStyle: "rgba(92, 69, 49, 0.84)",
      strokeStyle: "rgba(244, 235, 214, 0.84)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.26,
      amplitude: 0.36,
      wavelength1: 172,
      wavelength2: 78,
      sharpness: 1.7,
    },
  },
  generation: {
    roadTravelCost: 3.1,
    settlementHabitability: 0.48,
  },
  naming: {
    regionSuffixes: ["höjd", "ås", "utmark", "bergmark"],
  },
};
