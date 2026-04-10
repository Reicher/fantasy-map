// Re-export shim — new code should import from ./nodesLayer.js
export {
  drawNodes as drawSettlements,
  drawPlayerMarker,
  drawNodeTargetHalo as drawSettlementTargetHalo,
  getNodeZoomScale as getSettlementZoomScale,
} from "./nodesLayer.js";
