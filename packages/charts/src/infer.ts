/**
 * Channel-type inference, copying Observable Plot's own rule verbatim
 * (PLAN.md Phase 1, "channels infer channel types … exactly as Observable
 * Plot does"): a `Date` value infers a time scale, a `string` infers a band
 * (ordinal categorical) scale, a `number` infers a linear scale. Inference
 * looks at the first non-nullish value in a channel's resolved row values —
 * a chart's rows are homogeneous by construction (one field, one type).
 */

export type GlyphChartInferredScaleType = "time" | "band" | "linear";

export function inferGlyphChartScaleType(values: readonly unknown[]): GlyphChartInferredScaleType {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (v instanceof Date) return "time";
    if (typeof v === "string") return "band";
    if (typeof v === "number") return "linear";
  }
  // No usable value at all (every row null/undefined) — linear is the
  // least surprising fallback and matches an empty-domain guard downstream.
  return "linear";
}
