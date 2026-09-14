/**
 * `@glyphcss/charts/3d` — 3D chart marks (PLAN-3d.md §5+). A separate
 * subpath from the root `@glyphcss/charts` entry (AGENTS.md's "Charts"):
 * the root entry stays camera-free and rasterizer-free; this one imports
 * `glyphcss`'s scene-object primitives. The root package's `index.ts`
 * never imports from here.
 */
export { glyphChartSurface } from "./surface";
export { glyphChartObject, GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY } from "./object";
export {
  resolveGlyphChart3dColorscaleAnchors,
  interpolateGlyphChart3dAnchors,
  glyphChart3dBandIndex,
  glyphChart3dBandColor,
  hexLStar as glyphChart3dHexLStar,
} from "./colorscale";
export { GLYPH_CHART_3D_COLORSCALE_NAMES } from "./types";
export {
  GLYPH_CHART_3D_VALIDATION_RULES, GLYPH_CHART_3D_VALIDATION_REPAIR_HINTS, chart3dError, glyphChart3dRepairHint,
} from "./validate";
export type { GlyphChart3dValidationRuleId, GlyphChart3dValidationError } from "./validate";
export { glyphChart3dSurfaceJsonSchema } from "./schema";
export type { GlyphChart3dSurfaceJsonSchema } from "./schema";
export { glyphChart3dFitCamera, GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";
export type { GlyphChart3dBounds, GlyphChart3dFitCameraOptions, GlyphChart3dFitCameraResult } from "./camera";
export { renderGlyphChart3d, renderGlyphChart3dJson, glyphChart3dCharsetDegrades } from "./render";
export type {
  GlyphChart3dCameraOptions,
  GlyphChart3dRenderOptions,
  GlyphChart3dResolved,
  GlyphChart3dReport,
  GlyphChart3dResult,
  GlyphChart3dJsonInput,
} from "./render";
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
