/**
 * Row transforms — `bin`, `stack`, `group`, `normalize`, `window` — applied
 * after channel resolution (`channels.ts`), before scale/layout. Each is
 * deliberately minimal (PLAN.md Phase 1: "may be minimal but must exist and
 * be tested") rather than Plot's full transform vocabulary; they operate on
 * `GlyphChartMarkRow[]` so they compose with any mark type whose rows carry
 * numeric `x`/`y`.
 */

import { max as d3max, min as d3min } from "d3-array";
import type { GlyphChartMarkRow, GlyphChartTransform } from "./types";

function numeric(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

function keyOf(row: GlyphChartMarkRow, by: GlyphChartTransform["by"]): unknown {
  if (by === undefined) return row.fill ?? "__all__";
  if (typeof by === "function") return by(row as unknown as Record<string, unknown>, row.index);
  if (Array.isArray(by)) return by[row.index];
  return (row as unknown as Record<string, unknown>)[by as string];
}

/** Equal-width histogram over `x`: `n` bins (default 10), `y` becomes the count per bin. */
function applyBin(rows: readonly GlyphChartMarkRow[], n: number): GlyphChartMarkRow[] {
  const xs = rows.map((r) => numeric(r.x)).filter(Number.isFinite);
  if (xs.length === 0) return [];
  const lo = d3min(xs)!;
  const hi = d3max(xs)!;
  const width = hi > lo ? (hi - lo) / n : 1;
  const counts = new Array(n).fill(0) as number[];
  for (const x of xs) {
    const bin = width > 0 ? Math.min(n - 1, Math.floor((x - lo) / width)) : 0;
    counts[bin]!++;
  }
  return counts.map((count, i) => ({
    x: lo + width * (i + 0.5),
    y: count,
    index: i,
  }));
}

/**
 * Stacks rows sharing an `x` on top of each other, grouped by `by` (default
 * the row's own `fill` channel). Each output row keeps its `y` (the segment
 * size) and gains `y0`/`y1` (its baseline and top within the stack) — paint
 * reads `y0`/`y1` for a `stack`-transformed bar/area, `y` otherwise.
 */
function applyStack(rows: readonly GlyphChartMarkRow[], by: GlyphChartTransform["by"]): GlyphChartMarkRow[] {
  const runningByX = new Map<unknown, number>();
  const out: GlyphChartMarkRow[] = [];
  for (const row of rows) {
    void by; // grouping key doesn't affect stack order here — rows stack in input order per x.
    const x = row.x instanceof Date ? row.x.getTime() : row.x;
    const base = runningByX.get(x) ?? 0;
    const size = numeric(row.y);
    const top = base + (Number.isFinite(size) ? size : 0);
    runningByX.set(x, top);
    out.push({ ...row, y0: base, y1: top });
  }
  return out;
}

/** Aggregates `y` (sum by default, or `reduce`) for every distinct `x`. */
function applyGroup(rows: readonly GlyphChartMarkRow[], reduce: GlyphChartTransform["reduce"]): GlyphChartMarkRow[] {
  const buckets = new Map<unknown, { x: unknown; values: number[] }>();
  for (const row of rows) {
    const key = row.x instanceof Date ? row.x.getTime() : row.x;
    if (!buckets.has(key)) buckets.set(key, { x: row.x, values: [] });
    const y = numeric(row.y);
    if (Number.isFinite(y)) buckets.get(key)!.values.push(y);
  }
  return [...buckets.values()].map(({ x, values }, i) => {
    const y = reduceValues(values, reduce ?? "sum");
    return { x, y, index: i } as GlyphChartMarkRow;
  });
}

function reduceValues(values: readonly number[], reduce: NonNullable<GlyphChartTransform["reduce"]>): number {
  if (values.length === 0) return 0;
  if (reduce === "sum") return values.reduce((a, b) => a + b, 0);
  if (reduce === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  if (reduce === "min") return Math.min(...values);
  return Math.max(...values);
}

/**
 * Divides every row's `y` by the largest `|y|` within its `by`-defined group
 * (default: the whole series), so a mixed-magnitude series compares on a
 * shared [-1, 1] scale. A group whose values are all zero divides by 1
 * (leaves them at zero) rather than by zero.
 */
function applyNormalize(rows: readonly GlyphChartMarkRow[], by: GlyphChartTransform["by"]): GlyphChartMarkRow[] {
  const maxAbsByGroup = new Map<unknown, number>();
  for (const row of rows) {
    const key = keyOf(row, by);
    const y = Math.abs(numeric(row.y));
    if (Number.isFinite(y)) maxAbsByGroup.set(key, Math.max(maxAbsByGroup.get(key) ?? 0, y));
  }
  return rows.map((row) => {
    const key = keyOf(row, by);
    const denom = maxAbsByGroup.get(key) || 1;
    const y = numeric(row.y);
    return { ...row, y: Number.isFinite(y) ? y / denom : row.y };
  });
}

/** Rolling `reduce` (default mean) over `n` consecutive rows (default 3), assuming rows are already ordered by `x`. */
function applyWindow(rows: readonly GlyphChartMarkRow[], n: number, reduce: GlyphChartTransform["reduce"]): GlyphChartMarkRow[] {
  const ys = rows.map((r) => numeric(r.y));
  return rows.map((row, i) => {
    const lo = Math.max(0, i - Math.floor(n / 2));
    const hi = Math.min(ys.length, lo + n);
    const window = ys.slice(lo, hi).filter(Number.isFinite);
    return { ...row, y: reduceValues(window, reduce ?? "mean") };
  });
}

export function applyGlyphChartTransform(rows: readonly GlyphChartMarkRow[], transform: GlyphChartTransform): GlyphChartMarkRow[] {
  switch (transform.kind) {
    case "bin": return applyBin(rows, transform.n ?? 10);
    case "stack": return applyStack(rows, transform.by);
    case "group": return applyGroup(rows, transform.reduce);
    case "normalize": return applyNormalize(rows, transform.by);
    case "window": return applyWindow(rows, transform.n ?? 3, transform.reduce);
    default: return rows as GlyphChartMarkRow[];
  }
}
