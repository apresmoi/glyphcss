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

export type { GlyphChartLedgerEntry } from "./ledger";

export { glyphChartLabelLayout } from "./labels";
export type {
  GlyphChartLabelCandidate,
  GlyphChartLabelLayoutOptions,
  GlyphChartLabelLayoutResult,
  GlyphChartObstacleRect,
  GlyphChartPlacedLabel,
} from "./labels";

export { renderGlyphChart, GLYPH_CHART_TARGET_DEFAULTS } from "./render";
export { GLYPH_CHART_AXIS_DEFAULT_COLOR } from "./layout";
export { renderGlyphChartJson } from "./json";
export { glyphChartScaleDomains } from "./domains";
export { glyphChartSeriesPreview } from "./seriesPublic";
export type { GlyphChartSeriesPreviewEntry } from "./seriesPublic";

export type {
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
  GlyphChartRenderOptions,
  GlyphChartReport,
  GlyphChartResult,
  GlyphChartScaleOptions,
  GlyphChartSpec,
  GlyphChartTarget,
  GlyphChartTitleAlign,
  GlyphChartTitleOption,
  GlyphChartTitlePosition,
  GlyphChartTransform,
  GlyphChartTransformKind,
} from "./types";
