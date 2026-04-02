import { BIOME_KEYS } from "../config.js";

export function drawLabels(ctx, world, viewport, options = {}) {
  const { showBiomeLabels = false, showCityLabels = false } = options;
  const placedBoxes = [];

  if (showBiomeLabels) {
    drawLakeLabels(ctx, world, viewport, placedBoxes);
    drawBiomeLabels(ctx, world, viewport, placedBoxes);
  }

  if (showCityLabels) {
    drawCityLabels(ctx, world, viewport, placedBoxes);
  }
}

function drawLakeLabels(ctx, world, viewport, placedBoxes) {
  const lakes = [...(world.geometry.labels.lakes ?? [])]
    .filter((lake) => lake.size >= 28)
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const lake of lakes) {
    const point = viewport.worldToCanvas(lake.anchor.x - 0.5, lake.anchor.y - 0.5);
    const fontSize = Math.max(13, Math.min(22, 11 + Math.sqrt(lake.size) * 0.42));
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

function drawBiomeLabels(ctx, world, viewport, placedBoxes) {
  const regions = [...world.geometry.labels.biomeRegions]
    .filter((region) => region.size >= 90 && region.biome !== BIOME_KEYS.MOUNTAIN)
    .sort((a, b) => b.size - a.size)
    .slice(0, 14);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const region of regions) {
    const fontSize = Math.max(14, Math.min(24, 12 + Math.sqrt(region.size) * 0.46));
    const label = region.name;

    ctx.font = `italic ${fontSize}px Baskerville, "Palatino Linotype", Georgia, serif`;
    const anchors = region.candidates?.length ? region.candidates : [region.anchor];
    const placement = findLabelPlacement(ctx, viewport, anchors, label, fontSize, placedBoxes);
    if (!placement) {
      continue;
    }

    placedBoxes.push(placement.box);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(244, 235, 214, 0.8)";
    ctx.fillStyle = "rgba(82, 63, 39, 0.78)";
    ctx.strokeText(label, placement.point.x, placement.point.y);
    ctx.fillText(label, placement.point.x, placement.point.y);
  }

  ctx.restore();
}

function findLabelPlacement(ctx, viewport, anchors, label, fontSize, placedBoxes) {
  const textWidth = ctx.measureText(label).width;

  for (const anchor of anchors) {
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

function drawCityLabels(ctx, world, viewport, placedBoxes) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '15px Baskerville, "Palatino Linotype", Georgia, serif';

  for (const city of world.geometry.labels.cities) {
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
