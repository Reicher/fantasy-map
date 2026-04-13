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
      baseY: 0.18,
      amplitude: 0.44,
      wavelength1: 88,
      wavelength2: 30,
      sharpness: 4.6,
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
