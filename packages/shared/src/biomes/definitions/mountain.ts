import { BIOME_KEYS } from "../keys";
import type { BiomeDefinition } from "../../types/biome";

export const mountainBiome: BiomeDefinition = {
  id: BIOME_KEYS.MOUNTAIN,
  key: "mountain",
  label: "Berg",
  baseColor: "#81705d",
  labels: {
    mapRegion: {
      fontFamily: 'Baskerville, "Palatino Linotype", Georgia, serif',
      fontStyle: "italic",
      fontWeight: 600,
      lineWidth: 4.6,
      fillStyle: "rgba(88, 78, 68, 0.88)",
      strokeStyle: "rgba(244, 235, 214, 0.84)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.1,
      amplitude: 0.72,
      wavelength1: 86,
      wavelength2: 32,
      sharpness: 5.8,
    },
  },
  generation: {
    roadTravelCost: 8.8,
    settlementHabitability: 0.05,
  },
  naming: {
    regionSuffixes: ["bergen", "ås", "kam", "höjder"],
  },
};
