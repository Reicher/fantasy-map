import { BIOME_KEYS, getBiomeDefinitionById } from "@fardvag/shared/biomes";
import { isSnowCell } from "@fardvag/world-gen";
import { dedupePoints } from "@fardvag/shared/utils";
import type { PlayTravelState } from "@fardvag/shared/types/play";

const TRAVEL_BIOME_BANDS = {
  near: 0,
  mid: 5,
  far: 10,
};

interface WorldLike {
  terrain?: {
    width?: number;
    height?: number;
    elevation?: ArrayLike<number>;
    mountainField?: ArrayLike<number>;
  };
  climate?: {
    biome?: ArrayLike<number | string>;
    temperature?: ArrayLike<number>;
  };
}
type Point = { x: number; y: number };
type PathSample = { point: Point; segmentIndex: number; segmentT: number };
type TravelLike = Pick<
  PlayTravelState,
  "points" | "totalLength" | "progress" | "segmentLengths" | "biomeBandSegments"
>;
interface BiomeBandSegment {
  biome: string;
  label: string;
  isSnow: boolean;
  distance: number;
  share: number;
}
type BiomeBand = {
  name: string;
  offsetDistance: number;
  segments: BiomeBandSegment[];
};

function buildOffsetTravelBiomeSegments(
  world: WorldLike,
  points: Point[],
  offsetDistance: number = TRAVEL_BIOME_BANDS.mid,
) {
  const normalizedPoints = dedupePoints(points);
  const offsetPoints = normalizedPoints.map((_point, index) =>
    offsetPointLeft(normalizedPoints, index, offsetDistance),
  );
  return buildBiomeSegmentsFromPoints(world, offsetPoints);
}

export function buildTravelBiomeBandSegments(world: WorldLike, points: Point[]) {
  const normalizedPoints = dedupePoints(points);
  return {
    near: createTravelBiomeBand(
      "near",
      TRAVEL_BIOME_BANDS.near,
      buildBiomeSegmentsFromPoints(world, normalizedPoints),
    ),
    mid: createTravelBiomeBand(
      "mid",
      TRAVEL_BIOME_BANDS.mid,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.mid,
      ),
    ),
    far: createTravelBiomeBand(
      "far",
      TRAVEL_BIOME_BANDS.far,
      buildOffsetTravelBiomeSegments(
        world,
        normalizedPoints,
        TRAVEL_BIOME_BANDS.far,
      ),
    ),
  };
}

export function sampleTravelBiomeBandPoints(travel: TravelLike) {
  if (!travel?.points?.length) {
    return null;
  }

  const progress = Math.max(
    0,
    Math.min(travel.totalLength ?? 0, travel.progress ?? 0),
  );
  const sample = samplePath(
    travel.points,
    travel.segmentLengths ?? [],
    progress,
  );
  const bands = travel.biomeBandSegments ?? createEmptyTravelBiomeBands();
  const nearOffset =
    typeof bands.near?.offsetDistance === "number"
      ? bands.near.offsetDistance
      : 0;
  const midOffset =
    typeof bands.mid?.offsetDistance === "number"
      ? bands.mid.offsetDistance
      : TRAVEL_BIOME_BANDS.mid;
  const farOffset =
    typeof bands.far?.offsetDistance === "number"
      ? bands.far.offsetDistance
      : TRAVEL_BIOME_BANDS.far;

  return {
    near: createTravelBandPointSample(
      "near",
      nearOffset,
      sample.point,
    ),
    mid: createTravelBandPointSample(
      "mid",
      midOffset,
      offsetSamplePointLeft(
        travel.points,
        sample,
        midOffset,
      ),
    ),
    far: createTravelBandPointSample(
      "far",
      farOffset,
      offsetSamplePointLeft(
        travel.points,
        sample,
        farOffset,
      ),
    ),
  };
}

function buildBiomeSegmentsFromPoints(world: WorldLike, points: Point[]) {
  const biome = world?.climate?.biome;
  const elevation = world?.terrain?.elevation;
  const mountainField = world?.terrain?.mountainField;
  const temperature = world?.climate?.temperature;
  if (
    !points?.length ||
    !biome ||
    !elevation ||
    !mountainField ||
    !temperature
  ) {
    return [];
  }

  const segments: Array<{
    biome: string;
    label: string;
    isSnow: boolean;
    distance: number;
  }> = [];
  let current: (typeof segments)[number] | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const biomeKey = biomeKeyAtPoint(world, point) ?? BIOME_KEYS.PLAINS;
    const biomeInfo = getBiomeDefinitionById(biomeKey);
    const isSnow = isSnowAtPoint(world, point, biomeKey);
    const nextPoint = points[index + 1];
    const distance = nextPoint
      ? Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y)
      : 0;

    if (
      !current ||
      current.biome !== biomeInfo.key ||
      Boolean(current.isSnow) !== isSnow
    ) {
      current = {
        biome: biomeInfo.key,
        label: biomeInfo.label,
        isSnow,
        distance: 0,
      };
      segments.push(current);
    }

    current.distance += distance;
  }

  const totalDistance = segments.reduce(
    (sum, segment) => sum + segment.distance,
    0,
  );
  return segments.map((segment) => ({
    ...segment,
    share: totalDistance > 0 ? segment.distance / totalDistance : 0,
  }));
}

function createTravelBiomeBand(
  name: string,
  offsetDistance: number,
  segments: BiomeBandSegment[],
): BiomeBand {
  return {
    name,
    offsetDistance,
    segments,
  };
}

function createTravelBandPointSample(
  name: string,
  offsetDistance: number,
  point: Point | null,
) {
  return {
    name,
    offsetDistance,
    point,
  };
}

export function createEmptyTravelBiomeBands() {
  return {
    near: createTravelBiomeBand("near", TRAVEL_BIOME_BANDS.near, []),
    mid: createTravelBiomeBand("mid", TRAVEL_BIOME_BANDS.mid, []),
    far: createTravelBiomeBand("far", TRAVEL_BIOME_BANDS.far, []),
  };
}

export function samplePath(
  points: Point[],
  segmentLengths: number[],
  distance: number,
): PathSample {
  if (points.length <= 1) {
    return {
      point: points[0] ?? { x: 0, y: 0 },
      segmentIndex: 0,
      segmentT: 0,
    };
  }

  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (
      distance <= traversed + segmentLength ||
      index === segmentLengths.length - 1
    ) {
      const local =
        segmentLength <= 0 ? 0 : (distance - traversed) / segmentLength;
      const t = Math.max(0, Math.min(1, local));
      const start = points[index];
      const end = points[index + 1];
      return {
        point: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        },
        segmentIndex: index,
        segmentT: t,
      };
    }
    traversed += segmentLength;
  }

  return {
    point: points[points.length - 1],
    segmentIndex: segmentLengths.length - 1,
    segmentT: 1,
  };
}

function offsetPointLeft(
  points: Point[],
  index: number,
  offsetDistance: number,
): Point {
  const current = points[index];
  const previous = points[index - 1] ?? current;
  const next = points[index + 1] ?? current;
  const tangentX = next.x - previous.x;
  const tangentY = next.y - previous.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return { x: current.x, y: current.y };
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;

  return {
    x: current.x + normalX * offsetDistance,
    y: current.y + normalY * offsetDistance,
  };
}

function offsetSamplePointLeft(
  points: Point[],
  sample: PathSample,
  offsetDistance: number,
): Point | null {
  if (!sample?.point || !points?.length || Math.abs(offsetDistance) <= 0.0001) {
    return sample?.point ?? null;
  }

  const startIndex = Math.max(
    0,
    Math.min(points.length - 1, sample.segmentIndex ?? 0),
  );
  const endIndex = Math.max(0, Math.min(points.length - 1, startIndex + 1));
  const start = points[startIndex] ?? sample.point;
  const end = points[endIndex] ?? sample.point;
  const tangentX = end.x - start.x;
  const tangentY = end.y - start.y;
  const tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength <= 0.0001) {
    return sample.point;
  }

  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;
  return {
    x: sample.point.x + normalX * offsetDistance,
    y: sample.point.y + normalY * offsetDistance,
  };
}

export function biomeKeyAtPoint(
  world: WorldLike | null | undefined,
  position: Point | null,
): number | null {
  const cellIndex = getCellIndexAtPoint(world, position);
  if (cellIndex == null) {
    return null;
  }
  const biome = world?.climate?.biome;
  if (!biome || cellIndex >= biome.length) {
    return null;
  }
  const value = biome[cellIndex];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isSnowAtPoint(
  world: WorldLike,
  position: Point | null,
  biomeKey: number | null = null,
) {
  const cellIndex = getCellIndexAtPoint(world, position);
  if (cellIndex == null) {
    return false;
  }

  return isSnowCell(
    biomeKey ?? BIOME_KEYS.PLAINS,
    world.terrain?.elevation?.[cellIndex] ?? 0,
    world.terrain?.mountainField?.[cellIndex] ?? 0,
    world.climate?.temperature?.[cellIndex] ?? 0,
    true,
  );
}

function getCellIndexAtPoint(world: WorldLike, position: Point | null) {
  if (!world || !position) {
    return null;
  }
  const width = Number(world.terrain?.width ?? 0);
  const height = Number(world.terrain?.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const x = Math.max(
    0,
    Math.min(width - 1, Math.floor(position.x)),
  );
  const y = Math.max(
    0,
    Math.min(height - 1, Math.floor(position.y)),
  );
  return y * width + x;
}
