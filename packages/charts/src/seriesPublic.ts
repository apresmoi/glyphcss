import { normalizeGlyphChartInput } from "./spec";
import { validateGlyphChartSpec } from "./validate";
import { resolveGlyphChartSpec } from "./resolve";
import { chartSeries, resolveSeriesColor } from "./series";
import type { GlyphChartInput, GlyphChartMark } from "./types";

export interface GlyphChartSeriesPreviewEntry {
  /** The series' display name — a categorical fill/stroke value, an arc
   *  slice/sankey node/funnel stage name, or the mark's own `options.name`.
   *  A single-series mark with no name of its own falls back to `Mark <n>`
   *  (1-based `markIndex + 1`), so a caller driving one swatch per mark
   *  never has to special-case the unnamed case. */
  readonly name: string;
  /** Index into the INPUT's own `marks` array this series belongs to. */
  readonly markIndex: number;
  /** The shared, cross-mark style/palette index `paintGlyphChart` itself
   *  cycles line styles and the default colour palette on. */
  readonly styleIndex: number;
  /** The colour a real render would paint this series with — its own
   *  mark-level `options.color` override when it has one, else the shared
   *  default palette entry at `styleIndex`, exactly like `resolveSeriesColor`. */
  readonly color: string;
}

/**
 * The per-series identity and resolved colour a real render would paint,
 * computed through the exact `chartSeries`/`resolveSeriesColor` pipeline
 * `paintGlyphChart` uses — transform-aware (`group`/`stack`/`normalize`
 * already applied), a numeric `fill` channel resolves to ONE series exactly
 * like the real render does (never a per-row split), and `styleIndex` is
 * the same cross-mark index the painter shares a name's colour by. Order
 * matches `meta.series` for every series that HAS a name; an unnamed
 * single-series mark still gets exactly one entry so a caller driving one
 * swatch per mark (the `/charts` Dock's mark cards) never has to
 * special-case the single-series case or re-derive series grouping itself
 * — which used to diverge from the real render on a numeric `fill` channel
 * and under `group`/`normalize` transforms (AGENTS.md's "Charts" —
 * "Colours"; see also `docs/design/charts.md`).
 */
export function glyphChartSeriesPreview(input: GlyphChartInput): readonly GlyphChartSeriesPreviewEntry[] {
  const spec = validateGlyphChartSpec(normalizeGlyphChartInput(input));
  const resolved = resolveGlyphChartSpec(spec);
  const markIndexOf = new Map<GlyphChartMark, number>();
  spec.marks.forEach((mark, i) => markIndexOf.set(mark, i));
  return chartSeries(resolved).map((series) => {
    const markIndex = markIndexOf.get(series.mark)!;
    return {
      name: series.name ?? `Mark ${markIndex + 1}`,
      markIndex,
      styleIndex: series.styleIndex,
      color: resolveSeriesColor(series, true)!,
    };
  });
}
