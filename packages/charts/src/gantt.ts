import { glyphChartRowSpacing } from "./rowSpacing";
import { chartText } from "./labels";
import { ledgerMermaidDegraded, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartLayout, GlyphChartLayoutTick } from "./layout";
import type { GlyphChartResolvedScale } from "./scales";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

// Authored rows are structure, not axis ticks; thinning them would detach task names from bars.
export const GLYPH_CHART_GANTT = Symbol("glyph-chart-gantt");
export interface GlyphChartGanttRow { readonly key: string; readonly label: string; readonly section: boolean; readonly status?: string }
export const GLYPH_CHART_GANTT_TICKS = Symbol("glyph-chart-gantt-ticks");
const units = ["millisecond", "second", "minute", "hour", "day", "week", "month", "quarter", "year"] as const;
type TickUnit = typeof units[number];
export type GlyphChartGanttSpec = GlyphChartSpec & {
  readonly [GLYPH_CHART_GANTT]?: readonly GlyphChartGanttRow[];
  readonly [GLYPH_CHART_GANTT_TICKS]?: TickUnit;
};

/** Use the coarser of authored date precision and displayed tick precision. Literal tokens do not add precision. */
export function glyphGanttTickGranularity(dateFormat: string, axisFormat: string): TickUnit {
  const date = dateFormat.replace(/\[[^\]]*\]/g, "");
  const axis = [...axisFormat.matchAll(/%([-_0])?([a-zA-Z%])/g)].map((m) => m[2]).join("");
  const dateUnit = /[Sx]/.test(date) ? 0 : /[sX]/.test(date) ? 1 : /m/.test(date) ? 2 : /[HhAa]/.test(date) ? 3 : /D/.test(date) ? 4 : /M/.test(date) ? 6 : /Q/.test(date) ? 7 : 8;
  const axisUnit = /[fLQ]/.test(axis) ? 0 : /[sScX]/.test(axis) ? 1 : /M/.test(axis) ? 2 : /[HIp]/.test(axis) ? 3 : /[aAdejuwx]/.test(axis) ? 4 : /[UVW]/.test(axis) ? 5 : /[bBm]/.test(axis) ? 6 : /q/.test(axis) ? 7 : 8;
  return units[Math.max(dateUnit, axisUnit)]!;
}

/** Quantize the native ladder before label layout, rather than reporting ordinary repeated dates as lost labels. */
export function fitGlyphGanttTicks(spec: GlyphChartGanttSpec, scale: GlyphChartResolvedScale): GlyphChartResolvedScale {
  const unit = spec[GLYPH_CHART_GANTT_TICKS];
  if (!unit || scale.type !== "time") return scale;
  const rank = units.indexOf(unit);
  const floor = (value: Date) => {
    const d = new Date(value);
    if (rank >= 1) d.setMilliseconds(0);
    if (rank >= 2) d.setSeconds(0);
    if (rank >= 3) d.setMinutes(0);
    if (rank >= 4) d.setHours(0);
    if (unit === "week") d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    if (rank >= 6) d.setDate(1);
    if (unit === "quarter") d.setMonth(Math.floor(d.getMonth() / 3) * 3);
    if (unit === "year") d.setMonth(0);
    return d;
  };
  return { ...scale, ticks: (count) => {
    if (count === 0) return [];
    const [start, end] = scale.domain.map(Number), lo = Math.min(start!, end!), hi = Math.max(start!, end!);
    const candidates = new Map<number, Date>();
    for (const tick of scale.ticks(count)) {
      const value = floor(tick.value as Date), time = +value;
      if (time >= lo && time <= hi) candidates.set(time, value);
    }
    // A short interval wholly inside one calendar unit still needs its date anchor.
    if (!candidates.size) candidates.set(lo, new Date(lo));
    return [...candidates.values()].map((value) => ({ value, fraction: scale.toFraction(value), label: scale.format(value) }));
  } };
}

export function layoutGlyphGantt(spec: GlyphChartGanttSpec, layout: GlyphChartLayout, scale: number, charset: GlyphChartCharset, ledger: GlyphChartLedgerEntry[]): GlyphChartLayout {
  const authored = spec[GLYPH_CHART_GANTT];
  if (!authored) return layout;
  const bands = new Map<string, readonly [number, number]>(), ticks: GlyphChartLayoutTick[] = [];
  const statusWidth = Math.max(0, ...authored.map((row) => (row.status?.length ?? 0))) * scale;
  const boundaries: number[] = [];
  let naturalY = layout.plot.y0, sectionCount = 0;
  authored.forEach((row, i) => {
    if (i > 0 && !authored[i - 1]!.section) boundaries.push(naturalY);
    if (row.section && sectionCount++ > 0) naturalY += scale;
    naturalY += scale;
  });
  const space = glyphChartRowSpacing(naturalY, layout.xAxisLineRow, boundaries, scale);
  let y = layout.plot.y0, sections = 0;
  for (const row of authored) {
    if (row.section && sections++ > 0) y += scale;
    const rowY = space(y);
    const fits = rowY + scale - 1 < layout.xAxisLineRow;
    bands.set(row.key, fits ? [rowY, rowY + scale - 1] : [-scale, -1]);
    if (fits) {
      const indent = row.section ? 0 : 2 * scale;
      const statusSpace = statusWidth ? statusWidth + 2 * scale : 0;
      const width = row.section ? layout.cols : Math.max(0, layout.plot.x0 - indent - statusSpace);
      const text = chartText(row.label, charset, { ledger, role: row.section ? "Gantt section" : "Gantt task" }), words = text.split(/\s+/);
      let label = "";
      for (const word of words) {
        const next = label ? `${label} ${word}` : word;
        if (next.length * scale > width) break;
        label = next;
      }
      if (label !== text) ledger.push(ledgerMermaidDegraded({ feature: "Gantt row label outside its column", replacement: "the longest fitting whole-word prefix", row: row.label }));
      if (!row.section && statusWidth) label = `${label.padStart(width / scale)}  ${(row.status ?? "").padEnd(statusWidth / scale)}`;
      ticks.push({ value: row.key, label, cell: rowY, labelStart: row.section ? 0 : Math.max(indent, layout.plot.x0 - label.length * scale) });
    } else ledger.push(ledgerMermaidDegraded({ feature: "Gantt row outside the viewport", replacement: "an omitted complete row", row: row.label }));
    y += scale;
  }
  return { ...layout, gantt: true, yTicks: ticks, horizontalBarBands: bands };
}
