// Information-ranked chart-candidate enumeration for `/charts`' data layer
// (AGENTS.md's "Charts" — "Data layer"; formula/weights/ground-truth table
// in `docs/design/charts.md`'s "Chart candidate ranking"). Replaces the old
// single-pick recommender's implicit priority list with an EXPLICIT,
// SCORED enumeration: every mark a profiled table can honestly support,
// each mapping scored on how much information it actually shows, sorted
// best first. `dataProfile.ts`'s `recommendChart` is now a thin wrapper
// over `buildChartCandidates` (kept for callers that only want the old
// `ChartRecommendation` shape). The `/charts` mark-type toggle
// (`chartsMarkTypeFit.ts`) enables a type iff this list offers one the page
// can bind, and binds its top candidate.
//
// No DOM. Pure functions of `DataProfile` (which now also carries a
// row-aligned `sample` — see `dataProfile.ts` — because entropy/structure
// scoring needs paired values across columns that column-level metadata
// alone can't answer).
import { runPipeline, type PipelineStep } from "./dataPipeline";
import type { ColumnProfile, DataProfile } from "./dataProfile";
import type { TabularCell, TabularRow } from "./tabularParse";

// ── Column classification (moved from dataProfile.ts — this file now owns
// "what counts as a usable measure/category/ordered axis") ────────────────

export function numericColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "number" || c.type === "integer");
}
export function dateColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "date");
}
export function categoryColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "category" || c.type === "boolean");
}

/** `dataProfile.ts`'s own `type: "category"` cutoff (`distinctCount <=
 *  max(20, 20% of rows)`) exists to separate a repeated small vocabulary
 *  from FREE text — the UI-facing distinction every channel-select dropdown
 *  and table editor cares about. It's the wrong cutoff for "is this a
 *  legitimate bar/funnel AXIS", where the real question is closer to "is
 *  every value a distinct, meaningful LABEL rather than a paragraph" — a
 *  23-country table with one row per country (distinctCount === rowCount,
 *  so the strict cutoff reads it as unstructured text past 20) is exactly
 *  as good a bar axis as an 8-country one; only genuinely free text
 *  (`cardinality: "high"`, i.e. distinct out-scaling even that generous a
 *  bound) is excluded. Used ONLY by the plain single-measure bar generator
 *  (`buildChartCandidates`'s own bar section) — every other mark keeps its
 *  own, independent cardinality gate (arc's 2-6, cell/sankey unbounded but
 *  legibility-capped, funnel's 2-12 PLUS its stage-name gate), so widening
 *  this one axis's eligibility changes no other mark's candidate set. */
export function barAxisColumns(columns: readonly ColumnProfile[], rowCount: number): ColumnProfile[] {
  return columns.filter((c) => {
    if (c.type === "category" || c.type === "boolean") return true;
    return c.type === "text" && c.cardinality !== "high" && !isIdLikeColumn(c, rowCount);
  });
}

/** A column NAME that reads as a row identifier/ordinal rather than a
 *  measurement — `"Id"`/`"id"`/`"index"`/… as the WHOLE name, or a
 *  `_id`/`Id` SUFFIX (snake_case/camelCase). */
const ID_LIKE_NAME_RE = /^(id|_id|index|idx|key|uuid|row|n|no\.?|number)$/i;
const ID_LIKE_SUFFIX_RE = /_id$|Id$/;

/** True when the column's NAME reads as a row identifier/ordinal, or every
 *  value it has is one integer 0..n-1 or 1..n IN ROW ORDER (a real index/
 *  row-number sequence) — never mere `cardinality: "unique"` on its own,
 *  and never a shuffled permutation of the same value set.
 *
 * CHARTS-RESEARCH `REVIEW-batch4-fable.md` F-P1-4: a plain "every value is
 * distinct" rule (the previous `col.cardinality === "unique"` early
 * return) also caught an ordinary all-distinct-year column (30 rows,
 * 1990..2019) or a genuinely distinct integer MEASURE (population beside a
 * tied `medals` count) — neither is an identifier, and excluding them left
 * no ordered-x candidate for the year table at all (the vendored 16
 * datasets dodge this because their years are ISO strings, not integers —
 * `global-temperature`'s `year: "1880-01-01"`). Distinctness alone says
 * nothing about IDENTITY; only the column's own NAME, or the specific
 * 0..n-1/1..n row-number SHAPE, does. Mutation M9 (`REVIEW-batch4-fable.md`)
 * deleted the old rule and left all 33 `chartCandidates` tests green — this
 * rule now has its own repro (`chartCandidates.test.ts`'s "F-P1-4" block).
 *
 * `REVIEW-batch4-fixes-opus.md` P1-8's own side effect: the SET check above
 * (min/max/distinctCount) accepts a SHUFFLED `1..n` column just as readily
 * as a real row-number sequence — a shuffled column is not an index, it's
 * an ordinary distinct integer MEASURE that happens to enumerate every
 * value in `[1, n]` (a shuffled deck, a randomized trial id that is
 * genuinely a measurement). `col.monotonic` (`dataProfile.ts`'s own
 * `monotonicity()`) is computed over the column's values IN ROW ORDER, so
 * requiring `"increasing"` alongside the set check is exactly "the values
 * in row order are the 0..n-1/1..n sequence, not merely that set" — a real
 * index/row-number column is monotone by construction; a shuffled one
 * almost never is (and on the astronomically rare permutation that happens
 * to sort itself, the column has no way to be distinguished from a real
 * index at all, so treating it as one is the only defensible answer left).
 */
export function isIdLikeColumn(col: ColumnProfile, rowCount: number): boolean {
  if (ID_LIKE_NAME_RE.test(col.name) || ID_LIKE_SUFFIX_RE.test(col.name)) return true;
  if (col.type !== "integer") return false;
  if (col.monotonic !== "increasing") return false;
  const nonNullCount = rowCount - col.nullCount;
  if (nonNullCount > 1 && typeof col.min === "number" && typeof col.max === "number" && col.distinctCount === nonNullCount) {
    if (col.min === 0 && col.max === nonNullCount - 1) return true;
    if (col.min === 1 && col.max === nonNullCount) return true;
  }
  return false;
}

/** Name lexicon a real MEASURE column tends to carry — a small tie-breaker
 *  (the `prior` term), never the primary signal. */
const MEASURE_NAME_LEXICON_RE = /value|amount|count|total|price|demand|rate|pct|percent|score|sales|revenue|temp|mean|avg/i;
/** Name lexicon an ordered X axis tends to carry. */
const X_NAME_LEXICON_RE = /year|date|month|day|time|week|quarter/i;

/** Header names that read as a WIDE year table. */
const YEAR_HEADER_RE = /^(19|20)\d{2}$/;

/** `sum` for a count-like measure name, `mean` otherwise — used by the
 *  >500-row `group` transform candidates. */
export function reduceForMeasureName(name: string): "sum" | "mean" {
  return /count|total|amount/i.test(name) ? "sum" : "mean";
}

/** Recommends aggregating a category/date x down to one row per distinct
 *  value before charting it — rides as a candidate's `transform`. */
export const CHART_CANDIDATE_GROUP_ROW_THRESHOLD = 500;

/** A date+numeric+category line/area's `fill` needs the category small
 *  enough to stay distinguishable (legend entries, style cycle). */
export const CHART_CANDIDATE_FILL_MAX_CATEGORIES = 8;

/** Cap on how many rows `dataProfile.ts`'s `profileRows` retains as
 *  `DataProfile.sample` for this module's scoring — entropy/structure need
 *  paired row values, not just column metadata, but a remote dataset can be
 *  large and scoring is O(rows) per candidate. Every vendored dataset is
 *  under 200 rows, so this never engages for them. */
export const CHART_CANDIDATE_SAMPLE_CAP = 3000;

// ── Types ───────────────────────────────────────────────────────────────

export type ChartCandidateMark = "line" | "area" | "bar" | "dot" | "arc" | "cell" | "sankey" | "funnel";

export interface ChartCandidateChannels {
  readonly x?: string; readonly y?: string; readonly fill?: string; readonly label?: string;
  readonly source?: string; readonly target?: string; readonly value?: string; readonly stage?: string;
}

export interface ChartCandidateTerms {
  readonly entropy: number;
  readonly structure: number;
  readonly coverage: number;
  readonly legibility: number;
  readonly prior: number;
}

export type ChartCandidateTransform = { readonly kind: "group"; readonly reduce: "sum" | "mean" };

export interface ChartCandidate {
  readonly mark: ChartCandidateMark;
  readonly channels: ChartCandidateChannels;
  readonly reason: string;
  /** Weighted composite of `terms`, in [0, 1]. Higher wins. */
  readonly score: number;
  readonly terms: ChartCandidateTerms;
  readonly transform?: ChartCandidateTransform;
  readonly pipeline?: readonly PipelineStep[];
}

/** Composite weights — documented in `docs/design/charts.md`. `prior` is
 *  deliberately the smallest: a name-lexicon match is a tie-breaker, never
 *  the reason a candidate wins. */
export const CHART_CANDIDATE_WEIGHTS: ChartCandidateTerms = {
  entropy: 0.30, structure: 0.30, coverage: 0.15, legibility: 0.15, prior: 0.10,
};

/** Returned list is capped here (sorted first, so the cap only ever drops
 *  the worst-ranked candidates) — realistic column counts keep real
 *  enumerations well under this. */
export const CHART_CANDIDATE_MAX = 200;

// ── Small numeric utilities ────────────────────────────────────────────

function clamp01(v: number): number { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
function mean(values: readonly number[]): number { return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length; }

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Average-tie ranking, for Spearman. */
function rankArray(values: readonly number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]!] === values[order[i]!]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!] = avgRank;
    i = j + 1;
  }
  return ranks;
}
function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  return pearson(rankArray(xs.slice(0, n)), rankArray(ys.slice(0, n)));
}
/** Lag-1 autocorrelation of a sequence already ordered along its x axis —
 *  a smooth trend/season reads high, a noisy series near 0, an oscillation
 *  negative (clamped to 0: "smooth beats noise", not "beats oscillation"). */
function lag1Autocorrelation(ys: readonly number[]): number {
  if (ys.length < 3) return 0;
  return clamp01(pearson(ys.slice(0, -1), ys.slice(1)));
}

/** A Pearson/Spearman correlation from a handful of points has real
 *  sampling uncertainty (its standard error scales as `1/sqrt(n-3)`) — a
 *  perfect-looking r from 3-4 points is not the same claim as one from 30.
 *  Reaches full confidence at `SAMPLE_CONFIDENCE_FULL_N` points, 0 at 3
 *  or fewer (where a correlation coefficient is not meaningfully defined). */
const SAMPLE_CONFIDENCE_FULL_N = 15;
function sampleConfidence(n: number): number {
  return clamp01((n - 3) / (SAMPLE_CONFIDENCE_FULL_N - 3));
}

/** A pairwise correlation strong enough that a THIRD column correlating
 *  this strongly with either axis means the pair isn't distinctively
 *  related — it's one slice of a wider multicollinear measure set (every
 *  measure moving together, e.g. several dimensions of the same physical
 *  object). Shared by `scoreDot` and a monotonic-numeric-x `scoreLineArea`.
 *  Threshold and per-measure discount are documented in
 *  `docs/design/charts.md`. */
const COLLINEARITY_CORR_THRESHOLD = 0.8;
const COLLINEARITY_DISCOUNT_PER_MEASURE = 0.3;
const COLLINEARITY_DISCOUNT_MAX = 0.85;
function collinearityDiscountFor(x: string, y: string, otherMeasures: readonly string[], rows: readonly TabularRow[]): number {
  const xs = numericValues(rows, x), ys = numericValues(rows, y);
  let collinearOthers = 0;
  for (const other of otherMeasures) {
    const os = numericValues(rows, other);
    const n = Math.min(xs.length, os.length);
    const cx = Math.abs(pearson(xs.slice(0, n), os.slice(0, n)));
    const cy = Math.abs(pearson(ys.slice(0, n), os.slice(0, n)));
    if (Math.max(cx, cy) >= COLLINEARITY_CORR_THRESHOLD) collinearOthers += 1;
  }
  return Math.min(COLLINEARITY_DISCOUNT_MAX, collinearOthers * COLLINEARITY_DISCOUNT_PER_MEASURE);
}

/** Eta-squared–style between-group variance ratio: how much of the total
 *  spread is explained by which group a value falls in — categories that
 *  actually differ score high, categories that don't (same measure
 *  regardless of group) score near 0. */
/** `NEUTRAL_NO_REPLICATION`: with one observation per group (`k >= n`),
 *  within-group variance is undefined (every group's own SS is trivially
 *  0), so the naive ratio below is ALWAYS 1 regardless of whether the
 *  category means anything — a mathematical artifact of zero degrees of
 *  freedom, not real structure. Deliberately BELOW a coin-flip 0.5, not
 *  the naive 1: "cannot be estimated" is a weaker claim than "estimated
 *  and moderate", so an un-replicated category should score BELOW one
 *  whose measured effect is genuinely middling, not the same as it —
 *  until there's a second observation per group to compare against. */
const NEUTRAL_NO_REPLICATION = 0.3;

function betweenGroupVarianceRatio(groups: readonly (readonly number[])[]): number {
  const populated = groups.filter((g) => g.length > 0);
  const all = populated.flat();
  const n = all.length, k = populated.length;
  if (n < 2) return 0;
  if (k >= n) return NEUTRAL_NO_REPLICATION;
  const grandMean = mean(all);
  const totalSS = all.reduce((s, v) => s + (v - grandMean) ** 2, 0);
  if (totalSS === 0) return 0;
  let betweenSS = 0, withinSS = 0;
  for (const g of populated) {
    const m = mean(g);
    betweenSS += g.length * (m - grandMean) ** 2;
    for (const v of g) withinSS += (v - m) ** 2;
  }
  // Omega-squared: an unbiased-in-expectation correction over the naive
  // eta-squared (`betweenSS / totalSS`) — it discounts the apparent
  // between-group signal by what a group's own MEAN SQUARE within-group
  // variance would already predict by chance, so a category with THIN
  // replication (2-3 rows/group) doesn't read as more conclusive than it is.
  const msWithin = withinSS / (n - k);
  const omega2 = (betweenSS - (k - 1) * msWithin) / (totalSS + msWithin);
  return clamp01(omega2);
}

// ── Entropy ─────────────────────────────────────────────────────────────

/** Normalized Shannon entropy of a numeric column's own value HISTOGRAM —
 *  a constant column (one bin holds everything) scores exactly 0; a column
 *  whose values spread evenly across its own bins scores near 1. Bin count
 *  is `clamp(distinctCount, 2, 10)`: few distinct values get one bin each
 *  (no empty-bin dilution), a continuous column gets a fixed 10-bin read. */
function measureHistogramEntropy(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const min = Math.min(...values), max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return 0;
  const distinct = new Set(values).size;
  const bins = Math.max(2, Math.min(10, distinct));
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / (max - min)) * bins)));
    counts[idx]! += 1;
  }
  return normalizedEntropy(counts, bins);
}

function normalizedEntropy(counts: readonly number[], totalBins: number): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || totalBins <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
  }
  return clamp01(h / Math.log(totalBins));
}

/** Legibility-shaped cardinality curve: a category axis with 2-12 distinct
 *  values reads best; a single value (no discrimination) or a wall of 40+
 *  values (label soup) reads worst. Entropy of a category axis is capped by
 *  this curve, per the design doc's own wording. */
function categoryLegibilityBell(n: number): number {
  if (n <= 1) return 0;
  if (n <= 12) return 1;
  if (n >= 40) return 0.05;
  return 1 - ((n - 12) * 0.95) / 28;
}

function categoricalEntropyWithLegibility(values: readonly string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const n = counts.size;
  return clamp01(normalizedEntropy([...counts.values()], n) * categoryLegibilityBell(n));
}

// ── Materialization: apply a candidate's own pipeline (if any) to the
// profile's row sample, then read columns by name — this is what lets the
// wide-year pivot and multi-measure melt candidates share the exact same
// scoring code as every other candidate instead of a hand-rolled special
// case per transform. ───────────────────────────────────────────────────

function materialize(sample: readonly TabularRow[], pipeline?: readonly PipelineStep[]): readonly TabularRow[] {
  if (!pipeline || pipeline.length === 0) return sample;
  const result = runPipeline(sample, pipeline);
  return result.ok ? result.rows : sample;
}

function numericValues(rows: readonly TabularRow[], col: string | undefined): number[] {
  if (!col) return [];
  const out: number[] = [];
  for (const r of rows) {
    const v = r[col];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}
function cellToString(v: TabularCell): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}
function stringValues(rows: readonly TabularRow[], col: string | undefined): string[] {
  if (!col) return [];
  const out: string[] = [];
  for (const r of rows) { const s = cellToString(r[col]); if (s !== undefined) out.push(s); }
  return out;
}
/** Best-effort ordered-axis value: a date parses via `Date.parse`, else a
 *  bare numeric string (a melted "year" column) parses via `Number`. */
function orderedAxisValue(v: TabularCell): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function channelCoverage(rows: readonly TabularRow[], rowCount: number, cols: readonly (string | undefined)[], grouped: boolean): number {
  const used = cols.filter((c): c is string => c !== undefined);
  if (used.length === 0 || rowCount === 0) return 0;
  const complete = rows.filter((r) => used.every((c) => r[c] !== null && r[c] !== undefined)).length;
  const raw = clamp01(complete / rowCount);
  // Aggregation loses row-level detail even when it's the RIGHT move
  // (>500-row `group`) — a flat discount, not a cliff.
  return grouped ? raw * 0.7 : raw;
}

// ── Legibility ──────────────────────────────────────────────────────────

function crowdingPenalty(count: number, comfortable: number, hardMax: number): number {
  if (count <= comfortable) return 0;
  if (count >= hardMax) return 0.6;
  return (0.6 * (count - comfortable)) / (hardMax - comfortable);
}
function seriesPenalty(seriesCount: number): number {
  return seriesCount <= 6 ? 0 : Math.min(0.5, (seriesCount - 6) * 0.08);
}

/** A measure whose values sum to ~100 or ~1 reads as a SHARE of a whole
 *  (percentages, or fractions) — composition, not a sequence. Shared by
 *  `scoreArc`'s prior (a bonus) and the funnel generator (an exclusion). */
function isShareLikeSum(values: readonly number[]): boolean {
  const total = values.reduce((a, b) => a + b, 0);
  return Math.abs(total - 100) < 1 || Math.abs(total - 1) < 0.01;
}

// ── Prior (small tie-breaker) ───────────────────────────────────────────

function priorFor(names: { readonly measure?: string; readonly x?: string }, opts?: { readonly shareLike?: boolean }): number {
  const signals: number[] = [];
  if (names.measure) signals.push(MEASURE_NAME_LEXICON_RE.test(names.measure) ? 1 : 0);
  // A time-named x is a bonus, never a penalty: a bar's x is a CATEGORY
  // and can't carry a time word, so averaging a 0 in for it halved every
  // category mark's prior against a `cell` or `arc` that names no x at all
  // — the whole 0.05 by which a heatmap out-ranked the identical stacked
  // bar on `olympics-2024-medals-by-type` (`docs/design/charts.md`'s
  // "Mark-type fit").
  if (names.x && X_NAME_LEXICON_RE.test(names.x)) signals.push(1);
  if (opts?.shareLike !== undefined) signals.push(opts.shareLike ? 1 : 0);
  if (signals.length === 0) return 0.3;
  return clamp01(signals.reduce((a, b) => a + b, 0) / signals.length);
}

// ── Reason text ─────────────────────────────────────────────────────────

function describe(mark: string, parts: readonly string[]): string {
  return parts.length > 0 ? `${mark} of ${parts.join(" ")}` : mark;
}

// ── Per-mark scoring ────────────────────────────────────────────────────

interface ScoreInput {
  readonly sample: readonly TabularRow[];
  readonly rowCount: number;
  readonly pipeline?: readonly PipelineStep[];
  readonly transform?: ChartCandidateTransform;
  /** Total measures + categories the PROFILE has to offer (excluding
   *  id-like columns) — the denominator every mark's own "breadth" term
   *  divides by. Computed once per profile. */
  readonly totalEngageable: number;
}

/** How much of the profiled table's own measures/categories a candidate
 *  actually shows: a mapping using 2 of a table's 6 informative columns
 *  shows a narrower slice than one using all 6, even when the 2 it does
 *  show are individually well-scored — this is a genuine breadth-of-
 *  information factor `coverage` (row/null completeness) alone doesn't
 *  capture, since a candidate can use every ROW and still leave most of
 *  the table's COLUMNS unshown. A pool of only 1-2 total columns (nothing
 *  to have left out) never earns less than full breadth. */
function breadthFactor(channelsEngaged: number, totalEngageable: number): number {
  if (totalEngageable <= 2) return 1;
  return clamp01(channelsEngaged / totalEngageable);
}

function seriesGroups(rows: readonly TabularRow[], xCol: string, yCol: string, fillCol: string | undefined): readonly { readonly xs: number[]; readonly ys: number[] }[] {
  const buckets = new Map<string, { xs: number[]; ys: number[] }>();
  for (const r of rows) {
    const xv = orderedAxisValue(r[xCol]);
    const yv = r[yCol];
    if (xv === undefined || typeof yv !== "number" || !Number.isFinite(yv)) continue;
    const key = fillCol ? (cellToString(r[fillCol]) ?? "") : "";
    if (!buckets.has(key)) buckets.set(key, { xs: [], ys: [] });
    buckets.get(key)!.xs.push(xv);
    buckets.get(key)!.ys.push(yv);
  }
  const out: { xs: number[]; ys: number[] }[] = [];
  for (const { xs, ys } of buckets.values()) {
    const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
    out.push({ xs: order.map((i) => xs[i]!), ys: order.map((i) => ys[i]!) });
  }
  return out;
}

/** `AREA_LEGIBILITY_DISCOUNT`: an unfilled area reads no more informative
 *  than the same line, at heavier ink — a small, constant legibility cost
 *  documented in `docs/design/charts.md`, not a hidden mark preference. */
const AREA_LEGIBILITY_DISCOUNT = 0.04;
/** See `scoreLineArea`'s own comment: connecting two independent MEASURES
 *  with a line implies an adjacency the data doesn't carry. */
const MONOTONIC_X_LEGIBILITY_DISCOUNT = 0.3;
/** A scatter of one measure over a DATE axis shows the trend a line does
 *  without the stroke that makes adjacency legible — a documented notch
 *  below `area`'s own discount, so for the same x/y the order is always
 *  line > area > dot. It exists so a time scatter is a real, bindable
 *  candidate for the mark-type toggle, never so it can win. */
const DOT_OVER_TIME_LEGIBILITY_DISCOUNT = 0.08;

function scoreLineArea(mark: "line" | "area" | "dot", x: string, y: string, fill: string | undefined, xIsOrderedMeasure: boolean, otherMeasures: readonly string[], input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const groups = seriesGroups(rows, x, y, fill);
  const allYs = numericValues(rows, y);
  const measureEntropy = measureHistogramEntropy(allYs);
  const fillEntropy = fill ? categoricalEntropyWithLegibility(stringValues(rows, fill)) : 0;
  const entropy = fill ? measureEntropy * 0.65 + fillEntropy * 0.35 : measureEntropy;

  // A MONOTONIC-NUMERIC x is itself a measure — a line drawn over two
  // correlated measures is the same "one arbitrary slice of a collinear
  // set" case `scoreDot` guards against, so it takes the identical
  // distinctiveness discount. A genuine date/time x has no such twin.
  const collinearityDiscount = xIsOrderedMeasure ? collinearityDiscountFor(x, y, otherMeasures, rows) : 0;
  // Sample-size confidence guards against reading too much into a THIN
  // correlation ESTIMATE — real for a monotonic-numeric x (scoreDot's own
  // concern: is this pair's relationship real or noise). A genuine date
  // x isn't estimating an unknown coefficient at all — a 2-point time
  // series' direction is exactly, not approximately, what those 2 points
  // show, so it earns no such discount.
  const structurePerGroup = groups.map((g) => {
    if (g.xs.length < 2) return 0;
    const confidence = xIsOrderedMeasure ? sampleConfidence(g.xs.length) : 1;
    const trend = Math.abs(spearman(g.xs, g.ys)) * confidence * (1 - collinearityDiscount);
    const smooth = lag1Autocorrelation(g.ys) * confidence;
    return g.xs.length >= 3 ? 0.5 * trend + 0.5 * smooth : trend;
  });
  const structure = structurePerGroup.length > 0 ? mean(structurePerGroup) : 0;

  const grouped = input.transform?.kind === "group";
  // A monotonic-numeric x takes the SAME "narrow slice of the table"
  // breadth discount every OTHER mark does — it engages just this
  // x/y(/fill), never the other measures/categories the profile also has.
  // A genuine date x carries no such twin (dates aren't melted from a
  // measure pool, so there's no "the rest of the pool" to have skipped).
  const breadth = xIsOrderedMeasure ? breadthFactor(fill ? 3 : 2, input.totalEngageable) : 1;
  const coverage = channelCoverage(rows, fill ? rows.length : input.rowCount, [x, y, fill], grouped) * breadth;
  const totalPoints = groups.reduce((s, g) => s + g.xs.length, 0);
  const crowd = crowdingPenalty(totalPoints, 150, 800);
  const series = fill ? seriesPenalty(groups.length) : 0;
  const areaPenalty = mark === "area" ? AREA_LEGIBILITY_DISCOUNT : mark === "dot" ? DOT_OVER_TIME_LEGIBILITY_DISCOUNT : 0;
  // A line/area MEANS "x is a real ordered axis" — connecting two
  // independent MEASURES in x-sorted order implies an adjacency/path
  // narrative the data doesn't actually carry (unlike a genuine date/time
  // axis, where x-adjacency IS the story). `dot` is the honest mark for
  // two measures; a monotonic-numeric x here is legible but a documented
  // notch below the same shape plotted the right way.
  const orderedMeasurePenalty = xIsOrderedMeasure ? MONOTONIC_X_LEGIBILITY_DISCOUNT : 0;
  const legibility = clamp01(1 - crowd - series - areaPenalty - orderedMeasurePenalty);

  const prior = priorFor({ measure: y, x });
  return combine({ entropy, structure, coverage, legibility, prior });
}

function reduceValues(values: readonly number[], reduce: "sum" | "mean"): number {
  const total = values.reduce((a, b) => a + b, 0);
  return reduce === "sum" ? total : total / values.length;
}

function scoreBar(x: string, y: string, fill: string | undefined, input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const byX = new Map<string, number[]>();
  for (const r of rows) {
    const xs = cellToString(r[x]); const yv = r[y];
    if (xs === undefined || typeof yv !== "number" || !Number.isFinite(yv)) continue;
    if (!byX.has(xs)) byX.set(xs, []);
    byX.get(xs)!.push(yv);
  }

  // A `group` transform AGGREGATES to one row per x before the chart ever
  // reads it — scoring the raw per-row values instead would judge a
  // picture the reader never sees (and, worse, would inherit the same
  // zero-degrees-of-freedom artifact `betweenGroupVarianceRatio` guards
  // against, since the un-aggregated groups are what created it).
  const grouped = input.transform?.kind === "group";
  const groupedYValues = grouped ? [...byX.values()].map((vs) => reduceValues(vs, input.transform!.reduce)) : numericValues(rows, y);
  const measureEntropy = measureHistogramEntropy(groupedYValues);
  const xEntropy = categoricalEntropyWithLegibility(stringValues(rows, x));
  const fillEntropy = fill ? categoricalEntropyWithLegibility(stringValues(rows, fill)) : 0;
  const entropy = fill ? measureEntropy * 0.5 + xEntropy * 0.25 + fillEntropy * 0.25 : measureEntropy * 0.6 + xEntropy * 0.4;

  const structureGroups = grouped ? groupedYValues.map((v) => [v]) : [...byX.values()];
  const structure = betweenGroupVarianceRatio(structureGroups);

  const coverage = channelCoverage(rows, rows.length, [x, y, fill], grouped) * breadthFactor(fill ? 3 : 2, input.totalEngageable);
  const xCount = new Set(stringValues(rows, x)).size;
  const crowd = crowdingPenalty(xCount, 20, 60);
  const series = fill ? seriesPenalty(new Set(stringValues(rows, fill)).size) : 0;
  const legibility = clamp01(1 - crowd - series);

  const prior = priorFor({ measure: y, x });
  return combine({ entropy, structure, coverage, legibility, prior });
}

/** The multi-measure melt bar (`x = category, y = "value", fill =
 *  "measure"`) is scored SEPARATELY from a plain `scoreBar` call: its
 *  melted "value" column pools every measure's RAW values regardless of
 *  unit or scale (centimetres of sepal length beside centimetres of petal
 *  width, or dollars beside a percentage), so a between-group variance
 *  ratio taken on that pooled column mostly measures which MEASURE a row
 *  came from, not whether the category explains anything — structure
 *  computed there is close to meaningless. The real question — "does this
 *  category explain each measure's own variance" — is answered by scoring
 *  EACH measure's own between-group ratio on the un-melted data and
 *  averaging: a category that genuinely separates sepal/petal size (Fisher's
 *  iris, by species) scores high; one that's interleaved with it (a
 *  synthetic sequence index disguised as a category) scores low, exactly
 *  the discrimination a reader wants from "one series per measure". */
/** Z-score (mean 0, unit variance); a constant column normalizes to all
 *  zeros rather than dividing by a zero std. */
function zScores(values: readonly number[]): number[] {
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  const std = Math.sqrt(variance);
  return std === 0 ? values.map(() => 0) : values.map((v) => (v - m) / std);
}

function scoreBarMelt(catName: string, measureNames: readonly string[], input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const original = input.sample;
  // Pool every measure into ONE scale-free structure estimate, never a
  // per-row-only or a raw-unit pool: z-scoring each measure independently
  // before grouping removes the cross-measure SCALE confound a raw pool
  // has (centimetres of sepal length beside centimetres of petal width) —
  // exactly what let `sepal_length`'s huge range swamp `petal_width`'s
  // small one in the between-group sum — while still letting several
  // measures serve as each other's replicate observations per category
  // when the category itself has only one row per measure (a region
  // table with `sales`/`target`: 1 row per region, but 2 NORMALIZED
  // measures per region is real replication a per-measure-alone estimate,
  // needing within-measure repeats, cannot see at all).
  const byX = new Map<string, number[]>();
  for (const m of measureNames) {
    const rowsWithValue = original.filter((r) => typeof r[m] === "number" && Number.isFinite(r[m] as number));
    const z = zScores(rowsWithValue.map((r) => r[m] as number));
    rowsWithValue.forEach((r, i) => {
      const xs = cellToString(r[catName]);
      if (xs === undefined) return;
      if (!byX.has(xs)) byX.set(xs, []);
      byX.get(xs)!.push(z[i]!);
    });
  }
  const structure = betweenGroupVarianceRatio([...byX.values()]);

  const rows = materialize(input.sample, input.pipeline);
  const measureEntropy = measureHistogramEntropy(numericValues(rows, "value"));
  const xEntropy = categoricalEntropyWithLegibility(stringValues(rows, catName));
  const fillEntropy = categoricalEntropyWithLegibility(stringValues(rows, "measure"));
  const entropy = measureEntropy * 0.5 + xEntropy * 0.25 + fillEntropy * 0.25;

  const coverage = channelCoverage(rows, rows.length, [catName, "value", "measure"], false) * breadthFactor(measureNames.length + 1, input.totalEngageable);
  const xCount = new Set(stringValues(rows, catName)).size;
  const crowd = crowdingPenalty(xCount, 20, 60);
  const series = seriesPenalty(measureNames.length);
  const legibility = clamp01(1 - crowd - series);

  const prior = priorFor({ measure: "value", x: catName });
  return combine({ entropy, structure, coverage, legibility, prior });
}

function scoreDot(x: string, y: string, fill: string | undefined, otherMeasures: readonly string[], input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const xs = numericValues(rows, x), ys = numericValues(rows, y);
  const entropy = fill
    ? measureHistogramEntropy(xs) * 0.325 + measureHistogramEntropy(ys) * 0.325 + categoricalEntropyWithLegibility(stringValues(rows, fill)) * 0.35
    : measureHistogramEntropy(xs) * 0.5 + measureHistogramEntropy(ys) * 0.5;

  const paired: { x: number; y: number }[] = [];
  for (const r of rows) {
    const xv = r[x], yv = r[y];
    if (typeof xv === "number" && Number.isFinite(xv) && typeof yv === "number" && Number.isFinite(yv)) paired.push({ x: xv, y: yv });
  }
  const pairCorr = Math.abs(pearson(paired.map((p) => p.x), paired.map((p) => p.y)));
  // Distinctiveness discount: a THIRD measure that tracks x or y just as
  // closely means this pair isn't the interesting relationship, it's a
  // representative of a whole collinear cluster (a broader mark showing
  // every measure at once — `bar`'s multi-measure melt, `cell` — captures
  // that cluster structure without picking one arbitrary pair of it).
  const collinearityDiscount = collinearityDiscountFor(x, y, otherMeasures, rows);
  const structure = pairCorr * sampleConfidence(paired.length) * (1 - collinearityDiscount);

  const coverage = channelCoverage(rows, rows.length, [x, y, fill], false) * breadthFactor(fill ? 3 : 2, input.totalEngageable);
  const crowd = crowdingPenalty(paired.length, 300, 1500);
  const series = fill ? seriesPenalty(new Set(stringValues(rows, fill)).size) : 0;
  const legibility = clamp01(1 - crowd - series);

  const prior = priorFor({ measure: y, x });
  return combine({ entropy, structure, coverage, legibility, prior });
}

function scoreArc(fill: string, y: string, input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const byFill = new Map<string, number>();
  for (const r of rows) {
    const fv = cellToString(r[fill]); const yv = r[y];
    if (fv === undefined || typeof yv !== "number" || !Number.isFinite(yv) || yv < 0) continue;
    byFill.set(fv, (byFill.get(fv) ?? 0) + yv);
  }
  const shares = [...byFill.values()];
  const total = shares.reduce((a, b) => a + b, 0);
  const entropy = total > 0 ? normalizedEntropy(shares, shares.length) : 0;

  // Arc has no natural second-variable relationship the way a trend or a
  // correlation does — structure is a neutral baseline, and entropy/
  // legibility/prior do the differentiating.
  const structure = 0.5;

  const coverage = channelCoverage(rows, rows.length, [fill, y], false) * breadthFactor(2, input.totalEngageable);
  const legibility = categoryLegibilityBell(byFill.size);
  const prior = priorFor({ measure: y }, { shareLike: isShareLikeSum(shares) });
  return combine({ entropy, structure, coverage, legibility, prior });
}

function scoreCell(x: string, y: string, fill: string, input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const fillValues = numericValues(rows, fill);
  const measureEntropy = measureHistogramEntropy(fillValues);
  const xEntropy = categoricalEntropyWithLegibility(stringValues(rows, x));
  const yEntropy = categoricalEntropyWithLegibility(stringValues(rows, y));
  const entropy = measureEntropy * 0.5 + xEntropy * 0.25 + yEntropy * 0.25;

  const byX = new Map<string, number[]>();
  for (const r of rows) {
    const xs = cellToString(r[x]); const fv = r[fill];
    if (xs === undefined || typeof fv !== "number" || !Number.isFinite(fv)) continue;
    if (!byX.has(xs)) byX.set(xs, []);
    byX.get(xs)!.push(fv);
  }
  const structure = betweenGroupVarianceRatio([...byX.values()]);

  const coverage = channelCoverage(rows, rows.length, [x, y, fill], false) * breadthFactor(3, input.totalEngageable);
  const cells = new Set(stringValues(rows, x)).size * new Set(stringValues(rows, y)).size;
  const legibility = clamp01(1 - crowdingPenalty(cells, 200, 800));
  const prior = priorFor({ measure: fill });
  return combine({ entropy, structure, coverage, legibility, prior });
}

function scoreSankey(source: string, target: string, value: string, input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const values = numericValues(rows, value).filter((v) => v > 0);
  const entropy = measureHistogramEntropy(values);

  // Like arc, a sankey has no "does the category explain the measure"
  // relationship for `betweenGroupVarianceRatio` to answer — its value IS
  // the flow structure between nodes (already required at the ELIGIBILITY
  // gate: the source/target pair must form a genuine DAG), not a
  // statement about one axis's variance. A flow graph's real node/edge
  // topology is typically skewed (a few hub nodes, several leaves), which
  // makes a per-source variance estimate noisy rather than meaningful —
  // neutral, and let entropy/coverage/legibility/prior differentiate.
  const structure = 0.5;

  const coverage = channelCoverage(rows, rows.length, [source, target, value], false) * breadthFactor(3, input.totalEngageable);
  const nodes = new Set([...stringValues(rows, source), ...stringValues(rows, target)]).size;
  const legibility = clamp01(1 - crowdingPenalty(nodes, 20, 60));
  const prior = priorFor({ measure: value });
  return combine({ entropy, structure, coverage, legibility, prior });
}

/** A category column reading as PROCESS stages, not an arbitrary group —
 *  the funnel-specific half of the name prior, since "region"/"country"
 *  monotone-by-coincidence is a very different claim from "stage". */
const STAGE_NAME_LEXICON_RE = /stage|step|phase|funnel|level/i;

function scoreFunnel(stage: string, value: string, input: ScoreInput): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const rows = materialize(input.sample, input.pipeline);
  const values = numericValues(rows, value).filter((v) => v > 0);
  const entropy = measureHistogramEntropy(values);

  let steps = 0, nonIncreasing = 0;
  for (let i = 1; i < values.length; i++) {
    steps += 1;
    if (values[i]! <= values[i - 1]!) nonIncreasing += 1;
  }
  const rawFraction = steps > 0 ? nonIncreasing / steps : 0.5;
  // A handful of transitions gives a monotonicity fraction real sampling
  // noise (a coin flip clears 50% "non-increasing" on any given short
  // run) — shrink toward the chance baseline (0.5) exactly as
  // `sampleConfidence` shrinks a thin correlation, using the transition
  // COUNT as the "n" (a transition is the unit of evidence here, not a row).
  const confidence = sampleConfidence(steps);
  const structure = 0.5 + (rawFraction - 0.5) * confidence;

  const coverage = channelCoverage(rows, rows.length, [stage, value], false) * breadthFactor(2, input.totalEngageable);
  const stages = new Set(stringValues(rows, stage)).size;
  const legibility = categoryLegibilityBell(stages);
  const measureSignal = MEASURE_NAME_LEXICON_RE.test(value) ? 1 : 0;
  const stageSignal = STAGE_NAME_LEXICON_RE.test(stage) ? 1 : 0;
  const prior = clamp01((measureSignal + stageSignal) / 2);
  return combine({ entropy, structure, coverage, legibility, prior });
}

function combine(terms: ChartCandidateTerms): { readonly terms: ChartCandidateTerms; readonly score: number } {
  const w = CHART_CANDIDATE_WEIGHTS;
  const score = clamp01(terms.entropy * w.entropy + terms.structure * w.structure + terms.coverage * w.coverage + terms.legibility * w.legibility + terms.prior * w.prior);
  return { terms, score };
}

// ── Enumeration ─────────────────────────────────────────────────────────

function pairs<T>(items: readonly T[]): (readonly [T, T])[] {
  const out: (readonly [T, T])[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!]);
  return out;
}

function categoryPairFormsDag(sample: readonly TabularRow[], sourceCol: string, targetCol: string): boolean {
  const adjacency = new Map<string, Set<string>>();
  for (const row of sample) {
    const s = cellToString(row[sourceCol]); const t = cellToString(row[targetCol]);
    if (s === undefined || t === undefined) continue;
    if (s === t) return false;
    if (!adjacency.has(s)) adjacency.set(s, new Set());
    adjacency.get(s)!.add(t);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return false;
      if (c === WHITE && !visit(next)) return false;
    }
    color.set(node, BLACK);
    return true;
  };
  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && !visit(node)) return false;
  }
  return true;
}

/** Ordered-axis values of `col` in ROW order, bucketed by `groupCol`'s own
 *  value (one bucket for no group). A row whose x doesn't parse, or whose
 *  group is null, is skipped. */
function orderedAxisBuckets(sample: readonly TabularRow[], col: string, groupCol: string | undefined): readonly (readonly number[])[] {
  const buckets = new Map<string, number[]>();
  for (const row of sample) {
    const v = orderedAxisValue(row[col] ?? null);
    const key = groupCol === undefined ? "" : cellToString(row[groupCol] ?? null);
    if (v === undefined || key === undefined) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
  }
  return [...buckets.values()];
}

/** A NUMERIC column is an ordered x axis (within `groupCol`, or across the
 *  whole table) only when its values STRICTLY increase in row order in
 *  every bucket, at least two per bucket. The profiler's own `monotonic`
 *  flag, used before, fails twice (`docs/design/charts.md`'s "Mark-type
 *  fit"): it also accepts a DEcreasing or tied column — a table pre-sorted
 *  by rank (`olympics-2024-medals`' `gold`: 40, 40, 20, ...), a ranking and
 *  not an axis, so "a line of bronze over gold" was a candidate — and it
 *  is taken over the WHOLE column, so a long-format integer year repeated
 *  per country read as `none` and produced no line at all. */
function strictlyIncreasingWithin(sample: readonly TabularRow[], col: string, groupCol: string | undefined): boolean {
  const buckets = orderedAxisBuckets(sample, col, groupCol);
  if (buckets.length === 0) return false;
  return buckets.every((vs) => vs.length >= 2 && vs.every((v, i) => i === 0 || v > vs[i - 1]!));
}

/** A DATE x connects into ONE honest line per bucket only when no date
 *  repeats in it; a repeated date draws a vertical zig-zag through every
 *  row that shares it (`world-population-by-country`'s UNFILLED line: six
 *  countries per year, one stroke through all of them). */
function uniqueWithin(sample: readonly TabularRow[], col: string, groupCol: string | undefined): boolean {
  const buckets = orderedAxisBuckets(sample, col, groupCol);
  if (buckets.length === 0) return false;
  return buckets.every((vs) => new Set(vs).size === vs.length);
}

/** Every row's combination of `cols` values occurs once. */
function keysUnique(sample: readonly TabularRow[], cols: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const row of sample) {
    const key = JSON.stringify(cols.map((c) => cellToString(row[c] ?? null) ?? null));
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** An integer column with a handful of distinct values repeated across
 *  many rows is a CODE (a passenger class, a rating bucket), not a
 *  measure: `measureHistogramEntropy` gives it one bin per value, so three
 *  evenly-used codes score entropy ~1.0 — the maximum — and "mean
 *  passenger class by sex" out-ranked every real measure on a titanic-
 *  shaped table. Both bounds matter: a 4-row `{month, value}` table's
 *  integer value has 4 distinct values and is a real measure, which the
 *  repetition floor keeps. */
const CODE_LIKE_MAX_DISTINCT = 4;
const CODE_LIKE_MIN_ROWS_PER_VALUE = 10;
export function isCodeLikeInteger(col: ColumnProfile, rowCount: number): boolean {
  return col.type === "integer" && col.distinctCount <= CODE_LIKE_MAX_DISTINCT
    && rowCount - col.nullCount >= CODE_LIKE_MIN_ROWS_PER_VALUE * col.distinctCount;
}

/** Widest axis (categories or dates) a bar chart is offered over — the
 *  hard maximum `scoreBar`'s own crowding curve bottoms out at. Past it a
 *  web chart's ~88 plot columns give each bar under two cells (142
 *  countries on `gdp-life-expectancy-2007`), which the crowding penalty
 *  alone only discounted and never ruled out. */
export const CHART_CANDIDATE_BAR_AXIS_MAX = 60;

/** A sankey needs an EDGE LIST, which `categoryPairFormsDag` alone never
 *  checked — two category columns with disjoint vocabularies are always
 *  acyclic, so every table with two categories had a sankey candidate on a
 *  neutral 0.5 structure that out-ranked real but noisy relationships (a
 *  titanic-shaped table's top pick was "fare flowing from survived to
 *  sex"). An edge list has all three of:
 *  - every (source, target) pair at most once — a repeated pair is a
 *    cross-tab aggregated on the fly (200 passengers, 4 pairs);
 *  - a finite positive value on every edge row — the library rejects the
 *    first null or nonpositive flow outright (`sankey-bad-value`);
 *  - NOT every source paired with every target — a complete grid is a
 *    contingency table (10 countries x 3 medals, 30 rows), which `cell`
 *    and a stacked `bar` read honestly and a sankey only tangles. */
function sankeyEdgeList(sample: readonly TabularRow[], source: string, target: string, value: string): boolean {
  const pairs = new Set<string>();
  const sources = new Set<string>(), targets = new Set<string>();
  for (const row of sample) {
    const s = cellToString(row[source] ?? null), t = cellToString(row[target] ?? null);
    if (s === undefined || t === undefined) continue;
    const v = row[value];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
    const key = JSON.stringify([s, t]);
    if (pairs.has(key)) return false;
    pairs.add(key); sources.add(s); targets.add(t);
  }
  return pairs.size >= 2 && pairs.size < sources.size * targets.size;
}

/** Every valid mapping the profiled table can honestly support, each
 *  scored — sorted best first, capped at `CHART_CANDIDATE_MAX`. Never
 *  empty for a non-empty profile: a last-resort "by row order" line, or a
 *  bare no-channel bar, always fires when nothing else does. */
export function buildChartCandidates(profile: DataProfile): readonly ChartCandidate[] {
  const { columns, rowCount } = profile;
  const sample = profile.sample ?? [];
  const dates = dateColumns(columns);
  const numbers = numericColumns(columns);
  const categories = categoryColumns(columns);
  const measureNumbers = numbers.filter((c) => !isIdLikeColumn(c, rowCount));
  // codex P1-8 (`REVIEW-batch4-codex.md`): the old fallback
  // (`measureNumbers.length > 0 ? measureNumbers : numbers`) reintroduced
  // every excluded identifier the instant they were the table's ONLY
  // numeric columns — an `{id, name}` table's top candidate was a pie of
  // `id`. When every numeric column is an identifier there is no measure
  // at all; `effectiveNumbers` stays empty, every candidate loop below
  // that iterates it contributes nothing, and the "no obvious numeric or
  // date column found" last-resort fallback (this function's own tail)
  // fires instead — `remoteDatasetRecommendationCheck` then reports
  // `{ ok: false }` and the dataset is never dispatched or recorded as
  // Recent (`ChartsWorkbench.tsx`'s own pre-dispatch usability check).
  // A code-like integer (`isCodeLikeInteger`) is no more a measure than an
  // identifier is.
  const fillCategories = categories.filter((c) => c.distinctCount >= 2 && c.distinctCount <= CHART_CANDIDATE_FILL_MAX_CATEGORIES);
  // An ordered x is a date, or a numeric column that strictly increases in
  // row order — across the table (`plain`) and/or within each value of a
  // small category (`fills`). Only the variants whose own buckets pass are
  // offered: an unfilled line over a repeated x zig-zags.
  const orderedX = [
    ...dates.map((col) => ({ col, isMeasure: false, plain: uniqueWithin(sample, col.name, undefined), fills: fillCategories.filter((cat) => uniqueWithin(sample, col.name, cat.name)) })),
    // An ordered integer NAMED like time (`year`, `month`) is a time axis,
    // not a measure: scoring it as one took the ordered-measure legibility
    // discount (0.3), the breadth discount and sample-confidence shrinkage,
    // so on a long-format `{country, year, life_exp, pop}` table a scatter
    // of life expectancy against population out-ranked life expectancy
    // over time. It also stops pairing into a `dot` as if it were a value.
    ...measureNumbers.map((col) => ({ col, isMeasure: !X_NAME_LEXICON_RE.test(col.name), plain: strictlyIncreasingWithin(sample, col.name, undefined), fills: fillCategories.filter((cat) => strictlyIncreasingWithin(sample, col.name, cat.name)) })),
  ].filter((x) => x.plain || x.fills.length > 0);
  const timeAxisNames = new Set(orderedX.filter((x) => !x.isMeasure && x.col.type !== "date").map((x) => x.col.name));
  const effectiveNumbers = measureNumbers.filter((c) => !isCodeLikeInteger(c, rowCount) && !timeAxisNames.has(c.name));
  const groupEligible = rowCount > CHART_CANDIDATE_GROUP_ROW_THRESHOLD;

  const out: ChartCandidate[] = [];
  const totalEngageable = effectiveNumbers.length + categories.length;
  const input: ScoreInput = { sample, rowCount, totalEngageable };

  // ── line / area ──
  const firstCategory = categories[0];
  for (const { col: x, isMeasure: xIsOrderedMeasure, plain, fills } of orderedX) {
    const otherMeasuresForX = effectiveNumbers.filter((m) => m.name !== x.name).map((m) => m.name);
    for (const y of effectiveNumbers) {
      if (y.name === x.name) continue;
      const otherMeasures = otherMeasuresForX.filter((m) => m !== y.name);
      for (const mark of ["line", "area"] as const) {
        const plainReason = firstCategory
          ? firstCategory.distinctCount <= CHART_CANDIDATE_FILL_MAX_CATEGORIES
            ? `${y.name} over ${x.name} (see the filled variant, one line per ${firstCategory.name})`
            : `${x.name} over time vs ${y.name} (${firstCategory.name} has ${firstCategory.distinctCount} categories — too many to fill legibly)`
          : `${x.name} over time vs ${y.name}`;
        if (plain) {
          const { terms, score } = scoreLineArea(mark, x.name, y.name, undefined, xIsOrderedMeasure, otherMeasures, input);
          out.push({ mark, channels: { x: x.name, y: y.name }, reason: plainReason, score, terms });
        }
        if (groupEligible) {
          const reduce = reduceForMeasureName(y.name);
          const grouped = scoreLineArea(mark, x.name, y.name, undefined, xIsOrderedMeasure, otherMeasures, { ...input, transform: { kind: "group", reduce } });
          out.push({
            mark, channels: { x: x.name, y: y.name }, transform: { kind: "group", reduce },
            reason: `${plainReason} (${rowCount} rows grouped by ${x.name}, ${reduce})`, score: grouped.score, terms: grouped.terms,
          });
        }
      }
      for (const cat of fills) {
        for (const mark of ["line", "area"] as const) {
          const { terms, score } = scoreLineArea(mark, x.name, y.name, cat.name, xIsOrderedMeasure, otherMeasures, input);
          out.push({ mark, channels: { x: x.name, y: y.name, fill: cat.name }, reason: `${y.name} over ${x.name}, one ${mark} per ${cat.name}`, score, terms });
        }
      }
    }
  }

  // ── dot over time ── (a scatter needs no unique x; two-measure dots are
  // enumerated below)
  for (const x of dates) {
    for (const y of effectiveNumbers) {
      const plain = scoreLineArea("dot", x.name, y.name, undefined, false, [], input);
      out.push({ mark: "dot", channels: { x: x.name, y: y.name }, reason: `${y.name} over ${x.name}, one point per row`, score: plain.score, terms: plain.terms });
      for (const cat of fillCategories) {
        const filled = scoreLineArea("dot", x.name, y.name, cat.name, false, [], input);
        out.push({ mark: "dot", channels: { x: x.name, y: y.name, fill: cat.name }, reason: `${y.name} over ${x.name}, coloured by ${cat.name}`, score: filled.score, terms: filled.terms });
      }
    }
  }

  // ── bar over a short date axis ── (a column per period; the same
  // one-bar-per-x rule as a category axis)
  for (const x of dates) {
    if (x.distinctCount < 2 || x.distinctCount > CHART_CANDIDATE_BAR_AXIS_MAX) continue;
    for (const y of effectiveNumbers) {
      if (uniqueWithin(sample, x.name, undefined)) {
        const { terms, score } = scoreBar(x.name, y.name, undefined, input);
        out.push({ mark: "bar", channels: { x: x.name, y: y.name }, reason: describe("bar", [y.name, `by ${x.name}`]), score, terms });
      }
      for (const cat of fillCategories) {
        if (!uniqueWithin(sample, x.name, cat.name)) continue;
        const { terms, score } = scoreBar(x.name, y.name, cat.name, input);
        out.push({ mark: "bar", channels: { x: x.name, y: y.name, fill: cat.name }, reason: `${y.name} by ${x.name}, split by ${cat.name}`, score, terms });
      }
    }
  }

  // ── wide-year pivot (line) ──
  const yearColumns = numbers.filter((c) => YEAR_HEADER_RE.test(c.name));
  if (yearColumns.length >= 3) {
    const idColumns = columns.filter((c) => !yearColumns.includes(c));
    const fillColumn = idColumns.length === 1 && (idColumns[0]!.type === "category" || idColumns[0]!.type === "text") ? idColumns[0] : undefined;
    const pipeline: readonly PipelineStep[] = [{ kind: "pivotLonger", idColumns: idColumns.map((c) => c.name), keyColumn: "year", valueColumn: "value" }];
    const { terms, score } = scoreLineArea("line", "year", "value", fillColumn?.name, false, [], { ...input, pipeline });
    out.push({
      mark: "line", channels: { x: "year", y: "value", ...(fillColumn ? { fill: fillColumn.name } : {}) }, pipeline,
      reason: `${yearColumns.length} year columns (${yearColumns[0]!.name}–${yearColumns[yearColumns.length - 1]!.name}) reshaped long, one line per ${fillColumn ? fillColumn.name : "row"}`,
      score, terms,
    });
  }

  // ── bar ── (its plain x-axis pool is WIDER than `categories` — see
  // `barAxisColumns`'s own doc)
  for (const cat of barAxisColumns(columns, rowCount)) {
    if (cat.distinctCount > CHART_CANDIDATE_BAR_AXIS_MAX) continue;
    // A category whose distinct-value count is BELOW the row count repeats
    // keys — an ungrouped bar over it is AMBIGUOUS (which of several rows
    // sharing an x wins?) rather than a real per-category comparison, so
    // only the explicitly aggregated (`group`) variant is offered; a
    // category with no repeats (one row per value) has nothing to
    // aggregate and keeps the plain mapping. `groupEligible` (the >500-row
    // rule) can ALSO trigger grouping on a non-repeating category — a
    // real per-row category charted whole is still crowded past 500 bars.
    const hasDuplicateKeys = cat.distinctCount < rowCount;
    for (const y of effectiveNumbers) {
      if (!hasDuplicateKeys) {
        const { terms, score } = scoreBar(cat.name, y.name, undefined, input);
        out.push({ mark: "bar", channels: { x: cat.name, y: y.name }, reason: describe("bar", [y.name, `by ${cat.name}`]), score, terms });
      }
      if (hasDuplicateKeys || groupEligible) {
        const reduce = reduceForMeasureName(y.name);
        const grouped = scoreBar(cat.name, y.name, undefined, { ...input, transform: { kind: "group", reduce } });
        out.push({
          mark: "bar", channels: { x: cat.name, y: y.name }, transform: { kind: "group", reduce },
          reason: `${y.name} by ${cat.name} (${rowCount} rows grouped by ${cat.name}, ${reduce})`, score: grouped.score, terms: grouped.terms,
        });
      }
    }
  }
  if (effectiveNumbers.length >= 2 && categories.length >= 1) {
    const idColumns = columns.filter((c) => !effectiveNumbers.includes(c)).map((c) => c.name);
    const pipeline: readonly PipelineStep[] = [{ kind: "pivotLonger", idColumns, keyColumn: "measure", valueColumn: "value" }];
    for (const cat of categories) {
      // Melted, a category with several rows per value has several bars per
      // (category, measure) sub-band, drawn on top of one another — only the
      // tallest shows. The page can't bind the MEAN that would honestly
      // collapse them (`chartsCandidateBindable`), so only a category with
      // one row per value melts (`docs/design/charts.md`'s "Mark-type fit").
      if (cat.distinctCount < rowCount) continue;
      const { terms, score } = scoreBarMelt(cat.name, effectiveNumbers.map((m) => m.name), { ...input, pipeline });
      out.push({
        mark: "bar", channels: { x: cat.name, y: "value", fill: "measure" }, pipeline,
        reason: `${effectiveNumbers.length} numeric columns by ${cat.name}, one series per measure`, score, terms,
      });
    }
  }
  for (const [ca, cb] of pairs(categories)) {
    // A split bar draws one sub-bar per (x, fill) pair; a pair that repeats
    // stacks its rows' bars on top of each other (the same overlap as the
    // melt above), so only a table with one row per pair is split.
    if (!keysUnique(sample, [ca.name, cb.name])) continue;
    for (const y of effectiveNumbers) {
      if (cb.distinctCount >= 2 && cb.distinctCount <= 8) {
        const { terms, score } = scoreBar(ca.name, y.name, cb.name, input);
        out.push({ mark: "bar", channels: { x: ca.name, y: y.name, fill: cb.name }, reason: `${y.name} by ${ca.name}, split by ${cb.name}`, score, terms });
      }
      if (ca.distinctCount >= 2 && ca.distinctCount <= 8) {
        const { terms, score } = scoreBar(cb.name, y.name, ca.name, input);
        out.push({ mark: "bar", channels: { x: cb.name, y: y.name, fill: ca.name }, reason: `${y.name} by ${cb.name}, split by ${ca.name}`, score, terms });
      }
    }
  }

  // ── arc (small non-negative share-like category) ──
  for (const cat of categories) {
    if (cat.distinctCount < 2 || cat.distinctCount > 6) continue;
    // A category with duplicate rows sums its measure across whatever
    // OTHER axis (typically time) separates those rows, silently — an
    // unlabelled aggregation exactly like the ambiguous bar case above.
    // One row per category is a real "whole" to slice; several is an
    // unstated "whole of WHAT" for the reader.
    if (cat.distinctCount < rowCount) continue;
    for (const y of effectiveNumbers) {
      if (typeof y.min !== "number" || y.min < 0) continue;
      const { terms, score } = scoreArc(cat.name, y.name, input);
      out.push({ mark: "arc", channels: { y: y.name, fill: cat.name }, reason: `${cat.name} shares of ${y.name} (${cat.distinctCount} categories)`, score, terms });
    }
  }

  // ── cell (category x category x measure) ──
  for (const [ca, cb] of pairs(categories)) {
    for (const y of effectiveNumbers) {
      const a = scoreCell(ca.name, cb.name, y.name, input);
      out.push({ mark: "cell", channels: { x: ca.name, y: cb.name, fill: y.name }, reason: `${y.name} heatmap of ${ca.name} x ${cb.name}`, score: a.score, terms: a.terms });
      const b = scoreCell(cb.name, ca.name, y.name, input);
      out.push({ mark: "cell", channels: { x: cb.name, y: ca.name, fill: y.name }, reason: `${y.name} heatmap of ${cb.name} x ${ca.name}`, score: b.score, terms: b.terms });
    }
  }

  // ── dot (two measures) ──
  for (const [ma, mb] of pairs(effectiveNumbers)) {
    const otherMeasures = effectiveNumbers.filter((m) => m.name !== ma.name && m.name !== mb.name).map((m) => m.name);
    for (const [x, y] of [[ma, mb], [mb, ma]] as const) {
      const plain = scoreDot(x.name, y.name, undefined, otherMeasures, input);
      out.push({ mark: "dot", channels: { x: x.name, y: y.name }, reason: `${x.name} vs ${y.name}`, score: plain.score, terms: plain.terms });
      for (const cat of categories) {
        if (cat.distinctCount < 2 || cat.distinctCount > CHART_CANDIDATE_FILL_MAX_CATEGORIES) continue;
        const filled = scoreDot(x.name, y.name, cat.name, otherMeasures, input);
        out.push({ mark: "dot", channels: { x: x.name, y: y.name, fill: cat.name }, reason: `${x.name} vs ${y.name}, coloured by ${cat.name}`, score: filled.score, terms: filled.terms });
      }
    }
  }

  // ── sankey (two categories forming a DAG + positive measure) ──
  for (const [ca, cb] of pairs(categories)) {
    if (!categoryPairFormsDag(sample, ca.name, cb.name)) continue;
    for (const y of effectiveNumbers) {
      if (typeof y.min !== "number" || y.min <= 0) continue;
      if (!sankeyEdgeList(sample, ca.name, cb.name, y.name)) continue;
      for (const [source, target] of [[ca, cb], [cb, ca]] as const) {
        const { terms, score } = scoreSankey(source.name, target.name, y.name, input);
        out.push({ mark: "sankey", channels: { source: source.name, target: target.name, value: y.name }, reason: `${y.name} flow from ${source.name} to ${target.name}`, score, terms });
      }
    }
  }

  // ── funnel (an ordered category + positive measure) ──
  for (const cat of categories) {
    if (cat.distinctCount < 2 || cat.distinctCount > 12) continue;
    // Monotonicity alone is a weak claim: a table pre-sorted by RANK (a
    // medal table, any top-N leaderboard) is monotone by construction and
    // is NOT a process with stages — the category NAME is the only signal
    // that separates "these are sequential steps" from "this happens to
    // be sorted". A hard gate, not a soft prior nudge: a coincidentally-
    // monotone ranking otherwise wins on structure alone before the small
    // prior weight can pull it back down.
    if (!STAGE_NAME_LEXICON_RE.test(cat.name)) continue;
    for (const y of effectiveNumbers) {
      if (typeof y.min !== "number" || y.min <= 0) continue;
      // A measure that reads as a SHARE of a whole (values ~summing to 100
      // or 1) is a composition, not a sequence of process stages — arc's
      // domain, not funnel's, even when the row order happens to be
      // monotone. Without this a 3-row percentage breakdown that happens
      // to be listed largest-first outscores the pie it actually is.
      if (isShareLikeSum(numericValues(sample, y.name))) continue;
      const { terms, score } = scoreFunnel(cat.name, y.name, input);
      out.push({ mark: "funnel", channels: { stage: cat.name, value: y.name }, reason: `${y.name} funnel by ${cat.name}`, score, terms });
    }
  }

  // ── last-resort fallbacks (never an empty list for a non-empty profile) ──
  if (out.length === 0 && effectiveNumbers.length >= 1) {
    out.push({
      mark: "line", channels: { y: effectiveNumbers[0]!.name }, reason: `${effectiveNumbers[0]!.name} by row order`, score: 0.1,
      terms: { entropy: 0.1, structure: 0, coverage: 1, legibility: 1, prior: 0 },
    });
  }
  if (out.length === 0) {
    out.push({ mark: "bar", channels: {}, reason: "No obvious numeric or date column found.", score: 0, terms: { entropy: 0, structure: 0, coverage: 0, legibility: 0, prior: 0 } });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, CHART_CANDIDATE_MAX);
}
