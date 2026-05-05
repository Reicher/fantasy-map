import { describe, expect, it } from "vitest";
import { buildJourneyStrip } from "./journeyStrip";

function buildAlternatingBiomeTravel(segmentCount = 12, segmentDistance = 1) {
  const nearSegments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    nearSegments.push({
      biome: index % 2 === 0 ? "desert" : "forest",
      distance: segmentDistance,
      isSnow: false,
    });
  }

  return {
    totalLength: segmentCount * segmentDistance,
    biomeBandSegments: {
      near: { segments: nearSegments },
      mid: { segments: nearSegments },
      far: { segments: nearSegments },
    },
    biomeSegments: nearSegments,
  };
}

function findNonBlendSegmentAtX(segments, x) {
  for (const segment of segments) {
    if (!segment || segment.isBlend) continue;
    const start = Number(segment.stripX);
    const end = start + Number(segment.stripWidth);
    if (x >= start && x <= end) {
      return segment;
    }
  }
  return null;
}

function countTreesInSegment(trees, segment) {
  const start = Number(segment.stripX);
  const end = start + Number(segment.stripWidth);
  let count = 0;
  for (const tree of trees) {
    if (tree.stripX >= start && tree.stripX <= end) {
      count += 1;
    }
  }
  return count;
}

describe("journeyStrip vegetation placement", () => {
  it("keeps ground trees away from frequent biome seams", () => {
    const travel = buildAlternatingBiomeTravel();
    const strip = buildJourneyStrip(travel, 1280, 720);
    const groundSegments = strip.layerSegments.ground.filter((segment) => !segment?.isBlend);

    expect(strip.groundTrees.length).toBeGreaterThan(0);

    const seamXs = [];
    for (let index = 0; index + 1 < groundSegments.length; index += 1) {
      const left = groundSegments[index];
      const right = groundSegments[index + 1];
      if (!left || !right) continue;
      if (left.biomeKey === right.biomeKey && Boolean(left.isSnow) === Boolean(right.isSnow)) {
        continue;
      }
      seamXs.push(left.stripX + left.stripWidth);
    }

    expect(seamXs.length).toBeGreaterThan(0);

    for (const seamX of seamXs) {
      let closest = Number.POSITIVE_INFINITY;
      for (const tree of strip.groundTrees) {
        const distance = Math.abs(tree.stripX - seamX);
        if (distance < closest) {
          closest = distance;
        }
      }
      expect(closest).toBeGreaterThanOrEqual(24);
    }
  });

  it("keeps cacti inside desert segments with robust seam buffer", () => {
    const travel = buildAlternatingBiomeTravel();
    const strip = buildJourneyStrip(travel, 1280, 720);
    const groundSegments = strip.layerSegments.ground;
    const cactusTrees = strip.groundTrees.filter((tree) => tree.treeFamily === "cactus");

    expect(cactusTrees.length).toBeGreaterThan(0);

    for (const cactus of cactusTrees) {
      const segment = findNonBlendSegmentAtX(groundSegments, cactus.stripX);
      expect(segment).toBeTruthy();
      expect(segment?.biomeKey).toBe("desert");

      const segmentIndex = groundSegments.findIndex((entry) => entry === segment);
      const leftNeighbor = segmentIndex > 0 ? groundSegments[segmentIndex - 1] : null;
      const rightNeighbor = segmentIndex + 1 < groundSegments.length
        ? groundSegments[segmentIndex + 1]
        : null;
      const segmentStart = Number(segment?.stripX ?? 0);
      const segmentEnd = segmentStart + Number(segment?.stripWidth ?? 0);

      if (leftNeighbor && !leftNeighbor.isBlend && leftNeighbor.biomeKey !== segment?.biomeKey) {
        expect(cactus.stripX - segmentStart).toBeGreaterThanOrEqual(28);
      }
      if (rightNeighbor && !rightNeighbor.isBlend && rightNeighbor.biomeKey !== segment?.biomeKey) {
        expect(segmentEnd - cactus.stripX).toBeGreaterThanOrEqual(28);
      }
    }
  });

  it("caps per-segment tree density when biome switches are frequent", () => {
    const travel = buildAlternatingBiomeTravel();
    const strip = buildJourneyStrip(travel, 1280, 720);
    const groundSegments = strip.layerSegments.ground.filter((segment) => !segment?.isBlend);

    const interiorAlternatingSegments = [];
    for (let index = 1; index + 1 < groundSegments.length; index += 1) {
      const segment = groundSegments[index];
      const left = groundSegments[index - 1];
      const right = groundSegments[index + 1];
      if (!segment || !left || !right) continue;
      if (
        left.biomeKey !== segment.biomeKey &&
        right.biomeKey !== segment.biomeKey
      ) {
        interiorAlternatingSegments.push(segment);
      }
    }

    expect(interiorAlternatingSegments.length).toBeGreaterThan(0);

    for (const segment of interiorAlternatingSegments) {
      const count = countTreesInSegment(strip.groundTrees, segment);
      expect(count).toBeLessThanOrEqual(3);
    }
  });
});
