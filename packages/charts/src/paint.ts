/**
 * Paints a resolved+laid-out spec onto a `GlyphCanvas`, in FIXED priority
 * order (PLAN.md Phase 1): fills (bar/area/rect/cell/arc — region marks)
 * first, then axes, then marks (line/dot/rule — stroke/point marks), then
 * labels (title/legend/data labels) last, so nothing paints over a label.
 * Every mark type gets its own small painter function; `paintGlyphChart`
 * is the only place that decides ORDER, matching `docs/design/canvas.md`'s
 * own "tiers are tables, painters are dumb" discipline one level up.
 */

import type { GlyphCanvas, GlyphCanvasLineStyle } from "glyphcss";
import { bandColRange, bandRowRange, scaleToCol, scaleToRow, type GlyphChartLayout } from "./layout";
import { glyphChartLabelLayout, type GlyphChartLabelCandidate, type GlyphChartObstacleRect } from "./labels";
import { areaLayers, chartSeries, SERIES_COLORS, SERIES_STYLES, seriesDot, seriesShade, type ChartSeries } from "./series";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartResolvedScales } from "./scales";
import type { GlyphChartMarkRow, GlyphChartSpec } from "./types";

const PALETTE = SERIES_COLORS;

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
 * A bar's cell span is `(baseline, value]` — NOT `[0, value]` clamped to
 * "above" — so a negative value (mixed-sign honesty gate) draws BELOW the
 * baseline instead of collapsing to a zero-height bar. `stack`-transformed
 * rows (`y0`/`y1` present) use their own segment bounds instead of the
 * shared 0 baseline.
 */
function paintBar(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null): void {
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
    let x0: number;
    let x1: number;
    if (band) {
      [x0, x1] = band;
    } else {
      const col = scaleToCol(scales.x, layout.plot, row.x);
      const half = Math.floor(fallbackWidth / 2);
      x0 = col - half;
      x1 = col - half + fallbackWidth - 1;
    }
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

function paintRect(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null): void {
  for (const row of rows) {
    const base = scaleToRow(scales.y, layout.plot, row.y0 ?? 0);
    const value = scaleToRow(scales.y, layout.plot, row.y1 ?? row.y);
    const col = scaleToCol(scales.x, layout.plot, row.x);
    if (value === base) continue;
    const top = Math.max(layout.plot.y0, Math.min(base, value) + (value > base ? 1 : 0));
    const bottom = Math.min(layout.plot.y1, Math.max(base, value) - (value < base ? 1 : 0));
    if (Number.isFinite(top) && top <= bottom && col >= layout.plot.x0 && col <= layout.plot.x1) canvas.fillRect(col, top, col, bottom, { fill: "solid", color });
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
function paintArc(canvas: GlyphCanvas, layout: GlyphChartLayout, series: readonly ChartSeries[], innerRadius: number, colorEnabled: boolean, ledger: string[]): void {
  const values = series.map((s) => s.rows.reduce((sum, r) => sum + numeric(r.y), 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) { ledger.push("GLYPH_CHART_EMPTY_TOTAL: pie total is zero; no slices painted."); return; }
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
  canvas.line({ x: layout.yAxisCol, y: layout.plot.y0 }, { x: layout.yAxisCol, y: layout.xAxisLineRow });
  canvas.line({ x: layout.yAxisCol, y: layout.xAxisLineRow }, { x: layout.plot.x1, y: layout.xAxisLineRow });
  for (const t of layout.xTicks) {
    canvas.text(t.labelStart, layout.xAxisLabelRow, [t.label]);
  }
  for (const t of layout.yTicks) {
    canvas.text(t.labelStart, t.cell, [t.label]);
  }
}

// ── marks (line / dot / rule) ───────────────────────────────────────────

function paintLine(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, style: GlyphCanvasLineStyle = "solid"): void {
  const points = rows
    .map((r) => ({ x: scaleToCol(scales.x, layout.plot, r.x), y: scaleToRow(scales.y, layout.plot, r.y) }));
  for (let i = 0; i < points.length - 1; i++) {
    canvas.line(points[i]!, points[i + 1]!, { color, style });
  }
}

function paintDot(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, rows: readonly GlyphChartMarkRow[], color: string | null, styleIndex: number): void {
  const glyph = seriesDot(canvas.tier, styleIndex);
  for (const row of rows) {
    const col = scaleToCol(scales.x, layout.plot, row.x);
    const r = scaleToRow(scales.y, layout.plot, row.y);
    if (!Number.isFinite(col) || !Number.isFinite(r) || col < layout.plot.x0 || col > layout.plot.x1 || r < layout.plot.y0 || r > layout.plot.y1) continue;
    canvas.text(col, r, [glyph], { color });
  }
}

function paintRule(canvas: GlyphCanvas, layout: GlyphChartLayout, scales: GlyphChartResolvedScales, values: readonly number[], axis: "x" | "y", color: string | null): void {
  for (const v of values) {
    if (axis === "y") {
      const row = scaleToRow(scales.y, layout.plot, v);
      if (row < layout.plot.y0 || row > layout.plot.y1) continue;
      canvas.line({ x: layout.plot.x0, y: row }, { x: layout.plot.x1, y: row }, { color, style: "dashed" });
    } else {
      const col = scaleToCol(scales.x, layout.plot, v);
      if (col < layout.plot.x0 || col > layout.plot.x1) continue;
      canvas.line({ x: col, y: layout.plot.y0 }, { x: col, y: layout.plot.y1 }, { color, style: "dashed" });
    }
  }
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
    // Mixed signs reserve equal ramp halves around zero. Same-sign values
    // share one sequential domain; neither path destroys the sign.
    if (lo < 0 && hi > 0) return v < 0 ? 0.5 * (v - lo) / -lo : 0.5 + 0.5 * v / hi;
    return hi === lo ? 0 : (v - lo) / (hi - lo);
  };
  for (const { mark } of marks) {
    const groups = series.filter((s) => s.mark === mark);
    if (mark.type === "arc") paintArc(canvas, layout, groups, mark.options?.innerRadius ?? 0, opts.colorEnabled, ledger);
    else for (const { rows, styleIndex } of groups) {
      const color = paletteColor(styleIndex, opts.colorEnabled);
      if (mark.type === "bar") paintBar(canvas, layout, scales, rows, color);
      if (mark.type === "area") paintArea(canvas, layout, scales, rows, color);
      if (mark.type === "rect") paintRect(canvas, layout, scales, rows, color);
      if (mark.type === "cell") paintCell(canvas, layout, scales, rows, color, shadeFor);
    }
  }
  paintAxes(canvas, layout);
  for (const { mark, rows, ruleValues, styleIndex } of series) {
    const color = paletteColor(styleIndex, opts.colorEnabled);
    const style = opts.colorEnabled ? "solid" : SERIES_STYLES[styleIndex % SERIES_STYLES.length]!;
    if (mark.type === "line") paintLine(canvas, layout, scales, rows, color, style);
    // Area boundaries carry the same monochrome series vocabulary as lines.
    if (mark.type === "area" && !opts.colorEnabled && series.some((s) => s.name !== undefined)) {
      for (const layer of areaLayers(rows)) paintLine(canvas, layout, scales, layer.map((r) => ({ ...r, y: r.y1 ?? r.y })), color, style);
    }
    if (mark.type === "dot") paintDot(canvas, layout, scales, rows, color, opts.colorEnabled ? 0 : styleIndex);
    if (mark.type === "rule") paintRule(canvas, layout, scales, ruleValues ?? [], mark.options?.axis ?? "y", color);
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
  for (const label of placed) {
    if (label.id.startsWith("legend:")) {
      const i = Number(label.id.slice(7));
      const color = paletteColor(i, opts.colorEnabled);
      const entry = series.find((s) => s.name === layout.legend!.items[i]!.label);
      const swatchX = Math.max(0, label.x - 3);
      if (entry?.mark.type === "arc") canvas.text(swatchX, label.y, [seriesShade(canvas.tier, entry.shadeIndex!)], { color });
      else if (entry?.mark.type === "dot") canvas.text(swatchX, label.y, [seriesDot(canvas.tier, i)], { color });
      else canvas.line({ x: swatchX, y: label.y }, { x: Math.max(swatchX, label.x - 1), y: label.y }, { color, style: SERIES_STYLES[i % 4] });
      canvas.text(label.x, label.y, [label.text], { color });
    } else canvas.text(label.x, label.y, [label.text]);
  }
}
