// Pure per-column profiler + chart recommender for `/charts`' data layer
// (AGENTS.md's "Charts" — "Data layer"). No DOM. Takes the flat rows
// `tabularParse.ts`/`dataPipeline.ts` produce and answers two questions:
// what IS each column (`profileRows`), and what chart does this data ask
// for (`recommendChart`, now a thin wrapper over `chartCandidates.ts`'s
// information-ranked enumeration — see that file).

import {
  buildChartCandidates,
  CHART_CANDIDATE_SAMPLE_CAP,
  type ChartCandidateChannels,
  type ChartCandidateMark,
  type ChartCandidateTransform,
} from "./chartCandidates";
import type { PipelineStep } from "./dataPipeline";
import type { TabularCell, TabularRow } from "./tabularParse";

export type ColumnType = "number" | "integer" | "date" | "category" | "text" | "boolean";
export type CardinalityClass = "unique" | "low" | "medium" | "high";
export type Monotonicity = "increasing" | "decreasing" | "none";

export interface ColumnProfile {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullCount: number;
  readonly distinctCount: number;
  /** Numeric min/max for number/integer columns, ISO strings for date columns. */
  readonly min?: number | string;
  readonly max?: number | string;
  /** Only meaningful (and only computed) for number/integer/date columns. */
  readonly monotonic?: Monotonicity;
  readonly cardinality: CardinalityClass;
}

export interface DataProfile {
  readonly rowCount: number;
  readonly columns: readonly ColumnProfile[];
  /** Row-aligned sample, capped at `CHART_CANDIDATE_SAMPLE_CAP` —
   *  `chartCandidates.ts`'s entropy/structure scoring needs paired values
   *  across columns that column-level metadata alone can't answer. NOT
   *  part of the column-metadata contract above; never rely on it for
   *  typing (use `columns`). Absent only for an empty profile. */
  readonly sample?: readonly TabularRow[];
}

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function isNullish(v: TabularCell): boolean {
  return v === null || v === undefined || v === "";
}

const SLASH_DATE_PARTS = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

/** P3/N6c: `Date.parse`/`new Date` silently ROLL an out-of-range calendar
 *  day onto the next month (`"2024-02-30"` -> March 1st) instead of
 *  rejecting it — a plausible-looking but WRONG date, rather than the
 *  flagged typo `"2024-13-45"` already gets (that one has no valid month at
 *  all, so `Date.parse` itself returns `NaN`). A full `YYYY-MM-DD` (no time
 *  part) is round-tripped through the parsed UTC calendar fields (a bare
 *  ISO date parses as UTC midnight). `SLASH_DATE` (`MM/DD/YYYY`) rolls
 *  exactly the same way and used to go unchecked — its own round-trip
 *  reads LOCAL calendar fields instead, because `Date.parse` resolves THIS
 *  shape at LOCAL midnight, not UTC; the year comparison is taken mod 100
 *  for a 2-digit year so it never has to guess which century `Date.parse`
 *  chose. A partial ISO date (`YYYY-MM`/`YYYY`) or one with a time part
 *  still isn't checked — there's no "day that rolled" to catch there. */
function isRolledCalendarDate(v: string, timestamp: number): boolean {
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (isoDateOnly) {
    const [, y, m, d] = isoDateOnly;
    const date = new Date(timestamp);
    return (
      date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)
    );
  }
  const slashDate = SLASH_DATE_PARTS.exec(v);
  if (slashDate) {
    const [, m, d, yRaw] = slashDate;
    const date = new Date(timestamp);
    const yearMatches =
      yRaw!.length === 4 ? date.getFullYear() === Number(yRaw) : date.getFullYear() % 100 === Number(yRaw) % 100;
    return !yearMatches || date.getMonth() + 1 !== Number(m) || date.getDate() !== Number(d);
  }
  return false;
}

function looksLikeDate(v: TabularCell): boolean {
  if (typeof v !== "string") return false;
  if (!ISO_DATE.test(v) && !SLASH_DATE.test(v)) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return !isRolledCalendarDate(v, t);
}

function toTimestamp(v: TabularCell): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v);
  return NaN;
}

function classifyCardinality(distinct: number, rowCount: number): CardinalityClass {
  if (rowCount > 1 && distinct === rowCount) return "unique";
  if (distinct <= 10) return "low";
  if (distinct <= 50) return "medium";
  return "high";
}

function monotonicity(values: readonly number[]): Monotonicity {
  if (values.length < 2) return "none";
  let increasing = true;
  let decreasing = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) increasing = false;
    if (values[i]! > values[i - 1]!) decreasing = false;
  }
  if (increasing && !decreasing) return "increasing";
  if (decreasing && !increasing) return "decreasing";
  return "none";
}

function profileColumn(name: string, values: readonly TabularCell[]): ColumnProfile {
  const nonNull = values.filter((v) => !isNullish(v));
  const nullCount = values.length - nonNull.length;
  const distinctCount = new Set(nonNull.map((v) => String(v))).size;
  const cardinality = classifyCardinality(distinctCount, values.length);

  if (nonNull.length === 0) return { name, type: "text", nullCount, distinctCount, cardinality };

  if (nonNull.every((v) => typeof v === "boolean")) {
    return { name, type: "boolean", nullCount, distinctCount, cardinality };
  }

  if (nonNull.every(looksLikeDate)) {
    const timestamps = nonNull.map(toTimestamp);
    const min = new Date(Math.min(...timestamps)).toISOString();
    const max = new Date(Math.max(...timestamps)).toISOString();
    return { name, type: "date", nullCount, distinctCount, min, max, monotonic: monotonicity(timestamps), cardinality };
  }

  if (nonNull.every((v) => typeof v === "number" && Number.isFinite(v))) {
    const nums = nonNull as number[];
    const allInteger = nums.every((n) => Number.isInteger(n));
    return {
      name,
      type: allInteger ? "integer" : "number",
      nullCount,
      distinctCount,
      min: Math.min(...nums),
      max: Math.max(...nums),
      monotonic: monotonicity(nums),
      cardinality,
    };
  }

  // Non-numeric, non-date strings: low/medium cardinality relative to the
  // sample reads as a category (a repeated small vocabulary); anything
  // wider reads as free text.
  const isCategory = cardinality !== "high" && distinctCount <= Math.max(20, Math.ceil(values.length * 0.2));
  return { name, type: isCategory ? "category" : "text", nullCount, distinctCount, cardinality };
}

/** Whether one cell holds a value of its column's profiled TYPE. The
 *  profiler types a column from its non-null values alone, so a date column
 *  may still hold nulls and a category column may mix numbers with strings;
 *  the charts renderer rejects both (`bad-time-domain`, `mixed-x-scale`,
 *  `sankey-missing-channel`). `/charts` drops the rows this refuses before a
 *  mark is built (`chartsMarkTypeFit.ts`'s `chartsBuildBoundMark`). */
export function profiledCellUsable(col: ColumnProfile, v: TabularCell): boolean {
  if (isNullish(v)) return false;
  if (col.type === "date") return looksLikeDate(v);
  if (col.type === "number" || col.type === "integer") return typeof v === "number" && Number.isFinite(v);
  if (col.type === "boolean") return typeof v === "boolean";
  return true;
}

export function profileRows(rows: readonly TabularRow[]): DataProfile {
  if (rows.length === 0) return { rowCount: 0, columns: [] };
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    rowCount: rows.length,
    columns: columns.map((name) =>
      profileColumn(
        name,
        rows.map((row) => row[name] ?? null),
      ),
    ),
    sample: rows.length <= CHART_CANDIDATE_SAMPLE_CAP ? rows : rows.slice(0, CHART_CANDIDATE_SAMPLE_CAP),
  };
}

// ── Recommender ─────────────────────────────────────────────────────────
//
// `recommendChart` is a thin wrapper over `chartCandidates.ts`'s
// `buildChartCandidates` — the FULL information-ranked enumeration (every
// mark the profiled table can honestly support, scored on entropy/
// structure/coverage/legibility/name-prior, sorted best first;
// `CHART_CANDIDATE_WEIGHTS` holds the weights, and `chartCandidates.test.ts`
// re-derives the ground-truth ranks over all 16 vendored datasets). This
// module keeps the OLD, narrower `ChartRecommendation` shape (no `terms`)
// for callers that only ever wanted the ranked list; a caller that wants
// the full `ChartCandidate` (including `terms`, for a "why this chart"
// readout, or the mark-type toggle's per-type fit) uses `chartCandidates.ts`
// directly.

export type RecommendedMark = ChartCandidateMark;

export interface ChartRecommendation {
  readonly mark: RecommendedMark;
  readonly channels: ChartCandidateChannels;
  readonly reason: string;
  /** Higher wins; only used to rank — never shown to the reader. In
   *  [0, 1] (`chartCandidates.ts`'s composite score) — nothing compares
   *  this value across profiles or persists it, so the old 0-105 scale's
   *  retirement is invisible to every caller. */
  readonly score: number;
  /** P2-4/REVIEW-arc-density-search-opus.md: `rowCount > 500` recommends
   *  aggregating a category/date `x` down to one row per distinct `x`
   *  before charting it, `sum` for a count-like measure name, `mean`
   *  otherwise (`GLYPH_CHART_TRANSFORM` "group", AGENTS.md's "Charts"
   *  transforms line). `chartsDataSource.ts`'s `topChartsRecommendation`
   *  forwards only the `reduce: "sum"` case onward today — `reduce` has no
   *  home on `ChartsWorkbenchMark.transform` yet (a bare
   *  `"none" | GlyphChartTransformKind`), so a `"mean"` recommendation
   *  is a correct, testable ANSWER at this layer while the mark schema
   *  that would apply it stays a documented follow-up rather than
   *  silently summing a mean-shaped measure, which would be a materially
   *  wrong chart. */
  readonly transform?: ChartCandidateTransform;
  /** N4: a recommendation whose CHANNELS name a column that doesn't exist
   *  yet (`key`/`value`, the reshape's own output names) needs the reshape
   *  step that PRODUCES them run first — this recommender only sees column
   *  METADATA (`DataProfile`), never the rows themselves, so it cannot
   *  reshape data on its own. Whoever applies the recommendation (Apply's
   *  own `pipeline` -> `resolveChartsDataRows`) runs these steps on top of
   *  its already-resolved rows before building the mark. Absent for every
   *  recommendation whose channels already name real source columns. */
  readonly pipeline?: readonly PipelineStep[];
}

/** Ranked chart suggestions for a profiled table — the top entry is what
 *  the Data folder's dataset-picker flow applies automatically; the rest
 *  are runner-ups. Never empty for a non-empty profile: `chartCandidates`'s
 *  own last-resort fallback (a bare index/first-numeric line, or an
 *  empty-channels bar) always fires. */
export function recommendChart(profile: DataProfile): ChartRecommendation[] {
  return buildChartCandidates(profile).map((c) => ({
    mark: c.mark,
    channels: c.channels,
    reason: c.reason,
    score: c.score,
    ...(c.transform ? { transform: c.transform } : {}),
    ...(c.pipeline ? { pipeline: c.pipeline } : {}),
  }));
}
