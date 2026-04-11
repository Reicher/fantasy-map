import { BIOME_KEYS } from "../keys.js";

export const mountainBiome = {
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
      baseY: 0.24,
      amplitude: 0.34,
      wavelength1: 108,
      wavelength2: 40,
      sharpness: 3.7,
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
