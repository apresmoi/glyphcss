/**
 * Budget-first layout (PLAN.md Phase 1 / CHARTS-RESEARCH.md §5): given a
 * fixed `cols × rows` budget, reserve title / legend / y-axis gutter / x-axis
 * row FIRST, pick "nice" ticks and thin them until no two labels collide,
 * THEN allocate whatever remains to the plot rect. At 60×15 the tick count
 * matters more than anti-aliasing (the research doc's own framing) — this is
 * why layout runs before any mark is painted, rather than marks claiming
 * space and axes squeezing into what's left.
 */

import { chartSeries, SERIES_COLORS } from "./series";
import { abbreviateChartText, glyphChartLabelLayout } from "./labels";
import { hasZeroAnchoredMark } from "./scales";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScale, GlyphChartResolvedScales, GlyphChartTick } from "./scales";
import type { GlyphChartCharset, GlyphChartDetail, GlyphChartSpec } from "./types";

export interface GlyphChartLayoutTick {
  readonly value: unknown;
  readonly label: string;
  /** Cell column (x-axis) or row (y-axis). */
  readonly cell: number;
  /** Left edge after abbreviation and viewport placement. */
  readonly labelStart: number;
}

export interface GlyphChartPlotRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GlyphChartLegendItem {
  readonly label: string;
  readonly color?: string;
}

export interface GlyphChartLayout {
  readonly cols: number;
  readonly rows: number;
  readonly plot: GlyphChartPlotRect;
  readonly xTicks: readonly GlyphChartLayoutTick[];
  readonly yTicks: readonly GlyphChartLayoutTick[];
  readonly titleRow: number | null;
  readonly xAxisLineRow: number;
  readonly xAxisLabelRow: number;
  readonly yAxisCol: number;
  readonly legend: { readonly row: number; readonly items: readonly GlyphChartLegendItem[] } | null;
  /** `false` for an arc/text-only spec — see `layoutGlyphChart`'s own comment. `paintAxes` reads this to skip drawing an axis nobody needs. */
  readonly hasCartesianAxes: boolean;
}

/** A power-of-ten value (either sign) — the tick a log axis must never thin away, so the reader always has at least one labelled decade to anchor the others against (review finding 5). */
function isDecadeTick(value: unknown): boolean {
  if (typeof value !== "number" || value === 0 || !Number.isFinite(value)) return false;
  const log = Math.log10(Math.abs(value));
  return Number.isFinite(log) && Math.abs(log - Math.round(log)) < 1e-9;
}

function axisTicks(
  raw: readonly { value: unknown; fraction: number; label: string }[],
  toCell: (f: number) => number,
  axis: "x" | "y", cols: number, rows: number, labelRow: number,
  maxWidth: number, band: boolean, charset: GlyphChartCharset, ledger: string[],
  priorityValues: ReadonlySet<unknown> = new Set(),
): GlyphChartLayoutTick[] {
  const sorted = raw.map((t) => ({ ...t, cell: toCell(t.fraction) })).sort((a, b) => a.cell - b.cell);
  // Band ticks retain every kth category when a slot cannot carry even a
  // useful abbreviated label. Numeric/time labels keep their formatted width.
  let stride = 1;
  if (band && sorted.length > 1) {
    const spacing = Math.max(1, (sorted.at(-1)!.cell - sorted[0]!.cell) / (sorted.length - 1));
    stride = Math.max(1, Math.ceil((axis === "x" ? 5 : 2) / spacing));
  }
  const strided = sorted.filter((_, i) => i % stride === 0);
  // Priority ticks (a bar/rect y-axis's zero baseline, a log axis's own
  // decade values) go through the greedy collision test FIRST, so they can
  // never lose their cell to an ordinary neighbour that merely happened to
  // sort earlier — same candidates, same per-candidate logic, only the
  // ORDER changes; with no priority values this is the original cell order.
  const candidates = priorityValues.size === 0 ? strided : [
    ...strided.filter((t) => priorityValues.has(t.value)),
    ...strided.filter((t) => !priorityValues.has(t.value)),
  ];
  const kept: GlyphChartLayoutTick[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    const spacing = Math.min(i > 0 ? Math.abs(t.cell - candidates[i - 1]!.cell) : Infinity, i + 1 < candidates.length ? Math.abs(candidates[i + 1]!.cell - t.cell) : Infinity);
    const slot = axis === "x" && band ? Math.min(maxWidth, Math.max(1, Math.floor(spacing) - 1)) : maxWidth;
    // `band` (the scale's own type, not a re-derivation from `t.value`'s
    // runtime type) decides this — a synthetic/mocked tick source could
    // hand a band axis numeric-typed `value`s with non-numeric `label`s, and
    // only the SCALE knows which vocabulary its own labels belong to.
    const numeric = !band && typeof t.value === "number";
    const label = glyphChartLabelLayout([{ id: `${axis}:${String(t.value)}`, x: axis === "x" ? t.cell : Math.floor(slot / 2), y: axis === "x" ? labelRow : t.cell, text: t.label, maxWidth: slot, numeric }], { obstacles: [], viewport: { cols, rows }, charset });
    ledger.push(...label.ledger);
    const placed = label.placed[0];
    if (!placed) continue;
    const start = axis === "x" ? placed.x : Math.max(0, maxWidth - placed.text.length);
    // A full interval-overlap test (order-independent) rather than the
    // one-directional "does the new label start before the previous kept
    // one ends" check: priority reordering means `kept` is no longer
    // guaranteed to be in ascending cell order while this loop runs (it is
    // re-sorted at the end), so a one-directional test would misjudge a
    // candidate that sorts BEFORE an already-kept priority tick.
    const tEnd = start + placed.text.length - 1;
    // Symmetric (order-independent) form of the original one-directional
    // "does the new label start before a 1-cell gap past the previous kept
    // one ends" test — reduces to exactly that test when candidates are
    // visited in ascending cell order (the un-prioritised case), and also
    // catches a candidate that sorts BEFORE an already-kept priority tick.
    const collides = kept.some((k) => axis === "x"
      ? start <= k.labelStart + k.label.length && k.labelStart <= tEnd + 1
      : Math.abs(t.cell - k.cell) < 2);
    if (collides) continue;
    // Never show the identical label text twice — ambiguous, not merely
    // crowded (review finding 5: a two-day time axis kept two ticks both
    // formatted "12 PM" after thinning dropped the two that carried the
    // actual dates). Cell-adjacency alone doesn't catch this: two ticks can
    // occupy disjoint cells and still repeat the same string.
    const lastKept = kept.at(-1);
    if (lastKept && lastKept.label === placed.text) {
      ledger.push(`layout: ${axis} tick "${placed.text}" dropped — duplicate of the previous kept label.`);
      continue;
    }
    kept.push({ value: t.value, label: placed.text, cell: t.cell, labelStart: start });
  }
  // Priority ticks were considered out of cell order above; restore ascending
  // cell order for the returned/painted set (every consumer assumes it).
  kept.sort((a, b) => a.cell - b.cell);
  if (kept.length < raw.length) ledger.push(`layout: ${axis} ticks thinned ${raw.length} -> ${kept.length}${band ? ` (every ${stride}th category before collision thinning)` : ""}.`);
  return kept;
}

export function seriesNames(marks: readonly GlyphChartResolvedMark[]): string[] {
  return [...new Set(chartSeries(marks).flatMap((s) => s.name === undefined ? [] : [s.name]))];
}

export function layoutGlyphChart(
  spec: GlyphChartSpec,
  marks: readonly GlyphChartResolvedMark[],
  scales: GlyphChartResolvedScales,
  cols: number,
  rows: number,
  detail: GlyphChartDetail,
  ledger: string[],
  charset: GlyphChartCharset = "box",
  showLegend = true,
): GlyphChartLayout {
  let top = 0;
  let bottom = rows - 1;

  let titleRow: number | null = null;
  if (spec.title && detail !== "simplified" && rows > 4) {
    titleRow = top;
    top += 1;
  } else if (spec.title) {
    ledger.push(`layout: title dropped — viewport too small (${cols}x${rows}).`);
  }

  const names = seriesNames(marks);
  let legend: GlyphChartLayout["legend"] = null;
  const legendWide = names.length > 1 && cols >= 12 && rows - top - 3 > 2;
  if (showLegend && legendWide && detail !== "simplified") {
    legend = { row: bottom, items: names.map((label, i) => ({ label, color: SERIES_COLORS[i % SERIES_COLORS.length] })) };
    bottom -= 1;
  } else if (showLegend && names.length > 1) {
    ledger.push(`layout: legend dropped for ${names.length} series — viewport too small (${cols}x${rows}).`);
  }

  // A spec made only of `arc`/`text` marks has no cartesian x/y axis to
  // show at all (a pie chart's own radius fills the whole rect) — skipping
  // the gutter and axis rows for that case, rather than drawing empty
  // ticks against a meaningless default [0,1] domain, is what keeps a
  // donut chart from wasting a third of a small viewport on an axis nobody
  // reads.
  const cartesian = marks.some(({ mark }) => mark.type !== "arc" && mark.type !== "text");

  let xAxisLabelRow = -1;
  let xAxisLineRow = -1;
  let yAxisCol = 0;
  let xTicks: GlyphChartLayoutTick[] = [];
  let yTicks: GlyphChartLayoutTick[] = [];

  if (cartesian && rows - top >= 3 && cols >= 4) {
    xAxisLabelRow = bottom;
    bottom -= 1;
    xAxisLineRow = bottom;
    bottom -= 1;

    // y-axis gutter width: measure a generous tick set's label width first,
    // then reserve exactly that many columns plus the axis-line column.
    // The requested count is derived from what the MINIMUM label spacing
    // (2 rows, `axisTicks`'s own y-collision rule) can actually hold —
    // asking d3 for more than that just gets greedily thinned back down to
    // an arbitrary, unevenly-spaced subset (review finding 5) rather than
    // d3's own evenly-spaced "nice" answer for a count that already fits.
    const yRowBudget = Math.max(2, Math.min(8, Math.floor((bottom - top + 1) / 2) + 1));
    let yTicksRaw: GlyphChartTick[] = scales.y.ticks(yRowBudget);
    const yZeroAnchored = scales.y.type !== "band" && scales.y.type !== "time" && hasZeroAnchoredMark(marks);
    // The zero baseline is the one tick a bar/rect/area chart must always
    // label, whether or not d3's own "nice" set happened to include it.
    if (yZeroAnchored && !yTicksRaw.some((t) => t.value === 0)) {
      yTicksRaw = [...yTicksRaw, { value: 0, fraction: scales.y.toFraction(0), label: scales.y.format(0) }];
    }
    const yLabelWidth = Math.min(Math.max(1, Math.floor(cols / 4)), yTicksRaw.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.y.type !== "band" && typeof t.value === "number").text.length), 1));
    yAxisCol = yLabelWidth + 1;

    const plotForTicks: GlyphChartPlotRect = {
      x0: Math.min(cols - 1, yAxisCol + 1),
      y0: top,
      x1: cols - 1,
      y1: Math.max(top, xAxisLineRow - 1),
    };
    const plotWidth = Math.max(1, plotForTicks.x1 - plotForTicks.x0 + 1);
    const plotHeight = Math.max(1, plotForTicks.y1 - plotForTicks.y0 + 1);

    // x: same "ask for what fits" idea, refined by an actually MEASURED
    // label width rather than a flat constant — a provisional request gives
    // d3's own labels to measure, then a tighter final request (never
    // larger) accounts for genuinely wide ones (e.g. "Jan 01" on a time
    // axis) instead of relying on `axisTicks`'s collision thinning to claw
    // back the overshoot.
    const xTickCountProvisional = Math.max(2, Math.floor(plotWidth / 6));
    const provisionalXTicks = scales.x.ticks(xTickCountProvisional);
    const measuredXLabelWidth = provisionalXTicks.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset, scales.x.type !== "band" && typeof t.value === "number").text.length), 1);
    const xTickCount = Math.max(2, Math.min(xTickCountProvisional, Math.floor(plotWidth / (measuredXLabelWidth + 1))));
    const xTicksRaw = xTickCount >= xTickCountProvisional ? provisionalXTicks : scales.x.ticks(xTickCount);

    const xPriority = new Set<unknown>(scales.x.type === "log" ? xTicksRaw.filter((t) => isDecadeTick(t.value)).map((t) => t.value) : []);
    const yPriority = new Set<unknown>(
      scales.y.type === "log" ? yTicksRaw.filter((t) => isDecadeTick(t.value)).map((t) => t.value)
      : yZeroAnchored ? [0]
      : [],
    );
    xTicks = axisTicks(xTicksRaw, (f) => plotForTicks.x0 + Math.round(f * (plotWidth - 1)), "x", cols, rows, xAxisLabelRow, cols, scales.x.type === "band", charset, ledger, xPriority);
    yTicks = axisTicks(yTicksRaw, (f) => plotForTicks.y1 - Math.round(f * (plotHeight - 1)), "y", cols, rows, 0, yLabelWidth, scales.y.type === "band", charset, ledger, yPriority);
  }

  const plot: GlyphChartPlotRect = {
    x0: xAxisLineRow >= 0 ? Math.min(cols - 1, yAxisCol + 1) : 0,
    y0: top,
    x1: cols - 1,
    y1: xAxisLineRow >= 0 ? Math.max(top, xAxisLineRow - 1) : bottom,
  };

  return {
    cols,
    rows,
    plot,
    xTicks,
    yTicks,
    titleRow,
    xAxisLineRow,
    xAxisLabelRow,
    yAxisCol,
    legend,
    hasCartesianAxes: xAxisLineRow >= 0,
  };
}

export function fractionToCol(plot: GlyphChartPlotRect, fraction: number): number {
  const width = Math.max(1, plot.x1 - plot.x0 + 1);
  return plot.x0 + Math.round(fraction * (width - 1));
}

/** Row 0 is the grid's TOP, but a fraction of 1 means "top of the axis domain" (the scale's own convention) — so a larger fraction maps to a SMALLER row. */
export function fractionToRow(plot: GlyphChartPlotRect, fraction: number): number {
  const height = Math.max(1, plot.y1 - plot.y0 + 1);
  return plot.y1 - Math.round(fraction * (height - 1));
}

export function scaleToCol(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToCol(plot, scale.toFraction(value));
}

export function scaleToRow(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToRow(plot, scale.toFraction(value));
}

/**
 * `fractionToCol`/`fractionToRow` WITHOUT the `Math.round` — the sub-cell
 * precision a `braille`/`blocks` `dot` mark needs to place its mark at the
 * data point's actual sub-cell position (via `canvas.line`'s degenerate
 * point case) instead of snapping to the nearest whole cell first and
 * losing that precision before the canvas ever sees it. Every other caller
 * (bars, areas, axes, the whole-cell `dot` path) wants the rounded, integer
 * CELL the rest of this module already provides.
 */
export function fractionToColExact(plot: GlyphChartPlotRect, fraction: number): number {
  const width = Math.max(1, plot.x1 - plot.x0 + 1);
  return plot.x0 + fraction * (width - 1);
}

export function fractionToRowExact(plot: GlyphChartPlotRect, fraction: number): number {
  const height = Math.max(1, plot.y1 - plot.y0 + 1);
  return plot.y1 - fraction * (height - 1);
}

export function scaleToColExact(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToColExact(plot, scale.toFraction(value));
}

export function scaleToRowExact(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): number {
  return fractionToRowExact(plot, scale.toFraction(value));
}

/** Exact band bounds in CELLS for a `band`-scaled `value` — `undefined` when `scale` isn't a band scale. */
export function bandColRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  return [fractionToCol(plot, lo), fractionToCol(plot, hi) - 1];
}

/**
 * Exact band bounds in CELLS (rows) for a `band`-scaled `value` — the SAME
 * half-open convention `bandColRange` already applies (`fractionToCol(hi) -
 * 1`, keeping the `lo`-mapped coordinate exact and shrinking only the
 * `hi`-mapped one), carried through the row axis's own flip. `lo < hi`
 * always (`bandRange`'s own contract: a positive bandwidth), and
 * `fractionToRow` is non-increasing in its fraction argument, so the row for
 * `lo` (`a`, closer to the plot's bottom) is always `>=` the row for `hi`
 * (`b`, closer to the top) — the row axis's analogue of "increasing" is
 * DECREASING row numbers, so shrinking the `hi` side means moving `b`
 * *toward* `a`, i.e. `b + 1`, not `a - 1`. Without this, two adjacent row
 * bands shared their boundary row, each painting the other's value there
 * (review finding 12) — `Math.min(a, b)`/`Math.max(a, b)` with no
 * adjustment at all was the previous (buggy) behaviour.
 */
export function bandRowRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  const a = fractionToRow(plot, lo);
  const b = fractionToRow(plot, hi);
  return [b + 1, a];
}

/**
 * Clips a segment `a`-`b` (in CELL space, possibly sub-cell/fractional) to
 * `plot`'s inclusive `[x0, x1] x [y0, y1]` rectangle — the standard
 * Liang-Barsky parametric line clip. Returns `null` when the segment misses
 * the rect entirely. Callers whose fill/text painters already clamp their
 * own coordinates (bar/rect/cell/arc/dot) don't need this; `line()` draws
 * along a run the canvas itself never bounds to anything narrower than the
 * whole grid, so a mark whose value lies outside an explicit, narrower
 * scale domain (review finding 2) would otherwise paint through the title,
 * the axis line, and the tick labels.
 */
export function clipSegmentToPlot(a: GlyphCanvasPointLike, b: GlyphCanvasPointLike, plot: GlyphChartPlotRect): readonly [GlyphCanvasPointLike, GlyphCanvasPointLike] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clipEdge = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clipEdge(-dx, a.x - plot.x0)) return null;
  if (!clipEdge(dx, plot.x1 - a.x)) return null;
  if (!clipEdge(-dy, a.y - plot.y0)) return null;
  if (!clipEdge(dy, plot.y1 - a.y)) return null;
  if (t0 > t1) return null;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

interface GlyphCanvasPointLike { readonly x: number; readonly y: number }
