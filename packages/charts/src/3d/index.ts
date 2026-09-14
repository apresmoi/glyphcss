/**
 * `@glyphcss/charts/3d` — 3D chart marks (PLAN-3d.md §5+). A separate
 * subpath from the root `@glyphcss/charts` entry (AGENTS.md's "Charts"):
 * the root entry stays camera-free and rasterizer-free; this one imports
 * `glyphcss`'s scene-object primitives. The root package's `index.ts`
 * never imports from here.
 */
export { glyphChartSurface } from "./surface";
export { glyphChartObject } from "./object";
export {
  resolveGlyphChart3dColorscaleAnchors,
  interpolateGlyphChart3dAnchors,
  glyphChart3dBandIndex,
  glyphChart3dBandColor,
} from "./colorscale";
export { GLYPH_CHART_3D_COLORSCALE_NAMES } from "./types";
export { GLYPH_CHART_3D_VALIDATION_RULES, GLYPH_CHART_3D_VALIDATION_REPAIR_HINTS, chart3dError } from "./validate";
export type { GlyphChart3dValidationRuleId, GlyphChart3dValidationError } from "./validate";
export type {
  GlyphChart3dSurfaceGridData,
  GlyphChart3dSurfaceRecord,
  GlyphChart3dSurfaceData,
  GlyphChart3dChannelValue,
  GlyphChart3dSurfaceChannels,
  GlyphChart3dColorscaleName,
  GlyphChart3dColorscale,
  GlyphChart3dAxisOptions,
  GlyphChart3dSurfaceOptions,
  GlyphChart3dResolvedAxis,
  GlyphChart3dSurfaceMark,
  GlyphChart3dMark,
  GlyphChart3dObjectOptions,
  GlyphChart3dBuildReport,
  GlyphChart3dLedgerEntry,
} from "./types";
