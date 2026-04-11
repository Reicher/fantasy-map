import { BIOME_KEYS } from "../keys.js";

export const tundraBiome = {
  id: BIOME_KEYS.TUNDRA,
  key: "tundra",
  label: "Tundra",
  baseColor: "#aeb2a1",
  render: {
    tonePalette: [
      [159, 163, 147],
      [174, 178, 161],
      [188, 192, 177],
    ],
  },
  labels: {
    mapRegion: {
      fontFamily: 'Georgia, Baskerville, "Palatino Linotype", serif',
      fontStyle: "italic",
      fontWeight: 400,
      lineWidth: 4.15,
      fillStyle: "rgba(88, 90, 98, 0.84)",
      strokeStyle: "rgba(245, 241, 233, 0.88)",
    },
  },
  journey: {
    silhouette: {
      baseY: 0.5,
      amplitude: 0.12,
      wavelength1: 220,
      wavelength2: 100,
      sharpness: 1.1,
    },
  },
  generation: {
    roadTravelCost: 1.52,
    settlementHabitability: 0.2,
  },
  naming: {
    regionSuffixes: ["vidd", "frostmark", "fjällhed", "snövidd"],
  },
};
