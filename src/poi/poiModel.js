// Re-export shim — new code should import from ../nodeModel.js
export {
  NODE_MARKERS as POI_MARKERS,
  normalizeNodeMarker as normalizePoiMarker,
  describeNode as describePoi,
  getNodeTitle as getPoiTitle,
} from "../nodeModel.js";
