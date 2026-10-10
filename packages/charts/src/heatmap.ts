/**
 * Heatmap (`cell`) geometry and ramp. A chart made only of `cell` marks on
 * two band scales is a heatmap: its cells sit flush (no band padding), keep a
 * roughly square 2:1 column-to-row shape, and the chart shrinks to the grid
 * instead of stretching cells across the whole canvas. An unsigned heatmap
 * shades on a ramp with no blank level (a blank reads as missing data) and
 * gets a one-line range key under the grid.
 */
import type { GlyphChartLayout } from "./layout";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScales } from "./scales";
import type { GlyphChartCharset } from "./types";

/**
 * Default unsigned ramps, lightest first. Box/blocks/braille use the shade
 * blocks; ascii uses glyphs ordered by measured ink coverage in Menlo
 * (`.` 0.06 through `@` 0.33). Neither starts with a blank.
 */
const HEATMAP_RAMPS: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: [".", ":", "+", "*", "%", "#", "@"],
  box: ["░", "▒", "▓", "█"],
  blocks: ["░", "▒", "▓", "█"],
  braille: ["░", "▒", "▓", "█"],
};

export function heatmapRamp(charset: GlyphChartCharset, cellRamp: readonly string[] | undefined): readonly string[] {
  return cellRamp ?? HEATMAP_RAMPS[charset];
}

/** Every mark is a `cell` — the band scales then drop their padding so cells sit flush. */
export function isHeatmap(marks: readonly GlyphChartResolvedMark[]): boolean {
  return marks.length > 0 && marks.every(({ mark }) => mark.type === "cell");
}

/** The numeric `fill` values of every cell mark. */
export function cellFillValues(marks: readonly GlyphChartResolvedMark[]): readonly number[] {
  return marks.filter((m) => m.mark.type === "cell").flatMap((m) => m.rows.map((r) => Number(r.fill))).filter(Number.isFinite);
}

/** A heatmap whose values cross zero keeps its signed gain/loss ramps (blank = exactly zero) and has no range key. */
export function cellSigned(values: readonly number[]): boolean {
  return values.some((v) => v < 0) && values.some((v) => v > 0);
}

/** `[min, max]` of an unsigned heatmap's values — the ramp spans exactly this range, and the key labels both ends. */
export function cellRange(values: readonly number[]): readonly [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/** The ramp index for `value` over `[lo, hi]`: equal-width bins, the maximum in the last one. Equal values have no variation to show, so they take the lightest level. */
export function cellRampLevel(value: number, lo: number, hi: number, levels: number): number {
  if (hi === lo) return 0;
  return Math.max(0, Math.min(levels - 1, Math.floor(((value - lo) / (hi - lo)) * levels)));
}

/**
 * Columns per cell for every row of cells: a cell is `2k` columns by `k`
 * rows, the largest `k` both axes fit. `0` when even `k = 1` doesn't fit,
 * and the cells then share the plot the way any band chart does.
 */
export function heatmapCellScale(plotCols: number, categoryRows: number, xCount: number, yCount: number): number {
  if (xCount === 0 || yCount === 0) return 0;
  return Math.max(0, Math.min(Math.floor(plotCols / (2 * xCount)), Math.floor(categoryRows / yCount)));
}

/**
 * The canvas size that leaves a heatmap's plot exactly `2k` columns per x
 * category and `k` rows per y category (plus the x axis row when its line
 * shows), or `undefined` when the cells can't get even `k = 1`.
 */
export function heatmapFit(layout: GlyphChartLayout, scales: GlyphChartResolvedScales): { readonly cols: number; readonly rows: number } | undefined {
  if (!layout.hasCartesianAxes) return undefined;
  const plotCols = layout.plot.x1 - layout.plot.x0 + 1;
  const categoryRows = layout.plot.y1 - layout.plot.y0 + 1 - (layout.xAxisLine ? 1 : 0);
  const xCount = scales.x.domain.length, yCount = scales.y.domain.length;
  const k = heatmapCellScale(plotCols, categoryRows, xCount, yCount);
  if (k === 0) return undefined;
  return { cols: layout.cols - (plotCols - 2 * k * xCount), rows: layout.rows - (categoryRows - k * yCount) };
}
