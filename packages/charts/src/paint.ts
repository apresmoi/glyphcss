/**
 * Paints a resolved+laid-out spec onto a `GlyphCanvas`, in FIXED priority
 * order (PLAN.md Phase 1): fills (bar/area/rect/cell/arc — region marks)
 * first, then axes, then marks (line/dot/rule — stroke/point marks), then
 * labels (title/legend/data labels) last, so nothing paints over a label.
 * Since CHARTS-RESEARCH's B1 fix, a line/dot mark touching the y domain's
 * own minimum can share `xAxisLineRow` with the axis itself — axes still
 * paint first (see `paintGlyphChart`'s own comment at the call site for
 * why painting them after marks was tried and reverted), so that ONE
 * touching column may carry sub-cell ink over the whole-cell axis glyph.
 * Every mark type gets its own small painter function; `paintGlyphChart`
 * is the only place that decides ORDER, matching `docs/design/canvas.md`'s
 * own "tiers are tables, painters are dumb" discipline one level up.
 */

import { GLYPH_CANVAS_DIRECTION_BITS, GLYPH_CANVAS_TIERS, type GlyphCanvas, type GlyphCanvasLineStyle } from "glyphcss";
import {
  bandColRange,
  bandRowRange,
  clipSegmentToPlot,
  scaleToCol,
  scaleToColExact,
  scaleToRow,
  scaleToRowExact,
  type GlyphChartLayout,
  type GlyphChartLegendLayout,
} from "./layout";
import { abbreviateChartText, glyphChartLabelLayout, type GlyphChartLabelCandidate, type GlyphChartObstacleRect } from "./labels";
import { ledgerEmptyTotal, ledgerLegendDropped, ledgerLegendOverlapsMarks, ledgerMarkColorUnused, ledgerSeriesDodgeDegraded, ledgerSliceDropped, type GlyphChartLedgerEntry } from "./ledger";
import { computeSankeyRoutedRows, layoutSankeyGraph, paintFunnelMark, paintSankeyRoutedRows, type GlyphChartSankeyLayout, type SankeyRoutedRow } from "./flowMarks";
import { areaLayers, chartSeries, resolveSeriesColor, SERIES_STYLES, seriesDot, seriesShade, type ChartSeries } from "./series";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScales } from "./scales";
import type { GlyphChartCharset, GlyphChartMarkRow, GlyphChartSpec } from "./types";

/** See `shadeFor`'s own doc (the "orchestration" section below). */
const GLYPH_CHART_CELL_MIN_INK_SHADE = 0.15;

export interface GlyphChartPaintOptions {
  readonly colorEnabled: boolean;
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
function dodgeColRange(range: readonly [number, number], index: number, count: number, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): readonly [number, number] {
  const [x0, x1] = range;
  const width = x1 - x0 + 1;
  if (width < count) {
    if (!degraded.has(width)) {
      degraded.add(width);
      ledger.push(ledgerSeriesDodgeDegraded({ count, width }));
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
 * Fills `[x0,x1] x [y0,y1]` with a SPECIFIC glyph (never a continuous
 * `fillRect` shade level) — one row of `canvas.text` per painted row, the
 * glyph repeated across the run. Bar/rect/area series identity (B2) needs
 * the EXACT `seriesShade` glyph, and `ascii`'s series vocabulary (`# % + .`)
 * is not a subsequence of `fillRect`'s own 8-level shading ramp — only
 * `canvas.text` can guarantee the literal character painted.
 */
function fillRegionShade(canvas: GlyphCanvas, x0: number, y0: number, x1: number, y1: number, glyph: string, color: string | null): void {
  if (x0 > x1 || y0 > y1) return;
  const run = glyph.repeat(x1 - x0 + 1);
  for (let y = y0; y <= y1; y++) canvas.text(x0, y, [run], { color });
}

/**
 * A bar's cell span is `(baseline, value]` — NOT `[0, value]` clamped to
 * "above" — so a negative value (mixed-sign honesty gate) draws BELOW the
 * baseline instead of collapsing to a zero-height bar. `stack`-transformed
 * rows (`y0`/`y1` present) use their own segment bounds instead of the
 * shared 0 baseline, and use the FULL band width — dodging is a horizontal
 * grouping for UNSTACKED multi-series bars only (a stack is already
 * disambiguated vertically, by `y0`/`y1`).
 *
 * `styleIndex` (the series' cross-mark identity, the SAME index that picks
 * its colour) picks its FILL GLYPH too (CHARTS-RESEARCH diagnosis B2) —
 * `seriesShade(tier, styleIndex)`, never a flat `"solid"` fill — so two
 * stacked/dodged series remain distinguishable in `text` (Copy ASCII)
 * whether or not colour is enabled, exactly like `paintArc` already does
 * for pie slices.
 */
function paintBar(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number, dodge: { readonly index: number; readonly count: number }, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): void {
  const baselineRow = scaleToRow(scales.y, layout.plot, 0);
  const glyph = seriesShade(canvas.tier, styleIndex);
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
    fillRegionShade(canvas, x0, top, x1, bottom, glyph, color);
  }
}

/** See `paintBar`'s own doc — the same `styleIndex` -> `seriesShade` fill
 * glyph rule (CHARTS-RESEARCH diagnosis B2), applied per column since an
 * area's boundary is a slope rather than a flat-topped rect. */
function paintArea(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number): void {
  const glyph = seriesShade(canvas.tier, styleIndex);
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
        if (top <= bottom) fillRegionShade(canvas, col, top, col, bottom, glyph, color);
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
function paintRect(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number, dodge: { readonly index: number; readonly count: number }, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): void {
  const fallbackWidth = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) / Math.max(1, rows.length) * 0.7));
  const glyph = seriesShade(canvas.tier, styleIndex);
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
    fillRegionShade(canvas, x0, top, x1, bottom, glyph, color);
  }
}

/**
 * A SIGNED heatmap (final-gate-2 review, codex finding 3): `shadeFor`
 * already maps each side of a mixed-sign domain independently, from zero
 * (blank) out to its OWN extreme (full ink) — but painting both sides
 * through the same glyph ramp AND the same series colour made the biggest
 * loss and the biggest gain indistinguishable (both `█`, both the same
 * `#3b82f6`), which relocated rather than fixed the earlier "blank means
 * missing" defect: now the SIGN, not just the value, reads as no signal.
 * Gains keep the existing solid-shade ramp unchanged; losses get a HATCH
 * ramp of the identical length (quadrant/partial-block glyphs, not a
 * darker/lighter cousin of the same shape) so the two are still tellable
 * apart in monochrome/`NO_COLOR`, and colour (when enabled) is a distinct
 * hue per side — blue for gains, red for losses — never two shades of one
 * colour. Both ramps share index 0 (blank) with `shadeFor`'s own "zero is
 * always blank" rule.
 */
const GLYPH_CHART_CELL_GAIN_RAMP: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: [" ", ".", "+", "*", "#"],
  box: [" ", "░", "▒", "▓", "█"],
  blocks: [" ", "░", "▒", "▓", "█"],
  braille: [" ", "░", "▒", "▓", "█"],
};
const GLYPH_CHART_CELL_LOSS_RAMP: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: [" ", ",", "x", "%", "@"],
  box: [" ", "▖", "▞", "▚", "▙"],
  blocks: [" ", "▖", "▞", "▚", "▙"],
  braille: [" ", "▖", "▞", "▚", "▙"],
};
const GLYPH_CHART_CELL_GAIN_COLOR = "#3b82f6";
const GLYPH_CHART_CELL_LOSS_COLOR = "#ef4444";

/**
 * Heatmap cells (CHARTS-RESEARCH diagnosis B6d): `fillRect`'s own subcell
 * path (`blocks`/`braille`) derives its glyph from PARTIAL sub-cell dot
 * COVERAGE, which is right for a fill that reads as density (a bar, an
 * area) but wrong for a continuous VALUE ramp — a partially-covered cell
 * picks a quadrant SHAPE (`▘ ▀ ▛`), so a heatmap's shade steps read as
 * texture (which corner is lit) rather than monotone darkness, unlike
 * `box`'s own `" ░▒▓█"` ramp, which reads correctly at every level. Cell
 * marks therefore always quantise through `box`'s own 5-level ramp — the
 * one every tier's reader agrees is monotone — painted via `canvas.text`
 * (never `fillRect`) so `ascii`/`box` stay on `fillRect`'s existing,
 * unaffected, per-tier path (this function is the ONE exception) and
 * `blocks`/`braille` never touch the sub-cell occupancy buffer for a cell
 * mark at all. `signed` (whether the mark's OWN fill domain crosses zero,
 * decided once by `paintGlyphChart`) additionally routes through the
 * gain/loss ramp pair above — for every tier, including `ascii`/`box`,
 * since `fillRect` has no way to select between two glyph FAMILIES for one
 * shade value.
 *
 * `colorOverride` is the mark's own RAW `options.color` (never the generic
 * per-series `color` field `chartSeries` resolves — a cell mark always
 * produces exactly one series, so that field can carry only ONE override
 * slot, where a diverging domain legitimately needs two: AGENTS.md's
 * "Charts" "Colours" contract's `[losses, gains]`). A single string (or
 * one-element array) applies to both signs; two or more elements are
 * `[losses, gains]`; `undefined` keeps the existing gain/loss defaults.
 */
function paintCell(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, shadeFor: (v: number) => number, signed: boolean, colorEnabled: boolean, colorOverride?: string | readonly string[]): void {
  const overrideArr = colorOverride === undefined ? undefined : typeof colorOverride === "string" ? [colorOverride] : colorOverride;
  const lossColor = overrideArr?.[0] ?? GLYPH_CHART_CELL_LOSS_COLOR;
  const gainColor = overrideArr && overrideArr.length > 1 ? overrideArr[1]! : overrideArr?.[0] ?? GLYPH_CHART_CELL_GAIN_COLOR;
  const fallbackCols = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) * (scales.x.bandStep ?? 1 / Math.max(1, rows.length))));
  const fallbackRows = Math.max(1, Math.round((layout.plot.y1 - layout.plot.y0 + 1) * (scales.y.bandStep ?? 1 / Math.max(1, rows.length))));
  const subcellTier = GLYPH_CANVAS_TIERS[canvas.tier].subcell;
  const cellRamp = GLYPH_CANVAS_TIERS.box.shadeRamp;
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
    const value = row.fill !== undefined ? numeric(row.fill) : NaN;
    const shade = Number.isFinite(value) ? shadeFor(value) : 1;
    if (signed) {
      const negative = value < 0;
      const ramp = negative ? GLYPH_CHART_CELL_LOSS_RAMP[canvas.tier] : GLYPH_CHART_CELL_GAIN_RAMP[canvas.tier];
      const cellColor = colorEnabled ? (negative ? lossColor : gainColor) : null;
      const level = Number.isFinite(shade) ? Math.round(shade * (ramp.length - 1)) : ramp.length - 1;
      fillRegionShade(canvas, x0, y0, x1, y1, ramp[level]!, cellColor);
    } else if (subcellTier) {
      const level = Number.isFinite(shade) ? Math.round(shade * (cellRamp.length - 1)) : cellRamp.length - 1;
      fillRegionShade(canvas, x0, y0, x1, y1, cellRamp[level]!, color);
    } else {
      canvas.fillRect(x0, y0, x1, y1, { fill: Number.isFinite(shade) ? { shade } : "solid", color });
    }
  }
}

/**
 * One total covers every category in a pie. Angle and radius select the
 * slice per cell; its categorical shade is painted through canvas.text so
 * blocks/braille retain the same full-cell shade vocabulary as the legend,
 * instead of substituting subcell occupancy for slice identity.
 */
function paintArc(canvas: GlyphCanvas, layout: GlyphChartLayout, series: readonly ChartSeries[], innerRadius: number, colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], resolvedRowCount: number): void {
  const values = series.map((s) => s.rows.reduce((sum, r) => sum + numeric(r.y), 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) { ledger.push(ledgerEmptyTotal("pie")); return; }
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
    ledger.push(ledgerSliceDropped({ dropped: resolvedRowCount - shownRows, total: resolvedRowCount }));
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
    return { s, e: start, color: resolveSeriesColor(entry, colorEnabled), glyph: seriesShade(canvas.tier, entry.shadeIndex!) };
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

const { n: AXIS_N, e: AXIS_E, s: AXIS_S, w: AXIS_W } = GLYPH_CANVAS_DIRECTION_BITS;

/**
 * Faint gridlines at tick positions (packet item 6, default OFF). Painted
 * FIRST — before any fill/line/dot mark and before `paintAxes` itself — so
 * a gridline sits strictly BEHIND the data it's there to help read, never
 * over it. `┈`/`┊` (box-drawing quadruple dash) collapse to `.` on `ascii`,
 * matching every other structural axis glyph's own ascii fallback.
 */
function paintGrid(canvas: GlyphCanvas, layout: GlyphChartLayout, colorEnabled: boolean): void {
  if (!layout.hasCartesianAxes) return;
  const ascii = canvas.tier === "ascii";
  // Gridlines share the axis's own colour (AGENTS.md's "Charts" "Colours":
  // "Gridlines use the same colour") — `null` when colour is off, exactly
  // like every other structural glyph here, so text-only output is
  // untouched by this option existing.
  const xColor = colorEnabled ? layout.xAxisColor : null;
  const yColor = colorEnabled ? layout.yAxisColor : null;
  if (layout.xGrid) {
    const glyph = ascii ? "." : "┊";
    for (const t of layout.xTicks) {
      for (let y = layout.plot.y0; y <= layout.plot.y1; y++) canvas.text(t.cell, y, [glyph], { color: xColor });
    }
  }
  if (layout.yGrid) {
    const glyph = ascii ? "." : "┈";
    for (const t of layout.yTicks) {
      for (let x = layout.plot.x0; x <= layout.plot.x1; x++) canvas.text(x, t.cell, [glyph], { color: yColor });
    }
  }
}

/**
 * Default ON (packet item 6): `┤`/`┴` tick marks where a tick actually
 * lands, `│`/`─` elsewhere, `└` at the corner — every one of those glyphs
 * is already the box tier's own JUNCTION table (`┤` = up+down+left,
 * `┴` = up+left+right, `└` = up+right), so this reuses that table exactly
 * rather than inventing a parallel one; `ascii`'s junction table already
 * collapses every multi-stem entry to `+`, which is what gives the ascii
 * tier its own tick glyph for free. `tickMarks: false` on either axis
 * reverts that axis to the OLD plain `canvas.line()` sweep, byte-identical
 * to this feature not existing. Axes stay WHOLE-CELL box-drawing (`│ ─`)
 * even under `braille`/`blocks`, where DATA marks rasterise at sub-cell
 * (dot) resolution — an axis is structure, not data (AGENTS.md's "Cell
 * canvas" / "sub-cell data marks, whole-cell axes"), and `canvas.text()`
 * never rasterises sub-cell regardless of tier.
 */
function paintAxes(canvas: GlyphCanvas, layout: GlyphChartLayout, colorEnabled: boolean): void {
  if (!layout.hasCartesianAxes) return;
  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  const yTickRows = new Set(layout.yTicks.map((t) => t.cell));
  const xTickCols = new Set(layout.xTicks.map((t) => t.cell));
  // Both axes' line, tick marks, tick labels, and title (AGENTS.md's
  // "Charts" "Colours") — `null` when colour is off, byte-identical to
  // before `spec.axes.color` existed.
  const xColor = colorEnabled ? layout.xAxisColor : null;
  const yColor = colorEnabled ? layout.yAxisColor : null;

  // The y-axis spans the FULL plot height, top to bottom — never only up
  // to `xAxisLineRow` — because that row is no longer necessarily the
  // plot's own bottom edge (CHARTS-RESEARCH diagnosis B6a: a mixed-sign
  // domain's zero row sits INTERIOR to the plot, with negative bars
  // painted below it) and the vertical rule must keep going past it into
  // that negative region, exactly as it already does above a positive one.
  if (layout.yTickMarks) {
    for (let y = layout.plot.y0; y <= layout.plot.y1; y++) {
      const glyph = yTickRows.has(y) ? tier.junction[AXIS_N | AXIS_S | AXIS_W]! : tier.junction[AXIS_N | AXIS_S]!;
      canvas.text(layout.yAxisCol, y, [glyph], { color: yColor });
    }
  } else {
    canvas.line({ x: layout.yAxisCol, y: layout.plot.y0 }, { x: layout.yAxisCol, y: layout.plot.y1 }, { subcell: false, color: yColor });
  }

  // Painted second, so it wins the shared corner cell — matches the
  // pre-existing two-`canvas.line()`-call order this replaces. The corner
  // is a T-junction (`├`), not a plain corner (`└`), whenever the axis
  // line sits above the plot's own bottom row (the mixed-sign case above)
  // — the y-axis genuinely continues past it, so a plain corner glyph
  // would read as the axis line stopping there.
  const axisLineInterior = layout.xAxisLineRow < layout.plot.y1;
  if (layout.xTickMarks) {
    for (let x = layout.yAxisCol; x <= layout.plot.x1; x++) {
      const glyph = x === layout.yAxisCol ? tier.junction[AXIS_N | AXIS_E | (axisLineInterior ? AXIS_S : 0)]!
        : xTickCols.has(x) ? tier.junction[AXIS_N | AXIS_E | AXIS_W]! : tier.junction[AXIS_E | AXIS_W]!;
      canvas.text(x, layout.xAxisLineRow, [glyph], { color: xColor });
    }
  } else {
    canvas.line({ x: layout.yAxisCol, y: layout.xAxisLineRow }, { x: layout.plot.x1, y: layout.xAxisLineRow }, { subcell: false, color: xColor });
  }

  for (const t of layout.xTicks) {
    canvas.text(t.labelStart, layout.xAxisLabelRow, [t.label], { color: xColor });
  }
  for (const t of layout.yTicks) {
    canvas.text(t.labelStart, t.cell, [t.label], { color: yColor });
  }

  // Titles (packet item 6): x centred under its own tick-label row, y on
  // the top-left above the axis — a rotated column of text has no
  // character-grid analogue, so unlike x it never shares a row.
  if (layout.xAxisTitle) {
    const width = layout.plot.x1 - layout.plot.x0 + 1;
    const x = Math.max(layout.plot.x0, layout.plot.x0 + Math.floor((width - layout.xAxisTitle.length) / 2));
    canvas.text(x, layout.xAxisTitleRow, [layout.xAxisTitle], { color: xColor });
  }
  if (layout.yAxisTitle) {
    canvas.text(0, layout.yAxisTitleRow, [layout.yAxisTitle], { color: yColor });
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
 * CHARTS-RESEARCH diagnosis B6b: a single dot (or the old 2-dot companion
 * pair) measures ~1.9px in Glyph Mono — a stray fleck, not a visible data
 * point. "A point mark must put at least a whole cell of ink … sub-cell
 * precision may position it, not shrink it" — so every point now paints a
 * full 2x2 dot CLUSTER (4 of the cell's 8 dots: both columns, the pair of
 * rows the point's own position actually falls into), regardless of series
 * index. This trades the old per-series dot SHAPE for guaranteed
 * visibility; colour remains the primary series-identity channel for dot
 * marks, as it already is for every other mark type.
 */
function paintSubcellDot(canvas: GlyphCanvas, col: number, r: number, color: string | null): void {
  const dotCol = primaryDotIndex(col, SUBCELL_DOT_COLS);
  const dotRow = primaryDotIndex(r, SUBCELL_DOT_ROWS);
  const cellCol = Math.floor(dotCol / SUBCELL_DOT_COLS);
  const cellRow = Math.floor(dotRow / SUBCELL_DOT_ROWS);
  const localRow = dotRow - cellRow * SUBCELL_DOT_ROWS;
  const rowBand = localRow < 2 ? 0 : 2; // the half of the cell the point actually falls in.
  for (let lc = 0; lc < SUBCELL_DOT_COLS; lc++) {
    for (let lr = rowBand; lr < rowBand + 2; lr++) {
      const x = dotIndexToCoord(cellCol * SUBCELL_DOT_COLS + lc, SUBCELL_DOT_COLS);
      const y = dotIndexToCoord(cellRow * SUBCELL_DOT_ROWS + lr, SUBCELL_DOT_ROWS);
      canvas.line({ x, y }, { x, y }, { color });
    }
  }
}

function paintDot(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number): void {
  const subcell = GLYPH_CANVAS_TIERS[canvas.tier].subcell;
  const glyph = seriesDot(canvas.tier, styleIndex);
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
      paintSubcellDot(canvas, col, r, color);
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
      // A rule landing on the axis LINE's own row (now possible since B1's
      // fix folded that row into the plot — see `layoutGlyphChart`'s
      // `xAxisLineRow` derivation) is already drawn: `paintAxes` ran
      // before this loop, so a dashed overlay here would only stomp its
      // tick-mark junction glyphs for a line that reads identically to
      // the axis rule wherever both are plain "─" anyway.
      if (row === layout.xAxisLineRow) continue;
      canvas.line({ x: layout.plot.x0, y: row }, { x: layout.plot.x1, y: row }, { color, style: "dashed", subcell: false });
    } else {
      const col = scaleToCol(scales.x, layout.plot, v);
      if (col < layout.plot.x0 || col > layout.plot.x1) continue;
      if (col === layout.yAxisCol) continue;
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

/**
 * Corner legend placements paint INSIDE `layout.plot`, one item per row, at
 * paint time — the four corners reserve no chart row at all (owner packet
 * item 1: "reserving no chart rows"). Called from the label phase, after
 * axes/marks, so the legend box paints OVER whatever's underneath by
 * design; every covered non-blank cell is counted and reported via
 * `legend-overlaps-marks` so a caller knows their data was covered rather
 * than discovering it by eye.
 *
 * Two more drops the BOTTOM placement already reports (`ledgerLegendDropped`,
 * `layout.ts`) used to happen here with no ledger entry at all (fable
 * review, batch 3, finding f): a `plotWidth < 3` plot dropping the WHOLE
 * legend, and `items.slice(0, usableRows)` silently truncating past the
 * available rows. Both now push the SAME `legend-dropped` code bottom
 * placement uses, naming how many entries were lost. The available ROWS
 * also exclude the x-axis LINE row when it sits at the plot's own bottom
 * edge (the common all-nonnegative/zero-anchored case) — the axis's own
 * rule glyph would otherwise be the corner legend's last-painted row,
 * silently erasing it (CHARTS-RESEARCH B1's row folded into the plot is
 * exactly the row a `bottom-*`/tall `top-*` legend would otherwise reach).
 */
function paintCornerLegend(canvas: GlyphCanvas, layout: GlyphChartLayout, legend: GlyphChartLegendLayout, series: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[]): void {
  const { plot } = layout;
  const plotWidth = plot.x1 - plot.x0 + 1;
  const maxRow = layout.xAxisLineRow === plot.y1 ? plot.y1 - 1 : plot.y1;
  const plotHeight = maxRow - plot.y0 + 1;
  if (plotWidth < 3 || plotHeight < 1) {
    if (legend.items.length > 0) ledger.push(ledgerLegendDropped({ series: legend.items.length, cols: plotWidth, rows: Math.max(0, plotHeight) }));
    return;
  }
  const isRight = legend.placement === "top-right" || legend.placement === "bottom-right";
  const isBottom = legend.placement === "bottom-left" || legend.placement === "bottom-right";
  const items = legend.items.slice(0, plotHeight);
  if (legend.items.length > items.length) {
    ledger.push(ledgerLegendDropped({ series: legend.items.length - items.length, cols: plotWidth, rows: plotHeight }));
  }
  const maxTextWidth = Math.max(1, plotWidth - 2);
  let covered = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const row = isBottom ? maxRow - items.length + 1 + i : plot.y0 + i;
    const { text, dropped } = abbreviateChartText(item.label, maxTextWidth, canvas.tier, false);
    if (dropped || !text) continue;
    // 3-cell gutter (not 2) so a LINE-style swatch (the trailing `else`
    // below) has room for the same 3-cell styled run the bottom legend
    // paints (`paint.ts`'s own label-phase swatch, `swatchX .. label.x -
    // 1`) — a single-cell `canvas.line(p, p)` degenerates to one braille
    // dot under a sub-cell tier and can never show the solid/dashed/
    // dotted/double cycle that carries series identity when colour is off
    // (fable review, batch 3, finding b).
    const blockWidth = Math.min(plotWidth, text.length + 3);
    const startCol = isRight ? plot.x1 - blockWidth + 1 : plot.x0;
    const textCol = Math.min(plot.x1, startCol + 3);
    for (let c = startCol; c <= Math.min(plot.x1, startCol + blockWidth - 1); c++) {
      if (canvas.grid.char[row * canvas.cols + c] !== " ") covered++;
    }
    const entry = series.find((s) => s.name === item.label);
    const color = colorEnabled ? item.color ?? null : null;
    const styleIdx = entry ? (entry.mark.type === "arc" ? entry.shadeIndex! : entry.styleIndex) : i;
    if (entry?.mark.type === "arc") canvas.text(startCol, row, [seriesShade(canvas.tier, entry.shadeIndex!)], { color });
    else if (entry?.mark.type === "dot" && GLYPH_CANVAS_TIERS[canvas.tier].subcell) paintSubcellDot(canvas, startCol, row, color);
    else if (entry?.mark.type === "dot") canvas.text(startCol, row, [seriesDot(canvas.tier, styleIdx)], { color });
    else if (entry?.mark.type === "bar" || entry?.mark.type === "rect" || entry?.mark.type === "area" || entry?.mark.type === "sankey" || entry?.mark.type === "funnel") canvas.text(startCol, row, [seriesShade(canvas.tier, entry.styleIndex)], { color });
    else if (entry?.mark.type === "cell") canvas.text(startCol, row, [seriesShade(canvas.tier, 0)], { color });
    else canvas.line({ x: startCol, y: row }, { x: Math.max(startCol, textCol - 1), y: row }, { color, style: SERIES_STYLES[styleIdx % 4] });
    canvas.text(textCol, row, [text], { color });
  }
  if (covered > 0) ledger.push(ledgerLegendOverlapsMarks({ placement: legend.placement, covered }));
}

// ── orchestration ───────────────────────────────────────────────────────

export function paintGlyphChart(
  canvas: GlyphCanvas,
  spec: GlyphChartSpec,
  marks: readonly GlyphChartResolvedMark[],
  scales: GlyphChartResolvedScales,
  layout: GlyphChartLayout,
  opts: GlyphChartPaintOptions,
  ledger: GlyphChartLedgerEntry[],
): void {
  const series = chartSeries(marks, ledger);
  const fillValues = marks.filter((m) => m.mark.type === "cell").flatMap((m) => m.rows.map((r) => numeric(r.fill))).filter(Number.isFinite);
  const lo = Math.min(0, ...fillValues), hi = Math.max(0, ...fillValues);
  const cellSigned = lo < 0 && hi > 0;
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
    if (cellSigned) {
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
  paintGrid(canvas, layout, opts.colorEnabled);
  const dodgeDegraded = new Set<number>();
  // Every sankey mark's routes are registered and junction-resolved in ONE
  // batch, ahead of the per-mark paint loop below (`flowMarks.ts`'s own doc
  // on `paintSankeyRoutedRows`, finding c): `canvas.resolveJunctions()`
  // reads the canvas's SHARED, cross-mark edge bookkeeping, so calling it
  // once per sankey mark re-derives (and can corrupt) an EARLIER mark's
  // already-claimed cells, and two marks' own edge ids collide unless
  // namespaced by index. The actual PAINT of each mark's own bands/boxes
  // still happens at that mark's own turn in the loop below (through the
  // shared `sankeyClaimedBy`), so a sankey's z-order relative to every
  // OTHER mark type is unchanged — only the sankey-vs-sankey registration
  // step is batched.
  const sankeyMarks = marks.filter((m) => m.mark.type === "sankey");
  const sankeyRouted = new Map<GlyphChartResolvedMark["mark"], { readonly layout: GlyphChartSankeyLayout; readonly routedRows: readonly SankeyRoutedRow[] }>();
  if (sankeyMarks.length > 0) {
    const guardedSankey = guardedCanvas(canvas, "sankey");
    const registered: { readonly mark: GlyphChartResolvedMark["mark"]; readonly layout: GlyphChartSankeyLayout; readonly routedRows: readonly SankeyRoutedRow[] }[] = [];
    for (let i = 0; i < sankeyMarks.length; i++) {
      const { mark } = sankeyMarks[i]!;
      const groups = series.filter((s) => s.mark === mark);
      const sankeyLayout = layoutSankeyGraph(groups, layout.plot, canvas.tier, ledger);
      if (!sankeyLayout) continue;
      const routedRows = computeSankeyRoutedRows(guardedSankey, layout.plot, sankeyLayout, opts.colorEnabled, ledger, `sankey${i}:`);
      registered.push({ mark, layout: sankeyLayout, routedRows });
    }
    if (registered.length > 0) canvas.resolveJunctions();
    for (const r of registered) sankeyRouted.set(r.mark, { layout: r.layout, routedRows: r.routedRows });
  }
  const sankeyClaimedBy = new Set<number>();
  for (const { mark, rows: resolvedRows } of marks) {
    const groups = series.filter((s) => s.mark === mark);
    const guarded = guardedCanvas(canvas, mark.type);
    if (mark.type === "arc") paintArc(guarded, layout, groups, mark.options?.innerRadius ?? 0, opts.colorEnabled, ledger, resolvedRows.length);
    else if (mark.type === "sankey") {
      const r = sankeyRouted.get(mark);
      if (r) paintSankeyRoutedRows(guarded, r.layout, r.routedRows, ledger, sankeyClaimedBy);
    }
    else if (mark.type === "funnel") paintFunnelMark(guarded, layout.plot, groups, opts.colorEnabled, ledger);
    else for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const { rows, styleIndex } = group;
      const color = resolveSeriesColor(group, opts.colorEnabled);
      if (mark.type === "bar") paintBar(guarded, layout, scales, rows, color, styleIndex, { index: i, count: groups.length }, ledger, dodgeDegraded);
      if (mark.type === "area") paintArea(guarded, layout, scales, rows, color, styleIndex);
      if (mark.type === "rect") paintRect(guarded, layout, scales, rows, color, styleIndex, { index: i, count: groups.length }, ledger, dodgeDegraded);
      if (mark.type === "cell") {
        // `chartSeries` skips this mark's own `mark-color-unused` check
        // (its own doc explains why: a cell mark is always ONE series, so
        // it can't tell "one ink colour" from a diverging domain's
        // legitimate two) — reported here instead, now that `cellSigned`
        // (shared across every cell mark in the chart) is known.
        const rawColor = mark.options?.color;
        if (rawColor !== undefined) {
          const arr = typeof rawColor === "string" ? [rawColor] : rawColor;
          const usedSlots = cellSigned ? 2 : 1;
          if (arr.length > usedSlots) ledger.push(ledgerMarkColorUnused({ markType: "cell", provided: arr.length, used: usedSlots }));
        }
        paintCell(guarded, layout, scales, rows, color, shadeFor, cellSigned, opts.colorEnabled, rawColor);
      }
    }
  }
  // Axes paint BEFORE marks (PLAN.md Phase 1's original order, kept): a
  // line/dot mark touching the y domain's own minimum now legitimately
  // shares its row with `xAxisLineRow` (CHARTS-RESEARCH B1 — "when 0 is
  // not in the domain the axis line row is the y-min row"), and painting
  // axes AFTER marks was tried and reverted — it silently ERASED a data
  // point sitting exactly on that row instead of merely blemishing the
  // axis glyph beside it, which is strictly worse (missing data reads as
  // no data, not as an axis touch). The trade-off this keeps instead: the
  // ONE column a mark actually touches may show sub-cell ink on the axis
  // row under braille/blocks; `paintGrid`'s own faint gridlines still
  // paint first, so marks correctly sit on top of them either way.
  paintAxes(canvas, layout, opts.colorEnabled);
  for (const entry of series) {
    const { mark, rows, ruleValues, styleIndex } = entry;
    const color = resolveSeriesColor(entry, opts.colorEnabled);
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
  if (layout.titleRow !== null && layout.titleText) {
    // `x` is a CENTRE anchor (`glyphChartLabelLayout`'s own convention) — for
    // left/right align this is approximated from the title's own (raw,
    // pre-abbreviation) length so the label lands flush with that edge,
    // exactly the way the existing centred default (`floor(cols/2)`) always
    // has for the centre case.
    const half = Math.floor(layout.titleText.length / 2);
    const x = layout.titleAlign === "left" ? Math.min(layout.cols - 1, half)
      : layout.titleAlign === "right" ? Math.max(0, layout.cols - 1 - half)
      : Math.floor(layout.cols / 2);
    candidates.push({ id: "title", x, y: layout.titleRow, text: layout.titleText, priority: 100, role: "chart title" });
  }
  if (layout.legend && layout.legend.row !== undefined) {
    const legendRow = layout.legend.row;
    const isTitleRow = layout.legend.placement === "title";
    // "title" placement shares the title's own row: entries are laid out in
    // the region AFTER the title text (before it, for a right-aligned title,
    // which has no room to its right) — never the full row — so they read as
    // "next to the title", not scattered wherever the generic collision
    // nudge below happens to find room (a centred title has free space on
    // BOTH sides, so that nudge has no directional preference on its own).
    // Priority still sits below the title's (100) as a safety net in case
    // this estimate and the title's own (possibly abbreviated) painted width
    // disagree by a cell or two.
    let regionStart = 0;
    let regionWidth = layout.cols;
    if (isTitleRow && layout.titleText) {
      const titleLen = layout.titleText.length;
      if (layout.titleAlign === "right") {
        const titleStart = Math.max(0, layout.cols - titleLen);
        regionStart = 0;
        regionWidth = Math.max(1, titleStart - 1);
      } else {
        const titleEnd = layout.titleAlign === "left" ? titleLen - 1 : Math.floor(layout.cols / 2) + Math.ceil(titleLen / 2) - 1;
        regionStart = Math.min(layout.cols - 1, titleEnd + 2);
        regionWidth = Math.max(1, layout.cols - regionStart);
      }
    }
    const priority = isTitleRow ? 90 : 50;
    const slot = Math.max(1, Math.floor(regionWidth / layout.legend.items.length));
    for (let i = 0; i < layout.legend.items.length; i++) {
      const item = layout.legend.items[i]!;
      candidates.push({ id: `legend:${i}`, x: regionStart + i * slot + Math.floor(slot / 2), y: legendRow, text: item.label, maxWidth: Math.max(1, slot - 3), priority, role: "legend label" });
    }
  }
  let textIndex = 0;
  // A `text` mark's own `options.color` (AGENTS.md's "Charts" "Colours":
  // "Every mark's `options.color`… overrides its palette colour" — a `text`
  // mark is a mark like any other, and its label IS its own ink) resolved
  // once per mark via `resolveSeriesColor`, the SAME resolution every other
  // mark type shares — never a second colour rule, and never inert while
  // `chartSeries` counts this mark's one series as a USED colour slot
  // (review finding P3-2). Colours are looked up by candidate id below,
  // since `GlyphChartLabelCandidate` carries no colour field of its own —
  // the title/legend candidates that share this same placement pass must
  // stay uncoloured by this map.
  const textColors = new Map<string, string | null>();
  for (const { mark, rows } of marks) {
    if (mark.type !== "text") continue;
    const textEntry = series.find((s) => s.mark === mark);
    const textColor = textEntry ? resolveSeriesColor(textEntry, opts.colorEnabled) : null;
    for (const row of rows) {
      const label = row.label !== undefined ? String(row.label) : row.y !== undefined ? String(row.y) : "";
      if (!label) continue;
      const col = scaleToCol(scales.x, layout.plot, row.x);
      const r = row.y !== undefined ? scaleToRow(scales.y, layout.plot, row.y) : layout.plot.y0;
      if (!Number.isFinite(col) || !Number.isFinite(r)) continue;
      const id = `text:${textIndex++}`;
      textColors.set(id, textColor);
      candidates.push({ id, x: col, y: r, text: label, priority: 10, role: "data label" });
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
      const item = layout.legend!.items[i]!;
      const color = opts.colorEnabled ? item.color ?? null : null;
      const entry = series.find((s) => s.name === item.label);
      const swatchX = Math.max(0, label.x - 3);
      if (entry?.mark.type === "arc") guardedLabels.text(swatchX, label.y, [seriesShade(canvas.tier, entry.shadeIndex!)], { color });
      else if (entry?.mark.type === "dot" && GLYPH_CANVAS_TIERS[canvas.tier].subcell) {
        // Under braille/blocks the plot itself paints a 2x2 dot cluster
        // (CHARTS-RESEARCH diagnosis B6b), never the whole-cell "● × + ◆"
        // glyph `seriesDot` returns — the legend must show the SAME mark
        // `paintDot` actually painted, via the same helper.
        paintSubcellDot(guardedLabels, swatchX, label.y, color);
      }
      else if (entry?.mark.type === "dot") guardedLabels.text(swatchX, label.y, [seriesDot(canvas.tier, i)], { color });
      // Region marks (bar/rect/area/cell) carry series identity through
      // their own FILL GLYPH, never a line style (CHARTS-RESEARCH diagnosis
      // B2/B6d) — the legend swatch must show that same glyph, so a bar
      // chart's legend never reads as a line chart's. `cell` (a heatmap)
      // has no per-series shade cycle of its own (`paintCell` shades by
      // continuous VALUE, not by series) — its swatch is the ramp's own
      // full-ink glyph, `seriesShade(tier, 0)`, matching the darkest cell
      // it can paint.
      else if (entry?.mark.type === "bar" || entry?.mark.type === "rect" || entry?.mark.type === "area" || entry?.mark.type === "sankey" || entry?.mark.type === "funnel") {
        guardedLabels.text(swatchX, label.y, [seriesShade(canvas.tier, entry.styleIndex)], { color });
      }
      else if (entry?.mark.type === "cell") guardedLabels.text(swatchX, label.y, [seriesShade(canvas.tier, 0)], { color });
      else guardedLabels.line({ x: swatchX, y: label.y }, { x: Math.max(swatchX, label.x - 1), y: label.y }, { color, style: SERIES_STYLES[i % 4] });
      guardedLabels.text(label.x, label.y, [label.text], { color });
    } else if (textColors.has(label.id)) {
      guardedLabels.text(label.x, label.y, [label.text], { color: textColors.get(label.id)! });
    } else guardedLabels.text(label.x, label.y, [label.text]);
  }
  if (layout.legend && layout.legend.row === undefined) {
    paintCornerLegend(guardedLabels, layout, layout.legend, series, opts.colorEnabled, ledger);
  }
}
