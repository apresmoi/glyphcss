import type { GlyphCanvasLineStyle } from "glyphcss";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartCharset, GlyphChartMarkRow } from "./types";

export const SERIES_STYLES: readonly GlyphCanvasLineStyle[] = ["solid", "dashed", "dotted", "double"];
export const SERIES_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#ec4899"];
export function seriesDot(tier: string, index: number): string {
  return (tier === "ascii" ? ["o", "x", "+", "*"] : ["●", "×", "+", "◆"])[index % 4]!;
}
const SHADE_RAMPS: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: ["#", "%", "+", "."],
  box: ["█", "▓", "▒", "░"],
  blocks: ["█", "▓", "▒", "░"],
  braille: ["█", "▓", "▒", "░"],
};
/** Categorical fills use the same four-style cycle as lines, independent of colour. */
export function seriesShade(tier: GlyphChartCharset, index: number): string {
  const ramp = SHADE_RAMPS[tier];
  return ramp[index % ramp.length]!;
}
export interface ChartSeries extends GlyphChartResolvedMark {
  readonly name?: string;
  readonly styleIndex: number;
  /** Arc-local cycle: the closing slice must also differ from the opening one. */
  readonly shadeIndex?: number;
}

/** One grouping drives geometry, metadata and legend: their identities must agree. */
export function chartSeries(marks: readonly GlyphChartResolvedMark[]): ChartSeries[] {
  const named = new Map<string, number>();
  const out: ChartSeries[] = [];
  for (const resolved of marks) {
    const { mark, rows } = resolved;
    const canGroup = ["line", "area", "bar", "dot", "rect", "arc"].includes(mark.type);
    const channel = canGroup ? (["fill", "stroke"] as const).find((c) => rows.some((r) => typeof r[c] === "string")) : undefined;
    const groups = new Map<string | undefined, GlyphChartMarkRow[]>();
    for (const row of rows) {
      // Nonpositive arc values occupy no angle and need no swatch; an all-zero pie stays empty.
      if (mark.type === "arc" && !(typeof row.y === "number" && Number.isFinite(row.y) && row.y > 0)) continue;
      const name = canGroup && mark.type === "arc" ? String(row.fill ?? row.label ?? row.index) : channel ? String(row[channel]) : mark.options?.name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(row);
    }
    if (!groups.size && mark.type !== "arc") groups.set(mark.options?.name, []);
    let sliceIndex = 0;
    for (const [name, seriesRows] of groups) {
      if (name !== undefined && !named.has(name)) named.set(name, named.size);
      const shadeIndex = sliceIndex > 0 && sliceIndex === groups.size - 1 && sliceIndex % SERIES_STYLES.length === 0 ? sliceIndex + 1 : sliceIndex;
      out.push({ ...resolved, rows: seriesRows, name, styleIndex: name === undefined ? 0 : named.get(name)!, ...(mark.type === "arc" ? { shadeIndex } : {}) });
      sliceIndex++;
    }
  }
  return out;
}

/** An unnamed stack's kth occurrence at each x belongs to its kth layer. */
export function areaLayers(rows: readonly GlyphChartMarkRow[]): GlyphChartMarkRow[][] {
  if (!rows.some((r) => r.y1 !== undefined)) return [[...rows]];
  const counts = new Map<unknown, number>();
  const layers: GlyphChartMarkRow[][] = [];
  for (const row of rows) {
    const key = row.x instanceof Date ? row.x.getTime() : row.x;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    (layers[n] ??= []).push(row);
  }
  return layers;
}
