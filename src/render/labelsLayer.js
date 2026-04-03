import { BIOME_KEYS } from "../config.js";

export function drawLabels(ctx, world, viewport, options = {}) {
  const { showBiomeLabels = false, showCityLabels = false, discoveredCells = null } = options;
  const placedBoxes = [];
  const regionLabelSettings = getRegionLabelSettings(viewport);

  if (showBiomeLabels) {
    drawLakeLabels(ctx, world, viewport, placedBoxes, regionLabelSettings, discoveredCells);
    drawMountainLabels(ctx, world, viewport, placedBoxes, regionLabelSettings, discoveredCells);
    drawBiomeLabels(ctx, world, viewport, placedBoxes, regionLabelSettings, discoveredCells);
  }

  if (showCityLabels) {
    drawCityLabels(ctx, world, viewport, placedBoxes, options.cityLabelIds ?? null);
  }
}

function drawLakeLabels(ctx, world, viewport, placedBoxes, settings, discoveredCells) {
  const lakes = [...(world.geometry.labels.lakes ?? [])]
    .filter(
      (lake) =>
        lake.size >= settings.lakes.minSize &&
        isWorldPointDiscovered(world, discoveredCells, lake.anchor)
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, settings.lakes.maxCount);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const lake of lakes) {
    const point = viewport.worldToCanvas(lake.anchor.x - 0.5, lake.anchor.y - 0.5);
    const fontSize = Math.max(12, Math.min(22, 10.5 + Math.sqrt(lake.size) * 0.42));
    const label = lake.name;

    ctx.font = `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`;
    const textWidth = ctx.measureText(label).width;
    const box = {
      left: point.x - textWidth * 0.58,
      right: point.x + textWidth * 0.58,
      top: point.y - fontSize * 0.72,
      bottom: point.y + fontSize * 0.72
    };
    if (intersectsPlacedBox(box, placedBoxes)) {
      continue;
    }

    placedBoxes.push(box);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(237, 233, 224, 0.82)";
    ctx.fillStyle = "rgba(71, 92, 109, 0.84)";
    ctx.strokeText(label, point.x, point.y);
    ctx.fillText(label, point.x, point.y);
  }

  ctx.restore();
}

function drawBiomeLabels(ctx, world, viewport, placedBoxes, settings, discoveredCells) {
  const regions = [...world.geometry.labels.biomeRegions]
    .filter(
      (region) =>
        region.size >= settings.biomes.minSize &&
        region.biome !== BIOME_KEYS.MOUNTAIN &&
        hasDiscoveredLabelAnchor(world, discoveredCells, region)
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, settings.biomes.maxCount);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const region of regions) {
    const fontSize = Math.max(13, Math.min(24, 11.5 + Math.sqrt(region.size) * 0.46));
    const label = region.name;
    const style = getBiomeLabelStyle(region.biome, fontSize);

    ctx.font = style.font;
    const anchors = region.candidates?.length ? region.candidates : [region.anchor];
    const placement = findLabelPlacement(
      ctx,
      world,
      viewport,
      anchors,
      label,
      fontSize,
      placedBoxes,
      discoveredCells
    );
    if (!placement) {
      continue;
    }

    placedBoxes.push(placement.box);
    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = style.strokeStyle;
    ctx.fillStyle = style.fillStyle;
    ctx.strokeText(label, placement.point.x, placement.point.y);
    ctx.fillText(label, placement.point.x, placement.point.y);
  }

  ctx.restore();
}

function drawMountainLabels(ctx, world, viewport, placedBoxes, settings, discoveredCells) {
  const regions = [...(world.geometry.labels.mountainRegions ?? [])]
    .filter(
      (region) =>
        region.size >= settings.mountains.minSize &&
        hasDiscoveredLabelAnchor(world, discoveredCells, region)
    )
    .sort((a, b) => b.size - a.size)
    .slice(0, settings.mountains.maxCount);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const region of regions) {
    const fontSize = Math.max(13, Math.min(22, 11.5 + Math.sqrt(region.size) * 0.42));
    const label = region.name;

    ctx.font = `600 ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`;
    const anchors = region.candidates?.length ? region.candidates : [region.anchor];
    const placement = findLabelPlacement(
      ctx,
      world,
      viewport,
      anchors,
      label,
      fontSize,
      placedBoxes,
      discoveredCells
    );
    if (!placement) {
      continue;
    }

    placedBoxes.push(placement.box);
    ctx.lineWidth = 4.6;
    ctx.strokeStyle = "rgba(244, 235, 218, 0.88)";
    ctx.fillStyle = "rgba(88, 78, 68, 0.88)";
    ctx.strokeText(label, placement.point.x, placement.point.y);
    ctx.fillText(label, placement.point.x, placement.point.y);
  }

  ctx.restore();
}

function findLabelPlacement(ctx, world, viewport, anchors, label, fontSize, placedBoxes, discoveredCells) {
  const textWidth = ctx.measureText(label).width;

  for (const anchor of anchors) {
    if (!isWorldPointDiscovered(world, discoveredCells, anchor)) {
      continue;
    }
    const point = viewport.worldToCanvas(anchor.x - 0.5, anchor.y - 0.5);
    const box = {
      left: point.x - textWidth * 0.58,
      right: point.x + textWidth * 0.58,
      top: point.y - fontSize * 0.72,
      bottom: point.y + fontSize * 0.72
    };
    if (!intersectsPlacedBox(box, placedBoxes)) {
      return { point, box };
    }
  }

  return null;
}

function hasDiscoveredLabelAnchor(world, discoveredCells, region) {
  if (!discoveredCells) {
    return true;
  }

  const anchors = region.candidates?.length ? region.candidates : [region.anchor];
  return anchors.some((anchor) => isWorldPointDiscovered(world, discoveredCells, anchor));
}

function isWorldPointDiscovered(world, discoveredCells, point) {
  if (!discoveredCells || !point) {
    return true;
  }

  const x = Math.max(0, Math.min(world.terrain.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(world.terrain.height - 1, Math.floor(point.y)));
  return Boolean(discoveredCells[y * world.terrain.width + x]);
}

function drawCityLabels(ctx, world, viewport, placedBoxes, visibleCityIds = null) {
  const allowedIds = visibleCityIds ? new Set(visibleCityIds) : null;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '15px Baskerville, "Palatino Linotype", Georgia, serif';

  for (const city of world.geometry.labels.cities) {
    if (allowedIds && !allowedIds.has(city.id)) {
      continue;
    }

    const point = viewport.worldToCanvas(city.x - 0.5, city.y - 0.5);
    const labelX = point.x + 8;
    const labelY = point.y - 8;
    const textWidth = ctx.measureText(city.name).width;
    const box = {
      left: labelX - 2,
      right: labelX + textWidth + 2,
      top: labelY - 10,
      bottom: labelY + 10
    };
    if (intersectsPlacedBox(box, placedBoxes)) {
      continue;
    }

    placedBoxes.push(box);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(243, 234, 214, 0.92)";
    ctx.fillStyle = "rgba(58, 45, 29, 0.92)";
    ctx.strokeText(city.name, labelX, labelY);
    ctx.fillText(city.name, labelX, labelY);
  }

  ctx.restore();
}

function intersectsPlacedBox(box, placedBoxes) {
  return placedBoxes.some(
    (placed) =>
      box.left < placed.right &&
      box.right > placed.left &&
      box.top < placed.bottom &&
      box.bottom > placed.top
  );
}

function getRegionLabelSettings(viewport) {
  const zoom = Math.max(1, Math.min(3.2, viewport.zoom));
  const zoomPower = Math.pow(zoom, 1.18);

  return {
    lakes: {
      minSize: Math.max(22, Math.round(58 / zoomPower)),
      maxCount: Math.max(5, Math.min(16, Math.round(3 + zoom * 4.2)))
    },
    mountains: {
      minSize: Math.max(22, Math.round(74 / zoomPower)),
      maxCount: Math.max(4, Math.min(12, Math.round(2 + zoom * 3.2)))
    },
    biomes: {
      minSize: Math.max(70, Math.round(220 / zoomPower)),
      maxCount: Math.max(6, Math.min(20, Math.round(4 + zoom * 4.5)))
    }
  };
}

function getBiomeLabelStyle(biome, fontSize) {
  switch (biome) {
    case BIOME_KEYS.FOREST:
      return {
        font: `italic ${fontSize}px "Palatino Linotype", Baskerville, Georgia, serif`,
        fillStyle: "rgba(64, 79, 50, 0.84)",
        strokeStyle: "rgba(244, 238, 224, 0.86)",
        lineWidth: 4.1
      };
    case BIOME_KEYS.RAINFOREST:
      return {
        font: `600 italic ${fontSize}px "Palatino Linotype", Baskerville, Georgia, serif`,
        fillStyle: "rgba(48, 66, 38, 0.88)",
        strokeStyle: "rgba(244, 239, 226, 0.88)",
        lineWidth: 4.2
      };
    case BIOME_KEYS.DESERT:
      return {
        font: `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: "rgba(124, 92, 50, 0.82)",
        strokeStyle: "rgba(246, 236, 212, 0.82)",
        lineWidth: 4
      };
    case BIOME_KEYS.TUNDRA:
      return {
        font: `italic ${fontSize}px Georgia, Baskerville, "Palatino Linotype", serif`,
        fillStyle: "rgba(88, 90, 98, 0.82)",
        strokeStyle: "rgba(245, 241, 233, 0.88)",
        lineWidth: 4.15
      };
    case BIOME_KEYS.HIGHLANDS:
      return {
        font: `600 italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: "rgba(92, 69, 49, 0.84)",
        strokeStyle: "rgba(244, 235, 214, 0.84)",
        lineWidth: 4.2
      };
    case BIOME_KEYS.PLAINS:
    default:
      return {
        font: `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`,
        fillStyle: "rgba(74, 58, 37, 0.8)",
        strokeStyle: "rgba(244, 235, 214, 0.84)",
        lineWidth: 4.2
      };
  }
}
