// Re-export shim — new code should import from ./nodesLayer.js
export {
  drawNodes as drawCities,
  drawPlayerMarker,
  drawNodeTargetHalo as drawCityTargetHalo,
  getNodeZoomScale as getCityZoomScale,
} from "./nodesLayer.js";
