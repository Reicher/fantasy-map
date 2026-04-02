import { coordsOf, segmentPointDistance } from "../utils.js";

export function riverDistanceInCells(world, cellX, cellY) {
  let best = null;
  for (const river of world.features?.rivers ?? world.hydrology.rivers) {
    for (let index = 0; index < river.cells.length - 1; index += 1) {
      const [ax, ay] = coordsOf(river.cells[index], world.terrain.width);
      const [bx, by] = coordsOf(river.cells[index + 1], world.terrain.width);
      const distance = segmentPointDistance(cellX, cellY, ax, ay, bx, by);
      if (!best || distance < best.distance) {
        best = {
          river,
          distance,
          stepsToMouth: Math.max(0, river.cells.length - 1 - index)
        };
      }
    }
  }
  return best;
}
