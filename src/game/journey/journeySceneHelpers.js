import { buildTravelBiomeBandSegments } from "../travel.js";
import { clampValue } from "./journeySceneMath.js";

const IDLE_PREVIEW_POINT_COUNT = 14;
const IDLE_PREVIEW_SPAN_MIN = 14;
const IDLE_PREVIEW_SPAN_MAX = 34;

export function travelKey(travel) {
  if (!travel) return null;
  return [
    travel.startNodeId ?? "-",
    travel.targetNodeId ?? "-",
    travel.routeType ?? "-",
    (travel.totalLength ?? 0).toFixed(2),
    travel.biomeSegments?.length ?? 0,
    travel.biomeBandSegments?.near?.segments?.length ?? 0,
  ].join(":");
}

export function createIdlePreviewTravel(world, playState) {
  const pos = playState?.position;
  if (!pos) return null;

  if (
    !world?.terrain?.width ||
    !world?.terrain?.height ||
    !world?.climate?.biome
  ) {
    return null;
  }

  const minX = 0;
  const minY = 0;
  const maxX = world.terrain.width - 1;
  const maxY = world.terrain.height - 1;
  const centerX = clampValue(Number(pos.x) || 0, minX, maxX);
  const centerY = clampValue(Number(pos.y) || 0, minY, maxY);

  const span = clampValue(
    world.terrain.width * 0.08,
    IDLE_PREVIEW_SPAN_MIN,
    IDLE_PREVIEW_SPAN_MAX,
  );
  const wobble = clampValue(span * 0.08, 0.9, 2.6);
  const startX = clampValue(centerX - span * 0.55, minX, maxX);
  const endX = clampValue(centerX + span * 0.55, minX, maxX);

  const points = [];
  for (let index = 0; index <= IDLE_PREVIEW_POINT_COUNT; index += 1) {
    const t = index / IDLE_PREVIEW_POINT_COUNT;
    const x = startX + (endX - startX) * t;
    const waveA = Math.sin(t * Math.PI * 2);
    const waveB = Math.sin(t * Math.PI * 5 + 0.9);
    const y = clampValue(
      centerY + waveA * wobble * 0.4 + waveB * wobble * 0.16,
      minY,
      maxY,
    );
    points.push({ x, y });
  }

  const segmentLengths = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const length = Math.hypot(next.x - prev.x, next.y - prev.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  const biomeBandSegments = buildTravelBiomeBandSegments(world, points);

  const nodeId = playState?.currentNodeId ?? null;
  return {
    startNodeId: nodeId,
    targetNodeId: nodeId,
    routeType: "idle-preview",
    points,
    segmentLengths,
    totalLength: Math.max(1, totalLength),
    progress: 0,
    biomeBandSegments,
    biomeSegments: biomeBandSegments.near?.segments ?? [],
    __journeyIdleKey: [
      Math.round(centerX),
      Math.round(centerY),
      `${world.terrain.width}x${world.terrain.height}`,
    ].join(":"),
  };
}
