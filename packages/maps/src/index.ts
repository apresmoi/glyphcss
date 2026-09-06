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
export { glyphMapDedupeAttributions, GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "./attribution";

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
export { glyphMapProjectionTransition } from "./transition";
export type { GlyphMapProjectionTransitionOptions } from "./transition";
export { glyphMapDecodeGeoTileInt16, glyphMapGeoTileElevationAt, glyphMapGeoTileElevationRange, glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian } from "./tile";
export type { GlyphMapGeoTile, GlyphMapGeoTileInt16Meta } from "./tile";
export { glyphMapPolygons } from "./mesh";
export type { GlyphMapPolygonsOptions } from "./mesh";

export { glyphMapDegreesPerCell, glyphMapTargetLOD, glyphMapTileRangeForLevel } from "./provider";
export type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
export { glyphMapCuratedProvider } from "./curated";
export type { GlyphMapCuratedRasterTiles } from "./curated";

// ── Vector core (MAPS.md §13 slice 5) ──────────────────────────────────
export {
  decodeGlyphMapTopoJsonArcs,
  glyphMapTopoJsonFeatures,
} from "./vector/topology";
export type { TopoJsonGeometry, TopoJsonTopology, TopoJsonTransform } from "./vector/topology";
export { glyphMapAreaThresholdDeg, glyphMapCellEpsilonDeg, glyphMapSimplifyArc, glyphMapSimplifyArcs } from "./vector/simplify";
export type { GlyphMapLonLat } from "./vector/simplify";
export { glyphMapClipPolygonGroup, glyphMapClipPolyline, glyphMapSplitAtAntimeridian } from "./vector/clip";
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
export { glyphMapDecodeMVT, glyphMapPMTilesProvider } from "./vector/pmtiles";
export type { GlyphMapPMTilesOptions } from "./vector/pmtiles";
export type { GlyphMapCuratedVectorTiles } from "./vector/curated";
export type {
  GlyphMapVectorFeature,
  GlyphMapVectorFeatureCollection,
  GlyphMapVectorProvider,
  GlyphMapVectorSource,
  GlyphMapVectorTile,
} from "./vector/types";
export {
  stampGlyphMapContour,
  stampGlyphMapContourLabels,
  stampGlyphMapPolyline,
  GLYPH_MAP_STROKE_DEPTH_BIAS,
  GLYPH_MAP_STROKE_DEPTH_SLOPE_SCALE,
  GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS,
  GLYPH_MAP_CONTOUR_LABEL_MIN_HORIZONTALITY,
  GLYPH_MAP_CONTOUR_LABEL_MIN_SUPPORT,
  GLYPH_MAP_CONTOUR_LABEL_SCORE_BUCKETS,
} from "./stroke";
export {
  GLYPH_MAP_NIGHT_LEVELS,
  GLYPH_MAP_NIGHT_OPACITY,
  GLYPH_MAP_SUN_TWILIGHT_DEG,
  glyphMapDaylightFactor,
  glyphMapSolarAltitudeSin,
  glyphMapSubsolarPoint,
  glyphMapSunDirection,
  stampGlyphMapNight,
} from "./sun";
export type { GlyphMapNightOptions, GlyphMapSolarPosition } from "./sun";
export type {
  GlyphMapContourLabelCandidate,
  GlyphMapContourLabelOptions,
  GlyphMapContourLabelPlan,
  GlyphMapContourOptions,
  GlyphMapStampOptions,
  GlyphMapStrokeVertex,
} from "./stroke";
export {
  glyphMapDeclutterLabels,
  glyphMapPointHeatmap,
  glyphMapVectorCullWalls,
  glyphMapVectorMesh,
  glyphMapVectorPolygons,
  type GlyphMapVectorMesh,
  type GlyphMapVectorMeshOptions,
  type GlyphMapVectorWall,
} from "./layers";
export type { GlyphMapLabelCandidate } from "./layers";

export { createGlyphMap, glyphMapContourIndexLevels, glyphMapContourIntervalLevels, glyphMapHeadlightDirection, glyphMapNormalizeWheelDelta, GLYPH_MAP_CONTOUR_LABEL_EVERY, GLYPH_MAP_CONTOUR_LABEL_PAD_X, GLYPH_MAP_CONTOUR_LABEL_PAD_Y, GLYPH_MAP_SUN_TICK_MS, GLYPH_MAP_WHEEL_DELTA_MODE_SCALE, GLYPH_MAP_WHEEL_ZOOM_K, GLYPH_MAP_FLY_TO_DEFAULT_MS, GLYPH_MAP_FLY_TO_MAX_BOW } from "./widget";
export type {
  GlyphMapBackgroundLayer,
  GlyphMapClickEvent,
  GlyphMapContourLayer,
  GlyphMapContourSource,
  GlyphMapCircleLayer,
  GlyphMapEvent,
  GlyphMapEventHandler,
  GlyphMapFlyToOptions,
  GlyphMapFlyToTarget,
  GlyphMapHandle,
  GlyphMapLayer,
  GlyphMapFillLayer,
  GlyphMapFillExtrusionLayer,
  GlyphMapHeatmapLayer,
  GlyphMapKeyLightMode,
  GlyphMapLineLayer,
  GlyphMapLoadEvent,
  GlyphMapMarkerHandle,
  GlyphMapMarkerOptions,
  GlyphMapOptions,
  GlyphMapModelLayer,
  GlyphMapProjectResult,
  GlyphMapRasterLayer,
  GlyphMapRasterSource,
  GlyphMapSetProjectionOptions,
  GlyphMapSunEvent,
  GlyphMapSunMode,
  GlyphMapSunOptions,
  GlyphMapSunState,
  GlyphMapSymbolLayer,
  GlyphMapViewEvent,
} from "./widget";
