/**
 * `@glyphcss/charts/3d` — 3D chart marks (PLAN-3d.md §5+). A separate
 * subpath from the root `@glyphcss/charts` entry (AGENTS.md's "Charts"):
 * the root entry stays camera-free and rasterizer-free; this one imports
 * `glyphcss`'s scene-object primitives. The root package's `index.ts`
 * never imports from here.
 */
export { glyphChartSurface } from "./surface";
export { glyphChartScatter3d } from "./scatter";
export type { GlyphChart3dScatterChannels, GlyphChart3dScatterOptions } from "./scatter";
export { glyphChartParametric3d, glyphChart3dSphereGrid, glyphChart3dTorusGrid } from "./parametric";
export type { GlyphChart3dParametricInput, GlyphChart3dParametricOptions } from "./parametric";
export { glyphChartBars3d } from "./bars";
export type { GlyphChart3dBarsChannels, GlyphChart3dBarsOptions } from "./bars";
export { glyphChartLine3d, glyphChart3dLorenzAttractor } from "./line3d";
export type { GlyphChart3dLineInput, GlyphChart3dLineOptions, GlyphChart3dLineSeriesInput, GlyphChart3dPoint3 } from "./line3d";
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
export { glyphChart3dSurfaceJsonSchema, glyphChart3dScatterJsonSchema, glyphChart3dParametricJsonSchema, glyphChart3dBarsJsonSchema, glyphChart3dLineJsonSchema } from "./schema";
export type { GlyphChart3dSurfaceJsonSchema, GlyphChart3dJsonSchema } from "./schema";
export { glyphChart3dFitCamera, GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";
export type { GlyphChart3dBounds, GlyphChart3dFitCameraOptions, GlyphChart3dFitCameraResult } from "./camera";
export {
  renderGlyphChart3d, renderGlyphChart3dJson, glyphChart3dCharsetDegrades,
  resolveGlyphChart3dStyle, glyphChart3dStyleSceneOptions, glyphChart3dChromeTier,
} from "./render";
export type {
  GlyphChart3dCameraOptions,
  GlyphChart3dRenderOptions,
  GlyphChart3dResolved,
  GlyphChart3dReport,
  GlyphChart3dResult,
  GlyphChart3dJsonInput,
  GlyphChart3dStyle,
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
  GlyphChart3dCornerBit,
  GlyphChart3dCorner,
  GlyphChart3dCornerOption,
  GlyphChart3dGuideOptions,
  GlyphChart3dResolvedGuides,
  GlyphChart3dAxisTriadSpec,
  GlyphChart3dColorLegend,
  GlyphChart3dScatterMark,
  GlyphChart3dScatterPoint,
  GlyphChart3dScatterSeriesEntry,
  GlyphChart3dParametricMark,
  GlyphChart3dParametricGrid,
  GlyphChart3dBarsMark,
  GlyphChart3dBar,
  GlyphChart3dLineMark,
  GlyphChart3dLineSeriesEntry,
} from "./types";
