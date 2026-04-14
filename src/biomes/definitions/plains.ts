import { BIOME_KEYS } from "../keys";
import type { BiomeDefinition } from "../../types/biome";

export const plainsBiome: BiomeDefinition = {
  id: BIOME_KEYS.PLAINS,
  key: "plains",
  label: "Slätt",
  baseColor: "#b9b27f",
  render: {
    tonePalette: [
      [171, 166, 118],
      [185, 178, 127],
      [196, 186, 136],
    ],
    vegetation: {
      type: "tuft",
      density: 0.052,
      minSpacing: 12.2,
      minSize: 2.4,
      sizeRange: 1.5,
      fill: "rgba(126, 116, 76, 0.42)",
      stroke: "rgba(102, 90, 58, 0.52)",
    },
  },
  labels: {
    mapRegion: {
      fontFamily: 'Baskerville, "Palatino Linotype", Georgia, serif',
      fontStyle: "italic",
      fontWeight: 400,
      lineWidth: 4.2,
      fillStyle: "rgba(74, 58, 37, 0.84)",
      strokeStyle: "rgba(244, 235, 214, 0.84)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.58,
      amplitude: 0.08,
      wavelength1: 260,
      wavelength2: 120,
      sharpness: 0.9,
    },
  },
  generation: {
    roadTravelCost: 0.9,
    settlementHabitability: 1,
  },
  naming: {
    regionSuffixes: ["slätt", "hed", "vall", "mark"],
  },
};
