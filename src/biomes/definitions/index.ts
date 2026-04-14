import { desertBiome } from "./desert";
import { forestBiome } from "./forest";
import { highlandsBiome } from "./highlands";
import { lakeBiome } from "./lake";
import { mountainBiome } from "./mountain";
import { oceanBiome } from "./ocean";
import { plainsBiome } from "./plains";
import { rainforestBiome } from "./rainforest";
import { tundraBiome } from "./tundra";
import type { BiomeDefinition } from "../../types/biome";

export const BIOME_DEFINITIONS: BiomeDefinition[] = [
  oceanBiome,
  lakeBiome,
  plainsBiome,
  forestBiome,
  rainforestBiome,
  desertBiome,
  tundraBiome,
  highlandsBiome,
  mountainBiome,
];
