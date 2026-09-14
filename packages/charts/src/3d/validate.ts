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
export const GLYPH_CHART_3D_VALIDATION_RULES = [
  "surface-not-gridded",
  "surface-ragged",
  "surface-too-small",
  "surface-axis-unsorted",
  "non-finite-data",
  "bad-options",
  "colorscale-not-monotone",
  // Render-option-level rules (C2, `render.ts`) — same asymmetry the root
  // package's own table has (`bad-size` lives beside the spec-level rules,
  // even though `glyphChartJsonSchema()` describes the spec, not options):
  // these are never part of `glyphChart3dSurfaceJsonSchema()`, which
  // describes `glyphChartSurface`'s own input, not `renderGlyphChart3d`'s.
  "bad-render-size",
  "bad-render-options",
  "bad-camera",
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
};

export function glyphChart3dRepairHint(id: string): string | undefined {
  return (GLYPH_CHART_3D_VALIDATION_REPAIR_HINTS as Readonly<Record<string, string>>)[id];
}
