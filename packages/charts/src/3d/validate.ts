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
  "non-finite-data",
  "bad-options",
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
  "surface-ragged": "Every row of a z grid must have the same length, and long-row data must cover every (x, y) cell exactly once.",
  "surface-too-small": "A surface needs at least a 2x2 grid of z values.",
  "non-finite-data": "Replace NaN and Infinity with finite x/y/z values.",
  "bad-options": "Check aspect (3 positive numbers), colorscale, bands (a positive integer), and maxQuadsX/maxQuadsY (positive integers).",
};
