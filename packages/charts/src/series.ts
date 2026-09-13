import type { GlyphCanvasLineStyle } from "glyphcss";
import { ledgerMarkColorUnused, ledgerSeriesColorConflict, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartResolvedMark } from "./resolve";
import type { GlyphChartCharset, GlyphChartMarkRow } from "./types";

export const SERIES_STYLES: readonly GlyphCanvasLineStyle[] = ["solid", "dashed", "dotted", "double"];
export const SERIES_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#ec4899"];

/**
 * A mark's own `options.color` (a single canonical hex or an array assigned
 * per series in series order, cycling if shorter — AGENTS.md's "Charts"
 * "Colours" contract) resolved at ONE series' position within its own mark
 * (`chartSeries`' own `sliceIndex`, reset per mark — never the shared,
 * cross-mark `styleIndex` a name gets, since the override is a property of
 * THIS mark's own series list). `undefined`/no override is `null`, so a
 * caller falls back to the shared palette.
 */
function resolveMarkColorAt(color: string | readonly string[] | undefined, indexInMark: number): string | null {
  if (color === undefined) return null;
  const arr = typeof color === "string" ? [color] : color;
  if (arr.length === 0) return null;
  return arr[indexInMark % arr.length]!;
}

/**
 * One series' final colour: its own mark-level override when it has one,
 * else the shared palette by its cross-mark `styleIndex` — `null` whenever
 * colour is off, so every call site that used to read `PALETTE[i %
 * PALETTE.length]` directly (paint.ts, flowMarks.ts) shares this one rule
 * instead of re-deriving it.
 */
export function resolveSeriesColor(entry: { readonly color: string | null; readonly styleIndex: number }, enabled: boolean): string | null {
  if (!enabled) return null;
  return entry.color ?? SERIES_COLORS[entry.styleIndex % SERIES_COLORS.length]!;
}
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
  /** This series' own mark-level colour override, or `null` for none — see `resolveMarkColorAt`/`resolveSeriesColor`. */
  readonly color: string | null;
}

/**
 * One grouping drives geometry, metadata and legend: their identities must
 * agree. `ledger` is optional — `paintGlyphChart`'s own call is the ONE
 * place `mark-color-unused` is reported (a caller like `seriesNames`/
 * `chartSeriesColors` re-derives the same series list for a different
 * purpose and must not double-report it).
 */
export function chartSeries(marks: readonly GlyphChartResolvedMark[], ledger?: GlyphChartLedgerEntry[]): ChartSeries[] {
  const named = new Map<string, number>();
  const out: ChartSeries[] = [];
  for (const resolved of marks) {
    const { mark, rows } = resolved;
    // `sankey`/`funnel` are non-cartesian, like `arc` (AGENTS.md's "Charts"
    // section) — a sankey groups by SOURCE node (`row.x`, one legend entry
    // per source), a funnel groups by STAGE (`row.x`, one entry per stage,
    // in the given order since a `Map`'s insertion order is first-appearance
    // order and every row's `row.x` is normally distinct).
    const canGroup = ["line", "area", "bar", "dot", "rect", "arc", "sankey", "funnel"].includes(mark.type);
    const channel = canGroup && mark.type !== "sankey" && mark.type !== "funnel" ? (["fill", "stroke"] as const).find((c) => rows.some((r) => typeof r[c] === "string")) : undefined;
    const groups = new Map<string | undefined, GlyphChartMarkRow[]>();
    for (const row of rows) {
      // Nonpositive arc values occupy no angle and need no swatch; an all-zero pie stays empty.
      if (mark.type === "arc" && !(typeof row.y === "number" && Number.isFinite(row.y) && row.y > 0)) continue;
      const name = mark.type === "arc" ? String(row.fill ?? row.label ?? row.index)
        : mark.type === "sankey" || mark.type === "funnel" ? String(row.x)
        : channel ? String(row[channel])
        : mark.options?.name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(row);
    }
    if (!groups.size && !["arc", "sankey", "funnel"].includes(mark.type)) groups.set(mark.options?.name, []);
    let sliceIndex = 0;
    for (const [name, seriesRows] of groups) {
      if (name !== undefined && !named.has(name)) named.set(name, named.size);
      const shadeIndex = sliceIndex > 0 && sliceIndex === groups.size - 1 && sliceIndex % SERIES_STYLES.length === 0 ? sliceIndex + 1 : sliceIndex;
      const color = resolveMarkColorAt(mark.options?.color, sliceIndex);
      out.push({ ...resolved, rows: seriesRows, name, styleIndex: name === undefined ? 0 : named.get(name)!, color, ...(mark.type === "arc" ? { shadeIndex } : {}) });
      sliceIndex++;
    }
    // `cell` always produces exactly ONE series (its rows are never split by
    // name — see `paint.ts`'s own doc at `paintCell`), so `groups.size` here
    // is always 1 and can't tell "one ink colour" (used) from "[loss, gain]"
    // on a diverging domain (also 1 series, 2 colours legitimately used) —
    // `paintGlyphChart`'s own cell branch reports this mark's unused colours
    // instead, once it knows whether the domain is signed.
    if (ledger && mark.type !== "cell" && mark.options?.color !== undefined) {
      const arr = typeof mark.options.color === "string" ? [mark.options.color] : mark.options.color;
      if (arr.length > groups.size) ledger.push(ledgerMarkColorUnused({ markType: mark.type, provided: arr.length, used: groups.size }));
    }
  }
  // A series NAME is one identity shared across every mark that names it
  // (this file's own header, above: "their identities must agree") — so its
  // colour is resolved ONCE, by name, first-appearance order (the same rule
  // `chartSeriesColors` already applies for the legend), never by each
  // mark's own `sliceIndex` position. Without this, mark A's "B" and mark
  // B's "B" could paint two different colours under one legend swatch, with
  // nothing in `report.ledger` to say so (review finding P2-2).
  const namedColor = new Map<string, string>();
  const namedExplicit = new Map<string, string>();
  for (const s of out) {
    if (s.name === undefined) continue;
    if (!namedColor.has(s.name)) namedColor.set(s.name, s.color ?? SERIES_COLORS[s.styleIndex % SERIES_COLORS.length]!);
    if (s.color !== null) {
      const prior = namedExplicit.get(s.name);
      if (prior === undefined) namedExplicit.set(s.name, s.color);
      // Only two EXPLICIT overrides disagreeing counts as a conflict — a
      // name whose first occurrence had no override at all simply adopts
      // whatever colour (override or palette default) that first
      // occurrence resolved to, exactly like `chartSeriesColors` already
      // does; that is a silent "first wins", not a disagreement to log.
      else if (prior !== s.color && ledger) ledger.push(ledgerSeriesColorConflict({ name: s.name, kept: prior, rejected: s.color }));
    }
  }
  return out.map((s) => s.name === undefined ? s : { ...s, color: namedColor.get(s.name)! });
}

/**
 * One resolved colour per distinct series NAME, in first-appearance order —
 * what a legend swatch (and any other name-keyed colour lookup) shares, so
 * overriding a mark's `options.color` repaints its legend entry too. Reuses
 * `chartSeries`' own resolution (never a second colour rule) and reports no
 * ledger entries of its own — `paintGlyphChart`'s own `chartSeries(marks,
 * ledger)` call is the one that reports `mark-color-unused`.
 */
export function chartSeriesColors(marks: readonly GlyphChartResolvedMark[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const s of chartSeries(marks)) {
    if (s.name !== undefined && !map.has(s.name)) map.set(s.name, resolveSeriesColor(s, true)!);
  }
  return map;
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
