import { getBiomeRoadTravelCostById } from "../../biomes/index.js";
import { clamp, coordsOf, forEachNeighbor } from "../../utils.js";

const ON_ROAD_COST_FACTOR = 0.62;
const TOUCHING_ROAD_COST_FACTOR = 0.82;
const PARALLEL_ROAD_PENALTY = 2.9;
const RIVER_COST_THRESHOLD = 0.06;
const RIVER_BASE_PENALTY = 2.4;
const RIVER_STRENGTH_SCALE = 3.1;
const MAX_ROAD_USAGE = 65535;

export function generateRoads(world) {
  const { terrain, climate, hydrology, settlements } = world;
  const { width, height, size, isLand, elevation, mountainField } = terrain;
  const { biome } = climate;
  const { lakeIdByCell, riverStrength } = hydrology;

  if (!settlements?.length) {
    return { roads: [], roadUsage: new Uint16Array(size), componentCount: 0 };
  }
  if (settlements.length === 1) {
    return { roads: [], roadUsage: new Uint16Array(size), componentCount: 1 };
  }

  const baseCost = buildBaseCost({
    size,
    isLand,
    lakeIdByCell,
    biome,
    elevation,
    mountainField,
  });

  const roads = [];
  const roadUsage = new Uint16Array(size);
  const blockedRoadCells = new Uint8Array(size);
  const settlementCellSet = new Set(settlements.map((settlement) => settlement.cell));

  const pairEdges = collectPairEdges({
    settlements,
    width,
    height,
    size,
    baseCost,
    riverStrength,
  });

  if (!pairEdges.length) {
    return {
      roads,
      roadUsage,
      componentCount: countSettlementComponents(settlements.length, roads),
    };
  }

  const mstEdges = buildMstEdges(settlements.length, pairEdges);
  mstEdges.sort((a, b) => a.cost - b.cost);

  for (const edge of mstEdges) {
    materializeRoadEdge({
      settlements,
      roads,
      roadUsage,
      width,
      height,
      size,
      baseCost,
      riverStrength,
      edge,
      type: "road",
      blockedRoadCells,
      sharedAllowedCells: settlementCellSet,
    });
  }

  connectSettlementComponentsBySeaRoutes({
    settlements,
    roads,
    terrain,
  });

  removeDegenerateRoadsInPlace(roads);
  rebuildLandRoadUsage(roadUsage, roads);

  return {
    roads,
    roadUsage,
    componentCount: countSettlementComponents(settlements.length, roads),
  };
}

function buildBaseCost({
  size,
  isLand,
  lakeIdByCell,
  biome,
  elevation,
  mountainField,
}) {
  const baseCost = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    if (!isLand[index] || lakeIdByCell[index] >= 0) {
      baseCost[index] = Number.POSITIVE_INFINITY;
      continue;
    }

    const biomeCost = getBiomeRoadTravelCostById(biome[index]) ?? 1.2;
    const slopePenalty = elevation[index] * 1.05;
    const mountainPenalty =
      mountainField[index] * 4.2 + Math.max(0, mountainField[index] - 0.58) * 7.4;
    baseCost[index] = biomeCost + slopePenalty + mountainPenalty;
  }

  return baseCost;
}

function collectPairEdges({
  settlements,
  width,
  height,
  size,
  baseCost,
  riverStrength,
}) {
  const edges = [];

  for (let i = 0; i < settlements.length; i += 1) {
    const from = settlements[i];
    const distances = runGridDijkstra({
      source: from.cell,
      width,
      height,
      size,
      baseCost,
      riverStrength,
    });

    for (let j = i + 1; j < settlements.length; j += 1) {
      const to = settlements[j];
      const cost = distances[to.cell];
      if (!Number.isFinite(cost)) {
        continue;
      }
      edges.push({ i, j, cost });
    }
  }

  return edges;
}

function runGridDijkstra({ source, width, height, size, baseCost, riverStrength }) {
  const distances = new Float64Array(size);
  distances.fill(Number.POSITIVE_INFINITY);
  const heap = new MinHeap();

  if (!Number.isFinite(baseCost[source])) {
    return distances;
  }

  distances[source] = 0;
  heap.push(source, 0);

  while (heap.size > 0) {
    const { index: current, priority } = heap.pop();
    if (priority > distances[current] + 1e-6) {
      continue;
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny, ox, oy) => {
      const next = ny * width + nx;
      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const stepCost = computeRoadStepCost({
        from: current,
        to: next,
        diagonal,
        baseCost,
        riverStrength,
        roadUsage: null,
        width,
        height,
      });
      if (!Number.isFinite(stepCost)) {
        return;
      }
      const nextDistance = priority + stepCost;
      if (nextDistance < distances[next]) {
        distances[next] = nextDistance;
        heap.push(next, nextDistance);
      }
    });
  }

  return distances;
}

function buildMstEdges(nodeCount, edges) {
  const sorted = [...edges].sort((a, b) => a.cost - b.cost);
  const uf = new UnionFind(nodeCount);
  const mst = [];

  for (const edge of sorted) {
    if (!uf.union(edge.i, edge.j)) {
      continue;
    }
    mst.push(edge);
    if (mst.length >= nodeCount - 1) {
      break;
    }
  }

  return mst;
}

function materializeRoadEdge({
  settlements,
  roads,
  roadUsage,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  edge,
  type,
  blockedRoadCells,
  sharedAllowedCells,
}) {
  const fromSettlement = settlements[edge.i];
  const toSettlement = settlements[edge.j];
  if (!fromSettlement || !toSettlement) {
    return false;
  }

  const cells = findPathAStar({
    from: fromSettlement.cell,
    to: toSettlement.cell,
    width,
    height,
    size,
    baseCost,
    riverStrength,
    roadUsage,
    blockedRoadCells,
    sharedAllowedCells,
  });
  if (!cells || cells.length < 2) {
    return false;
  }

  const inserted = pushRoadRecord(roads, {
    type,
    settlementId: toSettlement.id,
    fromSettlementId: fromSettlement.id,
    cells,
    cost: edge.cost,
  });
  if (!inserted) {
    return false;
  }

  if (type === "road") {
    incrementRoadUsage(roadUsage, cells);
    for (const cell of cells) {
      if (!sharedAllowedCells?.has(cell)) {
        blockedRoadCells[cell] = 1;
      }
    }
  }

  return true;
}

function findPathAStar({
  from,
  to,
  width,
  height,
  size,
  baseCost,
  riverStrength,
  roadUsage,
  blockedRoadCells,
  sharedAllowedCells,
}) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return null;
  }

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const open = new MinHeap();
  gScore[from] = 0;
  open.push(from, heuristic(from, to, width));

  while (open.size > 0) {
    const { index: current } = open.pop();
    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny, ox, oy) => {
      const next = ny * width + nx;
      if (
        blockedRoadCells &&
        blockedRoadCells[next] > 0 &&
        !sharedAllowedCells?.has(next)
      ) {
        return;
      }
      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const stepCost = computeRoadStepCost({
        from: current,
        to: next,
        diagonal,
        baseCost,
        riverStrength,
        roadUsage,
        width,
        height,
      });
      if (!Number.isFinite(stepCost)) {
        return;
      }

      const tentative = gScore[current] + stepCost;
      if (tentative >= gScore[next] - 1e-9) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      const fScore = tentative + heuristic(next, to, width);
      open.push(next, fScore);
    });
  }

  return null;
}

function heuristic(cell, goal, width) {
  const [x0, y0] = coordsOf(cell, width);
  const [x1, y1] = coordsOf(goal, width);
  return Math.hypot(x1 - x0, y1 - y0) * 0.88;
}

function reconstructPath(cameFrom, end) {
  const path = [end];
  let current = end;

  while (cameFrom[current] >= 0) {
    current = cameFrom[current];
    if (path[path.length - 1] !== current) {
      path.push(current);
    }
  }

  path.reverse();
  return path;
}

function computeRoadStepCost({
  from,
  to,
  diagonal,
  baseCost,
  riverStrength,
  roadUsage,
  width,
  height,
}) {
  if (!Number.isFinite(baseCost[from]) || !Number.isFinite(baseCost[to])) {
    return Number.POSITIVE_INFINITY;
  }

  const stepLength = diagonal ? 1.4142 : 1;
  let cost = (baseCost[from] + baseCost[to]) * 0.5 * stepLength;

  const river = Math.max(riverStrength[from] ?? 0, riverStrength[to] ?? 0);
  if (river > RIVER_COST_THRESHOLD) {
    cost += RIVER_BASE_PENALTY + clamp(river, 0, 4) * RIVER_STRENGTH_SCALE;
  }

  if (roadUsage) {
    const fromOnRoad = roadUsage[from] > 0;
    const toOnRoad = roadUsage[to] > 0;

    if (toOnRoad) {
      cost *= fromOnRoad ? ON_ROAD_COST_FACTOR : TOUCHING_ROAD_COST_FACTOR;
    } else if (fromOnRoad) {
      cost *= TOUCHING_ROAD_COST_FACTOR;
    }

    if (!toOnRoad && isNearRoadCell(to, roadUsage, width, height)) {
      cost += PARALLEL_ROAD_PENALTY;
    }
  }

  return cost;
}

function isNearRoadCell(cell, roadUsage, width, height) {
  const x = cell % width;
  const y = Math.floor(cell / width);

  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (roadUsage[ny * width + nx] > 0) {
        return true;
      }
    }
  }

  return false;
}

function connectSettlementComponentsBySeaRoutes({
  settlements,
  roads,
  terrain,
}) {
  const uf = new UnionFind(settlements.length);

  for (const road of roads) {
    if (road.fromSettlementId == null || road.settlementId == null) {
      continue;
    }
    uf.union(road.fromSettlementId, road.settlementId);
  }

  while (countDistinctRoots(uf, settlements.length) > 1) {
    let best = null;

    for (let i = 0; i < settlements.length; i += 1) {
      for (let j = i + 1; j < settlements.length; j += 1) {
        if (uf.find(i) === uf.find(j)) {
          continue;
        }
        const a = settlements[i];
        const b = settlements[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || dist < best.dist) {
          best = { i, j, dist };
        }
      }
    }

    if (!best) {
      break;
    }

    const from = settlements[best.i];
    const to = settlements[best.j];
    const routeCells =
      findSeaRoutePath(terrain, from.cell, to.cell) ??
      rasterLineCells(from.cell, to.cell, terrain.width);
    if (routeCells.length < 2) {
      uf.union(best.i, best.j);
      continue;
    }

    const inserted = pushRoadRecord(roads, {
      type: "sea-route",
      settlementId: to.id,
      fromSettlementId: from.id,
      cells: routeCells,
      cost: best.dist,
    });

    uf.union(best.i, best.j);
    if (!inserted) {
      continue;
    }
  }
}

function findSeaRoutePath(terrain, from, to) {
  const { width, height, size, isLand } = terrain;

  const gScore = new Float64Array(size);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size);
  cameFrom.fill(-1);

  const open = new MinHeap();
  gScore[from] = 0;
  open.push(from, heuristic(from, to, width));

  while (open.size > 0) {
    const { index: current } = open.pop();
    if (current === to) {
      return reconstructPath(cameFrom, current);
    }

    const [x, y] = coordsOf(current, width);
    forEachNeighbor(width, height, x, y, false, (nx, ny, ox, oy) => {
      const next = ny * width + nx;
      const diagonal = Math.abs(ox) + Math.abs(oy) === 2;
      const stepLength = diagonal ? 1.4142 : 1;

      const nextIsEndpoint = next === from || next === to;
      const traversable = !isLand[next] || nextIsEndpoint;
      if (!traversable) {
        return;
      }

      let stepCost = stepLength;
      if (isLand[next] && !nextIsEndpoint) {
        stepCost += 9.5;
      }
      const tentative = gScore[current] + stepCost;
      if (tentative >= gScore[next] - 1e-9) {
        return;
      }

      cameFrom[next] = current;
      gScore[next] = tentative;
      open.push(next, tentative + heuristic(next, to, width));
    });
  }

  return null;
}

function rasterLineCells(fromCell, toCell, width) {
  const [x0Start, y0Start] = coordsOf(fromCell, width);
  const [x1, y1] = coordsOf(toCell, width);

  let x0 = x0Start;
  let y0 = y0Start;
  const cells = [];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    cells.push(y0 * width + x0);
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return dedupeConsecutive(cells);
}

function pushRoadRecord(roads, { type = "road", settlementId, fromSettlementId, cells, cost }) {
  const canonicalCells = dedupeConsecutive(cells);
  if (!canonicalCells || canonicalCells.length < 2) {
    return false;
  }

  roads.push({
    id: roads.length,
    type,
    settlementId,
    fromSettlementId,
    cells: canonicalCells,
    length: canonicalCells.length,
    cost,
  });
  return true;
}

function incrementRoadUsage(roadUsage, cells) {
  for (const cell of cells) {
    roadUsage[cell] = Math.min(roadUsage[cell] + 1, MAX_ROAD_USAGE);
  }
}

function rebuildLandRoadUsage(roadUsage, roads) {
  roadUsage.fill(0);
  for (const road of roads) {
    if ((road?.type ?? "road") !== "road") {
      continue;
    }
    incrementRoadUsage(roadUsage, road.cells ?? []);
  }
}

function removeDegenerateRoadsInPlace(roads) {
  let write = 0;
  for (const road of roads) {
    if (!road || !Array.isArray(road.cells) || road.cells.length < 2) {
      continue;
    }
    road.id = write;
    road.length = road.cells.length;
    roads[write] = road;
    write += 1;
  }
  roads.length = write;
}

function dedupeConsecutive(cells) {
  if (!cells?.length) {
    return [];
  }
  const deduped = [cells[0]];
  for (let i = 1; i < cells.length; i += 1) {
    if (cells[i] !== deduped[deduped.length - 1]) {
      deduped.push(cells[i]);
    }
  }
  return deduped;
}

function countSettlementComponents(settlementCount, roads) {
  if (settlementCount <= 0) {
    return 0;
  }

  const uf = new UnionFind(settlementCount);
  for (const road of roads) {
    if (road.fromSettlementId == null || road.settlementId == null) {
      continue;
    }
    uf.union(road.fromSettlementId, road.settlementId);
  }

  return countDistinctRoots(uf, settlementCount);
}

function countDistinctRoots(uf, count) {
  const roots = new Set();
  for (let i = 0; i < count; i += 1) {
    roots.add(uf.find(i));
  }
  return roots.size;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = new Uint8Array(size);
  }

  find(x) {
    let node = x;
    while (this.parent[node] !== node) {
      this.parent[node] = this.parent[this.parent[node]];
      node = this.parent[node];
    }
    return node;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }

    return true;
  }
}

class MinHeap {
  constructor() {
    this.values = [];
  }

  get size() {
    return this.values.length;
  }

  push(index, priority) {
    const node = { index, priority };
    this.values.push(node);
    this.bubbleUp(this.values.length - 1);
  }

  pop() {
    if (this.values.length === 0) {
      return null;
    }
    const top = this.values[0];
    const end = this.values.pop();
    if (this.values.length > 0 && end) {
      this.values[0] = end;
      this.sinkDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    let i = index;
    while (i > 0) {
      const parentIndex = Math.floor((i - 1) / 2);
      if (this.values[parentIndex].priority <= this.values[i].priority) {
        break;
      }
      [this.values[parentIndex], this.values[i]] = [
        this.values[i],
        this.values[parentIndex],
      ];
      i = parentIndex;
    }
  }

  sinkDown(index) {
    let i = index;
    const length = this.values.length;

    while (true) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;

      if (
        left < length &&
        this.values[left].priority < this.values[smallest].priority
      ) {
        smallest = left;
      }
      if (
        right < length &&
        this.values[right].priority < this.values[smallest].priority
      ) {
        smallest = right;
      }

      if (smallest === i) {
        break;
      }

      [this.values[i], this.values[smallest]] = [
        this.values[smallest],
        this.values[i],
      ];
      i = smallest;
    }
  }
}
