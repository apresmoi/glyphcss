// @glyphcss/charts — a declarative, Observable-Plot-flavoured chart spec
// rendered as glyphcss ASCII/box/braille output. See AGENTS.md's "Charts"
// section for the contract and docs/design/charts.md for the rationale.

export {
  glyphChartLine,
  glyphChartArea,
  glyphChartBar,
  glyphChartDot,
  glyphChartArc,
  glyphChartRect,
  glyphChartCell,
  glyphChartText,
  glyphChartRule,
  glyphChartSankey,
  glyphChartFunnel,
  glyphChartPlot,
  normalizeGlyphChartInput,
} from "./spec";
export type { GlyphChartPlotOptions, GlyphChartSankeyChannels, GlyphChartFunnelChannels } from "./spec";

export {
  validateGlyphChartSpec,
  validateGlyphChartRenderSize,
  glyphChartRepairHint,
  GLYPH_CHART_VALIDATION_RULES,
} from "./validate";
export type { GlyphChartValidationRuleId, GlyphChartValidationError } from "./validate";

export { glyphChartJsonSchema } from "./schema";
export type { GlyphChartJsonSchema } from "./schema";

export { GLYPH_CHART_TICK_FORMAT_PRESETS, GLYPH_CHART_TICK_FORMAT_PRESET_NAMES, resolveGlyphChartTickFormat } from "./tickFormat";
export type { GlyphChartResolvedTickFormat } from "./tickFormat";

export type { GlyphChartLedgerEntry } from "./ledger";

export { glyphChartLabelLayout } from "./labels";
export type {
  GlyphChartLabelCandidate,
  GlyphChartLabelLayoutOptions,
  GlyphChartLabelLayoutResult,
  GlyphChartObstacleRect,
  GlyphChartPlacedLabel,
} from "./labels";

export { renderGlyphChart, buildGlyphChart, encodeGlyphChart, glyphChartRegionFill, GLYPH_CHART_TARGET_DEFAULTS } from "./render";
export { glyphChartTextureSampler } from "./bridge";
export type { GlyphChartTextureSamplerOptions } from "./bridge";
export { composeGlyphChartEffects } from "./effectsBridge";
export type { GlyphChartComposeEffectsOptions } from "./effectsBridge";
export { glyphChartPlaneObject } from "./planeObject";
export type { GlyphChartPlaneObjectOptions } from "./planeObject";
export { GLYPH_CHART_AXIS_DEFAULT_COLOR } from "./layout";
export { renderGlyphChartJson } from "./json";
export { glyphChartScaleDomains } from "./domains";
export { glyphChartSeriesPreview } from "./seriesPublic";
export type { GlyphChartSeriesPreviewEntry } from "./seriesPublic";

export type {
  GlyphChartAxisOptions,
  GlyphChartBuild,
  GlyphChartCharset,
  GlyphChartChannels,
  GlyphChartChannelValue,
  GlyphChartColorMode,
  GlyphChartDatum,
  GlyphChartDetail,
  GlyphChartInput,
  GlyphChartLegendOption,
  GlyphChartLegendPlacement,
  GlyphChartMark,
  GlyphChartMarkOptions,
  GlyphChartMarkRow,
  GlyphChartMarkType,
  GlyphChartMeta,
  GlyphChartPlotRect,
  GlyphChartRegionFill,
  GlyphChartRegionFillReason,
  GlyphChartRegionFillResolution,
  GlyphChartRenderOptions,
  GlyphChartReport,
  GlyphChartResolved,
  GlyphChartResult,
  GlyphChartScaleOptions,
  GlyphChartSpec,
  GlyphChartTarget,
  GlyphChartTickFormat,
  GlyphChartTickFormatCallback,
  GlyphChartTickFormatPreset,
  GlyphChartTitleAlign,
  GlyphChartTitleOption,
  GlyphChartTitlePosition,
  GlyphChartTransform,
  GlyphChartTransformKind,
  GlyphChartXAxisOptions,
  GlyphChartXAxisTitleAt,
  GlyphChartYAxisOptions,
  GlyphChartYAxisTitleAt,
} from "./types";
