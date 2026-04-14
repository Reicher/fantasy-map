export type BiomeKeyName =
  | "ocean"
  | "lake"
  | "plains"
  | "forest"
  | "rainforest"
  | "desert"
  | "tundra"
  | "highlands"
  | "mountain";

export type RGBTriplet = [number, number, number];

export interface BiomeRegionLabelStyle {
  fontFamily: string;
  fontStyle: string;
  fontWeight: number;
  lineWidth: number;
  fillStyle: string;
  strokeStyle: string;
}

export interface JourneySilhouetteStyle {
  baseY: number;
  amplitude: number;
  wavelength1: number;
  wavelength2: number;
  sharpness: number;
}

export interface VegetationStyle {
  type: string;
  density: number;
  minSpacing: number;
  minSize: number;
  sizeRange: number;
  fill: string;
  stroke: string;
}

export interface BiomeRenderStyle {
  tonePalette?: RGBTriplet[];
  vegetation?: VegetationStyle;
}

export interface BiomeGenerationConfig {
  roadTravelCost: number;
  settlementHabitability: number;
}

export interface BiomeNamingConfig {
  regionSuffixes: string[];
}

export interface BiomeDefinition {
  id: number;
  key: BiomeKeyName;
  label: string;
  baseColor: string;
  render?: BiomeRenderStyle;
  labels: {
    mapRegion: BiomeRegionLabelStyle;
  };
  journey: {
    silhouette: JourneySilhouetteStyle;
  };
  generation: BiomeGenerationConfig;
  naming: BiomeNamingConfig;
}

export interface BiomeInfoEntry {
  key: BiomeKeyName;
  label: string;
  color: string;
}
