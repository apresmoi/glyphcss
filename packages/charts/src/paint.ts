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

import { GLYPH_CANVAS_DIRECTION_BITS, GLYPH_CANVAS_TIERS, type GlyphCanvas, type GlyphCanvasLineStyle, type GlyphCanvasPoint } from "glyphcss";
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
  type GlyphChartPlotRect,
} from "./layout";
import { abbreviateChartText, chartText, glyphChartLabelLayout, type GlyphChartLabelCandidate, type GlyphChartObstacleRect } from "./labels";
import { ledgerEmptyTotal, ledgerLabelDropped, ledgerLegendDropped, ledgerLegendOverlapsMarks, ledgerMarkColorUnused, ledgerSeriesDodgeDegraded, ledgerSliceDropped, type GlyphChartLedgerEntry } from "./ledger";
import { computeSankeyRoutedRows, layoutSankeyGraph, paintFunnelMark, paintSankeyRoutedRows, type GlyphChartSankeyLayout, type SankeyRoutedRow } from "./flowMarks";
import { areaLayers, chartSeries, regionFillGlyph, resolveSeriesColor, SERIES_STYLES, seriesDot, seriesShade, type ChartSeries } from "./series";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScales } from "./scales";
import type { GlyphChartCharset, GlyphChartMarkRow, GlyphChartSpec } from "./types";

/** See `shadeFor`'s own doc (the "orchestration" section below). */
const GLYPH_CHART_CELL_MIN_INK_SHADE = 0.15;

/** A region fill after `resolveGlyphChartRegionFill` has decided it — never `"auto"`. */
export type GlyphChartResolvedRegionFill = "solid" | "texture";

export interface GlyphChartPaintOptions {
  readonly colorEnabled: boolean;
  /**
   * Region-mark fill (bar/rect/area/arc and their legend swatches), already
   * resolved by `regionFill.ts`. Default `"texture"`, the pre-option paint.
   * `cell` ignores it (its ramp encodes value, not series); sankey ribbons
   * and funnel bars take it through `flowMarks.ts`.
   */
  readonly regionFill?: GlyphChartResolvedRegionFill;
  /**
   * Web-only `textScale` affordance (AGENTS.md's "Charts" "Density"
   * paragraph) — forwarded to `canvas.text({ scale })` for every chart-level
   * TEXT this module paints (title, axis titles, tick labels, legend names
   * + swatches, arc callout labels); a mark's own data labels (`text`
   * marks) are unaffected, since they're the mark's own ink, not chrome.
   * Default `1`, byte-identical to before this option existed.
   */
  readonly textScale?: number;
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
 * `glyph` is the series' own `regionFillGlyph` (CHARTS-RESEARCH diagnosis
 * B2, `DIAGNOSIS-solid-colour-fills.md`): its `seriesShade` texture, keyed
 * on the SAME cross-mark `styleIndex` that picks its colour, or a solid
 * block when this render's colour already tells the series apart.
 */
function paintBar(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, glyph: string, dodge: { readonly index: number; readonly count: number }, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): void {
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
    fillRegionShade(canvas, x0, top, x1, bottom, glyph, color);
  }
}

/** A `stack`-transformed area — its rows carry `y0`/`y1` bounds. */
function isStackedArea(rows: readonly GlyphChartMarkRow[]): boolean {
  return rows.some((r) => r.y1 !== undefined);
}

/** One area series as `paintAreaMark` paints it: its rows, resolved colour and `seriesShade` fill glyph. */
interface AreaSeriesPaint {
  readonly rows: readonly GlyphChartMarkRow[];
  readonly color: string | null;
  readonly glyph: string;
}

/**
 * One polyline layer of an area. A vertex sits in the plot COLUMN containing
 * its x (`scaleToCol`, the column a line or dot mark puts the same point
 * in), but keeps its EXACT row coordinate: rounding the row before
 * interpolating is S2 in `DIAGNOSIS-stacked-area.md`.
 */
interface AreaLayerEdges {
  readonly cols: readonly number[];
  readonly tops: readonly number[];
  readonly bases: readonly number[];
  readonly color: string | null;
  readonly glyph: string;
}

function areaLayerEdges(layout: GlyphChartLayout, scales: GlyphChartResolvedScales, layer: readonly GlyphChartMarkRow[], color: string | null, glyph: string): AreaLayerEdges | null {
  const points = [...layer]
    .sort((a, b) => scales.x.toFraction(a.x) - scales.x.toFraction(b.x))
    .map((r) => ({ col: scaleToCol(scales.x, layout.plot, r.x), top: scaleToRowExact(scales.y, layout.plot, r.y1 ?? r.y), base: scaleToRowExact(scales.y, layout.plot, r.y0 ?? 0) }));
  if (points.length < 2) return null;
  return { cols: points.map((p) => p.col), tops: points.map((p) => p.top), bases: points.map((p) => p.base), color, glyph };
}

/**
 * Every `[top, base]` the layer's segments give at exact column `x`, for the
 * segments that paint plot column `col` (`x` is `col` itself, or one of its
 * two quadrant columns). Several data points can share one column when the
 * data is denser than the plot; each segment through the column contributes,
 * so a one-sample spike still reaches its own column (the union the painter
 * has always drawn). `x` is clamped to the segment, and a segment whose two
 * points share a column reads its first point.
 */
function areaSpansAt(layer: AreaLayerEdges, col: number, x: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < layer.cols.length - 1; i++) {
    const c0 = layer.cols[i]!, c1 = layer.cols[i + 1]!;
    if (col < c0 || col > c1) continue;
    const t = c0 === c1 ? 0 : (Math.min(c1, Math.max(c0, x)) - c0) / (c1 - c0);
    spans.push([layer.tops[i]! + (layer.tops[i + 1]! - layer.tops[i]!) * t, layer.bases[i]! + (layer.bases[i + 1]! - layer.bases[i]!) * t]);
  }
  return spans;
}

/**
 * `areaSpansAt` for a QUADRANT column of `col` (`x` a quarter column off its
 * centre), reading only the segment that actually spans `x`. The union
 * `areaSpansAt` takes is right at the centre, where every segment through a
 * data vertex meets at that vertex; a quarter column either side, the two
 * segments of a vertex give different rows, and their union made two stacked
 * layers both cover one quadrant, handing it to the later (upper) layer below
 * the lower one. A segment whose two points share a column still counts for
 * that whole column (dense data), and `x` past the data clamps to its end.
 */
function areaSpansAtQuadrant(layer: AreaLayerEdges, col: number, x: number): [number, number][] {
  const first = layer.cols[0]!, last = layer.cols[layer.cols.length - 1]!;
  const cx = Math.min(last, Math.max(first, x));
  const spans: [number, number][] = [];
  for (let i = 0; i < layer.cols.length - 1; i++) {
    const c0 = layer.cols[i]!, c1 = layer.cols[i + 1]!;
    if (c0 === c1) {
      if (c0 === col) spans.push([layer.tops[i]!, layer.bases[i]!]);
      continue;
    }
    if (cx < c0 || cx > c1 || (cx === c1 && x > cx && i < layer.cols.length - 2) || (cx === c0 && x < cx && i > 0)) continue;
    const t = (cx - c0) / (c1 - c0);
    spans.push([layer.tops[i]! + (layer.tops[i + 1]! - layer.tops[i]!) * t, layer.bases[i]! + (layer.bases[i + 1]! - layer.bases[i]!) * t]);
  }
  return spans;
}

/**
 * Whether a point at exact row coordinate `y` lies inside the band between
 * `top` (the value's row) and `base` (the baseline's row). The band runs
 * from the value's row to the row strictly beyond the baseline's — the bar
 * convention, `(baseline, value]` in cells — so a POSITIVE band (`top <
 * base`, rows grow downward) covers `top - 0.5 < y <= base - 0.5` and a
 * negative one `base + 0.5 < y <= top + 0.5`. At a cell centre (`y` an
 * integer) this is exactly `Math.round` on both ends, the rows the fill
 * paints, so an area whose data lands on whole rows is byte-identical to the
 * rounded painter it replaced.
 */
function areaCovers(top: number, base: number, y: number): boolean {
  if (top < base) return top - 0.5 < y && y <= base - 0.5;
  if (top > base) return base + 0.5 < y && y <= top + 0.5;
  return false;
}

// `GlyphCanvas.sub`'s dot bits for each QUADRANT (TL, TR, BL, BR), from its
// public bit layout; a quadrant is lit by lighting both of its dots.
const AREA_QUADRANT_SUB_BITS: readonly number[] = [0b00000011, 0b00011000, 0b01000100, 0b10100000];

/**
 * Paints one `area` mark's series (CHARTS-RESEARCH `DIAGNOSIS-stacked-area.md`).
 *
 * Every column is centre-sampled against band edges interpolated from EXACT
 * row coordinates (S2): a cell carries a layer's own `seriesShade` glyph
 * (the region-mark rule, B2) when its centre lies inside that layer's band.
 * Interpolating between whole-row-rounded data points instead put the edge
 * up to 0.82 rows off and handed 10-24 cells per band to its neighbour. A
 * stack's layers partition each column exactly, so no layer overwrites
 * another, and a band 1 to 2 rows tall owns at least one cell per column.
 *
 * `silhouette` (S3, `braille`/`blocks` only): a cell whose centre no layer
 * covers but part of which a layer does — the cell just outside the band
 * group's own edge — gets the tier's own partial FILL glyph (`fillSubGlyph`,
 * the blocks quadrant table), sampled at quadrant centres, in the colour of
 * the layer covering most of it. That cell belongs to no band, so the
 * sub-cell edge costs no band an identity cell. An INTERNAL boundary
 * between two layers stays a whole-cell glyph transition: a cell holds one
 * glyph, and a quadrant there would strip a thin band of most of its
 * identity cells (measured 45-83% of Nuclear/Renewables' cells).
 *
 * `stacked` groups every layer of every series into ONE band group, so the
 * silhouette is the stack's outer edge; an unstacked mark treats each series
 * as its own group, painted in series order (later series in front, exactly
 * as before).
 */
function paintAreaMark(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, series: readonly AreaSeriesPaint[], stacked: boolean, silhouette: boolean, fill: GlyphChartResolvedRegionFill = "texture"): void {
  const { plot } = layout;
  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  const subFill = tier.subcell ? (tier.fillSubGlyph ?? tier.subGlyph) : undefined;
  const layersOf = (s: AreaSeriesPaint): AreaLayerEdges[] => areaLayers(s.rows)
    .map((layer) => areaLayerEdges(layout, scales, layer, s.color, s.glyph))
    .filter((l): l is AreaLayerEdges => l !== null);
  if (fill === "solid" && subFill) {
    // Every layer of every series in ONE compositor pass, later layers in
    // front exactly as the whole-cell paint orders them.
    const snap = zeroRowSnap(scales, plot);
    const layers = series.flatMap(layersOf).map((l): SolidRegionLayer => {
      const snapped: AreaLayerEdges = { ...l, tops: l.tops.map(snap), bases: l.bases.map(snap) };
      return { color: l.color, c0: l.cols[0]!, c1: l.cols[l.cols.length - 1]!, floor: stacked, spansAt: (col, x) => (x === col ? areaSpansAt(snapped, col, col) : areaSpansAtQuadrant(snapped, col, x)) };
    });
    paintSolidRegions(canvas, layout, layers);
    return;
  }
  const groups: AreaLayerEdges[][] = stacked ? [series.flatMap(layersOf)] : series.map(layersOf);
  for (const group of groups) {
    let groupC0 = Infinity, groupC1 = -Infinity;
    for (const layer of group) {
      const c0 = Math.max(plot.x0, layer.cols[0]!), c1 = Math.min(plot.x1, layer.cols[layer.cols.length - 1]!);
      groupC0 = Math.min(groupC0, c0); groupC1 = Math.max(groupC1, c1);
      for (let col = c0; col <= c1; col++) {
        for (const [top, base] of areaSpansAt(layer, col, col)) {
          if (Math.round(top) === Math.round(base)) continue;
          const first = Math.max(plot.y0, top < base ? Math.round(top) : Math.round(base) + 1);
          const last = Math.min(plot.y1, top < base ? Math.round(base) - 1 : Math.round(top));
          if (first <= last) fillRegionShade(canvas, col, first, col, last, layer.glyph, layer.color);
        }
      }
    }
    if (!silhouette || !subFill) continue;
    for (let col = groupC0; col <= groupC1; col++) {
      // Per layer: its spans at this column's centre, and at its left/right quadrant columns.
      const spans = group.map((l) => [col, col - 0.25, col + 0.25].map((x) => areaSpansAt(l, col, x)));
      for (let row = plot.y0; row <= plot.y1; row++) {
        if (spans.some((s) => s[0]!.some(([top, base]) => areaCovers(top, base, row)))) continue;
        let mask = 0;
        let owner = -1, ownerQuadrants = 0;
        for (let li = 0; li < spans.length; li++) {
          let quadrants = 0;
          for (let q = 0; q < 4; q++) {
            const y = row + (q < 2 ? -0.25 : 0.25);
            if (spans[li]![q % 2 === 0 ? 1 : 2]!.some(([top, base]) => areaCovers(top, base, y))) { mask |= AREA_QUADRANT_SUB_BITS[q]!; quadrants++; }
          }
          // Ties go to the later (outer) layer of the group.
          if (quadrants > 0 && quadrants >= ownerQuadrants) { owner = li; ownerQuadrants = quadrants; }
        }
        if (owner >= 0) canvas.text(col, row, [subFill(mask)], { color: group[owner]!.color });
      }
    }
  }
}

/**
 * One layer the SOLID sub-cell compositor (`paintSolidRegions`) owns: its
 * colour, the plot columns it spans, and its exact `[top, base]` row spans
 * at a column (`spansAt(col, x)`, `x` the column itself or one of its two
 * quadrant columns). `floor` marks a STACK layer, which must stay visible in
 * every column where it is non-zero.
 */
interface SolidRegionLayer {
  readonly color: string | null;
  readonly c0: number;
  readonly c1: number;
  readonly floor: boolean;
  spansAt(col: number, x: number): readonly (readonly [number, number])[];
}

const NO_OWNER = -1;

/** A painted cell: foreground layer, background layer (or none), and the foreground's quadrants (bit0 TL, bit1 TR, bit2 BL, bit3 BR). */
interface SolidCell { readonly fg: number; readonly bg: number; readonly mask: number }

/**
 * One cell from its four quadrant owners and its two column-centre half
 * owners (`up`, `down`). Two colours per cell is the limit (a glyph's ink
 * plus its background), so:
 * - one owner: its own quadrants, over the page (the silhouette rule);
 * - two owners and no sky: the one holding more BOTTOM quadrants is the ink
 *   (ties: more quadrants, then the later layer), the other the background —
 *   so a boundary through the middle is `▄` in the lower band over the upper
 *   one, whose overflowing ink lands in the row painted after it;
 * - three (the sky counts): drop to column-centre half-blocks, which can
 *   never hold more than two.
 */
function resolveSolidCell(q: readonly number[], up: number, down: number): SolidCell | null {
  const owners = [...new Set(q.filter((o) => o !== NO_OWNER))];
  if (owners.length === 0) return null;
  const maskOf = (o: number): number => q.reduce((m, v, i) => (v === o ? m | (1 << i) : m), 0);
  const bits = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  if (owners.length === 1) return { fg: owners[0]!, bg: NO_OWNER, mask: maskOf(owners[0]!) };
  if (owners.length === 2 && !q.includes(NO_OWNER)) {
    const rank = (o: number): readonly number[] => { const m = maskOf(o); return [bits(m & 0b1100), bits(m), o]; };
    const [a, b] = owners as [number, number];
    const ra = rank(a), rb = rank(b);
    const aWins = ra[0]! !== rb[0]! ? ra[0]! > rb[0]! : ra[1]! !== rb[1]! ? ra[1]! > rb[1]! : a > b;
    const fg = aWins ? a : b;
    return { fg, bg: aWins ? b : a, mask: maskOf(fg) };
  }
  if (up === down) {
    if (up !== NO_OWNER) return { fg: up, bg: NO_OWNER, mask: 0b1111 };
    let best = owners[0]!;
    for (const o of owners) if (bits(maskOf(o)) >= bits(maskOf(best))) best = o;
    return { fg: best, bg: NO_OWNER, mask: maskOf(best) };
  }
  if (down !== NO_OWNER) return { fg: down, bg: up, mask: 0b1100 };
  return { fg: up, bg: NO_OWNER, mask: 0b0011 };
}

/**
 * SOLID region fills on `braille`/`blocks` (`regionFill.ts` resolved solid):
 * every cell is sampled at its four QUADRANT centres (the stacked-area
 * silhouette's own sampling, now applied to every boundary) and painted in
 * at most two colours — the tier's quadrant glyph in one layer's colour over
 * the canvas `bg` of the other. A boundary is therefore drawn at the NEAREST
 * HALF CELL: within a quarter row of a cell edge it stays a whole-cell
 * transition (exactly the texture paint's cells), within a quarter row of the
 * middle it becomes `▄`/`▀`. That is the smallest worst-case error a
 * two-slot cell allows (a quarter row, against half a row for whole cells).
 *
 * The floor: a STACK layer that is non-zero in a column but reaches no
 * sample point there is given the half cell nearest its own midpoint,
 * preferring a half whose owner stays visible elsewhere in the column — and
 * the column is re-resolved until every such layer shows, since a
 * three-colour cell can drop a quadrant. A layer thinner than half a row is
 * thus drawn half a row thick where the data is non-zero, never omitted.
 *
 * `layout.xAxisLineRow` is never painted: the axis owns it.
 */
function paintSolidRegions(canvas: GlyphCanvas, layout: GlyphChartLayout, layers: readonly SolidRegionLayer[]): void {
  const { plot } = layout;
  const tier = GLYPH_CANVAS_TIERS[canvas.tier];
  const quad = (tier.fillSubGlyph ?? tier.subGlyph)!;
  const halves = (plot.y1 - plot.y0 + 1) * 2;
  const skipRow = layout.xAxisLineRow;
  const slotY = (h: number): number => plot.y0 - 0.25 + h * 0.5;
  let c0 = Infinity, c1 = -Infinity;
  for (const l of layers) { c0 = Math.min(c0, Math.max(plot.x0, l.c0)); c1 = Math.max(c1, Math.min(plot.x1, l.c1)); }
  const left = new Int32Array(halves), centre = new Int32Array(halves), right = new Int32Array(halves);
  for (let col = c0; col <= c1; col++) {
    const active: number[] = [];
    for (let i = 0; i < layers.length; i++) if (col >= layers[i]!.c0 && col <= layers[i]!.c1) active.push(i);
    if (active.length === 0) continue;
    const sampled = active.map((i) => [layers[i]!.spansAt(col, col - 0.25), layers[i]!.spansAt(col, col), layers[i]!.spansAt(col, col + 0.25)] as const);
    left.fill(NO_OWNER); centre.fill(NO_OWNER); right.fill(NO_OWNER);
    for (let h = 0; h < halves; h++) {
      if (plot.y0 + (h >> 1) === skipRow) continue;
      const y = slotY(h);
      for (let a = 0; a < active.length; a++) {
        const [l, c, r] = sampled[a]!;
        if (l.some(([t, b]) => areaCovers(t, b, y))) left[h] = active[a]!;
        if (c.some(([t, b]) => areaCovers(t, b, y))) centre[h] = active[a]!;
        if (r.some(([t, b]) => areaCovers(t, b, y))) right[h] = active[a]!;
      }
    }
    const resolveColumn = (): (SolidCell | null)[] => {
      const cells: (SolidCell | null)[] = [];
      for (let k = 0; k < halves / 2; k++) {
        if (plot.y0 + k === skipRow) { cells.push(null); continue; }
        const t = 2 * k, b = 2 * k + 1;
        cells.push(resolveSolidCell([left[t]!, right[t]!, left[b]!, right[b]!], centre[t]!, centre[b]!));
      }
      return cells;
    };
    let cells = resolveColumn();
    const forced = new Set<number>();
    for (let round = 0; round < active.length; round++) {
      const visible = new Set<number>();
      for (const c of cells) if (c) { visible.add(c.fg); if (c.bg !== NO_OWNER) visible.add(c.bg); }
      const missing: { readonly layer: number; readonly mid: number }[] = [];
      for (let a = 0; a < active.length; a++) {
        const li = active[a]!;
        if (!layers[li]!.floor || visible.has(li)) continue;
        let span: readonly [number, number] | undefined;
        for (const s of sampled[a]![1]) if (!span || Math.abs(s[1] - s[0]) > Math.abs(span[1] - span[0])) span = s;
        if (!span || span[0] === span[1]) continue;
        const [t, b] = span;
        const lo = t < b ? t - 0.5 : b + 0.5, hi = t < b ? b - 0.5 : t + 0.5;
        if (hi < plot.y0 - 0.5 || lo > plot.y1 + 0.5) continue;
        missing.push({ layer: li, mid: (lo + hi) / 2 });
      }
      if (missing.length === 0) break;
      for (const { layer, mid } of missing) {
        const elsewhere = (owner: number, h: number): boolean => {
          if (owner === NO_OWNER || owner === layer) return true;
          for (let j = 0; j < halves; j++) if (j !== h && (left[j] === owner || centre[j] === owner || right[j] === owner)) return true;
          return false;
        };
        // The nearest half whose owner stays visible elsewhere, else the
        // nearest free half: unsafe and already-floored halves form one
        // contiguous block around a crowd of thin layers, so the nearest safe
        // half is the one just past that block — a displacement no larger
        // than the crowd itself.
        let pick = -1, pickSafe = false, pickDist = Infinity;
        for (let h = 0; h < halves; h++) {
          if (forced.has(h) || plot.y0 + (h >> 1) === skipRow) continue;
          const safe = elsewhere(left[h]!, h) && elsewhere(centre[h]!, h) && elsewhere(right[h]!, h);
          const dist = Math.abs(slotY(h) - mid);
          if ((safe && !pickSafe) || (safe === pickSafe && dist < pickDist)) { pick = h; pickSafe = safe; pickDist = dist; }
        }
        if (pick < 0) continue;
        forced.add(pick);
        left[pick] = centre[pick] = right[pick] = layer;
      }
      cells = resolveColumn();
    }
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (!c) continue;
      let sub = 0;
      for (let q = 0; q < 4; q++) if (c.mask & (1 << q)) sub |= AREA_QUADRANT_SUB_BITS[q]!;
      canvas.text(col, plot.y0 + k, [quad(sub)], { color: layers[c.fg]!.color, bg: c.bg === NO_OWNER ? null : layers[c.bg]!.color });
    }
  }
}

/** Rows that meet the zero baseline snap to the axis row's own edge, so a solid band never floats half a row above the axis it stands on. */
function zeroRowSnap(scales: GlyphChartResolvedScales, plot: GlyphChartPlotRect): (row: number) => number {
  const zero = scaleToRowExact(scales.y, plot, 0);
  return (row) => (Number.isFinite(zero) && Math.abs(row - zero) < 1e-9 ? Math.round(row) : row);
}

/**
 * `paintBar`'s segments as solid compositor layers — the same band/dodge
 * column range, but EXACT rows for the value and the stack boundaries, so
 * `paintSolidRegions` can put a boundary at the nearest half cell. A stacked
 * segment is floored. A segment whose exact rows coincide is empty (a zero
 * bar paints nothing).
 */
function solidBarLayers(layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, dodge: { readonly index: number; readonly count: number }, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): SolidRegionLayer[] {
  const snap = zeroRowSnap(scales, layout.plot);
  const baseline = snap(scaleToRowExact(scales.y, layout.plot, 0));
  const fallbackWidth = Math.max(1, Math.round((layout.plot.x1 - layout.plot.x0 + 1) / Math.max(1, rows.length) * 0.7));
  const out: SolidRegionLayer[] = [];
  for (const row of rows) {
    const stacked = row.y1 !== undefined;
    const topValue = stacked ? row.y1! : numeric(row.y);
    if (!Number.isFinite(topValue)) continue;
    const top = snap(scaleToRowExact(scales.y, layout.plot, topValue));
    const base = stacked ? snap(scaleToRowExact(scales.y, layout.plot, row.y0 ?? 0)) : baseline;
    if (!Number.isFinite(top) || !Number.isFinite(base) || top === base) continue;
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
    const x0 = Math.max(layout.plot.x0, range[0]), x1 = Math.min(layout.plot.x1, range[1]);
    if (x0 > x1) continue;
    const span: readonly (readonly [number, number])[] = [[top, base]];
    out.push({ color, c0: x0, c1: x1, floor: stacked, spansAt: () => span });
  }
  return out;
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
function paintRect(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, glyph: string, dodge: { readonly index: number; readonly count: number }, ledger: GlyphChartLedgerEntry[], degraded: Set<number>): void {
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
 * A pie/donut's outer diameter as a FRACTION of the smaller of the two
 * budgets it's fitted into (`arcRadii`'s own `min(plotRows, ...)`) — never
 * `1.0`, which touches the plot rect edge on the binding axis and leaves no
 * room for a callout's own disc-adjacent leader cell. Exported: it's the
 * one arc-shape contract that isn't a private layout constant (AGENTS.md's
 * "Charts").
 */
export const GLYPH_CHART_ARC_FILL = 0.8;

/**
 * Columns reserved on EACH side of the disc for a callout's leader + label
 * when `labels: "callout"` (the default) — a FIXED budget, not derived from
 * any label's actual text, so the disc's own size never depends on what a
 * slice happens to be named (`arcRadii`'s doc). Broken down:
 * `GLYPH_CHART_ARC_CALLOUT_DISC_GAP` (the leader's first cell sits one cell
 * outside the disc, per the addendum) + `..._DIAG_COLS` (the short diagonal
 * run) + `..._STUB_COLS` (the horizontal stub) + `..._TEXT_GAP` (one blank
 * cell before the label) + `..._MIN_TEXT_COLS` (room for a short abbreviated
 * label — `abbreviateChartText` degrades gracefully below this, but this is
 * what the gutter is SIZED for).
 */
const GLYPH_CHART_ARC_CALLOUT_DISC_GAP = 1;
const GLYPH_CHART_ARC_CALLOUT_DIAG_COLS = 2;
const GLYPH_CHART_ARC_CALLOUT_STUB_COLS = 2;
const GLYPH_CHART_ARC_CALLOUT_TEXT_GAP = 1;
const GLYPH_CHART_ARC_CALLOUT_MIN_TEXT_COLS = 6;
export const GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS =
  GLYPH_CHART_ARC_CALLOUT_DISC_GAP + GLYPH_CHART_ARC_CALLOUT_DIAG_COLS + GLYPH_CHART_ARC_CALLOUT_STUB_COLS +
  GLYPH_CHART_ARC_CALLOUT_TEXT_GAP + GLYPH_CHART_ARC_CALLOUT_MIN_TEXT_COLS;

/** A slice thinner than this never grows a callout — too little arc to
 * genuinely point at, and a leader crowd at the centre reads as noise. */
const GLYPH_CHART_ARC_CALLOUT_MIN_ANGLE = (8 * Math.PI) / 180;

interface ArcSlice {
  readonly s: number;
  readonly e: number;
  readonly color: string | null;
  readonly glyph: string;
  readonly name: string;
  readonly value: number;
}

interface ArcRadii {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** `false` when callouts were requested but there was no room for the
   * gutter (a too-narrow/short plot) — `paintArc` degrades to the plain
   * disc, exactly like `labels: "legend-only"`, rather than reserving a
   * gutter no callout can actually be painted in. */
  readonly calloutsFit: boolean;
}

/**
 * One shared radius, split into `rx`/`ry` by `canvas.cellAspect`
 * (width/height; default `0.5` — AGENTS.md's "Cell canvas") so a pie is a
 * circle on SCREEN, not merely in cell counts: physically
 * `colRadius * cellWidth == rowRadius * cellHeight`, so
 * `colRadius = rowRadius / cellAspect`. The diameter (in ROW units, before
 * that split) is `min(plotRows, availableCols * cellAspect) *
 * GLYPH_CHART_ARC_FILL` — the largest row-diameter whose matching
 * col-diameter (`/ cellAspect`) still clears `availableCols` too (see
 * `docs/design/charts.md`'s "Arc shape and callouts" for why this is
 * `* cellAspect` and not `/ cellAspect`). `availableCols` drops a
 * `GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS`-wide strip on each side when
 * callouts are wanted and the plot is wide enough to spare it; the centre
 * (`cx`/`cy`) is unchanged either way since the gutters are symmetric.
 * `textScale` (AGENTS.md's "Charts" "Density") multiplies the WHOLE
 * `min(GUTTER_COLS, floor(plotCols/4))` expression rather than just the raw
 * budget — `min(s*a, s*b) === s*min(a,b)` for `s > 0`, so the cap scales
 * WITH the budget it caps, and a scale-2 callout label gets a genuinely
 * bigger reservation rather than the same flat column count a bigger glyph
 * would then overflow.
 */
function arcRadii(plot: GlyphChartPlotRect, cellAspect: number, wantCallouts: boolean, textScale = 1): ArcRadii {
  const plotCols = plot.x1 - plot.x0 + 1;
  const plotRows = plot.y1 - plot.y0 + 1;
  const aspect = cellAspect > 0 && Number.isFinite(cellAspect) ? cellAspect : 0.5;
  // P3 (REVIEW-arc-density-search-opus.md): the FIXED 24-column gutter
  // (12/side) is genuinely free at every target default (the row budget
  // binds there, AGENTS.md's own claim) — but on a TALL or SQUARE grid
  // (`plotRows` comparable to or larger than `plotCols`), removing a flat
  // fraction of the COLUMNS removes a much larger fraction of the disc's
  // own ROW diameter (`availableCols * aspect` is what actually bounds
  // it): measured at 40x40, the unreserved gutter left a 12x6 smudge in
  // the middle of a 40x40 canvas — 63% of the disc's rows traded for
  // callout labels 13 characters long in a 12-column reservation. Capped
  // per side at a quarter of the plot's own width, which is genuinely
  // free at every measured target default (140/2=... — the cap only ever
  // binds below `4 * GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS` = 96 plot
  // columns, well under every target's own width) and keeps the property
  // the fixed budget was FOR (independent of label text) while no longer
  // trading the majority of the disc away on a narrow/tall grid.
  const gutter = textScale * Math.min(GLYPH_CHART_ARC_CALLOUT_GUTTER_COLS, Math.floor(plotCols / 4));
  const calloutsFit = wantCallouts && plotCols - 2 * gutter >= 3 && plotRows >= 3;
  const availableCols = calloutsFit ? plotCols - 2 * gutter : plotCols;
  const diameter = Math.max(1, Math.min(plotRows, availableCols * aspect)) * GLYPH_CHART_ARC_FILL;
  const rowRadius = Math.max(0.5, diameter / 2);
  const colRadius = rowRadius / aspect;
  return { cx: (plot.x0 + plot.x1) / 2, cy: (plot.y0 + plot.y1) / 2, rx: colRadius, ry: rowRadius, calloutsFit };
}

interface ArcCalloutCandidate {
  readonly index: number;
  readonly side: "left" | "right";
  readonly mid: number;
  readonly anchorRow: number;
  readonly targetRow: number;
  readonly name: string;
  readonly pct: number;
  readonly color: string | null;
}

/**
 * Leader + `name · NN%` label for every slice whose own angular span clears
 * `GLYPH_CHART_ARC_CALLOUT_MIN_ANGLE`. Per side (left = mid-angle's cosine
 * negative, right = non-negative): candidates sort by their own natural
 * TARGET row — which is already the same order `sin(mid)` puts them in
 * across a whole side's angular domain (monotonic there: `(-90°,90°]` for
 * the right half, `(90°,270°]` for the left, and `sin` is monotonic on
 * each), so this IS "sort by angle", just read off the row it already
 * implies — then rows are pushed apart by at least `textScale` (AGENTS.md's
 * "Charts" "Density" — a callout label now reserves a `textScale`-row band,
 * `canvas.text`'s own `scale`-row pitch, not a single row) so two labels
 * never share a band, and a label pushed past the plot's own bottom row is
 * dropped (`label-dropped`) rather than overlapping the next one down.
 *
 * The trailing `· NN%` is never itself abbreviated — a name that doesn't fit
 * abbreviates (through `glyphChartLabelLayout`'s own `scale` field, the SAME
 * mechanism an axis tick label uses, `layout.ts`'s `axisTicks`) or drops
 * whole, but the percentage is never truncated into a different, wrong
 * number.
 */
function paintArcCallouts(canvas: GlyphCanvas, plot: GlyphChartPlotRect, slices: readonly ArcSlice[], radii: ArcRadii, ledger: GlyphChartLedgerEntry[], textScale = 1): void {
  const { cx, cy, rx, ry } = radii;
  const total = slices.reduce((sum, sl) => sum + sl.value, 0);
  const candidates: ArcCalloutCandidate[] = [];
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i]!;
    if (sl.e - sl.s < GLYPH_CHART_ARC_CALLOUT_MIN_ANGLE) continue;
    const mid = (sl.s + sl.e) / 2;
    const side: "left" | "right" = Math.cos(mid) >= 0 ? "right" : "left";
    const anchorRow = Math.round(cy + ry * Math.sin(mid));
    const targetRow = Math.max(plot.y0, Math.min(plot.y1, anchorRow));
    candidates.push({ index: i, side, mid, anchorRow, targetRow, name: sl.name, pct: Math.round((sl.value / total) * 100), color: sl.color });
  }

  for (const side of ["left", "right"] as const) {
    const group = candidates.filter((c) => c.side === side).sort((a, b) => a.targetRow - b.targetRow);
    const sign = side === "right" ? 1 : -1;
    let lastRow = plot.y0 - textScale;
    for (const c of group) {
      const row = Math.max(c.targetRow, lastRow + textScale);
      if (row + textScale - 1 > plot.y1) {
        ledger.push(ledgerLabelDropped({ role: "pie callout", text: `${c.name} · ${c.pct}%`, reason: "there was no row left for it on this side of the pie" }));
        continue;
      }
      lastRow = row;

      // The disc's own edge column AT the anchor's row — solved from the
      // exact ellipse test `paintArc`'s fill loop uses, so the leader's
      // first cell is genuinely adjacent to that row's own disc ink rather
      // than the disc's widest point (which is usually a different row).
      const outRow = Math.max(plot.y0, Math.min(plot.y1, c.anchorRow));
      const dyFrac = ry > 0 ? (outRow - cy) / ry : 0;
      const edgeDx = Math.sqrt(Math.max(0, 1 - dyFrac * dyFrac)) * rx;
      const discEdgeCol = side === "right" ? Math.floor(cx + edgeDx) : Math.ceil(cx - edgeDx);
      const outCol = discEdgeCol + sign * GLYPH_CHART_ARC_CALLOUT_DISC_GAP;
      const elbow: GlyphCanvasPoint = { x: outCol + sign * GLYPH_CHART_ARC_CALLOUT_DIAG_COLS, y: row };
      const stubEnd: GlyphCanvasPoint = { x: elbow.x + sign * GLYPH_CHART_ARC_CALLOUT_STUB_COLS, y: row };
      // THE RESERVATION: the label's own near (leader-facing) edge is
      // measured from `textCol`, one full `textScale`-wide glyph-box short
      // of the leader's own last painted cell (`stubEnd`) — a flat 1-cell
      // gap at `textScale === 1`, byte-identical to before this option
      // existed, and a genuinely bigger blank buffer at scale > 1 so a
      // bigger glyph's own box never swallows into the leader. Every box
      // edge painted below is measured FROM this column, on both sides, so
      // a leader can never end inside the label it points at.
      const textCol = stubEnd.x + sign * GLYPH_CHART_ARC_CALLOUT_TEXT_GAP * textScale;
      const maxWidthCols = side === "right" ? plot.x1 - textCol + 1 : textCol - plot.x0 + 1;
      if (maxWidthCols < 1) {
        ledger.push(ledgerLabelDropped({ role: "pie callout", text: `${c.name} · ${c.pct}%`, reason: "there was no room for the label" }));
        continue;
      }

      const full = `${c.name} · ${c.pct}%`;
      const fullFolded = chartText(full, canvas.tier);
      const maxWidthChars = Math.max(1, Math.floor(maxWidthCols / textScale));
      let text: string;
      if (fullFolded.length <= maxWidthChars) {
        text = fullFolded;
      } else {
        // `x`/`y` here are never read for placement (only `.text` is used —
        // this call's own box math is discarded in favour of the leader-
        // relative `textCol` geometry below), so any in-bounds anchor
        // works; `obstacles: []` means this can never drop for lack of
        // SPACE on the row (nothing else is registered to collide with) —
        // but the NAME itself can still be dropped, either because it
        // reads as numeric (a slice name that happens to parse as a
        // number, e.g. `"20240101"`) and SI-abbreviation still can't make
        // it fit, or because the row landed outside the viewport's own
        // height. Either way `placed` comes back EMPTY, never a one-entry
        // array with an empty `.text` — a review finding (codex P1-1)
        // caught this dereferencing `placed[0]` unconditionally and
        // crashing on a narrow pie with numeric-looking slice names.
        const nameResult = glyphChartLabelLayout([{
          id: "arc-callout-name", x: textCol, y: row, text: c.name,
          maxWidth: maxWidthCols, role: "pie callout", scale: textScale,
        }], { obstacles: [], viewport: { cols: canvas.cols, rows: canvas.rows }, charset: canvas.tier });
        ledger.push(...nameResult.ledger);
        if (nameResult.placed.length === 0) {
          ledger.push(ledgerLabelDropped({ role: "pie callout", text: full, reason: "there was no room for even the slice's own name" }));
          continue;
        }
        text = nameResult.placed[0].text;
        if (text === "") {
          ledger.push(ledgerLabelDropped({ role: "pie callout", text: full, reason: "there was no room for even the slice's own name" }));
          continue;
        }
      }

      canvas.line({ x: outCol, y: outRow }, elbow, { subcell: false, color: c.color });
      canvas.line(elbow, stubEnd, { subcell: false, color: c.color });
      // Always painted `align: "left"` from an EXPLICITLY computed left
      // edge (never `canvas.text`'s own `align: "right"`, whose box grows
      // from `x0 - boxWidth + scale`, i.e. `scale - 1` columns past `x0`)
      // so `textCol` is the box's near edge on BOTH sides, symmetrically —
      // the property the leader-gap reservation above depends on. Dropping
      // this offset on the left side (using `textCol` as the box's LEFT
      // edge instead of its right) grows the box back TOWARD the leader
      // instead of away from it, which is exactly the reservation this
      // function exists to prevent.
      const boxWidth = text.length * textScale;
      const boxLeftCol = side === "right" ? textCol : textCol - boxWidth + 1;
      canvas.text(boxLeftCol, row, [text], { align: "left", color: c.color, scale: textScale });
    }
  }
}

/**
 * One total covers every category in a pie. Angle and radius select the
 * slice per cell; its categorical shade is painted through canvas.text so
 * blocks/braille retain the same full-cell shade vocabulary as the legend,
 * instead of substituting subcell occupancy for slice identity.
 */
function paintArc(canvas: GlyphCanvas, layout: GlyphChartLayout, series: readonly ChartSeries[], innerRadius: number, colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], resolvedRowCount: number, labels: "callout" | "legend-only", textScale: number, fill: GlyphChartResolvedRegionFill): void {
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
  const radii = arcRadii(layout.plot, canvas.cellAspect, labels === "callout", textScale);
  const { cx, cy, rx, ry } = radii;
  let start = -Math.PI / 2;
  const slices: ArcSlice[] = values.map((v, i) => {
    const angle = (v / total) * Math.PI * 2;
    const s = start;
    start += angle;
    const entry = series[i]!;
    return { s, e: start, color: resolveSeriesColor(entry, colorEnabled), glyph: regionFillGlyph(canvas.tier, entry.shadeIndex!, series.length, fill), name: entry.name ?? String(i), value: v };
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
  if (radii.calloutsFit) paintArcCallouts(canvas, layout.plot, slices, radii, ledger, textScale);
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
function paintAxes(canvas: GlyphCanvas, layout: GlyphChartLayout, colorEnabled: boolean, textScale = 1): void {
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
    canvas.text(t.labelStart, layout.xAxisLabelRow, [t.label], { color: xColor, scale: textScale });
  }
  for (const t of layout.yTicks) {
    canvas.text(t.labelStart, t.cell, [t.label], { color: yColor, scale: textScale });
  }

  // Titles (packet item 6): x defaults to centred under its own tick-label
  // row (`titleAt: "center"`) but can instead start/end-align at the plot's
  // own left/right edge; y defaults to the top-left above the axis
  // (`titleAt: "top"`) or, for `"bottom"`, below the plot at column 0 —
  // always column 0, whether it shares the x title's row or claims its own
  // (`layoutGlyphChart`'s own comment on `titleAt: "bottom"`), so unlike x
  // it never needs its own alignment field.
  if (layout.xAxisTitle) {
    const width = layout.plot.x1 - layout.plot.x0 + 1;
    // The title's actual footprint is `length * textScale` columns once
    // painted at scale — the start/end/center formulas below are the
    // originals with `layout.xAxisTitle.length` generalized to it.
    const titleCols = layout.xAxisTitle.length * textScale;
    const x = layout.xAxisTitleAt === "start" ? layout.plot.x0
      : layout.xAxisTitleAt === "end" ? Math.max(layout.plot.x0, layout.plot.x1 - titleCols + 1)
      : Math.max(layout.plot.x0, layout.plot.x0 + Math.floor((width - titleCols) / 2));
    canvas.text(x, layout.xAxisTitleRow, [layout.xAxisTitle], { color: xColor, scale: textScale });
  }
  if (layout.yAxisTitle) {
    canvas.text(0, layout.yAxisTitleRow, [layout.yAxisTitle], { color: yColor, scale: textScale });
  }
}

// ── marks (line / dot / rule) ───────────────────────────────────────────

/** Default `1` — every mark's `options.strokeWidth`, already validated to
 * `1 | 2 | 3` or absent by `validate.ts`'s `bad-stroke-width` rule. */
function resolveStrokeWidth(options: { readonly strokeWidth?: 1 | 2 | 3 } | undefined): 1 | 2 | 3 {
  return options?.strokeWidth ?? 1;
}

/**
 * A width>=2 stroke on `braille`/`blocks` adds real ink up to ONE DOT
 * perpendicular to the segment (`glyphcss`'s `paintSubcellLine`) — at most
 * one whole CELL over, since a cell holds only 2 dot columns (or 4 dot
 * rows), so a dot at a cell's own far edge steps into its neighbour. `plot`
 * is inset by exactly that one-cell margin before a wide line's own
 * endpoints are clipped to it, which is what keeps "clips to the plot rect
 * like every mark" true at width 2/3 too. `ascii`/`box` never need this —
 * width there only substitutes a heavier GLYPH on the identical walked
 * cells (`canvas.ts`'s own doc) — and `width <= 1` returns `plot` verbatim,
 * so a plain line's clip is byte-identical to before this option existed.
 */
function strokeClipPlot(plot: GlyphChartPlotRect, subcell: boolean, width: 1 | 2 | 3): GlyphChartPlotRect {
  if (!subcell || width <= 1) return plot;
  return {
    x0: Math.min(plot.x1, plot.x0 + 1),
    x1: Math.max(plot.x0, plot.x1 - 1),
    y0: Math.min(plot.y1, plot.y0 + 1),
    y1: Math.max(plot.y0, plot.y1 - 1),
  };
}

/**
 * `canvas.line()` itself bounds a run only to the whole GRID (0..cols,
 * 0..rows) — it has no notion of the chart's own, possibly narrower, plot
 * rect. An explicit scale domain excluding some of the data (or a `null` y
 * that resolves to a value outside `[0,1]` via `Number`) would otherwise
 * paint straight through the title row, the axis line, and the tick labels
 * (review finding 2) — `clipSegmentToPlot` is what `paintDot`'s own
 * plot-rect bounds check already does for a single point, generalised to a
 * segment. `width` (default `1`, byte-identical when absent) is the mark's
 * own `options.strokeWidth`, forwarded to `canvas.line()` — see
 * `strokeClipPlot`'s doc for why width 2/3 clips against a tighter rect.
 */
function paintLine(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, style: GlyphCanvasLineStyle = "solid", width: 1 | 2 | 3 = 1): void {
  const points = rows
    .map((r) => ({ x: scaleToCol(scales.x, layout.plot, r.x), y: scaleToRow(scales.y, layout.plot, r.y) }));
  const clipPlot = strokeClipPlot(layout.plot, GLYPH_CANVAS_TIERS[canvas.tier].subcell, width);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const clipped = clipSegmentToPlot(a, b, clipPlot);
    if (!clipped) continue;
    canvas.line(clipped[0], clipped[1], { color, style, width });
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
// `subcell: false` override, not a second mechanism. `subcell: false` also
// means a rule's own footprint never depends on `width` (`canvas.ts`'s
// whole-cell path only substitutes a heavier glyph), so `strokeClipPlot`'s
// margin is never needed here.
function paintRule(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, values: readonly number[], axis: "x" | "y", color: string | null, width: 1 | 2 | 3 = 1): void {
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
      canvas.line({ x: layout.plot.x0, y: row }, { x: layout.plot.x1, y: row }, { color, style: "dashed", subcell: false, width });
    } else {
      const col = scaleToCol(scales.x, layout.plot, v);
      if (col < layout.plot.x0 || col > layout.plot.x1) continue;
      if (col === layout.yAxisCol) continue;
      canvas.line({ x: col, y: layout.plot.y0 }, { x: col, y: layout.plot.y1 }, { color, style: "dashed", subcell: false, width });
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
 *
 * `textScale` (AGENTS.md's "Charts" "Density") reserves an `s`-row-tall band
 * per entry — `canvas.text`'s own `scale`-row pitch — with a `3*s`-wide
 * swatch gutter, exactly the `3 * textScale` the bottom-placed legend's own
 * `swatchGutter` uses, so entries never crowd tighter than a scale-2 swatch's
 * own `2x2` box needs. Every expression below reduces to the pre-`textScale`
 * one at `textScale === 1` (`3*1 === 3`, `floor(plotHeight/1) === plotHeight`,
 * …), so this is byte-identical there.
 */
function paintCornerLegend(canvas: GlyphCanvas, layout: GlyphChartLayout, legend: GlyphChartLegendLayout, series: readonly ChartSeries[], colorEnabled: boolean, ledger: GlyphChartLedgerEntry[], textScale: number, fill: GlyphChartResolvedRegionFill): void {
  const { plot } = layout;
  const plotWidth = plot.x1 - plot.x0 + 1;
  const maxRow = layout.xAxisLineRow === plot.y1 ? plot.y1 - 1 : plot.y1;
  const plotHeight = maxRow - plot.y0 + 1;
  if (plotWidth < 3 * textScale || plotHeight < textScale) {
    if (legend.items.length > 0) ledger.push(ledgerLegendDropped({ series: legend.items.length, cols: plotWidth, rows: Math.max(0, plotHeight) }));
    return;
  }
  const isRight = legend.placement === "top-right" || legend.placement === "bottom-right";
  const isBottom = legend.placement === "bottom-left" || legend.placement === "bottom-right";
  const maxItems = Math.max(0, Math.floor(plotHeight / textScale));
  const items = legend.items.slice(0, maxItems);
  if (legend.items.length > items.length) {
    ledger.push(ledgerLegendDropped({ series: legend.items.length - items.length, cols: plotWidth, rows: plotHeight }));
  }
  const swatchGutterCols = 3 * textScale;
  const maxTextWidth = Math.max(1, Math.floor((plotWidth - 2) / textScale));
  let covered = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const row = isBottom ? maxRow - items.length * textScale + 1 + i * textScale : plot.y0 + i * textScale;
    const { text, dropped } = abbreviateChartText(item.label, maxTextWidth, canvas.tier, false);
    if (dropped || !text) continue;
    // `swatchGutterCols` (not `2 * textScale`) so a LINE-style swatch (the
    // trailing `else` below) has room for the same styled run the bottom
    // legend paints (`paint.ts`'s own label-phase swatch, `swatchX ..
    // label.x - 1`) — a single-cell `canvas.line(p, p)` degenerates to one
    // braille dot under a sub-cell tier and can never show the
    // solid/dashed/dotted/double cycle that carries series identity when
    // colour is off (fable review, batch 3, finding b).
    const blockWidth = Math.min(plotWidth, text.length * textScale + swatchGutterCols);
    const startCol = isRight ? plot.x1 - blockWidth + 1 : plot.x0;
    const textCol = Math.min(plot.x1, startCol + swatchGutterCols);
    for (let rr = row; rr < row + textScale; rr++) {
      for (let c = startCol; c <= Math.min(plot.x1, startCol + blockWidth - 1); c++) {
        if (canvas.grid.char[rr * canvas.cols + c] !== " ") covered++;
      }
    }
    const entry = series.find((s) => s.name === item.label);
    const color = colorEnabled ? item.color ?? null : null;
    const styleIdx = entry ? (entry.mark.type === "arc" ? entry.shadeIndex! : entry.styleIndex) : i;
    // `total` mirrors the mark's own paint-time count — the number of
    // OTHER series entries sharing this exact `entry.mark` reference — so
    // the legend swatch always picks the same table (compact-vs-extended
    // ASCII) the plot itself painted with.
    const shadeTotal = entry ? series.filter((s) => s.mark === entry.mark).length : 1;
    if (entry?.mark.type === "arc") canvas.text(startCol, row, [regionFillGlyph(canvas.tier, entry.shadeIndex!, shadeTotal, fill)], { color, scale: textScale });
    else if (entry?.mark.type === "dot" && GLYPH_CANVAS_TIERS[canvas.tier].subcell) paintSubcellDot(canvas, startCol, row, color);
    else if (entry?.mark.type === "dot") canvas.text(startCol, row, [seriesDot(canvas.tier, styleIdx)], { color, scale: textScale });
    else if (entry?.mark.type === "bar" || entry?.mark.type === "rect" || entry?.mark.type === "area" || entry?.mark.type === "sankey" || entry?.mark.type === "funnel") canvas.text(startCol, row, [regionFillGlyph(canvas.tier, entry.styleIndex, shadeTotal, fill)], { color, scale: textScale });
    else if (entry?.mark.type === "cell") canvas.text(startCol, row, [seriesShade(canvas.tier, 0)], { color, scale: textScale });
    else canvas.line({ x: startCol, y: row }, { x: Math.max(startCol, textCol - 1), y: row }, { color, style: SERIES_STYLES[styleIdx % 4], width: entry ? resolveStrokeWidth(entry.mark.options) : 1 });
    canvas.text(textCol, row, [text], { color, scale: textScale });
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
  // Web-only affordance — see `GlyphChartPaintOptions.textScale`'s own doc.
  // Default `1`, so every `scale: textScale` forwarded below is `scale: 1`
  // (canvas.text's own byte-identical default) when the caller never set it.
  const textScale = opts.textScale ?? 1;
  const fill = opts.regionFill ?? "texture";
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
      const sankeyLayout = layoutSankeyGraph(groups, layout.plot, canvas.tier, ledger, textScale);
      if (!sankeyLayout) continue;
      const routedRows = computeSankeyRoutedRows(guardedSankey, layout.plot, sankeyLayout, opts.colorEnabled, ledger, `sankey${i}:`, textScale);
      registered.push({ mark, layout: sankeyLayout, routedRows });
    }
    if (registered.length > 0) canvas.resolveJunctions();
    for (const r of registered) sankeyRouted.set(r.mark, { layout: r.layout, routedRows: r.routedRows });
  }
  const sankeyClaimedBy = new Set<number>();
  const areaBoundaryLines = !opts.colorEnabled && series.some((s) => s.name !== undefined);
  for (const { mark, rows: resolvedRows } of marks) {
    const groups = series.filter((s) => s.mark === mark);
    const guarded = guardedCanvas(canvas, mark.type);
    if (mark.type === "arc") paintArc(guarded, layout, groups, mark.options?.innerRadius ?? 0, opts.colorEnabled, ledger, resolvedRows.length, mark.options?.labels ?? "callout", textScale, fill);
    else if (mark.type === "sankey") {
      const r = sankeyRouted.get(mark);
      if (r) paintSankeyRoutedRows(guarded, r.layout, r.routedRows, ledger, sankeyClaimedBy, mark.options?.ribbon ?? "filled", textScale, fill);
    }
    else if (mark.type === "funnel") paintFunnelMark(guarded, layout.plot, groups, opts.colorEnabled, ledger, textScale, fill);
    else if (mark.type === "area") {
      // One call per mark, not per series: a stack's silhouette is the edge
      // of ALL its layers together. An unstacked area whose boundary LINE
      // is drawn below takes that line as its edge instead of a sub-cell
      // silhouette, so the edge is drawn once.
      const stacked = isStackedArea(resolvedRows);
      paintAreaMark(guarded, layout, scales, groups.map((g) => ({ rows: g.rows, color: resolveSeriesColor(g, opts.colorEnabled), glyph: regionFillGlyph(canvas.tier, g.styleIndex, groups.length, fill) })), stacked, stacked || !areaBoundaryLines, fill);
    }
    else {
    // A solid bar mark on `braille`/`blocks` goes through the sub-cell
    // compositor as ONE pass over every series' segments, so a stack
    // boundary through the middle of a cell shows both segments' colours.
    const solidBars: SolidRegionLayer[] = [];
    const solidSubcell = fill === "solid" && GLYPH_CANVAS_TIERS[canvas.tier].subcell;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const { rows, styleIndex } = group;
      const color = resolveSeriesColor(group, opts.colorEnabled);
      const glyph = regionFillGlyph(canvas.tier, styleIndex, groups.length, fill);
      if (mark.type === "bar" && solidSubcell) solidBars.push(...solidBarLayers(layout, scales, rows, color, { index: i, count: groups.length }, ledger, dodgeDegraded));
      else if (mark.type === "bar") paintBar(guarded, layout, scales, rows, color, glyph, { index: i, count: groups.length }, ledger, dodgeDegraded);
      if (mark.type === "rect") paintRect(guarded, layout, scales, rows, color, glyph, { index: i, count: groups.length }, ledger, dodgeDegraded);
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
    if (solidBars.length > 0) paintSolidRegions(guarded, layout, solidBars);
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
  paintAxes(canvas, layout, opts.colorEnabled, textScale);
  for (const entry of series) {
    const { mark, rows, ruleValues, styleIndex } = entry;
    const color = resolveSeriesColor(entry, opts.colorEnabled);
    const style = opts.colorEnabled ? "solid" : SERIES_STYLES[styleIndex % SERIES_STYLES.length]!;
    const guarded = guardedCanvas(canvas, mark.type);
    const width = resolveStrokeWidth(mark.options);
    if (mark.type === "line") paintLine(guarded, layout, scales, rows, color, style, width);
    // An UNSTACKED area's boundaries carry the same monochrome series
    // vocabulary as lines: its series' fills overlap, so a later fill can
    // hide an earlier series and the line is what still shows it. A STACKED
    // layer never draws one (DIAGNOSIS-stacked-area.md S1): its fill already
    // partitions the column, so the change of glyph IS the boundary, and a
    // line on the layer's own top row erased every band under ~2 rows.
    if (mark.type === "area" && areaBoundaryLines && !isStackedArea(rows)) {
      for (const layer of areaLayers(rows)) paintLine(guarded, layout, scales, layer.map((r) => ({ ...r, y: r.y1 ?? r.y })), color, style, width);
    }
    if (mark.type === "dot") paintDot(guarded, layout, scales, rows, color, opts.colorEnabled ? 0 : styleIndex);
    if (mark.type === "rule") paintRule(guarded, layout, scales, ruleValues ?? [], mark.options?.axis ?? "y", color, width);
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
    const half = Math.floor((layout.titleText.length * textScale) / 2);
    const x = layout.titleAlign === "left" ? Math.min(layout.cols - 1, half)
      : layout.titleAlign === "right" ? Math.max(0, layout.cols - 1 - half)
      : Math.floor(layout.cols / 2);
    candidates.push({ id: "title", x, y: layout.titleRow, text: layout.titleText, priority: 100, role: "chart title", scale: textScale });
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
      // The title's own footprint is `titleLen * textScale` columns once
      // painted at scale.
      const titleLen = layout.titleText.length * textScale;
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
    // The swatch itself paints at `scale: textScale` too (legend "names +
    // swatches" both scale, AGENTS.md's "Charts" "Density" paragraph), so
    // its own gutter before the label scales the same way the original
    // flat 3-column gutter did at `textScale === 1`.
    const swatchGutter = 3 * textScale;
    for (let i = 0; i < layout.legend.items.length; i++) {
      const item = layout.legend.items[i]!;
      candidates.push({ id: `legend:${i}`, x: regionStart + i * slot + Math.floor(slot / 2), y: legendRow, text: item.label, maxWidth: Math.max(1, slot - swatchGutter), priority, role: "legend label", scale: textScale });
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
      // The swatch itself paints at `label.scale` too (AGENTS.md's
      // "Charts" "Density" — legend "names + swatches" both scale), so its
      // own gutter matches the candidate's own `swatchGutter` above.
      const swatchX = Math.max(0, label.x - 3 * label.scale);
      // See `paintCornerLegend`'s own doc on `shadeTotal`.
      const shadeTotal = entry ? series.filter((s) => s.mark === entry.mark).length : 1;
      if (entry?.mark.type === "arc") guardedLabels.text(swatchX, label.y, [regionFillGlyph(canvas.tier, entry.shadeIndex!, shadeTotal, fill)], { color, scale: label.scale });
      else if (entry?.mark.type === "dot" && GLYPH_CANVAS_TIERS[canvas.tier].subcell) {
        // Under braille/blocks the plot itself paints a 2x2 dot cluster
        // (CHARTS-RESEARCH diagnosis B6b), never the whole-cell "● × + ◆"
        // glyph `seriesDot` returns — the legend must show the SAME mark
        // `paintDot` actually painted, via the same helper. `textScale` has
        // no sub-cell analogue, so this one swatch stays unscaled.
        paintSubcellDot(guardedLabels, swatchX, label.y, color);
      }
      else if (entry?.mark.type === "dot") guardedLabels.text(swatchX, label.y, [seriesDot(canvas.tier, i)], { color, scale: label.scale });
      // Region marks (bar/rect/area/cell) carry series identity through
      // their own FILL GLYPH, never a line style (CHARTS-RESEARCH diagnosis
      // B2/B6d) — the legend swatch must show that same glyph, so a bar
      // chart's legend never reads as a line chart's. `cell` (a heatmap)
      // has no per-series shade cycle of its own (`paintCell` shades by
      // continuous VALUE, not by series) — its swatch is the ramp's own
      // full-ink glyph, `seriesShade(tier, 0)`, matching the darkest cell
      // it can paint. A bar/rect/area/sankey/funnel swatch follows the
      // render's resolved `fill` exactly as its plot fill does.
      else if (entry?.mark.type === "bar" || entry?.mark.type === "rect" || entry?.mark.type === "area" || entry?.mark.type === "sankey" || entry?.mark.type === "funnel") {
        guardedLabels.text(swatchX, label.y, [regionFillGlyph(canvas.tier, entry.styleIndex, shadeTotal, fill)], { color, scale: label.scale });
      }
      else if (entry?.mark.type === "cell") guardedLabels.text(swatchX, label.y, [seriesShade(canvas.tier, 0)], { color, scale: label.scale });
      // A line-style swatch (`canvas.line`) has no `textScale` analogue —
      // stays a single row regardless of `label.scale`.
      else guardedLabels.line({ x: swatchX, y: label.y }, { x: Math.max(swatchX, label.x - 1), y: label.y }, { color, style: SERIES_STYLES[i % 4], width: entry ? resolveStrokeWidth(entry.mark.options) : 1 });
      guardedLabels.text(label.x, label.y, [label.text], { color, scale: label.scale });
    } else if (textColors.has(label.id)) {
      guardedLabels.text(label.x, label.y, [label.text], { color: textColors.get(label.id)!, scale: label.scale });
    } else guardedLabels.text(label.x, label.y, [label.text], { scale: label.scale });
  }
  if (layout.legend && layout.legend.row === undefined) {
    paintCornerLegend(guardedLabels, layout, layout.legend, series, opts.colorEnabled, ledger, textScale, fill);
  }
  if (fill === "solid") paintSolidCellBackgrounds(canvas);
}

/**
 * Under a SOLID region fill, every full-block cell (`█`) also carries its own
 * colour as its background (DIAGNOSIS-sankey-column-jump.md, Round 3).
 *
 * A browser draws `█` as a glyph, antialiased at its left and right edges.
 * At the web `<pre>`'s 13px Glyph Mono a column is 7.6171875 CSS px wide, so
 * most column boundaries fall between device pixels, and two abutting blocks
 * each cover part of the shared pixel: the composite is lighter than either,
 * a hairline seam. Measured in Chromium on the energy sankey's Coal ribbon
 * (braille, css, 96x32): 9 seam pixels across 19 columns at DPR 2, 12 at
 * DPR 1, at column boundaries inside a single span, never at a span edge
 * alone. An inline box's background is one pixel-snapped rectangle per run,
 * so a run of cells whose background already is the ink colour has nothing
 * to show through. `█` is the only glyph whose ink is the whole cell, so it
 * is the only one this can be true of; a two-colour quadrant cell already
 * carries the other band's background, and a quadrant over sky must not.
 *
 * Only the solid canvas takes it: its exits are the colour-carrying ones
 * (html under `css`, Copy ANSI), and a texture paint is byte-identical.
 */
function paintSolidCellBackgrounds(canvas: GlyphCanvas): void {
  const { char, color } = canvas.grid;
  for (let idx = 0; idx < char.length; idx++) {
    const ink = color[idx];
    if (char[idx] === "█" && ink && canvas.bg[idx] == null) canvas.bg[idx] = ink;
  }
}
