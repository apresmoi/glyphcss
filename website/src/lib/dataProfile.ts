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
  /** P2-4/REVIEW-arc-density-search-opus.md: `rowCount > 500` recommends
   *  aggregating a category/date `x` down to one row per distinct `x`
   *  before charting it, `sum` for a count-like measure name, `mean`
   *  otherwise (`GLYPH_CHART_TRANSFORM` "group", AGENTS.md's "Charts"
   *  transforms line). `chartsDataSource.ts`'s `topChartsRecommendation`
   *  forwards only the `reduce: "sum"` case onward today — `reduce` has no
   *  home on `ChartsWorkbenchMark.transform` yet (a bare
   *  `"none" | GlyphChartTransformKind`), so a `"mean"` recommendation
   *  is a correct, testable ANSWER at this layer while the mark schema
   *  that would apply it stays a documented follow-up (see
   *  `docs/design/charts.md`'s "P2-4" note) rather than silently summing
   *  a mean-shaped measure, which would be a materially wrong chart. */
  readonly transform?: { readonly kind: "group"; readonly reduce: "sum" | "mean" };
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

// ── P2-4 (REVIEW-arc-density-search-opus.md): don't chart an identifier ────

/** A column NAME that reads as a row identifier/ordinal rather than a
 *  measurement — `"Id"`/`"id"`/`"index"`/… as the WHOLE name, or a
 *  `_id`/`Id` SUFFIX (snake_case/camelCase) that requires the boundary
 *  (an underscore, or the capital `I`) so a word that merely ENDS in the
 *  letters "id" — "avoid", "solid", "void" — is never caught by accident. */
const ID_LIKE_NAME_RE = /^(id|_id|index|idx|key|uuid|row|n|no\.?|number)$/i;
const ID_LIKE_SUFFIX_RE = /_id$|Id$/;

/** True when EVERY value the column has is one integer 0..n-1 or 1..n, or
 *  the column is otherwise unique per non-null row (`ColumnProfile`'s own
 *  `cardinality`) — derivable from `min`/`max`/`distinctCount` alone
 *  (no raw values needed): a dense integer range whose distinct count
 *  equals its own span is, by construction, exactly that permutation. */
function isIdLikeColumn(col: ColumnProfile, rowCount: number): boolean {
  if (ID_LIKE_NAME_RE.test(col.name) || ID_LIKE_SUFFIX_RE.test(col.name)) return true;
  if (col.type !== "integer") return false;
  if (col.cardinality === "unique") return true; // unique-per-row integers
  const nonNullCount = rowCount - col.nullCount;
  if (nonNullCount > 1 && typeof col.min === "number" && typeof col.max === "number" && col.distinctCount === nonNullCount) {
    if (col.min === 0 && col.max === nonNullCount - 1) return true; // strict 0..n-1
    if (col.min === 1 && col.max === nonNullCount) return true; // strict 1..n
  }
  return false;
}

/** Name lexicon a real MEASURE column tends to carry — checked before
 *  falling back to range (a stand-in for variance: only min/max survive
 *  into `ColumnProfile`, not the raw values a true variance would need). */
const MEASURE_NAME_LEXICON_RE = /value|amount|count|total|price|demand|rate|pct|percent|score|sales|revenue|temp|mean|avg/i;

function numericRange(col: ColumnProfile): number {
  return typeof col.min === "number" && typeof col.max === "number" ? col.max - col.min : 0;
}

/** Picks the best MEASURE among a set of numeric columns: never an
 *  id/ordinal column when a real measure is also present, then by name
 *  lexicon, then by the widest range. `pool` is assumed non-empty. */
function selectMeasureColumn(pool: readonly ColumnProfile[]): ColumnProfile {
  const lexiconMatch = pool.find((c) => MEASURE_NAME_LEXICON_RE.test(c.name));
  if (lexiconMatch) return lexiconMatch;
  return pool.reduce((best, c) => (numericRange(c) > numericRange(best) ? c : best), pool[0]!);
}

/** Header names that read as a WIDE year table — "1990", "2000", … each its
 *  own numeric column — rather than one column per measurement; three or
 *  more is the threshold at which reshaping long stops being a guess. */
const YEAR_HEADER_RE = /^(19|20)\d{2}$/;

/** `sum` for a count-like measure name, `mean` otherwise (P2-4's own
 *  ">500 rows" rule) — the same lexicon split a reader would make by eye:
 *  "count"/"total"/"amount" accumulate, everything else (a price, a rate,
 *  a score) averages. */
function reduceForMeasureName(name: string): "sum" | "mean" {
  return /count|total|amount/i.test(name) ? "sum" : "mean";
}

/** P2-4's own ">500 rows" rule — recommends AGGREGATING a category/date `x`
 *  down to one row per distinct value before charting it. Rides as
 *  `ChartRecommendation.transform`; see that field's own doc for why only
 *  the `"sum"` case is forwarded onward today. */
const CHART_RECOMMENDATION_GROUP_ROW_THRESHOLD = 500;

/** Ranked chart suggestions for a profiled table — the top entry is what
 *  the Data folder's "Custom…" flow applies automatically; the rest are
 *  shown as one-click runner-ups. Never empty for a non-empty profile: the
 *  last-resort fallback (two numerics, or a bare index/first-numeric line)
 *  always fires. */
export function recommendChart(profile: DataProfile): ChartRecommendation[] {
  const { columns, rowCount } = profile;
  const dates = dateColumns(columns);
  const numbers = numericColumns(columns);
  const categories = categoryColumns(columns);
  const out: ChartRecommendation[] = [];

  // P2-4: an id/ordinal column (`Id`, a strict 1..n index, a unique-per-row
  // integer) is never a MEASURE — excluded from the pool every rule below
  // picks a `y`/measure from. Falls back to the full `numbers` list only
  // when EVERY numeric column reads as an id (so a table with no real
  // measure at all still gets a last-resort answer rather than none).
  const measureNumbers = numbers.filter((c) => !isIdLikeColumn(c, rowCount));
  const effectiveNumbers = measureNumbers.length > 0 ? measureNumbers : numbers;
  const groupAggregate = rowCount > CHART_RECOMMENDATION_GROUP_ROW_THRESHOLD;

  if (dates.length >= 1 && effectiveNumbers.length >= 1) {
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
    const measure = selectMeasureColumn(effectiveNumbers);
    const cat = categories.length >= 1 ? categories[0]! : undefined;
    const fillableCategory = cat && cat.distinctCount <= DATE_NUMERIC_CATEGORY_FILL_MAX_CATEGORIES ? cat : undefined;
    const groupReduce = groupAggregate ? reduceForMeasureName(measure.name) : undefined;
    out.push({
      mark: "line", channels: { x: dates[0]!.name, y: measure.name, ...(fillableCategory ? { fill: fillableCategory.name } : {}) },
      reason: (fillableCategory
        ? `${measure.name} over ${dates[0]!.name}, one line per ${fillableCategory.name}`
        : cat
          ? `${dates[0]!.name} over time vs ${measure.name} (${cat.name} has ${cat.distinctCount} categories — too many to fill legibly)`
          : `${dates[0]!.name} over time vs ${measure.name}`)
        + (groupReduce ? ` (${rowCount} rows grouped by ${dates[0]!.name}, ${groupReduce})` : ""),
      score: 100,
      ...(groupReduce ? { transform: { kind: "group" as const, reduce: groupReduce } } : {}),
    });
    const secondMeasure = effectiveNumbers.find((c) => c !== measure);
    if (secondMeasure) {
      out.push({
        mark: "area", channels: { x: dates[0]!.name, y: secondMeasure.name },
        reason: `${secondMeasure.name} filled area over ${dates[0]!.name}`, score: 70,
      });
    }
  }

  if (categories.length >= 1 && effectiveNumbers.length >= 1) {
    const cat = categories[0]!;
    const measure = selectMeasureColumn(effectiveNumbers);
    // "Small" is about the RAW distinct count, not the cardinality bucket —
    // three distinct values across exactly three rows is `cardinality:
    // "unique"` (every row differs) but is still a perfectly pie-shaped
    // three-category split. The pie itself is additionally gated to exactly
    // ONE numeric MEASURE (a slice is a share of ONE total) that itself
    // READS AS a share/count (N4) — its own min is non-negative, since a
    // pie of a signed quantity like a temperature change has no honest
    // wedge-size reading. With several numeric measures present (F1/P1-1 —
    // Fisher's iris: 4 measurements, 3 species) there is no principled
    // reason to sum the FIRST one into wedges rather than any other — that
    // reads as an arbitrary, misleading pick ("a pie of summed sepal
    // lengths"), where the multi-numeric rule below is the one this shape
    // actually asks for.
    const isSmallCategory = cat.distinctCount <= 6;
    const readsAsShareOrCount = effectiveNumbers.length === 1 && typeof measure.min === "number" && measure.min >= 0;
    if (isSmallCategory && effectiveNumbers.length === 1 && readsAsShareOrCount) {
      out.push({
        mark: "arc", channels: { y: measure.name, fill: cat.name },
        reason: `${cat.name} shares of ${measure.name} (${cat.distinctCount} categories)`, score: 85,
      });
    }
    // This bar names only ONE measure — with several genuine measures
    // present that's the SAME "arbitrary first measure" defect the pie is
    // gated against above, so it scores BELOW the multi-numeric reshaped
    // bar below (75) whenever there's more than one, regardless of category
    // size; with exactly one measure it keeps its original score (deferring
    // only to arc, when arc applies).
    const singleNumericBarScore = effectiveNumbers.length === 1 ? (isSmallCategory ? 60 : 90) : 55;
    const groupReduce = groupAggregate ? reduceForMeasureName(measure.name) : undefined;
    out.push({
      mark: "bar", channels: { x: cat.name, y: measure.name },
      reason: `${measure.name} by ${cat.name}` + (groupReduce ? ` (${rowCount} rows grouped by ${cat.name}, ${groupReduce})` : ""),
      score: singleNumericBarScore,
      ...(groupReduce ? { transform: { kind: "group" as const, reduce: groupReduce } } : {}),
    });
  }

  if (categories.length >= 2 && effectiveNumbers.length >= 1) {
    const measure = selectMeasureColumn(effectiveNumbers);
    out.push({
      mark: "cell", channels: { x: categories[0]!.name, y: categories[1]!.name, fill: measure.name },
      reason: `${measure.name} heatmap of ${categories[0]!.name} x ${categories[1]!.name}`, score: 80,
    });
  }

  if (categories.length >= 1 && effectiveNumbers.length >= 2) {
    // category + SEVERAL numerics -> grouped bar, one series PER MEASURE
    // (N4 — a rewrite of F1/P1-1's own rule, which plotted `numbers[1]`
    // alone with `fill` duplicating `x`, silently dropping every OTHER
    // numeric column including `numbers[0]`). Every numeric MEASURE becomes
    // its own series through a LONG-FORMAT RESHAPE: a `pivotLonger` step
    // melts every measure column (never an id-like numeric column, a
    // category, or a date — those stay id columns, so a second category or
    // date column rides through untouched) into one `measure`/`value` pair
    // per row, so `x` is the category, `y` is the melted value, and `fill`
    // is the melted MEASURE NAME — never `x` again. This is what lets a
    // 4-region {sales, target} table chart BOTH measures instead of
    // summing one arbitrarily (F1/P1-1's own reason this rule exists), and
    // what a lone pie (above) has no principled answer for with more than
    // one measure. Scored above the single-measure bar/arc pair so a table
    // like Fisher's iris (one category, an `Id` column, four numeric
    // measurements) recommends this over a pie — or a bar — of one
    // arbitrarily-chosen measurement, and never melts `Id` in as a
    // "measure" alongside the real ones (P2-4).
    const idColumns = columns.filter((c) => !effectiveNumbers.some((n) => n.name === c.name)).map((c) => c.name);
    out.push({
      mark: "bar", channels: { x: categories[0]!.name, y: "value", fill: "measure" },
      reason: `${effectiveNumbers.length} numeric columns by ${categories[0]!.name}, one series per measure`, score: 75,
      pipeline: [{ kind: "pivotLonger", idColumns, keyColumn: "measure", valueColumn: "value" }],
    });
  }

  // P2-4: a WIDE year table ("1990", "1991", … each its own column) reads
  // long as one line per row (the id/category columns left over), `x` the
  // year, `y` the melted value — the shape `dataProfile.ts` otherwise has
  // no rule for at all (every year column is just another "numeric
  // measure", which the multi-numeric bar rule above would melt into a
  // meaningless one-bar-per-year-per-row grouped bar instead of a time
  // series). Scored above every rule that could otherwise fire on the same
  // columns (the multi-numeric bar's 75, the date+numeric line's 100 only
  // applies when a REAL date column exists, which a wide year table has
  // none of by construction).
  const yearColumns = numbers.filter((c) => YEAR_HEADER_RE.test(c.name));
  if (yearColumns.length >= 3) {
    const idColumns = columns.filter((c) => !yearColumns.includes(c));
    const fillColumn = idColumns.length === 1 && (idColumns[0]!.type === "category" || idColumns[0]!.type === "text") ? idColumns[0]! : undefined;
    out.push({
      mark: "line",
      channels: { x: "year", y: "value", ...(fillColumn ? { fill: fillColumn.name } : {}) },
      reason: `${yearColumns.length} year columns (${yearColumns[0]!.name}–${yearColumns[yearColumns.length - 1]!.name}) reshaped long, one line per ${fillColumn ? fillColumn.name : "row"}`,
      score: 105,
      pipeline: [{ kind: "pivotLonger", idColumns: idColumns.map((c) => c.name), keyColumn: "year", valueColumn: "value" }],
    });
  }

  if (effectiveNumbers.length >= 2) {
    const x = effectiveNumbers[0]!;
    const y = effectiveNumbers.find((c) => c !== x) ?? effectiveNumbers[1]!;
    out.push({
      mark: "dot", channels: { x: x.name, y: y.name },
      reason: `${x.name} vs ${y.name}`, score: 65,
    });
  }

  if (out.length === 0 && effectiveNumbers.length >= 1) {
    out.push({ mark: "line", channels: { y: effectiveNumbers[0]!.name }, reason: `${effectiveNumbers[0]!.name} by row order`, score: 10 });
  }
  if (out.length === 0) {
    out.push({ mark: "bar", channels: {}, reason: "No obvious numeric or date column found.", score: 0 });
  }

  return [...out].sort((a, b) => b.score - a.score);
}
