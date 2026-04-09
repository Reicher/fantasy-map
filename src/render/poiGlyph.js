// Re-export shim — new code should import from ./nodeGlyph.js
export {
  drawNodeMarkerGlyph as drawPoiMarkerGlyph,
  drawNodeIcon as drawPoiIcon,
  drawAbandonedIcon as drawCrashSiteIcon,
  drawGuidepostIcon as drawSignpostIcon,
  drawSettlementIcon,
} from "./nodeGlyph.js";
