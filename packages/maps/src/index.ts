// @glyphcss/maps — geographic raster data → glyphcss.
//
// This entry point is pure and browser-safe: no `fs`, no native modules.
// Anything that touches the filesystem lives behind `@glyphcss/maps/node`.

export type {
  GlyphMapArtifact,
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

export { glyphMapBounds, viewBounds } from "./view";
export { sampleGlyphMapField, glyphMapSamplerId } from "./sample";
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
