import { BIOME_KEYS } from "../keys.js";

export const oceanBiome = {
  id: BIOME_KEYS.OCEAN,
  key: "ocean",
  label: "Hav",
  baseColor: "#90a5ad",
  labels: {
    mapRegion: {
      fontFamily: 'Baskerville, "Palatino Linotype", Georgia, serif',
      fontStyle: "italic",
      fontWeight: 400,
      lineWidth: 4.2,
      fillStyle: "rgba(71, 92, 109, 0.84)",
      strokeStyle: "rgba(237, 233, 224, 0.84)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.97,
      amplitude: 0.02,
      wavelength1: 800,
      wavelength2: 400,
      sharpness: 0.5,
    },
  },
  generation: {
    roadTravelCost: Number.POSITIVE_INFINITY,
    settlementHabitability: 0,
  },
  naming: {
    regionSuffixes: ["hav", "vatten", "ocean"],
  },
};
