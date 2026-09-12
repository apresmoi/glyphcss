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
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScale, GlyphChartResolvedScales } from "./scales";
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

function axisTicks(
  raw: readonly { value: unknown; fraction: number; label: string }[],
  toCell: (f: number) => number,
  axis: "x" | "y", cols: number, rows: number, labelRow: number,
  maxWidth: number, band: boolean, charset: GlyphChartCharset, ledger: string[],
): GlyphChartLayoutTick[] {
  const sorted = raw.map((t) => ({ ...t, cell: toCell(t.fraction) })).sort((a, b) => a.cell - b.cell);
  // Band ticks retain every kth category when a slot cannot carry even a
  // useful abbreviated label. Numeric/time labels keep their formatted width.
  let stride = 1;
  if (band && sorted.length > 1) {
    const spacing = Math.max(1, (sorted.at(-1)!.cell - sorted[0]!.cell) / (sorted.length - 1));
    stride = Math.max(1, Math.ceil((axis === "x" ? 5 : 2) / spacing));
  }
  const kept: GlyphChartLayoutTick[] = [];
  const candidates = sorted.filter((_, i) => i % stride === 0);
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    const spacing = Math.min(i > 0 ? t.cell - candidates[i - 1]!.cell : Infinity, i + 1 < candidates.length ? candidates[i + 1]!.cell - t.cell : Infinity);
    const slot = axis === "x" && band ? Math.min(maxWidth, Math.max(1, Math.floor(spacing) - 1)) : maxWidth;
    const label = glyphChartLabelLayout([{ id: `${axis}:${String(t.value)}`, x: axis === "x" ? t.cell : Math.floor(slot / 2), y: axis === "x" ? labelRow : t.cell, text: t.label, maxWidth: slot }], { obstacles: [], viewport: { cols, rows }, charset });
    ledger.push(...label.ledger);
    const placed = label.placed[0];
    if (!placed) continue;
    const start = axis === "x" ? placed.x : Math.max(0, maxWidth - placed.text.length);
    const collides = kept.some((k) => axis === "x"
      ? start <= k.labelStart + k.label.length
      : Math.abs(t.cell - k.cell) < 2);
    if (!collides) kept.push({ value: t.value, label: placed.text, cell: t.cell, labelStart: start });
  }
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
  if (legendWide && detail !== "simplified") {
    legend = { row: bottom, items: names.map((label, i) => ({ label, color: SERIES_COLORS[i % SERIES_COLORS.length] })) };
    bottom -= 1;
  } else if (names.length > 1) {
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
    const yTicksRaw = scales.y.ticks(Math.max(2, Math.min(8, bottom - top + 1)));
    const yLabelWidth = Math.min(Math.max(1, Math.floor(cols / 4)), yTicksRaw.reduce((w, t) => Math.max(w, abbreviateChartText(t.label, cols, charset).text.length), 1));
    yAxisCol = yLabelWidth + 1;

    const plotForTicks: GlyphChartPlotRect = {
      x0: Math.min(cols - 1, yAxisCol + 1),
      y0: top,
      x1: cols - 1,
      y1: Math.max(top, xAxisLineRow - 1),
    };
    const plotWidth = Math.max(1, plotForTicks.x1 - plotForTicks.x0 + 1);
    const plotHeight = Math.max(1, plotForTicks.y1 - plotForTicks.y0 + 1);

    const xTickCount = Math.max(2, Math.floor(plotWidth / 6));
    const xTicksRaw = scales.x.ticks(xTickCount);
    xTicks = axisTicks(xTicksRaw, (f) => plotForTicks.x0 + Math.round(f * (plotWidth - 1)), "x", cols, rows, xAxisLabelRow, cols, scales.x.type === "band", charset, ledger);
    yTicks = axisTicks(yTicksRaw, (f) => plotForTicks.y1 - Math.round(f * (plotHeight - 1)), "y", cols, rows, 0, yLabelWidth, scales.y.type === "band", charset, ledger);
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

/** Exact band bounds in CELLS for a `band`-scaled `value` — `undefined` when `scale` isn't a band scale. */
export function bandColRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  return [fractionToCol(plot, lo), fractionToCol(plot, hi) - 1];
}

/** Exact band bounds in CELLS (rows) for a `band`-scaled `value` — note the axis flip matches `fractionToRow`. */
export function bandRowRange(scale: GlyphChartResolvedScale, plot: GlyphChartPlotRect, value: unknown): readonly [number, number] | undefined {
  const range = scale.bandRange?.(value);
  if (!range) return undefined;
  const [lo, hi] = range;
  const a = fractionToRow(plot, lo);
  const b = fractionToRow(plot, hi);
  return [Math.min(a, b), Math.max(a, b)];
}
