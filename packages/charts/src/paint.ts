/**
 * Paints a resolved+laid-out spec onto a `GlyphCanvas`, in FIXED priority
 * order (PLAN.md Phase 1): fills (bar/area/rect/cell/arc — region marks)
 * first, then axes, then marks (line/dot/rule — stroke/point marks), then
 * labels (title/legend/data labels) last, so nothing paints over a label.
 * Every mark type gets its own small painter function; `paintGlyphChart`
 * is the only place that decides ORDER, matching `docs/design/canvas.md`'s
 * own "tiers are tables, painters are dumb" discipline one level up.
 */

import { GLYPH_CANVAS_TIERS, type GlyphCanvas, type GlyphCanvasLineStyle } from "glyphcss";
import {
  bandColRange,
  bandRowRange,
  clipSegmentToPlot,
  scaleToCol,
  scaleToColExact,
  scaleToRow,
  scaleToRowExact,
  type GlyphChartLayout,
} from "./layout";
import { glyphChartLabelLayout, type GlyphChartLabelCandidate, type GlyphChartObstacleRect } from "./labels";
import { areaLayers, chartSeries, SERIES_COLORS, SERIES_STYLES, seriesDot, seriesShade, type ChartSeries } from "./series";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScales } from "./scales";
import type { GlyphChartMarkRow, GlyphChartSpec } from "./types";

const PALETTE = SERIES_COLORS;

/** See `shadeFor`'s own doc (the "orchestration" section below). */
const GLYPH_CHART_CELL_MIN_INK_SHADE = 0.15;

export interface GlyphChartPaintOptions {
  readonly colorEnabled: boolean;
}

function paletteColor(i: number, enabled: boolean): string | null {
  return enabled ? PALETTE[i % PALETTE.length]! : null;
}

function numeric(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

// ── fills ────────────────────────────────────────────────────────────────

/**
 * Divides a band's `[x0, x1]` cell range into `count` equal-ish, gapless,
 * non-overlapping sub-bands (Plot's own `fx`-free dodge: series side by side
 * within the band, in series order) — the first `width % count` sub-bands
 * get one extra cell so the sub-bands still sum to the full band width
 * exactly (same "neither gap nor overlap" discipline as `bandColRange`
 * itself). When the band is narrower than `count` (each series can't get
 * even one cell), dodging is impossible without inventing fractional cells:
 * DEGRADE to the undivided full-width range (the pre-fix behaviour) and log
 * exactly once per distinct band width so the reader knows why series
 * overlap there.
 */
function dodgeColRange(range: readonly [number, number], index: number, count: number, ledger: string[], degraded: Set<number>): readonly [number, number] {
  const [x0, x1] = range;
  const width = x1 - x0 + 1;
  if (width < count) {
    if (!degraded.has(width)) {
      degraded.add(width);
      ledger.push(`layout: ${count} bar/rect series do not fit in a ${width}-cell band; bars overlap.`);
    }
    return range;
  }
  const base = Math.floor(width / count);
  const remainder = width % count;
  const widthForIndex = base + (index < remainder ? 1 : 0);
  const offset = index * base + Math.min(index, remainder);
  return [x0 + offset, x0 + offset + widthForIndex - 1];
}

/**
 * A bar's cell span is `(baseline, value]` — NOT `[0, value]` clamped to
 * "above" — so a negative value (mixed-sign honesty gate) draws BELOW the
 * baseline instead of collapsing to a zero-height bar. `stack`-transformed
 * rows (`y0`/`y1` present) use their own segment bounds instead of the
 * shared 0 baseline, and use the FULL band width — dodging is a horizontal
 * grouping for UNSTACKED multi-series bars only (a stack is already
 * disambiguated vertically, by `y0`/`y1`).
 */
function paintBar(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, dodge: { readonly index: number; readonly count: number }, ledger: string[], degraded: Set<number>): void {
  const baselineRow = scaleToRow(scales.y, layout.plot, 0);
  const fallbackWidth = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) / Math.max(1, rows.length) * 0.7));
  for (const row of rows) {
    const stacked = row.y1 !== undefined;
    const topValue = stacked ? row.y1! : numeric(row.y);
    if (!Number.isFinite(topValue)) continue;
    const bottomValue = stacked ? (row.y0 ?? 0) : 0;
    const rowTop = scaleToRow(scales.y, layout.plot, topValue);
    const rowBottom = stacked ? scaleToRow(scales.y, layout.plot, bottomValue) : baselineRow;
    if (rowTop === rowBottom) continue;
    const top = Math.max(layout.plot.y0, Math.min(rowTop, rowBottom) + (rowTop > rowBottom ? 1 : 0));
    // Cell boundaries are half-open: coincident endpoints paint nothing.
    const bottom = Math.min(layout.plot.y1, Math.max(rowTop, rowBottom) - (rowTop < rowBottom ? 1 : 0));

    const band = bandColRange(scales.x, layout.plot, row.x);
    let range: readonly [number, number];
    if (band) {
      range = band;
    } else {
      const col = scaleToCol(scales.x, layout.plot, row.x);
      const half = Math.floor(fallbackWidth / 2);
      range = [col - half, col - half + fallbackWidth - 1];
    }
    if (!stacked && dodge.count > 1) range = dodgeColRange(range, dodge.index, dodge.count, ledger, degraded);
    let [x0, x1] = range;
    x0 = Math.max(layout.plot.x0, x0);
    x1 = Math.min(layout.plot.x1, x1);
    if (x0 > x1 || top > bottom) continue;
    canvas.fillRect(x0, top, x1, bottom, { fill: "solid", color });
  }
}

function paintArea(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null): void {
  for (const layer of areaLayers(rows)) {
    const sorted = [...layer].sort((a, b) => scales.x.toFraction(a.x) - scales.x.toFraction(b.x));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      const colA = scaleToCol(scales.x, layout.plot, a.x), colB = scaleToCol(scales.x, layout.plot, b.x);
      const topA = scaleToRow(scales.y, layout.plot, a.y1 ?? a.y), topB = scaleToRow(scales.y, layout.plot, b.y1 ?? b.y);
      const baseA = scaleToRow(scales.y, layout.plot, a.y0 ?? 0), baseB = scaleToRow(scales.y, layout.plot, b.y0 ?? 0);
      for (let col = Math.max(layout.plot.x0, colA); col <= Math.min(layout.plot.x1, colB); col++) {
        const t = colA === colB ? 0 : (col - colA) / (colB - colA);
        const value = Math.round(topA + (topB - topA) * t), base = Math.round(baseA + (baseB - baseA) * t);
        if (value === base) continue;
        const top = Math.max(layout.plot.y0, Math.min(value, base) + (value > base ? 1 : 0)), bottom = Math.min(layout.plot.y1, Math.max(value, base) - (value < base ? 1 : 0));
        if (top <= bottom) canvas.fillRect(col, top, col, bottom, { fill: "solid", color });
      }
    }
  }
}

/**
 * A `rect` on a band `x` scale is a "band mark" exactly like `bar`
 * (AGENTS.md's "Band marks use the scale's own bounds") — it owns the FULL
 * band, not one arbitrary column — so UNSTACKED multi-series rects dodge
 * into that band's sub-bands via the SAME `dodgeColRange` a bar uses,
 * instead of every series overwriting the same single column (review
 * finding 4: an undodged Jan band read as North's bar with South's own
 * value merely painted over its base, "January resembles a stack").
 */
function paintRect(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, dodge: { readonly index: number; readonly count: number }, ledger: string[], degraded: Set<number>): void {
  const fallbackWidth = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) / Math.max(1, rows.length) * 0.7));
  for (const row of rows) {
    const stacked = row.y1 !== undefined;
    const base = scaleToRow(scales.y, layout.plot, row.y0 ?? 0);
    const value = scaleToRow(scales.y, layout.plot, row.y1 ?? row.y);
    if (value === base) continue;
    const top = Math.max(layout.plot.y0, Math.min(base, value) + (value > base ? 1 : 0));
    const bottom = Math.min(layout.plot.y1, Math.max(base, value) - (value < base ? 1 : 0));

    const band = bandColRange(scales.x, layout.plot, row.x);
    let range: readonly [number, number];
    if (band) {
      range = band;
    } else {
      const col = scaleToCol(scales.x, layout.plot, row.x);
      const half = Math.floor(fallbackWidth / 2);
      range = [col - half, col - half + fallbackWidth - 1];
    }
    if (!stacked && dodge.count > 1) range = dodgeColRange(range, dodge.index, dodge.count, ledger, degraded);
    let [x0, x1] = range;
    x0 = Math.max(layout.plot.x0, x0);
    x1 = Math.min(layout.plot.x1, x1);
    if (x0 > x1 || !Number.isFinite(top) || top > bottom) continue;
    canvas.fillRect(x0, top, x1, bottom, { fill: "solid", color });
  }
}

function paintCell(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, shadeFor: (v: number) => number): void {
  const fallbackCols = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) * (scales.x.bandStep ?? 1 / Math.max(1, rows.length))));
  const fallbackRows = Math.max(1, Math.round((layout.plot.y1 - layout.plot.y0 + 1) * (scales.y.bandStep ?? 1 / Math.max(1, rows.length))));
  for (const row of rows) {
    const colBand = bandColRange(scales.x, layout.plot, row.x);
    const rowBand = bandRowRange(scales.y, layout.plot, row.y);
    let x0: number, x1: number, y0: number, y1: number;
    if (colBand) [x0, x1] = colBand;
    else { const col = scaleToCol(scales.x, layout.plot, row.x); const half = Math.floor(fallbackCols / 2); x0 = col - half; x1 = col - half + fallbackCols - 1; }
    if (rowBand) [y0, y1] = rowBand;
    else { const r = scaleToRow(scales.y, layout.plot, row.y); const half = Math.floor(fallbackRows / 2); y0 = r - half; y1 = r - half + fallbackRows - 1; }
    x0 = Math.max(layout.plot.x0, x0); x1 = Math.min(layout.plot.x1, x1);
    y0 = Math.max(layout.plot.y0, y0); y1 = Math.min(layout.plot.y1, y1);
    if (x0 > x1 || y0 > y1) continue;
    const shade = row.fill !== undefined ? shadeFor(numeric(row.fill)) : 1;
    canvas.fillRect(x0, y0, x1, y1, { fill: Number.isFinite(shade) ? { shade } : "solid", color });
  }
}

/**
 * One total covers every category in a pie. Angle and radius select the
 * slice per cell; its categorical shade is painted through canvas.text so
 * blocks/braille retain the same full-cell shade vocabulary as the legend,
 * instead of substituting subcell occupancy for slice identity.
 */
function paintArc(canvas: GlyphCanvas, layout: GlyphChartLayout, series: readonly ChartSeries[], innerRadius: number, colorEnabled: boolean, ledger: string[], resolvedRowCount: number): void {
  const values = series.map((s) => s.rows.reduce((sum, r) => sum + numeric(r.y), 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) { ledger.push("GLYPH_CHART_EMPTY_TOTAL: pie total is zero; no slices painted."); return; }
  // `chartSeries` already dropped every nonpositive/zero-or-less arc row
  // before `series` ever reached this painter (`docs/design/charts.md`'s
  // documented rule: "Negative pie values contribute zero"), so the drop
  // itself is intended — but it happened silently, with no record a reader
  // of `report.ledger` could see (review's P2 #11). The comparison is
  // against `resolvedRowCount` (the mark's own resolved row count BEFORE
  // `chartSeries` split/filtered it), never a re-derivation from `series`,
  // since `series` has already lost the rows this exists to report on.
  const shownRows = series.reduce((n, s) => n + s.rows.length, 0);
  if (shownRows < resolvedRowCount) {
    ledger.push(`arc: ${resolvedRowCount - shownRows} of ${resolvedRowCount} slice(s) dropped — nonpositive values contribute zero to the total and paint no slice.`);
  }
  const cx = (layout.plot.x0 + layout.plot.x1) / 2;
  const cy = (layout.plot.y0 + layout.plot.y1) / 2;
  const rx = (layout.plot.x1 - layout.plot.x0) / 2;
  const ry = (layout.plot.y1 - layout.plot.y0) / 2;
  let start = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const angle = (v / total) * Math.PI * 2;
    const s = start;
    start += angle;
    const entry = series[i]!;
    return { s, e: start, color: paletteColor(entry.styleIndex, colorEnabled), glyph: seriesShade(canvas.tier, entry.shadeIndex!) };
  });
  for (let y = layout.plot.y0; y <= layout.plot.y1; y++) {
    for (let x = layout.plot.x0; x <= layout.plot.x1; x++) {
      const dx = (x - cx) / (rx || 1);
      const dy = (y - cy) / (ry || 1);
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 1 || r < innerRadius) continue;
      let theta = Math.atan2(dy, dx);
      if (theta < slices[0]!.s) theta += Math.PI * 2;
      const slice = slices.find((s) => theta >= s.s && theta < s.e) ?? slices[slices.length - 1]!;
      canvas.text(x, y, [slice.glyph], { color: slice.color });
    }
  }
}

// ── axes ─────────────────────────────────────────────────────────────────

function paintAxes(canvas: GlyphCanvas, layout: GlyphChartLayout): void {
  if (!layout.hasCartesianAxes) return;
  // Axes stay WHOLE-CELL box-drawing (`│ ─`) even under `braille`/`blocks`,
  // where DATA marks rasterise at sub-cell (dot) resolution — an axis is
  // structure, not data, and reads as a rule either way (AGENTS.md's "Cell
  // canvas" / "sub-cell data marks, whole-cell axes").
  canvas.line({ x: layout.yAxisCol, y: layout.plot.y0 }, { x: layout.yAxisCol, y: layout.xAxisLineRow }, { subcell: false });
  canvas.line({ x: layout.yAxisCol, y: layout.xAxisLineRow }, { x: layout.plot.x1, y: layout.xAxisLineRow }, { subcell: false });
  for (const t of layout.xTicks) {
    canvas.text(t.labelStart, layout.xAxisLabelRow, [t.label]);
  }
  for (const t of layout.yTicks) {
    canvas.text(t.labelStart, t.cell, [t.label]);
  }
}

// ── marks (line / dot / rule) ───────────────────────────────────────────

/**
 * `canvas.line()` itself bounds a run only to the whole GRID (0..cols,
 * 0..rows) — it has no notion of the chart's own, possibly narrower, plot
 * rect. An explicit scale domain excluding some of the data (or a `null` y
 * that resolves to a value outside `[0,1]` via `Number`) would otherwise
 * paint straight through the title row, the axis line, and the tick labels
 * (review finding 2) — `clipSegmentToPlot` is what `paintDot`'s own
 * plot-rect bounds check already does for a single point, generalised to a
 * segment.
 */
function paintLine(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, style: GlyphCanvasLineStyle = "solid"): void {
  const points = rows
    .map((r) => ({ x: scaleToCol(scales.x, layout.plot, r.x), y: scaleToRow(scales.y, layout.plot, r.y) }));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const clipped = clipSegmentToPlot(a, b, layout.plot);
    if (!clipped) continue;
    canvas.line(clipped[0], clipped[1], { color, style });
  }
}

// Mirrors `GlyphCanvas.sub`'s fixed 2-wide x 4-tall dot lattice (`AGENTS.md`'s
// "Cell canvas") — a public contract, not a canvas-internal detail — so this
// module can compute a SAME-CELL companion dot without reaching into
// `glyphcss`'s private sub-cell code.
const SUBCELL_DOT_COLS = 2;
const SUBCELL_DOT_ROWS = 4;

/**
 * The dot lattice's own rounding rule (`canvas.ts`'s `toSubcellSpace`,
 * `DOTS * x + (DOTS - 1) / 2`, then rounded) — replicated here so this
 * function derives the EXACT dot the canvas will independently re-derive
 * from the same `col`/`row`, rather than guessing at it.
 */
function primaryDotIndex(coord: number, dotsPerCell: number): number {
  return Math.round(dotsPerCell * coord + (dotsPerCell - 1) / 2);
}

/** Inverse of `primaryDotIndex` — the cell-space coordinate whose own dot
 * index is exactly `dotIndex`. */
function dotIndexToCoord(dotIndex: number, dotsPerCell: number): number {
  return (dotIndex - (dotsPerCell - 1) / 2) / dotsPerCell;
}

/**
 * `braille`/`blocks` place the mark AT its sub-cell position instead of the
 * whole-cell glyph `ascii`/`box` still use (`seriesDot`'s `● × + ◆`/
 * `o x + *`) — a whole-cell mark would throw away the resolution `line()`
 * now has for these two tiers. `scaleToColExact`/`scaleToRowExact`
 * (unrounded) carry that precision from the scale into cell space; ROUNDING
 * it first (`scaleToCol`) would snap the mark to a whole cell before the
 * canvas ever sees the sub-cell offset.
 *
 * What keeps monochrome series identity legible at this resolution:
 * `styleIndex % 4 === 0` (the common "one series, or colour already carries
 * identity" case — `paintGlyphChart` zeroes `styleIndex` whenever
 * `colorEnabled`) is a single dot at the exact position via `canvas.line`'s
 * degenerate zero-length case; the other three cycle a distinct 2-dot
 * COMPANION shape (horizontal / vertical / diagonal pair) computed to land
 * in the SAME braille cell as the primary dot, via `primaryDotIndex` —
 * simply adding "half a cell" in continuous cell-space can cross into the
 * NEIGHBOURING cell instead, depending on which half of the current cell the
 * primary's own fraction happens to round into (verified by
 * `review.test.ts`). Every shape stays within the DOT MARK's own "at most 2
 * dots" bound — a property of `paintSubcellDot` below, not of `line()`
 * itself, which has no such limit (a genuine sloped `line()` run legitimately
 * touches up to 4 dots per cell; `canvas.ts`/`docs/design/canvas.md` are the
 * source of truth for that).
 */
/**
 * Paints the sub-cell (braille/blocks) dot pattern for `shape` (0: a single
 * centred dot; 1/2/3: a horizontal/vertical/diagonal 2-dot companion pair)
 * at continuous cell-space position `(col, r)`. Shared by `paintDot` and the
 * dot legend swatch (`paintGlyphChart`) so the legend can never show a
 * pattern the plot itself does not paint (review finding 4).
 *
 * Each dot is painted as its own DEGENERATE (zero-length) `line()` call
 * rather than one `line()` between the primary and its companion: the
 * companion sits exactly 2 dot-steps away on the vertical/diagonal shapes,
 * and a real connecting line rasterises the dot exactly between them too,
 * exceeding the documented "at most 2 dots" bound (review finding 3).
 */
function paintSubcellDot(canvas: GlyphCanvas, col: number, r: number, shape: number, color: string | null): void {
  canvas.line({ x: col, y: r }, { x: col, y: r }, { color });
  if (shape === 0) return;
  const dotCol = primaryDotIndex(col, SUBCELL_DOT_COLS);
  const dotRow = primaryDotIndex(r, SUBCELL_DOT_ROWS);
  const cellCol = Math.floor(dotCol / SUBCELL_DOT_COLS);
  const cellRow = Math.floor(dotRow / SUBCELL_DOT_ROWS);
  const localCol = dotCol - cellCol * SUBCELL_DOT_COLS;
  const localRow = dotRow - cellRow * SUBCELL_DOT_ROWS;
  // shape 1: horizontal pair, shape 2: vertical pair, shape 3: diagonal.
  const companionLocalCol = shape === 1 || shape === 3 ? (localCol + 1) % SUBCELL_DOT_COLS : localCol;
  const companionLocalRow = shape === 2 || shape === 3 ? (localRow + 2) % SUBCELL_DOT_ROWS : localRow;
  const companionCol = dotIndexToCoord(cellCol * SUBCELL_DOT_COLS + companionLocalCol, SUBCELL_DOT_COLS);
  const companionRow = dotIndexToCoord(cellRow * SUBCELL_DOT_ROWS + companionLocalRow, SUBCELL_DOT_ROWS);
  canvas.line({ x: companionCol, y: companionRow }, { x: companionCol, y: companionRow }, { color });
}

function paintDot(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number): void {
  const subcell = GLYPH_CANVAS_TIERS[canvas.tier].subcell;
  const glyph = seriesDot(canvas.tier, styleIndex);
  const shape = styleIndex % 4;
  for (const row of rows) {
    if (subcell) {
      const col = scaleToColExact(scales.x, layout.plot, row.x);
      const r = scaleToRowExact(scales.y, layout.plot, row.y);
      if (!Number.isFinite(col) || !Number.isFinite(r)) continue;
      // Clip by the mark's actual DESTINATION cell — the same dot-lattice
      // rounding `paintSubcellDot`/the canvas independently perform — never
      // a heuristic half-cell margin on the continuous coordinate: a
      // coordinate whose exact position sits just outside the plot rect but
      // whose ROUNDED cell still lands outside it too must not paint there
      // (review finding 2 — a half-cell margin wrongly admitted it).
      const dotCol = primaryDotIndex(col, SUBCELL_DOT_COLS);
      const dotRow = primaryDotIndex(r, SUBCELL_DOT_ROWS);
      const cellCol = Math.floor(dotCol / SUBCELL_DOT_COLS);
      const cellRow = Math.floor(dotRow / SUBCELL_DOT_ROWS);
      if (cellCol < layout.plot.x0 || cellCol > layout.plot.x1 || cellRow < layout.plot.y0 || cellRow > layout.plot.y1) continue;
      paintSubcellDot(canvas, col, r, shape, color);
      continue;
    }
    const col = scaleToCol(scales.x, layout.plot, row.x);
    const r = scaleToRow(scales.y, layout.plot, row.y);
    if (!Number.isFinite(col) || !Number.isFinite(r) || col < layout.plot.x0 || col > layout.plot.x1 || r < layout.plot.y0 || r > layout.plot.y1) continue;
    canvas.text(col, r, [glyph], { color });
  }
}

// `glyphChartRule` marks are structural (a reference line), not a DATA
// series, so they stay whole-cell like axes/gridlines/tick marks — the same
// `subcell: false` override, not a second mechanism.
function paintRule(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, values: readonly number[], axis: "x" | "y", color: string | null): void {
  for (const v of values) {
    if (axis === "y") {
      const row = scaleToRow(scales.y, layout.plot, v);
      if (row < layout.plot.y0 || row > layout.plot.y1) continue;
      canvas.line({ x: layout.plot.x0, y: row }, { x: layout.plot.x1, y: row }, { color, style: "dashed", subcell: false });
    } else {
      const col = scaleToCol(scales.x, layout.plot, v);
      if (col < layout.plot.x0 || col > layout.plot.x1) continue;
      canvas.line({ x: col, y: layout.plot.y0 }, { x: col, y: layout.plot.y1 }, { color, style: "dashed", subcell: false });
    }
  }
}

// ── internal-coordinate guard ───────────────────────────────────────────

/**
 * A channel that resolves to `undefined`/non-numeric/out-of-vocabulary
 * reaches a scale as `NaN`, and `NaN` propagates silently through
 * `scaleToCol`/`scaleToRow`/`Math.round` all the way to a canvas painter —
 * where `fillRect`/`text` throw an UNTAGGED `RangeError` naming only
 * "fillRect()"/"text()", with nothing pointing back at the mark or the
 * actual cause. `guardedCanvas` wraps the three coordinate-taking painters
 * `paint.ts` calls with a check that fires FIRST, so the thrown error is
 * always TAGGED (`.code === "GLYPH_CHART_INTERNAL_COORD"`) and always names
 * the mark type — never a bare canvas-internal message (review finding 3).
 * `fillRect`/`text` additionally require INTEGER coordinates (the canvas's
 * own contract); `line()` only finiteness, since sub-cell endpoints are
 * legitimately fractional.
 */
function guardCoord(markType: string, painter: string, values: readonly number[], requireInteger: boolean): void {
  for (const v of values) {
    if (!Number.isFinite(v) || (requireInteger && !Number.isInteger(v))) {
      throw Object.assign(
        new RangeError(`glyphcss: GLYPH_CHART_INTERNAL_COORD: mark "${markType}" produced a ${requireInteger ? "non-finite or non-integer" : "non-finite"} ${painter}() coordinate — an unresolved or non-numeric channel reached the canvas.`),
        { code: "GLYPH_CHART_INTERNAL_COORD" },
      );
    }
  }
}

function guardedCanvas(canvas: GlyphCanvas, markType: string): GlyphCanvas {
  return {
    ...canvas,
    fillRect: (x0, y0, x1, y1, fillOpts) => {
      guardCoord(markType, "fillRect", [x0, y0, x1, y1], true);
      canvas.fillRect(x0, y0, x1, y1, fillOpts);
    },
    line: (a, b, lineOpts) => {
      guardCoord(markType, "line", [a.x, a.y, b.x, b.y], false);
      canvas.line(a, b, lineOpts);
    },
    text: (x, y, lines, textOpts) => {
      guardCoord(markType, "text", [x, y], true);
      canvas.text(x, y, lines, textOpts);
    },
  };
}

// ── orchestration ───────────────────────────────────────────────────────

export function paintGlyphChart(
  canvas: GlyphCanvas,
  spec: GlyphChartSpec,
  marks: readonly GlyphChartResolvedMark[],
  scales: GlyphChartResolvedScales,
  layout: GlyphChartLayout,
  opts: GlyphChartPaintOptions,
  ledger: string[],
): void {
  const series = chartSeries(marks);
  const fillValues = marks.filter((m) => m.mark.type === "cell").flatMap((m) => m.rows.map((r) => numeric(r.fill))).filter(Number.isFinite);
  const lo = Math.min(0, ...fillValues), hi = Math.max(0, ...fillValues);
  const shadeFor = (v: number): number => {
    // Mixed signs: blank means "no signal" — reserved for exactly `v === 0`,
    // never for the domain's most extreme value. The old mapping anchored
    // shade 0 at `lo` (the most NEGATIVE value) and shade 0.5 at zero, so a
    // gains/losses heatmap's biggest LOSS read as missing data while zero
    // (genuinely nothing happening) read as a visible medium shade — exactly
    // backwards (review finding 8). Each side now ramps independently from
    // zero (blank) out to its own extreme (full ink), through the same
    // `GLYPH_CHART_CELL_MIN_INK_SHADE` floor the same-sign branch below
    // uses, so a value arbitrarily close to zero on EITHER side still never
    // rounds down to the same blank glyph zero itself gets.
    if (lo < 0 && hi > 0) {
      if (v === 0) return 0;
      const raw = v < 0 ? v / lo : v / hi;
      return GLYPH_CHART_CELL_MIN_INK_SHADE + (1 - GLYPH_CHART_CELL_MIN_INK_SHADE) * raw;
    }
    if (hi === lo) return 0;
    // Same-sign domain: the EXISTING linear mapping (`(v - lo) / (hi -
    // lo)`) is preserved exactly — `lo` reads as blank and `hi` as full ink,
    // whichever raw values those are (an all-nonpositive domain's `lo` is
    // its most-negative value, not 0; review.test.ts's own "5: same-sign
    // values … use a shared sequential ramp" pins BOTH directions). What's
    // new: a value that is NOT `lo` must never ROUND DOWN to the same blank
    // glyph `lo` itself gets — blank is reserved for the domain minimum
    // exactly (review finding 6: the shipped Heatmap preset's Mon/AM cell,
    // value 1 of a max 12 with `lo` forced to 0, rounded to `box`'s blank
    // level indistinguishably from a missing/zero cell).
    // `GLYPH_CHART_CELL_MIN_INK_SHADE` is the floor every tier's own "does
    // this shade round to a non-blank glyph" threshold clears: `box`'s
    // 5-entry ramp (the coarsest of the four) needs `shade >= 0.125`
    // (`Math.round(shade * 4) === 0` below that); `ascii`'s 8-entry ramp
    // needs `>= 0.0714`; the sub-cell tiers' 8-dot quantization needs
    // `>= 0.0625`. `0.15` clears all three with margin.
    if (v === lo) return 0;
    const raw = (v - lo) / (hi - lo);
    return GLYPH_CHART_CELL_MIN_INK_SHADE + (1 - GLYPH_CHART_CELL_MIN_INK_SHADE) * raw;
  };
  const dodgeDegraded = new Set<number>();
  for (const { mark, rows: resolvedRows } of marks) {
    const groups = series.filter((s) => s.mark === mark);
    const guarded = guardedCanvas(canvas, mark.type);
    if (mark.type === "arc") paintArc(guarded, layout, groups, mark.options?.innerRadius ?? 0, opts.colorEnabled, ledger, resolvedRows.length);
    else for (let i = 0; i < groups.length; i++) {
      const { rows, styleIndex } = groups[i]!;
      const color = paletteColor(styleIndex, opts.colorEnabled);
      if (mark.type === "bar") paintBar(guarded, layout, scales, rows, color, { index: i, count: groups.length }, ledger, dodgeDegraded);
      if (mark.type === "area") paintArea(guarded, layout, scales, rows, color);
      if (mark.type === "rect") paintRect(guarded, layout, scales, rows, color, { index: i, count: groups.length }, ledger, dodgeDegraded);
      if (mark.type === "cell") paintCell(guarded, layout, scales, rows, color, shadeFor);
    }
  }
  paintAxes(canvas, layout);
  for (const { mark, rows, ruleValues, styleIndex } of series) {
    const color = paletteColor(styleIndex, opts.colorEnabled);
    const style = opts.colorEnabled ? "solid" : SERIES_STYLES[styleIndex % SERIES_STYLES.length]!;
    const guarded = guardedCanvas(canvas, mark.type);
    if (mark.type === "line") paintLine(guarded, layout, scales, rows, color, style);
    // Area boundaries carry the same monochrome series vocabulary as lines.
    if (mark.type === "area" && !opts.colorEnabled && series.some((s) => s.name !== undefined)) {
      for (const layer of areaLayers(rows)) paintLine(guarded, layout, scales, layer.map((r) => ({ ...r, y: r.y1 ?? r.y })), color, style);
    }
    if (mark.type === "dot") paintDot(guarded, layout, scales, rows, color, opts.colorEnabled ? 0 : styleIndex);
    if (mark.type === "rule") paintRule(guarded, layout, scales, ruleValues ?? [], mark.options?.axis ?? "y", color);
  }

  // labels: title, legend, then any explicit `text` marks and rule/data
  // labels — all through `glyphChartLabelLayout` so a long one abbreviates
  // instead of overflowing, and later labels dodge earlier ones.
  const candidates: GlyphChartLabelCandidate[] = [];
  if (layout.titleRow !== null && spec.title) {
    candidates.push({ id: "title", x: Math.floor(layout.cols / 2), y: layout.titleRow, text: spec.title, priority: 100 });
  }
  if (layout.legend) {
    const slot = Math.max(1, Math.floor(layout.cols / layout.legend.items.length));
    for (let i = 0; i < layout.legend.items.length; i++) {
      const item = layout.legend.items[i]!;
      candidates.push({ id: `legend:${i}`, x: i * slot + Math.floor(slot / 2), y: layout.legend.row, text: item.label, maxWidth: Math.max(1, slot - 3), priority: 50 });
    }
  }
  let textIndex = 0;
  for (const { mark, rows } of marks) {
    if (mark.type !== "text") continue;
    for (const row of rows) {
      const label = row.label !== undefined ? String(row.label) : row.y !== undefined ? String(row.y) : "";
      if (!label) continue;
      const col = scaleToCol(scales.x, layout.plot, row.x);
      const r = row.y !== undefined ? scaleToRow(scales.y, layout.plot, row.y) : layout.plot.y0;
      if (!Number.isFinite(col) || !Number.isFinite(r)) continue;
      candidates.push({ id: `text:${textIndex++}`, x: col, y: r, text: label, priority: 10 });
    }
  }

  const obstacles: GlyphChartObstacleRect[] = [];
  const { placed, ledger: labelLedger } = glyphChartLabelLayout(candidates, {
    obstacles,
    charset: canvas.tier,
    viewport: { cols: layout.cols, rows: layout.rows },
  });
  ledger.push(...labelLedger);
  const guardedLabels = guardedCanvas(canvas, "label");
  for (const label of placed) {
    if (label.id.startsWith("legend:")) {
      const i = Number(label.id.slice(7));
      const color = paletteColor(i, opts.colorEnabled);
      const entry = series.find((s) => s.name === layout.legend!.items[i]!.label);
      const swatchX = Math.max(0, label.x - 3);
      if (entry?.mark.type === "arc") guardedLabels.text(swatchX, label.y, [seriesShade(canvas.tier, entry.shadeIndex!)], { color });
      else if (entry?.mark.type === "dot" && GLYPH_CANVAS_TIERS[canvas.tier].subcell) {
        // Under braille/blocks the plot itself paints a 1-2 dot sub-cell
        // pattern, never the whole-cell "● × + ◆" glyph `seriesDot` returns
        // (review finding 4) — the legend must show the SAME pattern
        // `paintDot` actually painted for this series, via the same helper
        // and the same shape derivation (`opts.colorEnabled ? 0 : styleIndex`).
        paintSubcellDot(guardedLabels, swatchX, label.y, (opts.colorEnabled ? 0 : entry.styleIndex) % 4, color);
      }
      else if (entry?.mark.type === "dot") guardedLabels.text(swatchX, label.y, [seriesDot(canvas.tier, i)], { color });
      else guardedLabels.line({ x: swatchX, y: label.y }, { x: Math.max(swatchX, label.x - 1), y: label.y }, { color, style: SERIES_STYLES[i % 4] });
      guardedLabels.text(label.x, label.y, [label.text], { color });
    } else guardedLabels.text(label.x, label.y, [label.text]);
  }
}
