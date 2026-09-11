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
export { glyphMapDedupeAttributions, GLYPH_MAP_OPENFREEMAP_ATTRIBUTION, GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "./attribution";

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
  glyphMapTrueScaleElevation,
} from "./projection";
export type { GlyphMapD3RawOptions, GlyphMapD3RawProjection, GlyphMapProjection } from "./projection";
export { glyphMapProjectionTransition } from "./transition";
export type { GlyphMapProjectionTransitionOptions } from "./transition";
export { glyphMapDecodeGeoTileInt16, glyphMapGeoTileElevationAt, glyphMapGeoTileElevationRange, glyphMapGeoTileVertexLonLat, splitGlyphMapGeoTileAtAntimeridian } from "./tile";
export type { GlyphMapGeoTile, GlyphMapGeoTileInt16Meta } from "./tile";
export { glyphMapPolygons } from "./mesh";
export type { GlyphMapPolygonsOptions } from "./mesh";

export { glyphMapDegreesPerCell, glyphMapEqualAngleTileRange, glyphMapFinestLOD, glyphMapTargetLOD, glyphMapTileRangeForLevel } from "./provider";
export type { GlyphMapProvider, GlyphMapProviderZoomLevel, GlyphMapTileIndexRange, GlyphMapTileRangeStrategy } from "./provider";
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
export {
  GLYPH_MAP_MERCATOR_MAX_LAT,
  glyphMapMercatorTileBounds,
  glyphMapMercatorTileIndex,
  glyphMapMercatorTileRange,
  glyphMapMercatorZooms,
} from "./vector/mercator";
export {
  GLYPH_MAP_OPENFREEMAP_MAX_ZOOM,
  GLYPH_MAP_OPENFREEMAP_MIN_ZOOM,
  GLYPH_MAP_OPENFREEMAP_TILE_URL,
  glyphMapOpenFreeMapProvider,
} from "./vector/openfreemap";
export type { GlyphMapOpenFreeMapOptions } from "./vector/openfreemap";
export {
  GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION,
  GLYPH_MAP_OPENMAPTILES_DATUM_WATER_CLASSES,
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS,
  glyphMapOpenMapTilesAdminLevel,
  glyphMapOpenMapTilesBrunnel,
  glyphMapOpenMapTilesClass,
  glyphMapOpenMapTilesFeatureFilter,
  glyphMapOpenMapTilesFlag,
  glyphMapOpenMapTilesLayers,
  glyphMapOpenMapTilesWaterDrape,
} from "./vector/openmaptiles";
export type {
  GlyphMapOpenMapTilesFeatureFilterOptions,
  GlyphMapOpenMapTilesGeometry,
  GlyphMapOpenMapTilesLayerSpec,
  GlyphMapOpenMapTilesLayersOptions,
  GlyphMapOpenMapTilesSourceLayer,
} from "./vector/openmaptiles";
export { glyphMapDecodeMVT, glyphMapPMTilesBufferSource, glyphMapPMTilesProvider } from "./vector/pmtiles";
export type { GlyphMapPMTilesOptions, GlyphMapPMTilesProvider, GlyphMapPMTilesReader } from "./vector/pmtiles";
export {
  GLYPH_MAP_PROTOMAPS_LAYERS,
  GLYPH_MAP_PROTOMAPS_SOURCE_LAYERS,
  glyphMapProtomapsExtract,
  glyphMapProtomapsFeatureFilter,
  glyphMapProtomapsKind,
  glyphMapProtomapsLayers,
} from "./vector/protomaps";
export type {
  GlyphMapProtomapsExtract,
  GlyphMapProtomapsExtractOptions,
  GlyphMapProtomapsFeatureFilterOptions,
  GlyphMapProtomapsLayerSpec,
  GlyphMapProtomapsLayersOptions,
  GlyphMapProtomapsSourceLayer,
} from "./vector/protomaps";
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
  stampGlyphMapContourGeometry,
  stampGlyphMapContourLabels,
  stampGlyphMapPolyline,
  GLYPH_MAP_STROKE_DEPTH_CURVATURE_SCALE,
  GLYPH_MAP_CONTOUR_LABEL_GAP_CELLS,
  GLYPH_MAP_CONTOUR_LABEL_MIN_HORIZONTALITY,
  GLYPH_MAP_CONTOUR_LABEL_MIN_SUPPORT,
  GLYPH_MAP_CONTOUR_LABEL_SCORE_BUCKETS,
  glyphMapForeignOwned,
  glyphMapSurfaceOccludes,
} from "./stroke";
export {
  glyphMapAsciiLabel,
  glyphMapPointCells,
  stampGlyphMapPoint,
  stampGlyphMapPointLabel,
  GLYPH_MAP_POINT_COVERAGE_SAMPLES,
  GLYPH_MAP_POINT_MAX_SIZE_ROWS,
  GLYPH_MAP_POINT_MIN_COVERAGE,
  GLYPH_MAP_POINT_RAMP,
} from "./point";
export type { GlyphMapPointCell, GlyphMapPointMark, GlyphMapPointStampOptions } from "./point";
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
export { glyphMapMarchContourGrid, glyphMapMarchContourMosaic } from "./contourGeometry";
export type { GlyphMapContourSampleGrid, GlyphMapContourSegment } from "./contourGeometry";
export type {
  GlyphMapContourGeometryOptions,
  GlyphMapContourPolyline,
  GlyphMapContourLabelCandidate,
  GlyphMapContourLabelOptions,
  GlyphMapContourLabelPlan,
  GlyphMapContourOptions,
  GlyphMapStampOptions,
  GlyphMapStrokeVertex,
} from "./stroke";
export {
  GLYPH_MAP_LABEL_ANCHORS,
  GLYPH_MAP_LABEL_WRAP_CELLS,
  GLYPH_MAP_LABEL_WRAP_MAX_LINES,
  glyphMapDeclutterLabels,
  glyphMapLabelAnchorFraction,
  glyphMapLabelAnchorPoint,
  glyphMapWrapLabel,
  glyphMapPointHeatmap,
  glyphMapVectorCullWalls,
  glyphMapVectorMarkWalls,
  glyphMapVectorMesh,
  glyphMapVectorPolygons,
  type GlyphMapVectorMesh,
  type GlyphMapVectorMeshOptions,
  type GlyphMapVectorWall,
} from "./layers";
export type { GlyphMapLabelAnchor, GlyphMapLabelCandidate } from "./layers";
export {
  glyphMapFacadeSuitsBand,
  glyphMapFacadeTexture,
  glyphMapFacadeTiles,
  glyphMapFeatureSeed,
  glyphMapFootprintWidthMetres,
  glyphMapMetresBetween,
  glyphMapVaryColor,
  GLYPH_MAP_FACADE_BAY_METRES,
  GLYPH_MAP_FACADE_FLOOR_METRES,
  GLYPH_MAP_FACADE_MAX_SLENDERNESS,
  GLYPH_MAP_FACADE_TEXTURE,
  type GlyphMapFacadeOptions,
} from "./facade";

export {
  GLYPH_MAP_WALK_EYE_HEIGHT_M,
  GLYPH_MAP_WALK_FAR_M,
  GLYPH_MAP_WALK_FOV_DEG,
  GLYPH_MAP_WALK_HORIZON_TILT_DEG,
  GLYPH_MAP_WALK_KEYS,
  GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG,
  GLYPH_MAP_WALK_MAX_PITCH_DEG,
  GLYPH_MAP_WALK_NEAR_M,
  GLYPH_MAP_WALK_RUN_MULTIPLIER,
  GLYPH_MAP_WALK_SPEED_M_PER_S,
  glyphMapWalkAxis,
  glyphMapWalkAxisForKey,
  glyphMapWalkLens,
  glyphMapWalkSpan,
  glyphMapWalkBoundsWithinHorizon,
  glyphMapWalkStep,
  GLYPH_MAP_WALL_HORIZON_SLACK_M,
  glyphMapWalkDistanceM,
  glyphMapWalkHorizonTest,
  glyphMapWalkWithinHorizon,
  resolveGlyphMapWalkOptions,
} from "./walk";
export type {
  GlyphMapResolvedWalkOptions,
  GlyphMapWalkAxis,
  GlyphMapWalkBounds,
  GlyphMapWalkLens,
  GlyphMapWalkOptions,
  GlyphMapWalkState,
} from "./walk";
export {
  GLYPH_MAP_SKY_BANDS,
  GLYPH_MAP_SKY_DAY,
  GLYPH_MAP_SKY_DAY_DEG,
  GLYPH_MAP_SKY_DUSK,
  GLYPH_MAP_SKY_MESH_COLOR,
  GLYPH_MAP_SKY_NIGHT,
  GLYPH_MAP_SKY_NIGHT_DEG,
  GLYPH_MAP_SKY_RADIUS_FRACTION,
  GLYPH_MAP_SKY_RAMP,
  GLYPH_MAP_SKY_RINGS,
  GLYPH_MAP_SKY_SEGMENTS,
  GLYPH_MAP_SKY_SUN_DISC_DEG,
  GLYPH_MAP_SKY_SUN_GLOW_DEG,
  glyphMapSkyDome,
  glyphMapSkyEffect,
  glyphMapSkyPalette,
  glyphMapSkyParamsFor,
  glyphMapSkyRecentreDistanceM,
  glyphMapSkySunAltitude,
} from "./sky";
export type {
  GlyphMapSkyDome,
  GlyphMapSkyDomeOptions,
  GlyphMapSkyPalette,
  GlyphMapSkyParams,
} from "./sky";
export {
  GLYPH_MAP_WALK_BODY_RADIUS_M,
  GLYPH_MAP_WALK_COLLISION_CELL_M,
  createGlyphMapWalkCollisionIndex,
  glyphMapWalkFootprints,
  glyphMapWalkResolveStep,
} from "./walkCollision";
export type {
  GlyphMapWalkCollisionIndex,
  GlyphMapWalkFootprint,
  GlyphMapWalkFootprintSource,
} from "./walkCollision";
export { createGlyphMap, glyphMapContourIndexLevels, glyphMapContourIntervalLevels, glyphMapHeadlightDirection, glyphMapNormalizeWheelDelta, GLYPH_MAP_CONTOUR_LABEL_EVERY, GLYPH_MAP_CONTOUR_LABEL_PAD_X, GLYPH_MAP_CONTOUR_LABEL_PAD_Y, GLYPH_MAP_SUN_TICK_MS, GLYPH_MAP_WHEEL_DELTA_MODE_SCALE, GLYPH_MAP_WHEEL_ZOOM_K, GLYPH_MAP_FLY_TO_DEFAULT_MS, GLYPH_MAP_FLY_TO_MAX_BOW, GLYPH_MAP_MAX_TILT, GLYPH_MAP_TILT_DRAG_DEG_PER_PX, GLYPH_MAP_BEARING_DRAG_DEG_PER_PX, GLYPH_MAP_TOUCH_ZOOM_THRESHOLD_LEVELS, GLYPH_MAP_TOUCH_ROTATE_THRESHOLD_PX, GLYPH_MAP_TOUCH_TILT_THRESHOLD_PX, GLYPH_MAP_TOUCH_SINGLE_TOUCH_GRACE_MS, GLYPH_MAP_TAP_DRAG_ZOOM_LEVELS_PER_PX, GLYPH_MAP_TAP_ZOOM_LEVELS, GLYPH_MAP_DOUBLE_TAP_MAX_MS, GLYPH_MAP_DOUBLE_TAP_MAX_MOVE_PX, GLYPH_MAP_TAP_MAX_MS, GLYPH_MAP_POINT_HIT_CELLS, GLYPH_MAP_SHADOW_LIFT, GLYPH_MAP_FILL_DRAPES, glyphMapNormalizeBearing } from "./widget";
export type {
  GlyphMapBackgroundLayer,
  GlyphMapClickEvent,
  GlyphMapContourLayer,
  GlyphMapContourSource,
  GlyphMapCircleLayer,
  GlyphMapGlyphLayer,
  GlyphMapEvent,
  GlyphMapEventHandler,
  GlyphMapFeatureFilter,
  GlyphMapFlyToOptions,
  GlyphMapFlyToTarget,
  GlyphMapHandle,
  GlyphMapLayer,
  GlyphMapFillLayer,
  GlyphMapFillDrape,
  GlyphMapFillDrapeFor,
  GlyphMapFillExtrusionLayer,
  GlyphMapGroundElevation,
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
  GlyphMapShadowOptions,
  GlyphMapSunEvent,
  GlyphMapSunMode,
  GlyphMapSunOptions,
  GlyphMapSunState,
  GlyphMapSymbolLayer,
  GlyphMapViewEvent,
} from "./widget";
