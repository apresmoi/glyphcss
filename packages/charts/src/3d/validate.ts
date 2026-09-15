/**
 * `@glyphcss/charts/3d`'s validation rules — same discipline as the root
 * package's `GLYPH_CHART_VALIDATION_RULES` (AGENTS.md's "Charts"
 * "Validation/schema"): a stable rule table, one thrower, `schema.ts`
 * derives its own repair-hint table from the same ids. A SEPARATE table
 * from the root's own, not an extension of it — the two mark vocabularies
 * (2D marks, 3D marks) don't share a spec today (PLAN-3d.md §2.2's
 * `mixed-dimension` unification is a later, C2+ concern), so this file has
 * no reason to touch `packages/charts/src/validate.ts`.
 */
// C7 (AGENTS.md's "Charts 3D" "C7"): every mark's own axis triad shares
// `axisTriadShared.ts`'s `resolveAxis`, so every mark type's rule list gets
// the SAME three axis-option rules — `bad-tick-format`/`bad-axis-color` are
// the 2D rule CODES reused verbatim (the meaning is identical: an unknown
// tick-format preset, or a non-canonical hex colour), never a parallel 3D
// spelling of the same check; `bad-axis-domain` is new (2D has no single
// `[min, max]` axis-domain option shaped like this one).
const AXIS_OPTION_RULES = ["bad-tick-format", "bad-axis-color", "bad-axis-domain"] as const;

/** Rules SHARED by every 3D mark type's own model step. */
export const GLYPH_CHART_3D_SHARED_RULES = ["non-finite-data", "bad-options", "colorscale-not-monotone", ...AXIS_OPTION_RULES] as const;
export const GLYPH_CHART_3D_SURFACE_RULES = ["surface-not-gridded", "surface-ragged", "surface-too-small", "surface-axis-unsorted", "non-finite-data", "bad-options", "colorscale-not-monotone", ...AXIS_OPTION_RULES] as const;
export const GLYPH_CHART_3D_SCATTER_RULES = ["scatter-empty", "scatter-bad-channel", "non-finite-data", "bad-options", "colorscale-not-monotone", ...AXIS_OPTION_RULES] as const;
export const GLYPH_CHART_3D_PARAMETRIC_RULES = ["parametric-too-small", "parametric-ragged", "non-finite-data", "bad-options", "colorscale-not-monotone", ...AXIS_OPTION_RULES] as const;
export const GLYPH_CHART_3D_BARS_RULES = ["bars-empty", "bars-bad-channel", "non-finite-data", "bad-options", "colorscale-not-monotone", ...AXIS_OPTION_RULES] as const;
export const GLYPH_CHART_3D_LINE3D_RULES = ["line3d-too-short", "line3d-empty", "non-finite-data", "bad-options", ...AXIS_OPTION_RULES] as const;
// Render-option-level rules (C2, `render.ts`) — same asymmetry the root
// package's own table has (`bad-size` lives beside the spec-level rules,
// even though `glyphChartJsonSchema()` describes the spec, not options):
// these are never part of any per-mark `glyphChart3d*JsonSchema()`, which
// describes a mark's own model input, not `renderGlyphChart3d`'s options.
export const GLYPH_CHART_3D_RENDER_RULES = ["bad-render-size", "bad-render-options", "bad-camera"] as const;

/** The FULL, UNIQUE rule set across every mark type — `GlyphChart3dValidationRuleId`'s own source. Each mark's own `glyphChart3d*JsonSchema()` lists only ITS OWN applicable subset (above) in `x-glyphcss-validation-rules` — never this whole table verbatim, which would claim a `scatter-empty` violation is Ajv-describable for a SURFACE schema. */
export const GLYPH_CHART_3D_VALIDATION_RULES = [
  "surface-not-gridded", "surface-ragged", "surface-too-small", "surface-axis-unsorted",
  "non-finite-data", "bad-options", "colorscale-not-monotone",
  "scatter-empty", "scatter-bad-channel",
  "parametric-too-small", "parametric-ragged",
  "bars-empty", "bars-bad-channel",
  "line3d-too-short", "line3d-empty",
  "bad-render-size", "bad-render-options", "bad-camera",
  ...AXIS_OPTION_RULES,
] as const;
export type GlyphChart3dValidationRuleId = typeof GLYPH_CHART_3D_VALIDATION_RULES[number];
export interface GlyphChart3dValidationError extends Error {
  readonly code: GlyphChart3dValidationRuleId;
}

export function chart3dError(code: GlyphChart3dValidationRuleId, message: string): never {
  throw Object.assign(new TypeError(`glyphcss: ${code}: ${message}`), { code });
}

export const GLYPH_CHART_3D_VALIDATION_REPAIR_HINTS: Readonly<Record<GlyphChart3dValidationRuleId, string>> = {
  "surface-not-gridded": "Provide at least 2 distinct x values and 2 distinct y values, or pass a row-major z grid directly.",
  "surface-ragged": "Every row of a z grid must have the same length (and must itself be an array), and long-row data must cover every (x, y) cell exactly once.",
  "surface-too-small": "A surface needs at least a 2x2 grid of z values.",
  "surface-axis-unsorted": "An explicit x/y position vector must be strictly monotonic (ascending or descending) — reorder it or drop it for the default uniform positions.",
  "non-finite-data": "Replace NaN and Infinity with finite x/y/z values.",
  "bad-options": "Check aspect (3 positive numbers), colorscale, bands (a positive integer), and maxQuadsX/maxQuadsY (positive integers).",
  "colorscale-not-monotone": "A custom colorscale's anchors must be monotonically increasing or decreasing in perceptual lightness (CIELAB L*) — a colour a reader can't tell is higher or lower than its neighbour defeats a sequential ramp.",
  "bad-render-size": "Pass positive integer width and height, or omit them.",
  "bad-render-options": "Check target (chat/terminal/web), charset (ascii/box/blocks/braille), color (none/ansi16/ansi256/truecolor/css) and cellAspect (a positive finite number).",
  "bad-camera": "camera.rotX/rotY must be finite numbers and camera.zoom, when given, a positive finite number.",
  "scatter-empty": "Scatter data must be a non-empty array of points.",
  "scatter-bad-channel": "Check the x/y/z channels resolve to finite numbers, and pass at most one of a categorical series channel or a numeric color channel, never both.",
  "parametric-too-small": "A parametric surface needs at least a 2x2 grid of (x, y, z) points (or wrapU/wrapV over a single ring).",
  "parametric-ragged": "Every row of the x/y/z (and value, if given) grids must have the same length, and all grids must share the same shape.",
  "bars-empty": "Bar data must be a non-empty array of bars.",
  "bars-bad-channel": "Check the x/y/z channels resolve to finite numbers.",
  "line3d-too-short": "A 3D line needs at least 2 points per series.",
  "line3d-empty": "Line data must be a non-empty array of points, or an array of named series each with 2+ points.",
  "bad-tick-format": "Use a known tick format preset name, { preset, ...params }, or (TS/JS only) a callback function — see the 2D axes.{x,y}.format vocabulary.",
  "bad-axis-color": "Use a canonical lowercase #rrggbb string for axes.color and axes.{x,y,z}.color.",
  "bad-axis-domain": "axes.{x,y,z}.domain must be two finite numbers [min, max] with min < max.",
};

export function glyphChart3dRepairHint(id: string): string | undefined {
  return (GLYPH_CHART_3D_VALIDATION_REPAIR_HINTS as Readonly<Record<string, string>>)[id];
}
