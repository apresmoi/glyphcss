import type { GlyphCanvasLineStyle } from "glyphcss";
import { ledgerMarkColorUnused, ledgerSeriesColorConflict, ledgerSeriesShadeRepeat, type GlyphChartLedgerEntry } from "./ledger";
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

/**
 * Categorical fills use SHAPE-FAMILY glyphs, never a single density ramp
 * (CHARTS-RESEARCH `DIAGNOSIS-pie-contrast.md` C1/C2, measured ink coverage
 * per glyph in Glyph Mono/Menlo/SF Mono, `fixtures/glyphInkCoverage.json`):
 * a 4-step density-only cycle (the old `█ ▓ ▒ ░`/`# % + .`) fails a 0.15
 * adjacent-pair coverage gap in every measured monospace font, and ASCII's
 * WHOLE repertoire spans only 0.03-0.32 coverage there — four density steps
 * cannot exist in ANY font, so density alone can never carry ASCII. Adjacent
 * glyphs differ in ORIENTATION (solid / stipple / diagonal / vertical /
 * horizontal / checker) so a reader tells slices apart by shape, not shade.
 * `box`/`blocks`/`braille` share one 8-glyph set, prefix-consistent — an
 * n-series chart uses the first n, so growing from 4 to 5 series never
 * changes the first four. ASCII alone needs two tables: a density-first
 * 4-set (`# . @ -`) clears a >=0.15 gap in every measured font but ASCII
 * cannot sustain that past 4 entries, so a total over 4 switches to the
 * shape-first 8-set (`# . = / @ : | -`) — NOT a superset of the 4-set
 * (index 3 is `-` in one, `/` in the other), because the two orderings
 * optimise different, conflicting objectives.
 */
const SHADE_RAMPS: Readonly<Record<GlyphChartCharset, readonly string[]>> = {
  ascii: ["#", ".", "=", "/", "@", ":", "|", "-"],
  box: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
  blocks: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
  braille: ["█", "░", "▚", "╱", "▌", "═", "▓", "▒"],
};
const ASCII_SHADE_COMPACT: readonly string[] = ["#", ".", "@", "-"];

/** Every charset's shade family is this many glyphs long — the point past which `seriesShade` wraps and two series can share a fill. */
export const GLYPH_CHART_SHADE_CYCLE_LENGTH = SHADE_RAMPS.box.length;

/**
 * `total` is the number of series sharing this one cycle (the caller's own
 * slice/group count) — needed only to pick ASCII's compact-vs-extended
 * table (`total <= 4` keeps the denser 4-set); every other charset's ramp
 * is fixed regardless of `total`. Defaults to `index + 1` for a caller with
 * no total to give (a single always-index-0 call, e.g. a `cell` mark's
 * swatch) — a caller with more than one series MUST pass its own real
 * total, since a default derived per-call from `index` alone cannot see
 * that a later index belongs to the same cycle and would silently switch
 * tables mid-cycle. Cycles modulo the active ramp's length past
 * `GLYPH_CHART_SHADE_CYCLE_LENGTH` series; `chartSeries` reports the
 * resulting repeat once per pair via `ledgerSeriesShadeRepeat` — this
 * function itself never throws or logs. `shades` (the render's own `shades`
 * option) replaces the charset's table outright and cycles on its own length.
 */
export function seriesShade(tier: GlyphChartCharset, index: number, total = index + 1, shades?: readonly string[]): string {
  const ramp = shades ?? (tier === "ascii" && total <= ASCII_SHADE_COMPACT.length ? ASCII_SHADE_COMPACT : SHADE_RAMPS[tier]);
  return ramp[index % ramp.length]!;
}
/**
 * A region mark's fill glyph under the render's resolved fill
 * (`regionFill.ts`): a solid block when colour carries series identity, the
 * series' own `seriesShade` texture otherwise. Every region painter and both
 * legend swatch paths go through here, so a swatch always equals its fill.
 * `ascii` stays 7-bit.
 */
export function regionFillGlyph(tier: GlyphChartCharset, index: number, total: number, fill: "solid" | "texture", shades?: readonly string[]): string {
  if (fill === "solid") return tier === "ascii" ? "#" : "█";
  return seriesShade(tier, index, total, shades);
}
export interface ChartSeries extends GlyphChartResolvedMark {
  readonly name?: string;
  readonly styleIndex: number;
  /** Arc-local shade cycle — this slice's own position modulo `GLYPH_CHART_SHADE_CYCLE_LENGTH`, independent of every other arc mark's own slices. */
  readonly shadeIndex?: number;
  /** This series' own mark-level colour override, or `null` for none — see `resolveMarkColorAt`/`resolveSeriesColor`. */
  readonly color: string | null;
}

/**
 * One grouping drives geometry, metadata and legend: their identities must
 * agree. `ledger` is optional — `paintGlyphChart`'s own call is the ONE
 * place `mark-color-unused` is reported (a caller like `seriesNames`/
 * `chartSeriesColors` re-derives the same series list for a different
 * purpose and must not double-report it). `cycle` is the active fill
 * palette's length, so a custom `shades` option wraps (and reports) where
 * its own glyphs run out.
 */
export function chartSeries(marks: readonly GlyphChartResolvedMark[], ledger?: GlyphChartLedgerEntry[], cycle = GLYPH_CHART_SHADE_CYCLE_LENGTH): ChartSeries[] {
  const named = new Map<string, number>();
  const out: ChartSeries[] = [];
  for (const resolved of marks) {
    const { mark, rows } = resolved;
    // `sankey`/`funnel` are non-cartesian, like `arc` (AGENTS.md's "Charts"
    // section) — a sankey groups by SOURCE node (`row.x`, one legend entry
    // per source), a funnel groups by STAGE (`row.x`, one entry per stage,
    // in the given order since a `Map`'s insertion order is first-appearance
    // order). `canGroup` never includes them: the `channel` lookup right
    // below is unconditionally excluded for both types anyway (the ternary's
    // own `mark.type !== "sankey" && mark.type !== "funnel"` clause), so
    // adding them here was dead — verified by mutation (a prior review found
    // deleting them from a since-removed 3-way inclusion changed no test).
    const canGroup = ["line", "area", "bar", "dot", "rect", "arc"].includes(mark.type);
    const channel = canGroup ? (["fill", "stroke"] as const).find((c) => rows.some((r) => typeof r[c] === "string")) : undefined;
    const groups = new Map<string | undefined, GlyphChartMarkRow[]>();
    const displayNameByGroupKey = new Map<string | undefined, string | undefined>();
    for (const row of rows) {
      // Nonpositive arc values occupy no angle and need no swatch; an all-zero pie stays empty.
      if (mark.type === "arc" && !(typeof row.y === "number" && Number.isFinite(row.y) && row.y > 0)) continue;
      const name = mark.type === "arc" ? String(row.fill ?? row.label ?? row.index)
        : mark.type === "sankey" || mark.type === "funnel" ? String(row.x)
        : channel ? String(row[channel])
        : mark.options?.name;
      // A funnel keys each STAGE by its own row, never by name (P2-4): two
      // stages that happen to share a label (two "Retry" steps, or a
      // repeated category) are still two rows, and grouping by name alone
      // silently merged the second into the first's group, where only
      // `g.rows[0]` is ever painted — dropping it with no ledger entry. The
      // DISPLAYED name/legend/colour identity is still `name`, tracked
      // separately in `displayNameByGroupKey`.
      const groupKey = mark.type === "funnel" ? String(row.index) : name;
      if (!groups.has(groupKey)) { groups.set(groupKey, []); displayNameByGroupKey.set(groupKey, name); }
      groups.get(groupKey)!.push(row);
    }
    if (!groups.size && !["arc", "sankey", "funnel"].includes(mark.type)) { groups.set(mark.options?.name, []); displayNameByGroupKey.set(mark.options?.name, mark.options?.name); }
    // A funnel's `groupKey` (row index) can disagree with its display
    // `name` (two "Retry" stages are two rows, one name) — everywhere
    // else `groupKey === name`, so two groups can never legitimately share
    // a name. Left alone, that shared name flows into the cross-mark
    // `named`/`namedColor` pooling below (whose whole POINT is "one name,
    // one identity"), which then silently re-merges the two stages'
    // colours after `chartSeries` just went out of its way to keep them as
    // two rows — the exact NEW-3 defect (a `glyphChartSeriesPreview` entry
    // count exceeding `meta.series`, a duplicate legend/swatch key, and a
    // swatch edit on the second stage snapping back to the first's colour).
    // Suffixing every repeat occurrence ("Retry", "Retry (2)", …) in
    // FIRST-SEEN order gives each row its own honest identity, so it also
    // becomes the label `paintFunnelMark` paints for that stage — which is
    // correct, not a side effect: two stages drawn identically labelled
    // were already ambiguous on the chart itself.
    if (mark.type === "funnel") {
      // AUTHORED names (every original label, including one that already
      // looks like a generated suffix, e.g. a genuine "A (2)" stage) are
      // reserved up front, so a COUNT-based candidate this loop is about to
      // mint can never collide with one — the residual collision a plain
      // "count occurrences" pass leaves behind: `["A","A","A (2)"]` used to
      // rename the second "A" to "A (2)", landing squarely on the THIRD
      // stage's own authored name, so two rows (both drawn, coloured and
      // keyed identically) shared one display name while `meta.series` and
      // `chartSeries`' own `named` pool only ever saw one of them.
      const reserved = new Set(displayNameByGroupKey.values());
      const seen = new Map<string, number>();
      for (const [groupKey, name] of displayNameByGroupKey) {
        if (name === undefined) continue;
        let count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        if (count > 1) {
          let candidate = `${name} (${count})`;
          while (reserved.has(candidate)) {
            count++;
            seen.set(name, count);
            candidate = `${name} (${count})`;
          }
          displayNameByGroupKey.set(groupKey, candidate);
          reserved.add(candidate);
        }
      }
    }
    let sliceIndex = 0;
    // Named per arc-local `shadeIndex` (or a synthetic "slice N" for an
    // unnamed one) — collected only to report a wrap-around repeat below;
    // a mark with <= GLYPH_CHART_SHADE_CYCLE_LENGTH slices never reads it.
    const arcSliceNames: string[] = [];
    for (const [groupKey, seriesRows] of groups) {
      const name = displayNameByGroupKey.get(groupKey);
      if (name !== undefined && !named.has(name)) named.set(name, named.size);
      const shadeIndex = sliceIndex % cycle;
      const color = resolveMarkColorAt(mark.options?.color, sliceIndex);
      out.push({ ...resolved, rows: seriesRows, name, styleIndex: name === undefined ? 0 : named.get(name)!, color, ...(mark.type === "arc" ? { shadeIndex } : {}) });
      if (mark.type === "arc") arcSliceNames.push(name ?? `slice ${sliceIndex + 1}`);
      sliceIndex++;
    }
    // A pie's own slices cycle `seriesShade` independently of every other
    // mark (`shadeIndex` is arc-local, never the cross-mark `styleIndex`) —
    // past GLYPH_CHART_SHADE_CYCLE_LENGTH slices the fill glyph repeats,
    // and unlike a colour (which just runs out of hues gracefully) a
    // repeated monochrome fill makes two categories genuinely
    // indistinguishable with colour off, so it is reported, once per pair.
    if (ledger) {
      for (let i = cycle; i < arcSliceNames.length; i++) {
        ledger.push(ledgerSeriesShadeRepeat({ repeated: arcSliceNames[i]!, reused: arcSliceNames[i % cycle]! }));
      }
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
  // Region marks (bar/rect/area/cell/sankey/funnel) paint their fill via
  // `seriesShade(tier, styleIndex)` — the CROSS-MARK `named` index, never
  // an arc's own local `shadeIndex` — so a wrap here is a wrap of that
  // shared identity: a "Revenue" bar and a "Revenue" rect both use the
  // same glyph by design, but a NINTH distinct named region series reuses
  // the first's. Only the region-mark types actually consult `seriesShade`
  // for their fill (a line/dot's own name may sit at the same `styleIndex`
  // with no collision at all — it cycles line styles or dot glyphs on a
  // different, unrelated period), so only they are checked here.
  if (ledger) {
    const REGION_SHADE_MARK_TYPES = new Set(["bar", "rect", "area", "cell", "sankey", "funnel"]);
    const nameByShadeIndex = new Map<number, string>();
    for (const s of out) {
      if (s.name === undefined || !REGION_SHADE_MARK_TYPES.has(s.mark.type)) continue;
      if (!nameByShadeIndex.has(s.styleIndex)) nameByShadeIndex.set(s.styleIndex, s.name);
    }
    const reported = new Set<number>();
    for (const [index, name] of nameByShadeIndex) {
      if (index < cycle || reported.has(index)) continue;
      const reused = nameByShadeIndex.get(index % cycle);
      if (reused === undefined) continue;
      reported.add(index);
      ledger.push(ledgerSeriesShadeRepeat({ repeated: name, reused }));
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
