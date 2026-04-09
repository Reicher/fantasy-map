import { ALPHA, rgbToRgbaString } from "../palette/colorSystem.js";

const rgba = (rgb, alpha) => rgbToRgbaString(rgb, alpha);

export const LABEL_COLORS = {
  lake: {
    stroke: rgba([237, 233, 224], ALPHA.rich),
    fill: rgba([71, 92, 109], ALPHA.rich),
  },
  poi: {
    stroke: rgba([243, 234, 214], ALPHA.surface),
    fill: rgba([58, 45, 29], ALPHA.surface),
  },
  mountainRegion: {
    fill: rgba([88, 78, 68], ALPHA.label),
    stroke: rgba([244, 235, 214], ALPHA.rich),
  },
  biome: {
    forest: {
      fill: rgba([64, 79, 50], ALPHA.rich),
      stroke: rgba([244, 238, 224], ALPHA.opaqueSoft),
    },
    rainforest: {
      fill: rgba([48, 66, 38], ALPHA.label),
      stroke: rgba([244, 238, 224], ALPHA.opaqueSoft),
    },
    desert: {
      fill: rgba([124, 92, 50], ALPHA.rich),
      stroke: rgba([244, 235, 214], ALPHA.rich),
    },
    tundra: {
      fill: rgba([88, 90, 98], ALPHA.rich),
      stroke: rgba([245, 241, 233], ALPHA.label),
    },
    highlands: {
      fill: rgba([92, 69, 49], ALPHA.rich),
      stroke: rgba([244, 235, 214], ALPHA.rich),
    },
    plains: {
      fill: rgba([74, 58, 37], ALPHA.rich),
      stroke: rgba([244, 235, 214], ALPHA.rich),
    },
  },
};

export const MOUNTAIN_COLORS = {
  gradient: {
    snow: {
      top: rgba([246, 244, 239], ALPHA.opaqueHard),
      mid: rgba([235, 233, 228], ALPHA.surface),
      bottom: rgba([229, 227, 222], ALPHA.label),
    },
    rock: {
      top: rgba([134, 128, 121], ALPHA.opaqueSoft),
      mid: rgba([114, 108, 102], ALPHA.surface),
      bottom: rgba([121, 115, 108], ALPHA.strong),
    },
  },
  ridge: {
    snow: rgba([107, 102, 94], ALPHA.rich),
    rock: rgba([64, 56, 47], ALPHA.surface),
  },
  detail: {
    snow: rgba([186, 183, 177], ALPHA.medium),
    rock: rgba([116, 112, 108], ALPHA.medium),
  },
  snowCap: rgba([245, 241, 233], ALPHA.opaqueSoft),
};
