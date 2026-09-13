// Pure per-column profiler + chart recommender for `/charts`' data layer
// (AGENTS.md's "Charts" — "Data layer"). No DOM. Takes the flat rows
// `tabularParse.ts`/`dataPipeline.ts` produce and answers two questions:
// what IS each column (`profileRows`), and what chart does this data ask
// for (`recommendChart`).

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

function looksLikeDate(v: TabularCell): boolean {
  if (typeof v !== "string") return false;
  if (!ISO_DATE.test(v) && !SLASH_DATE.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
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
}

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
    out.push({
      mark: "line", channels: { x: dates[0]!.name, y: numbers[0]!.name },
      reason: `${dates[0]!.name} over time vs ${numbers[0]!.name}`, score: 100,
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
    // three-category split.
    const isSmall = cat.distinctCount <= 6;
    if (isSmall) {
      out.push({
        mark: "arc", channels: { y: numbers[0]!.name, fill: cat.name },
        reason: `${cat.name} shares of ${numbers[0]!.name} (${cat.distinctCount} categories)`, score: 85,
      });
    }
    out.push({
      mark: "bar", channels: { x: cat.name, y: numbers[0]!.name },
      reason: `${numbers[0]!.name} by ${cat.name}`, score: isSmall ? 60 : 90,
    });
  }

  if (categories.length >= 2 && numbers.length >= 1) {
    out.push({
      mark: "cell", channels: { x: categories[0]!.name, y: categories[1]!.name, fill: numbers[0]!.name },
      reason: `${numbers[0]!.name} heatmap of ${categories[0]!.name} x ${categories[1]!.name}`, score: 80,
    });
  }

  if (categories.length >= 1 && numbers.length >= 2) {
    out.push({
      mark: "bar", channels: { x: categories[0]!.name, y: numbers[1]!.name, fill: categories[0]!.name },
      reason: `${numbers.length} series by ${categories[0]!.name}`, score: 55,
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
