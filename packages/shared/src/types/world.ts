export interface WorldParams {
  seed: string;
  worldAspect: number;
  worldScale: number;
  fragmentation: number;
  mapSize: number;
  mountainousness: number;
  settlementDensity: number;
  riverAmount: number;
  lakeAmount: number;
  lakeSize: number;
  coastComplexity: number;
  edgeDetail: number;
  minBiomeSize: number;
  renderScale: number;
  fogVisionRadius: number;
  temperatureBias: number;
  moistureBias: number;
  inlandPreference: number;
  roadConnectivity: number;
  abandonedMaxSegmentLength: number;
  settlementRandomness: number;
  abandonedFrequency: number;
  nodeMinDistance: number;
  startTimeOfDayHours: number;
}

export interface WorldInputParams extends Partial<WorldParams> {
  waterRichness?: number;
  coastalBias?: number;
  waterAffinity?: number;
}

export interface TerrainData {
  width: number;
  height: number;
  size: number;
  style: {
    name: string;
  };
  [key: string]: unknown;
}

export interface RiverData {
  id: number;
  name: string;
  cells: number[];
  width: number;
  [key: string]: unknown;
}

export interface LakeData {
  id: number;
  name: string;
  cells: number[];
  [key: string]: unknown;
}

export interface HydrologyData {
  rivers: RiverData[];
  lakes: LakeData[];
  [key: string]: unknown;
}

export interface ClimateData {
  temperature: Float32Array;
  moisture: Float32Array;
  biome: Uint8Array;
  [key: string]: unknown;
}

export interface RegionData {
  id: number;
  name?: string;
  [key: string]: unknown;
}

export interface RegionsData {
  mountainRegions: RegionData[];
  biomeRegions: RegionData[];
  [key: string]: unknown;
}

export interface SettlementData {
  id: number;
  name: string;
  x: number;
  y: number;
  score: number;
  coastal?: boolean;
  agents?: SettlementAgentData[];
  [key: string]: unknown;
}

export interface SettlementAgentData {
  id: string;
  [key: string]: unknown;
}

export interface PlayerStart {
  nodeId: number;
  x: number;
  y: number;
}

export interface RoadData {
  type: string;
  fromSettlementId: number;
  settlementId: number;
  length: number;
  cells: number[];
  [key: string]: unknown;
}

export interface RoadsData {
  roads: RoadData[];
  componentCount: number;
  [key: string]: unknown;
}

export interface NetworkComponent {
  settlementIds: number[];
  [key: string]: unknown;
}

export interface WorldNetwork {
  nodes: unknown[];
  links: unknown[];
  components: NetworkComponent[];
  [key: string]: unknown;
}

export interface World {
  params: WorldParams;
  terrain: TerrainData;
  hydrology: HydrologyData;
  climate: ClimateData;
  regions: RegionsData;
  surface: unknown;
  settlements: SettlementData[];
  playerStart: PlayerStart | null;
  roads: RoadsData;
  crashSiteCells: number[];
  network: WorldNetwork;
  features: unknown;
  travelGraph: unknown;
  geometry: unknown;
  title: string;
  stats: unknown;
}
