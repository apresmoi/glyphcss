/**
 * `spec → resolveScales (d3)` — ONE scale per axis, shared by every mark
 * (PLAN.md's "one scale per axis" gate: a per-mark scale would make ticks on
 * a composed line+dot+rule chart disagree). Domain type is inferred per
 * `infer.ts`'s Plot-matching rule; the honesty gate additionally requires
 * the y-domain to include 0 whenever a `bar`/`area` mark is present AND its
 * values cross (or touch) zero from both sides is unnecessary — the rule is
 * simpler and stronger: 0 is always inside a bar/area chart's y-domain, so
 * "bar length ∝ value" and "zero baseline sits in the domain when signs
 * mix" both fall out of the same domain-extension rule.
 */

import { extent as d3extent } from "d3-array";
import { scaleBand, scaleLinear, scaleLog, scaleSqrt, scaleTime, type ScaleBand } from "d3-scale";
import { format as d3format } from "d3-format";
import { timeValue, validateLogDomain, chartError } from "./validate";
import { inferGlyphChartScaleType, type GlyphChartInferredScaleType } from "./infer";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartScaleOptions } from "./types";

export interface GlyphChartTick {
  readonly value: number | string | Date;
  /** Fraction in [0, 1] along the axis — `layout.ts` maps this to a cell column/row. */
  readonly fraction: number;
  readonly label: string;
}

export interface GlyphChartResolvedScale {
  readonly type: GlyphChartInferredScaleType | "log" | "sqrt";
  /** Maps a domain value to a fraction in [0, 1] along the axis (0 = domain start, 1 = domain end). */
  toFraction(value: unknown): number;
  /** For a `band` scale: the fractional step width one category occupies. `undefined` otherwise. */
  readonly bandStep?: number;
  /**
   * For a `band` scale: the EXACT `[start, end]` fraction a category's own
   * band occupies (its `scaleBand` position and bandwidth, not a heuristic
   * derived from `bandStep`) — `paintBar`/`paintCell` use this so adjacent
   * bands neither gap nor overlap regardless of rounding. `undefined` for
   * every other scale type.
   */
  bandRange?(value: unknown): readonly [number, number];
  ticks(count: number): GlyphChartTick[];
  format(value: number | string | Date): string;
}

function collectValues(marks: readonly GlyphChartResolvedMark[], axis: "x" | "y"): unknown[] {
  const values: unknown[] = [];
  for (const { mark, rows, ruleValues } of marks) {
    if (mark.type === "rule") {
      const ruleAxis = mark.options?.axis ?? "y";
      if (ruleAxis === axis) for (const v of ruleValues ?? []) values.push(v);
      continue;
    }
    if (mark.type === "arc") continue; // radial — positioned independently of x/y scales.
    for (const row of rows) {
      if (axis === "x") values.push(row.x);
      else {
        if (row.y1 !== undefined) { values.push(row.y0 ?? 0); values.push(row.y1); }
        else values.push(row.y);
      }
    }
  }
  return values.filter((v) => v !== undefined && v !== null);
}

/** `true` iff any resolved mark is a `bar`/`area` — see module doc for why that forces 0 into the y-domain. */
function hasZeroAnchoredMark(marks: readonly GlyphChartResolvedMark[]): boolean {
  return marks.some((m) => ["bar", "area", "rect"].includes(m.mark.type));
}

function numericDomain(values: readonly unknown[], includeZero: boolean): [number, number] {
  const nums = values.map(Number).filter(Number.isFinite);
  let [lo, hi] = d3extent(nums) as [number | undefined, number | undefined];
  if (lo === undefined || hi === undefined) { lo = 0; hi = 1; }
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
}

// `d3.format("~s")` reads naturally for a magnitude far from 1 (1500 ->
// "1.5k"), but `scale.ticks()` on a chart's typical small-index/small-value
// domain produces "nice" numbers CLOSE to 1 (0, 0.5, 1, 1.5, …), where SI
// notation picks the milli/micro prefix instead ("500m" for 0.5) — correct
// SI, but unreadable as a chart axis. `~s` is reserved for genuinely large
// or small magnitudes; everything in between prints as a plain, trimmed
// decimal via `~r` (round to significant digits, no trailing zeros).
const SI_FORMAT = d3format("~s");
const PLAIN_FORMAT = d3format("~r");
function formatLinearTick(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1000 || abs < 0.01)) return SI_FORMAT(v).replace(/−/g, "-").replace(/µ/g, "u");
  return PLAIN_FORMAT(v).replace(/−/g, "-");
}

function buildContinuous(
  type: "linear" | "log" | "sqrt" | "time",
  values: readonly unknown[],
  includeZero: boolean,
  opts: GlyphChartScaleOptions | undefined,
): GlyphChartResolvedScale {
  if (type === "time") {
    // Parse each distinct JSON value once, including explicit domain values.
    const cache = new Map<unknown, Date>();
    const date = (v: unknown): Date => {
      if (!cache.has(v)) cache.set(v, timeValue(v));
      return cache.get(v)!;
    };
    const dates = (opts?.domain ?? values).map(date);
    const [lo, hi] = opts?.domain ? [dates[0]!, dates[dates.length - 1]!] : d3extent(dates);
    const scale = scaleTime().domain([lo ?? new Date(0), hi ?? new Date(1)]);
    if (opts?.nice) scale.nice();
    const fmt = scale.tickFormat();
    return {
      type,
      toFraction: (v) => scale(date(v)),
      ticks: (count) => scale.ticks(count).map((t) => ({ value: t, fraction: scale(t), label: fmt(t) })),
      format: (v) => fmt(date(v)),
    };
  }
  let domain = opts?.domain ? opts.domain.map(Number) : numericDomain(values, includeZero);
  if (type === "log") {
    // A singleton log domain expands multiplicatively; ±1 would introduce zero.
    if (!opts?.domain) {
      const nums = values.map(Number);
      validateLogDomain(includeZero ? [...nums, 0] : nums);
      const [lo, hi] = d3extent(nums) as [number, number];
      domain = lo === hi ? [lo / 10, hi * 10] : [lo, hi];
    }
    validateLogDomain(domain);
  }
  if (includeZero && !(Math.min(...domain) <= 0 && Math.max(...domain) >= 0)) chartError("bar-domain-excludes-zero", "A bar/rect/area domain must include zero.");
  const scale = (type === "log" ? scaleLog() : type === "sqrt" ? scaleSqrt() : scaleLinear()).domain([domain[0]!, domain[domain.length - 1]!]);
  if (opts?.nice) scale.nice();
  return {
    type,
    toFraction: (v) => scale(Number(v)),
    ticks: (count) => scale.ticks(count).map((t) => ({ value: t, fraction: scale(t), label: formatLinearTick(t) })),
    format: (v) => formatLinearTick(Number(v)),
  };
}

function buildBand(values: readonly unknown[], opts: GlyphChartScaleOptions | undefined): GlyphChartResolvedScale {
  const seen = new Set<string>();
  const domain: string[] = [];
  const source = opts?.domain ? opts.domain.map(String) : values.map(String);
  for (const v of source) if (!seen.has(v)) { seen.add(v); domain.push(v); }
  const scale: ScaleBand<string> = scaleBand<string>().domain(domain).range([0, 1]).paddingInner(0.2).paddingOuter(0.1);
  const step = scale.step();
  return {
    type: "band",
    toFraction: (v) => (scale(String(v)) ?? 0) + scale.bandwidth() / 2,
    bandStep: step,
    bandRange: (v) => {
      const start = scale(String(v)) ?? 0;
      return [start, start + scale.bandwidth()];
    },
    // Layout owns thinning so every dropped category has a ledger entry.
    ticks: () => domain.map((v) => ({ value: v, fraction: (scale(v) ?? 0) + scale.bandwidth() / 2, label: v })),
    format: (v) => String(v),
  };
}

export function resolveGlyphChartScale(
  marks: readonly GlyphChartResolvedMark[],
  axis: "x" | "y",
  opts: GlyphChartScaleOptions | undefined,
): GlyphChartResolvedScale {
  const values = collectValues(marks, axis);
  const type = opts?.type
    ? (opts.type === "ordinal" ? "band" : opts.type)
    : inferGlyphChartScaleType(values);
  const includeZero = axis === "y" && hasZeroAnchoredMark(marks);
  if (includeZero && (type === "band" || type === "time")) chartError("bad-scale", "Bar/rect/area y scales must be numeric and include zero.");
  if (type === "band") return buildBand(values, opts);
  return buildContinuous(type, values, includeZero, opts);
}

export interface GlyphChartResolvedScales {
  readonly x: GlyphChartResolvedScale;
  readonly y: GlyphChartResolvedScale;
}

export function resolveGlyphChartScales(
  marks: readonly GlyphChartResolvedMark[],
  scaleOptions: { readonly x?: GlyphChartScaleOptions; readonly y?: GlyphChartScaleOptions } | undefined,
): GlyphChartResolvedScales {
  return {
    x: resolveGlyphChartScale(marks, "x", scaleOptions?.x),
    y: resolveGlyphChartScale(marks, "y", scaleOptions?.y),
  };
}
