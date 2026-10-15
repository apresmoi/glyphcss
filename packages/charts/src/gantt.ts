import { chartText } from "./labels";
import { ledgerMermaidDegraded, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartLayout, GlyphChartLayoutTick } from "./layout";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

// Authored rows are structure, not axis ticks; thinning them would detach task names from bars.
export const GLYPH_CHART_GANTT = Symbol("glyph-chart-gantt");
export interface GlyphChartGanttRow { readonly key: string; readonly label: string; readonly section: boolean }
export type GlyphChartGanttSpec = GlyphChartSpec & { readonly [GLYPH_CHART_GANTT]?: readonly GlyphChartGanttRow[] };

export function layoutGlyphGantt(spec: GlyphChartGanttSpec, layout: GlyphChartLayout, scale: number, charset: GlyphChartCharset, ledger: GlyphChartLedgerEntry[]): GlyphChartLayout {
  const authored = spec[GLYPH_CHART_GANTT];
  if (!authored) return layout;
  const bands = new Map<string, readonly [number, number]>(), ticks: GlyphChartLayoutTick[] = [];
  let y = layout.plot.y0, sections = 0;
  for (const row of authored) {
    if (row.section && sections++ > 0) y += scale;
    const fits = y + scale - 1 < layout.xAxisLineRow;
    bands.set(row.key, fits ? [y, y + scale - 1] : [-scale, -1]);
    if (fits) {
      const indent = row.section ? 0 : 2 * scale;
      const width = row.section ? layout.cols : Math.max(0, layout.plot.x0 - indent);
      const text = chartText(row.label, charset), words = text.split(/\s+/);
      let label = "";
      for (const word of words) {
        const next = label ? `${label} ${word}` : word;
        if (next.length * scale > width) break;
        label = next;
      }
      if (label !== text) ledger.push(ledgerMermaidDegraded({ feature: "Gantt row label outside its column", replacement: "the longest fitting whole-word prefix", row: row.label }));
      ticks.push({ value: row.key, label, cell: y, labelStart: row.section ? 0 : Math.max(indent, layout.plot.x0 - label.length * scale) });
    } else ledger.push(ledgerMermaidDegraded({ feature: "Gantt row outside the viewport", replacement: "an omitted complete row", row: row.label }));
    y += scale;
  }
  return { ...layout, yTicks: ticks, horizontalBarBands: bands };
}
