// @glyphcss/maps — geographic raster data → glyphcss.
//
// This entry point is pure and browser-safe: no `fs`, no native modules.
// Anything that touches the filesystem lives behind `@glyphcss/maps/node`.

export type {
  GlyphMapArtifact,
  GlyphMapAttribution,
  GlyphMapBands,
  GlyphMapBounds,
  GlyphMapCellContext,
  GlyphMapClassifier,
  GlyphMapCompileOptions,
  GlyphMapField,
  GlyphMapNamedSampler,
  GlyphMapNoDataRule,
  GlyphMapPresentation,
  GlyphMapSampleOptions,
  GlyphMapSampler,
  GlyphMapSamplerFn,
  GlyphMapSource,
  GlyphMapUpsample,
  GlyphMapView,
} from "./types";
export { glyphMapDedupeAttributions } from "./attribution";

export { glyphMapBounds, viewBounds } from "./view";
export { sampleGlyphMapField, glyphMapSamplerId, glyphMapFieldValueAt } from "./sample";
export type { GlyphMapFieldValueAtOptions } from "./sample";
export {
  classifyGlyphMapField,
  glyphMapBreaks,
  glyphMapEqualInterval,
  glyphMapLog,
  glyphMapQuantile,
  GlyphMapClassifiers,
} from "./classify";
export { compileGlyphMap } from "./compile";
export { buildGlyphMapArtifact } from "./artifact";
export { parseGlyphMapAsciiGrid } from "./asciiGrid";
export type { GlyphMapAsciiGridMeta } from "./asciiGrid";

export {
  GLYPH_MAP_EARTH_RADIUS_M,
  glyphMapEquirectangular,
  glyphMapFromD3Raw,
  glyphMapGlobe,
  glyphMapMercator,
  glyphMapOrthographic,
} from "./projection";
export type { GlyphMapD3RawOptions, GlyphMapD3RawProjection, GlyphMapProjection } from "./projection";
export { glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian } from "./tile";
export type { GlyphMapGeoTile } from "./tile";
export { glyphMapPolygons } from "./mesh";
export type { GlyphMapPolygonsOptions } from "./mesh";

export { glyphMapDegreesPerCell, glyphMapTargetLOD } from "./provider";
export type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";

// ── Vector core (MAPS.md §13 slice 5) ──────────────────────────────────
export {
  decodeGlyphMapTopoJsonArcs,
  glyphMapTopoJsonFeatures,
} from "./vector/topology";
export type { TopoJsonGeometry, TopoJsonTopology, TopoJsonTransform } from "./vector/topology";
export { glyphMapAreaThresholdDeg, glyphMapCellEpsilonDeg, glyphMapSimplifyArc, glyphMapSimplifyArcs } from "./vector/simplify";
export type { GlyphMapLonLat } from "./vector/simplify";
export { glyphMapClipPolyline } from "./vector/clip";
export {
  GLYPH_MAP_VECTOR_TILE_EXTENT,
  glyphMapDecodeQuantizedLine,
  glyphMapDequantizePoint,
  glyphMapEncodeQuantizedLine,
  glyphMapQuantizeErrorDeg,
  glyphMapQuantizePoint,
} from "./vector/quantize";
export { glyphMapBuildVectorTile, glyphMapDecodeVectorTile, glyphMapVectorTileBounds } from "./vector/tile";
export type { GlyphMapVectorWireFeature, GlyphMapVectorWireTile } from "./vector/tile";
export { glyphMapCuratedVectorProvider } from "./vector/curated";
export type { GlyphMapCuratedVectorTiles } from "./vector/curated";
export type {
  GlyphMapVectorFeature,
  GlyphMapVectorFeatureCollection,
  GlyphMapVectorProvider,
  GlyphMapVectorSource,
  GlyphMapVectorTile,
} from "./vector/types";
export { stampGlyphMapContour, stampGlyphMapPolyline, GLYPH_MAP_STROKE_DEPTH_BIAS, GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE } from "./stroke";
export type { GlyphMapContourOptions, GlyphMapStampOptions, GlyphMapStrokeVertex } from "./stroke";

export { createGlyphMap, glyphMapContourIntervalLevels } from "./widget";
export type {
  GlyphMapBackgroundLayer,
  GlyphMapClickEvent,
  GlyphMapContourLayer,
  GlyphMapContourSource,
  GlyphMapEvent,
  GlyphMapEventHandler,
  GlyphMapHandle,
  GlyphMapLayer,
  GlyphMapLineLayer,
  GlyphMapLoadEvent,
  GlyphMapMarkerHandle,
  GlyphMapMarkerOptions,
  GlyphMapOptions,
  GlyphMapProjectResult,
  GlyphMapRasterLayer,
  GlyphMapRasterSource,
  GlyphMapViewEvent,
} from "./widget";
