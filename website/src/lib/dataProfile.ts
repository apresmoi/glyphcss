// Pure per-column profiler + chart recommender for `/charts`' data layer
// (AGENTS.md's "Charts" — "Data layer"). No DOM. Takes the flat rows
// `tabularParse.ts`/`dataPipeline.ts` produce and answers two questions:
// what IS each column (`profileRows`), and what chart does this data ask
// for (`recommendChart`).

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
}

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function isNullish(v: TabularCell): boolean { return v === null || v === undefined || v === ""; }

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
    return date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d);
  }
  const slashDate = SLASH_DATE_PARTS.exec(v);
  if (slashDate) {
    const [, m, d, yRaw] = slashDate;
    const date = new Date(timestamp);
    const yearMatches = yRaw!.length === 4 ? date.getFullYear() === Number(yRaw) : date.getFullYear() % 100 === Number(yRaw) % 100;
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
      name, type: allInteger ? "integer" : "number", nullCount, distinctCount,
      min: Math.min(...nums), max: Math.max(...nums), monotonic: monotonicity(nums), cardinality,
    };
  }

  // Non-numeric, non-date strings: low/medium cardinality relative to the
  // sample reads as a category (a repeated small vocabulary); anything
  // wider reads as free text.
  const isCategory = cardinality !== "high" && distinctCount <= Math.max(20, Math.ceil(values.length * 0.2));
  return { name, type: isCategory ? "category" : "text", nullCount, distinctCount, cardinality };
}

export function profileRows(rows: readonly TabularRow[]): DataProfile {
  if (rows.length === 0) return { rowCount: 0, columns: [] };
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    rowCount: rows.length,
    columns: columns.map((name) => profileColumn(name, rows.map((row) => row[name] ?? null))),
  };
}

// ── Recommender ─────────────────────────────────────────────────────────

export type RecommendedMark = "line" | "bar" | "area" | "dot" | "arc" | "cell";

export interface ChartRecommendation {
  readonly mark: RecommendedMark;
  readonly channels: { readonly x?: string; readonly y?: string; readonly fill?: string };
  readonly reason: string;
  /** Higher wins; only used to rank — never shown to the reader. */
  readonly score: number;
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

/** N11: a date+numeric+category line's `fill` puts one line, one legend
 *  entry and one style (of a 4-style cycle) per distinct category — past
 *  this many, none of the three stays distinguishable (measured: 12
 *  categories = 12 identical truncated legend entries, 20 = one-character
 *  labels with the style cycle repeated five times over). */
const DATE_NUMERIC_CATEGORY_FILL_MAX_CATEGORIES = 8;

function numericColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "number" || c.type === "integer");
}
function dateColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "date");
}
function categoryColumns(columns: readonly ColumnProfile[]): ColumnProfile[] {
  return columns.filter((c) => c.type === "category" || c.type === "boolean");
}

/** Ranked chart suggestions for a profiled table — the top entry is what
 *  the Data folder's "Custom…" flow applies automatically; the rest are
 *  shown as one-click runner-ups. Never empty for a non-empty profile: the
 *  last-resort fallback (two numerics, or a bare index/first-numeric line)
 *  always fires. */
export function recommendChart(profile: DataProfile): ChartRecommendation[] {
  const { columns } = profile;
  const dates = dateColumns(columns);
  const numbers = numericColumns(columns);
  const categories = categoryColumns(columns);
  const out: ChartRecommendation[] = [];

  if (dates.length >= 1 && numbers.length >= 1) {
    // date + numeric + category -> one LINE per category (F1/P1-1): the
    // plain date+numeric line below already wins this shape (score 100),
    // so the missing piece was never the RANKING, only the CHANNELS — a
    // category column sitting right there went unread and the reader got
    // one flat line instead of the series-by-category picture the data
    // actually shows (measured: world-population-by-country). `fill` is
    // omitted entirely (not `fill: undefined`) when there's no category (or
    // the category has more than DATE_NUMERIC_CATEGORY_FILL_MAX_CATEGORIES
    // distinct values, N11), so the shape here matches the old
    // single-series recommendation byte for byte.
    const cat = categories.length >= 1 ? categories[0]! : undefined;
    const fillableCategory = cat && cat.distinctCount <= DATE_NUMERIC_CATEGORY_FILL_MAX_CATEGORIES ? cat : undefined;
    out.push({
      mark: "line", channels: { x: dates[0]!.name, y: numbers[0]!.name, ...(fillableCategory ? { fill: fillableCategory.name } : {}) },
      reason: fillableCategory
        ? `${numbers[0]!.name} over ${dates[0]!.name}, one line per ${fillableCategory.name}`
        : cat
          ? `${dates[0]!.name} over time vs ${numbers[0]!.name} (${cat.name} has ${cat.distinctCount} categories — too many to fill legibly)`
          : `${dates[0]!.name} over time vs ${numbers[0]!.name}`,
      score: 100,
    });
    if (numbers.length >= 2) {
      out.push({
        mark: "area", channels: { x: dates[0]!.name, y: numbers[1]!.name },
        reason: `${numbers[1]!.name} filled area over ${dates[0]!.name}`, score: 70,
      });
    }
  }

  if (categories.length >= 1 && numbers.length >= 1) {
    const cat = categories[0]!;
    // "Small" is about the RAW distinct count, not the cardinality bucket —
    // three distinct values across exactly three rows is `cardinality:
    // "unique"` (every row differs) but is still a perfectly pie-shaped
    // three-category split. The pie itself is additionally gated to exactly
    // ONE numeric column (a slice is a share of ONE total) that itself
    // READS AS a share/count (N4) — its own min is non-negative, since a
    // pie of a signed quantity like a temperature change has no honest
    // wedge-size reading. With several numeric measures present (F1/P1-1 —
    // Fisher's iris: 4 measurements, 3 species) there is no principled
    // reason to sum the FIRST one into wedges rather than any other — that
    // reads as an arbitrary, misleading pick ("a pie of summed sepal
    // lengths"), where the multi-numeric rule below is the one this shape
    // actually asks for.
    const isSmallCategory = cat.distinctCount <= 6;
    const readsAsShareOrCount = numbers.length === 1 && typeof numbers[0]!.min === "number" && numbers[0]!.min >= 0;
    if (isSmallCategory && numbers.length === 1 && readsAsShareOrCount) {
      out.push({
        mark: "arc", channels: { y: numbers[0]!.name, fill: cat.name },
        reason: `${cat.name} shares of ${numbers[0]!.name} (${cat.distinctCount} categories)`, score: 85,
      });
    }
    // This bar names only `numbers[0]` — with several numeric columns
    // present that's the SAME "arbitrary first measure" defect the pie is
    // gated against above, so it scores BELOW the multi-numeric reshaped
    // bar below (75) whenever there's more than one numeric column,
    // regardless of category size; with exactly one numeric column it
    // keeps its original score (deferring only to arc, when arc applies).
    const singleNumericBarScore = numbers.length === 1 ? (isSmallCategory ? 60 : 90) : 55;
    out.push({
      mark: "bar", channels: { x: cat.name, y: numbers[0]!.name },
      reason: `${numbers[0]!.name} by ${cat.name}`, score: singleNumericBarScore,
    });
  }

  if (categories.length >= 2 && numbers.length >= 1) {
    out.push({
      mark: "cell", channels: { x: categories[0]!.name, y: categories[1]!.name, fill: numbers[0]!.name },
      reason: `${numbers[0]!.name} heatmap of ${categories[0]!.name} x ${categories[1]!.name}`, score: 80,
    });
  }

  if (categories.length >= 1 && numbers.length >= 2) {
    // category + SEVERAL numerics -> grouped bar, one series PER MEASURE
    // (N4 — a rewrite of F1/P1-1's own rule, which plotted `numbers[1]`
    // alone with `fill` duplicating `x`, silently dropping every OTHER
    // numeric column including `numbers[0]`). Every numeric column becomes
    // its own series through a LONG-FORMAT RESHAPE: a `pivotLonger` step
    // melts every numeric column (never a category/date — those stay id
    // columns, so a second category or date column rides through
    // untouched) into one `measure`/`value` pair per row, so `x` is the
    // category, `y` is the melted value, and `fill` is the melted MEASURE
    // NAME — never `x` again. This is what lets a 4-region {sales, target}
    // table chart BOTH measures instead of summing one arbitrarily
    // (F1/P1-1's own reason this rule exists), and what a lone pie (above)
    // has no principled answer for with more than one numeric column.
    // Scored above the single-numeric bar/arc pair so a table like
    // Fisher's iris (one category, four numeric measurements) recommends
    // this over a pie — or a bar — of one arbitrarily-chosen measurement.
    const idColumns = columns.filter((c) => !numbers.some((n) => n.name === c.name)).map((c) => c.name);
    out.push({
      mark: "bar", channels: { x: categories[0]!.name, y: "value", fill: "measure" },
      reason: `${numbers.length} numeric columns by ${categories[0]!.name}, one series per measure`, score: 75,
      pipeline: [{ kind: "pivotLonger", idColumns, keyColumn: "measure", valueColumn: "value" }],
    });
  }

  if (numbers.length >= 2) {
    out.push({
      mark: "dot", channels: { x: numbers[0]!.name, y: numbers[1]!.name },
      reason: `${numbers[0]!.name} vs ${numbers[1]!.name}`, score: 65,
    });
  }

  if (out.length === 0 && numbers.length >= 1) {
    out.push({ mark: "line", channels: { y: numbers[0]!.name }, reason: `${numbers[0]!.name} by row order`, score: 10 });
  }
  if (out.length === 0) {
    out.push({ mark: "bar", channels: {}, reason: "No obvious numeric or date column found.", score: 0 });
  }

  return [...out].sort((a, b) => b.score - a.score);
}
