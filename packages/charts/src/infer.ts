/**
 * Channel-type inference, copying Observable Plot's own rule verbatim
 * (PLAN.md Phase 1, "channels infer channel types … exactly as Observable
 * Plot does"): a `Date` value infers a time scale, a `string` infers a band
 * (ordinal categorical) scale, a `number` infers a linear scale — UNLESS
 * every string value in the channel is itself a calendar-valid ISO date
 * (`YYYY-MM-DD`, optional `THH:mm[:ss][Z|±hh:mm]`), which infers `time`
 * instead. A date column arriving as JSON is a plain ISO STRING (JSON has
 * no `Date`), so the un-widened rule read it as `band` and printed
 * truncated raw ISO/epoch text instead of real d3 year/month tick labels
 * unless a caller EXPLICITLY set `scales.x.type: "time"` (the website's
 * data-layer workaround, `chartsDataSource.ts`'s `xChannelIsDate`) — this
 * makes the CLI/JSON path get the same real date ticks with no such
 * workaround, matching what the explicit type already produced exactly (a
 * genuinely mixed column — some ISO-date strings, some not — stays `band`,
 * since only a HOMOGENEOUS column has an honest single inferred type).
 * Inference looks at every value once it commits to checking strings (a
 * `Date`/`number` still short-circuits on the FIRST non-nullish value,
 * preserving the "homogeneous by construction" assumption there).
 *
 * `allowDateStrings` (default `true`) is `scales.ts`'s own escape hatch for
 * a BAND-ONLY mark (`bar`/`rect`/`cell`, "Band marks use the scale's own
 * bounds") sharing this axis: such a mark must paint an exact, gapless
 * column per category, which a continuous time scale cannot give it (the
 * first/last column would clip at the plot edges and ticks would stop
 * landing on the data's own dates — fable review, batch 3, finding (a)).
 * `false` makes a string column resolve `band` exactly as it did before
 * ISO-string inference existed, regardless of the strings' own shape; a
 * CONTINUOUS mark (`line`/`area`/`dot`/`rule`) sharing the same string
 * column with no band-only mark present still infers `time`.
 */
import { ISO_DATE_PATTERN } from "./validate";

export type GlyphChartInferredScaleType = "time" | "band" | "linear";

// Shares `validate.ts`'s own calendar-valid ISO pattern exactly — the same
// string an explicit `scales.x.type: "time"` domain is checked against
// (`timeValue`), so "infers time" and "validates as time" never disagree.
const ISO_DATE_ONLY_REGEX = new RegExp(ISO_DATE_PATTERN);

export function inferGlyphChartScaleType(
  values: readonly unknown[],
  opts?: { readonly allowDateStrings?: boolean },
): GlyphChartInferredScaleType {
  const allowDateStrings = opts?.allowDateStrings ?? true;
  // Short-circuits on the FIRST value whose type settles the answer — kept
  // exactly as before (a `number` still commits to "linear" immediately,
  // a non-date `string` still commits to "band" immediately) because
  // `scales.ts`'s `numericValuesUnplaceableOnBand` runs this over the
  // CONCATENATION of every mark's own x values sharing an axis and relies
  // on that first-type-wins order to tell "a numeric mark genuinely wants a
  // continuous scale" (numeric-shorthand mark declared first) from "a
  // numeric value can honestly sit on the other mark's band" (declared
  // after a categorical mark) — changing that general rule is out of this
  // fix's scope. The ONE case that must NOT reach the number branch is a
  // run of calendar-ISO date strings seen so far with no number yet: those
  // don't commit to anything (`sawDateStringOnly`, scanning continues) so
  // a LATER plain number can still be caught as a genuine mix (round 2
  // N10/N12: `["2024-01-01", 5]` used to short-circuit through the date
  // string to "linear", and `Number("2024-01-01")` is NaN).
  let sawDateStringOnly = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (v instanceof Date) return "time"; // a real Date is a controlled, already-homogeneous source.
    if (typeof v === "number") return sawDateStringOnly ? "band" : "linear";
    if (typeof v === "string") {
      if (!allowDateStrings || !ISO_DATE_ONLY_REGEX.test(v)) return "band"; // one non-date string (or date strings disallowed here) settles it.
      sawDateStringOnly = true; // a valid date string so far — keep scanning.
    }
  }
  if (sawDateStringOnly) return "time"; // every string seen was a valid calendar ISO date.
  // No usable value at all (every row null/undefined) — linear is the
  // least surprising fallback and matches an empty-domain guard downstream.
  return "linear";
}
