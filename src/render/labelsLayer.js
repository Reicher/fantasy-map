import { BIOME_KEYS } from "../config.js";
import { LABEL_COLORS } from "./colorTokens.js";

const MAP_NODE_ICON_LIFT = 3.3;

export function drawLabels(ctx, world, viewport, options = {}) {
  const {
    showBiomeLabels = false,
    showNodeLabels = false,
    discoveredCells = null,
  } = options;
  const showLabels = showNodeLabels;
  const placedBoxes = [];
  const regionLabelSettings = getRegionLabelSettings(viewport);
  const visibleNodeIds = resolveVisibleNodeIdsForLabels(options);
  const opasettlement = 0.9;

  ctx.save();
  ctx.globalAlpha = opasettlement;

  if (showBiomeLabels) {
    const mapPlacedBoxes = [...placedBoxes];
    const reservedNodeCount = reserveNodeCollisionBoxesForMapNames(
      world,
      viewport,
      mapPlacedBoxes,
      visibleNodeIds,
      discoveredCells,
    );

    drawMajorRegionLabels(
      ctx,
      world,
      viewport,
      mapPlacedBoxes,
      regionLabelSettings,
      discoveredCells,
    );
    drawLakeLabels(
      ctx,
      world,
      viewport,
      mapPlacedBoxes,
      regionLabelSettings,
      discoveredCells,
    );

    for (
      let index = reservedNodeCount;
      index < mapPlacedBoxes.length;
      index += 1
    ) {
      placedBoxes.push(mapPlacedBoxes[index]);
    }
  }

  if (showLabels) {
    drawNodeLabels(ctx, world, viewport, placedBoxes, visibleNodeIds);
  }

  ctx.restore();
}

function reserveNodeCollisionBoxesForMapNames(
  world,
  viewport,
  placedBoxes,
  visibleNodeIds,
  discoveredCells,
) {
  const nodes = world.geometry.labels.nodes;
  if (!nodes.length) {
    return placedBoxes.length;
  }

  const allowedIds = visibleNodeIds ? new Set(visibleNodeIds) : null;
  const markerScale = getNodeCollisionScale(viewport);
  const iconLift = markerScale * MAP_NODE_ICON_LIFT;
  const halfWidth = markerScale * 7.0;
  const halfHeight = markerScale * 6.2;
  const padding = Math.max(2.2, markerScale * 0.7);
  const bounds = {
    left: viewport.margin - 12,
    right: viewport.margin + viewport.innerWidth + 12,
    top: viewport.margin - 12,
    bottom: viewport.margin + viewport.innerHeight + 12,
  };

  for (const node of nodes) {
    if (allowedIds && !allowedIds.has(node.id)) {
      continue;
    }
    if (!isWorldPointDiscovered(world, discoveredCells, node)) {
      continue;
    }

    const point = viewport.worldToCanvas(node.x - 0.5, node.y - 0.5);
    const centerX = point.x;
    const centerY = point.y - iconLift;
    const box = {
      left: centerX - halfWidth - padding,
      right: centerX + halfWidth + padding,
      top: centerY - halfHeight - padding,
      bottom: centerY + halfHeight + padding,
    };

    if (
      box.right < bounds.left ||
      box.left > bounds.right ||
      box.bottom < bounds.top ||
      box.top > bounds.bottom
    ) {
      continue;
    }
    placedBoxes.push(box);
  }

  return placedBoxes.length;
}

function getNodeCollisionScale(viewport) {
  return Math.max(2.1, Math.min(6.2, viewport.zoom * 1.32));
}

function resolveVisibleNodeIdsForLabels(options = {}) {
  return (
    options.nodeOverlay?.visibleNodeIds ??
    options.visibleNodeIds ??
    null
  );
}

function drawLakeLabels(
  ctx,
  world,
  viewport,
  placedBoxes,
  settings,
  discoveredCells,
) {
  const lakes = [...(world.geometry.labels.lakes ?? [])]
    .filter(
      (lake) =>
        lake.size >= settings.lakes.minSize &&
        isWorldPointDiscovered(world, discoveredCells, lake.anchor),
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, settings.lakes.maxCount);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const lake of lakes) {
    const point = viewport.worldToCanvas(
      lake.anchor.x - 0.5,
      lake.anchor.y - 0.5,
    );
    const fontSize = Math.max(
      12,
      Math.min(22, 10.5 + Math.sqrt(lake.size) * 0.42),
    );
    const label = lake.name;

    ctx.font = `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`;
    const textWidth = ctx.measureText(label).width;
    const box = {
      left: point.x - textWidth * 0.58,
      right: point.x + textWidth * 0.58,
      top: point.y - fontSize * 0.72,
      bottom: point.y + fontSize * 0.72,
    };
    if (intersectsPlacedBox(box, placedBoxes)) {
      continue;
    }

    placedBoxes.push(box);
    ctx.lineWidth = 4;
    ctx.strokeStyle = LABEL_COLORS.lake.stroke;
    ctx.fillStyle = LABEL_COLORS.lake.fill;
    ctx.strokeText(label, point.x, point.y);
    ctx.fillText(label, point.x, point.y);
  }

  ctx.restore();
}

function drawMajorRegionLabels(
  ctx,
  world,
  viewport,
  placedBoxes,
  settings,
  discoveredCells,
) {
  const mountainEntries = [...(world.geometry.labels.mountainRegions ?? [])]
    .filter(
      (region) =>
        region.size >= settings.mountains.minSize &&
        hasDiscoveredLabelAnchor(world, discoveredCells, region),
    )
    .slice(0, settings.mountains.maxCount)
    .map((region) => {
      const fontSize = Math.max(
        13,
        Math.min(22, 11.5 + Math.sqrt(region.size) * 0.42),
      );
      const anchors = region.candidates?.length
        ? region.candidates
        : [region.anchor];
      const anchorDepth = anchors[0]?.edgeDistance ?? 0;
      return {
        region,
        label: region.name,
        fontSize,
        anchors,
        style: getMountainLabelStyle(fontSize),
        priority: Math.pow(region.size, 0.58) * 1.34 + anchorDepth * 0.85,
      };
    });

  const biomeEntries = [...world.geometry.labels.biomeRegions]
    .filter(
      (region) =>
        region.size >= settings.biomes.minSize &&
        region.biome !== BIOME_KEYS.MOUNTAIN &&
        hasDiscoveredLabelAnchor(world, discoveredCells, region),
    )
    .slice(0, settings.biomes.maxCount)
    .map((region) => {
      const fontSize = Math.max(
        13,
        Math.min(24, 11.5 + Math.sqrt(region.size) * 0.46),
      );
      const anchors = region.candidates?.length
        ? region.candidates
        : [region.anchor];
      const anchorDepth = anchors[0]?.edgeDistance ?? 0;
      return {
        region,
        label: region.name,
        fontSize,
        anchors,
        style: getBiomeLabelStyle(region.biome, fontSize),
        priority: Math.pow(region.size, 0.56) + anchorDepth * 0.72,
      };
    });

  const entries = [...mountainEntries, ...biomeEntries].sort(
    (a, b) => b.priority - a.priority,
  );

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const entry of entries) {
    ctx.font = entry.style.font;
    const placement = findLabelPlacement(
      ctx,
      world,
      viewport,
      entry.anchors,
      entry.label,
      entry.fontSize,
      placedBoxes,
      discoveredCells,
      entry.priority,
    );
    if (!placement) {
      continue;
    }

    placedBoxes.push(placement.box);
    ctx.lineWidth = entry.style.lineWidth;
    ctx.strokeStyle = entry.style.strokeStyle;
    ctx.fillStyle = entry.style.fillStyle;
    ctx.strokeText(entry.label, placement.point.x, placement.point.y);
    ctx.fillText(entry.label, placement.point.x, placement.point.y);
  }

  ctx.restore();
}

function findLabelPlacement(
  ctx,
  world,
  viewport,
  anchors,
  label,
  fontSize,
  placedBoxes,
  discoveredCells,
  priority = 0,
) {
  const textWidth = ctx.measureText(label).width;
  const padding = Math.max(8, Math.min(18, fontSize * 0.42));
  const viewportBounds = {
    left: viewport.margin + padding,
    right: viewport.margin + viewport.innerWidth - padding,
    top: viewport.margin + padding,
    bottom: viewport.margin + viewport.innerHeight - padding,
  };
  const viewportCenterX = viewport.margin + viewport.innerWidth * 0.5;
  const viewportCenterY = viewport.margin + viewport.innerHeight * 0.5;
  const offsets = [
    { x: 0, y: 0 },
    { x: 0, y: -fontSize * 0.2 },
    { x: 0, y: fontSize * 0.2 },
    { x: fontSize * 0.28, y: 0 },
    { x: -fontSize * 0.28, y: 0 },
    { x: fontSize * 0.2, y: -fontSize * 0.16 },
    { x: -fontSize * 0.2, y: -fontSize * 0.16 },
    { x: fontSize * 0.2, y: fontSize * 0.16 },
    { x: -fontSize * 0.2, y: fontSize * 0.16 },
  ];
  let bestPlacement = null;

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    if (!isWorldPointDiscovered(world, discoveredCells, anchor)) {
      continue;
    }
    const basePoint = viewport.worldToCanvas(anchor.x - 0.5, anchor.y - 0.5);
    const anchorScore = (anchor.score ?? 0) * 0.7 - anchorIndex * 4;

    for (const offset of offsets) {
      const point = {
        x: basePoint.x + offset.x,
        y: basePoint.y + offset.y,
      };
      const box = {
        left: point.x - textWidth * 0.58,
        right: point.x + textWidth * 0.58,
        top: point.y - fontSize * 0.72,
        bottom: point.y + fontSize * 0.72,
      };
      if (
        box.left < viewportBounds.left ||
        box.right > viewportBounds.right ||
        box.top < viewportBounds.top ||
        box.bottom > viewportBounds.bottom
      ) {
        continue;
      }
      if (intersectsPlacedBox(box, placedBoxes)) {
        continue;
      }

      const edgeClearance = Math.min(
        box.left - viewportBounds.left,
        viewportBounds.right - box.right,
        box.top - viewportBounds.top,
        viewportBounds.bottom - box.bottom,
      );
      const centerDist = Math.hypot(
        point.x - viewportCenterX,
        point.y - viewportCenterY,
      );
      const offsetDist = Math.hypot(offset.x, offset.y);
      const score =
        priority * 4.2 +
        anchorScore +
        edgeClearance * 0.3 -
        offsetDist * 0.28 -
        centerDist * 0.012;

      if (!bestPlacement || score > bestPlacement.score) {
        bestPlacement = { point, box, score };
      }
    }
  }

  return bestPlacement
    ? { point: bestPlacement.point, box: bestPlacement.box }
    : null;
}

function hasDiscoveredLabelAnchor(world, discoveredCells, region) {
  if (!discoveredCells) {
    return true;
  }

  const anchors = region.candidates?.length
    ? region.candidates
    : [region.anchor];
  return anchors.some((anchor) =>
    isWorldPointDiscovered(world, discoveredCells, anchor),
  );
}

function isWorldPointDiscovered(world, discoveredCells, point) {
  if (!discoveredCells || !point) {
    return true;
  }

  const x = Math.max(0, Math.min(world.terrain.width - 1, Math.floor(point.x)));
  const y = Math.max(
    0,
    Math.min(world.terrain.height - 1, Math.floor(point.y)),
  );
  return Boolean(discoveredCells[y * world.terrain.width + x]);
}

function drawNodeLabels(
  ctx,
  world,
  viewport,
  placedBoxes,
  visibleNodeIds = null,
) {
  const allowedIds = visibleNodeIds ? new Set(visibleNodeIds) : null;
  const namedNodes = world.geometry.labels.nodes;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '15px Baskerville, "Palatino Linotype", Georgia, serif';

  for (const node of namedNodes) {
    if (!String(node.name ?? "").trim()) {
      continue;
    }
    if (allowedIds && !allowedIds.has(node.id)) {
      continue;
    }

    const point = viewport.worldToCanvas(node.x - 0.5, node.y - 0.5);
    const markerScale = getNodeCollisionScale(viewport);
    const iconCenterY = point.y - markerScale * MAP_NODE_ICON_LIFT;
    const labelX = point.x + Math.max(12, markerScale * 8.4);
    const labelY = iconCenterY;
    const textWidth = ctx.measureText(node.name).width;
    const halfTextHeight = 9.5;
    const box = {
      left: labelX - 2,
      right: labelX + textWidth + 2,
      top: labelY - halfTextHeight,
      bottom: labelY + halfTextHeight,
    };
    if (intersectsPlacedBox(box, placedBoxes)) {
      continue;
    }

    placedBoxes.push(box);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = LABEL_COLORS.node.stroke;
    ctx.fillStyle = LABEL_COLORS.node.fill;
    ctx.strokeText(node.name, labelX, labelY);
    ctx.fillText(node.name, labelX, labelY);
  }

  ctx.restore();
}

function intersectsPlacedBox(box, placedBoxes) {
  return placedBoxes.some(
    (placed) =>
      box.left < placed.right &&
      box.right > placed.left &&
      box.top < placed.bottom &&
      box.bottom > placed.top,
  );
}

function getRegionLabelSettings(viewport) {
  const zoom = Math.max(1, Math.min(3.2, viewport.zoom));
  const zoomPower = Math.pow(zoom, 1.18);

  return {
    lakes: {
      minSize: Math.max(28, Math.round(84 / zoomPower)),
      maxCount: Math.max(3, Math.min(11, Math.round(2 + zoom * 2.8))),
    },
    mountains: {
      minSize: Math.max(22, Math.round(74 / zoomPower)),
      maxCount: Math.max(4, Math.min(12, Math.round(2 + zoom * 3.2))),
    },
    biomes: {
      minSize: Math.max(70, Math.round(220 / zoomPower)),
      maxCount: Math.max(6, Math.min(20, Math.round(4 + zoom * 4.5))),
    },
  };
}

function getMountainLabelStyle(fontSize) {
  return {
    font: `600 ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
    fillStyle: LABEL_COLORS.mountainRegion.fill,
    strokeStyle: LABEL_COLORS.mountainRegion.stroke,
    lineWidth: 4.6,
  };
}

function getBiomeLabelStyle(biome, fontSize) {
  switch (biome) {
    case BIOME_KEYS.FOREST:
      return {
        font: `italic ${fontSize}px "Palatino Linotype", Baskerville, Georgia, serif`,
        fillStyle: LABEL_COLORS.biome.forest.fill,
        strokeStyle: LABEL_COLORS.biome.forest.stroke,
        lineWidth: 4.1,
      };
    case BIOME_KEYS.RAINFOREST:
      return {
        font: `600 italic ${fontSize}px "Palatino Linotype", Baskerville, Georgia, serif`,
        fillStyle: LABEL_COLORS.biome.rainforest.fill,
        strokeStyle: LABEL_COLORS.biome.rainforest.stroke,
        lineWidth: 4.2,
      };
    case BIOME_KEYS.DESERT:
      return {
        font: `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: LABEL_COLORS.biome.desert.fill,
        strokeStyle: LABEL_COLORS.biome.desert.stroke,
        lineWidth: 4,
      };
    case BIOME_KEYS.TUNDRA:
      return {
        font: `italic ${fontSize}px Georgia, Baskerville, "Palatino Linotype", serif`,
        fillStyle: LABEL_COLORS.biome.tundra.fill,
        strokeStyle: LABEL_COLORS.biome.tundra.stroke,
        lineWidth: 4.15,
      };
    case BIOME_KEYS.HIGHLANDS:
      return {
        font: `600 italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: LABEL_COLORS.biome.highlands.fill,
        strokeStyle: LABEL_COLORS.biome.highlands.stroke,
        lineWidth: 4.2,
      };
    case BIOME_KEYS.PLAINS:
    default:
      return {
        font: `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: LABEL_COLORS.biome.plains.fill,
        strokeStyle: LABEL_COLORS.biome.plains.stroke,
        lineWidth: 4.2,
      };
  }
}
