import { floodFillRegions } from "./grid.js";
import { isSnowCell } from "./surfaceModel.js";

export function buildSurfaceGeometry(world) {
  const { terrain, climate, hydrology, regions } = world;
  const { width, height, size, isLand } = terrain;

  const biomes = regions.biomeRegions.map((region) => ({
    id: region.id,
    biome: region.biome,
    size: region.size,
    loops: traceExactLoops(region.cells, width),
    stats: summarizeCells(region.cells, world)
  }));

  const lakes = hydrology.lakes.map((lake) => ({
    id: lake.id,
    size: lake.cells.length,
    loops: traceExactLoops(lake.cells, width)
  }));

  const snowMask = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || hydrology.lakeIdByCell[index] >= 0) {
      continue;
    }

    if (
      isSnowCell(
        climate.biome[index],
        terrain.elevation[index],
        terrain.mountainField[index],
        climate.temperature[index],
        true
      )
    ) {
      snowMask[index] = 1;
    }
  }

  const snowRegions = floodFillRegions(width, height, (index) => snowMask[index] === 1, true)
    .filter((cells) => cells.length > 0)
    .map((cells, id) => ({
      id,
      size: cells.length,
      loops: traceExactLoops(cells, width)
    }));

  const landCells = [];
  for (let index = 0; index < size; index += 1) {
    if (isLand[index]) {
      landCells.push(index);
    }
  }

  const landLoops = traceExactLoops(landCells, width);
  const positiveCoastlines = landLoops.filter((loop) => signedArea(loop) > 0);

  return {
    biomes,
    lakes,
    snowRegions,
    coastlineLoops: positiveCoastlines.length > 0 ? positiveCoastlines : landLoops
  };
}

function summarizeCells(cells, world) {
  const { terrain, climate, hydrology } = world;
  let elevation = 0;
  let mountain = 0;
  let temperature = 0;
  let moisture = 0;
  let riverStrength = 0;
  let provinceField = 0;

  for (const cell of cells) {
    elevation += terrain.elevation[cell];
    mountain += terrain.mountainField[cell];
    temperature += climate.temperature[cell];
    moisture += climate.moisture[cell];
    riverStrength += hydrology.riverStrength[cell];
    provinceField += terrain.provinceField[cell];
  }

  const count = Math.max(1, cells.length);
  return {
    elevation: elevation / count,
    mountain: mountain / count,
    temperature: temperature / count,
    moisture: moisture / count,
    riverStrength: riverStrength / count,
    provinceField: provinceField / count
  };
}

export function traceExactLoops(cells, width) {
  if (!cells.length) {
    return [];
  }

  const cellSet = new Set(cells);
  const edges = [];
  const edgesByStartKey = new Map();

  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);

    if (y === 0 || !cellSet.has(cell - width)) {
      addEdge(edges, edgesByStartKey, { x, y }, { x: x + 1, y }, "E");
    }
    if (x === width - 1 || !cellSet.has(cell + 1)) {
      addEdge(edges, edgesByStartKey, { x: x + 1, y }, { x: x + 1, y: y + 1 }, "S");
    }
    if (!cellSet.has(cell + width)) {
      addEdge(edges, edgesByStartKey, { x: x + 1, y: y + 1 }, { x, y: y + 1 }, "W");
    }
    if (x === 0 || !cellSet.has(cell - 1)) {
      addEdge(edges, edgesByStartKey, { x, y: y + 1 }, { x, y }, "N");
    }
  }

  const loops = [];

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (edges[edgeIndex].used) {
      continue;
    }

    const startEdge = edges[edgeIndex];
    startEdge.used = true;
    const loop = [startEdge.from];
    let current = startEdge;

    while (true) {
      loop.push(current.to);
      if (current.toKey === startEdge.fromKey) {
        loop.pop();
        break;
      }

      const candidates = (edgesByStartKey.get(current.toKey) ?? []).filter(
        (candidateIndex) => !edges[candidateIndex].used
      );
      if (candidates.length === 0) {
        break;
      }

      const nextIndex = chooseNextEdge(edges, candidates, current.dir);
      edges[nextIndex].used = true;
      current = edges[nextIndex];
    }

    const simplified = simplifyLoop(loop);
    if (simplified.length >= 3) {
      loops.push(simplified);
    }
  }

  return loops;
}

function addEdge(edges, edgesByStartKey, from, to, dir) {
  const edge = {
    from,
    to,
    fromKey: pointKey(from),
    toKey: pointKey(to),
    dir,
    used: false
  };
  const index = edges.length;
  edges.push(edge);

  if (!edgesByStartKey.has(edge.fromKey)) {
    edgesByStartKey.set(edge.fromKey, []);
  }
  edgesByStartKey.get(edge.fromKey).push(index);
}

function chooseNextEdge(edges, candidateIndices, currentDir) {
  const priority = TURN_PRIORITY[currentDir];
  let bestIndex = candidateIndices[0];
  let bestRank = priority.indexOf(edges[bestIndex].dir);

  for (let index = 1; index < candidateIndices.length; index += 1) {
    const candidateIndex = candidateIndices[index];
    const rank = priority.indexOf(edges[candidateIndex].dir);
    if (rank < bestRank) {
      bestIndex = candidateIndex;
      bestRank = rank;
    }
  }

  return bestIndex;
}

function simplifyLoop(loop) {
  if (loop.length <= 3) {
    return loop;
  }

  const simplified = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index + loop.length - 1) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const dx1 = current.x - previous.x;
    const dy1 = current.y - previous.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;
    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-6) {
      continue;
    }
    simplified.push(current);
  }
  return simplified;
}

function signedArea(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

const TURN_PRIORITY = {
  E: ["S", "E", "N", "W"],
  S: ["W", "S", "E", "N"],
  W: ["N", "W", "S", "E"],
  N: ["E", "N", "W", "S"]
};
