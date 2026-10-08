import { normalizeGlyphChartInput } from "./spec";
import { validateGlyphChartSpec } from "./validate";
import { resolveGlyphChartSpec } from "./resolve";
import { chartSeries, resolveSeriesColor } from "./series";
import type { GlyphChartColorMode, GlyphChartInput, GlyphChartMark } from "./types";

export interface GlyphChartSeriesPreviewEntry {
  /** The series' display name — a categorical fill/stroke value, an arc
   *  slice/sankey node/funnel stage name, or the mark's own `options.name`.
   *  A single-series mark with no name of its own falls back to `Mark <n>`
   *  (1-based `markIndex + 1`), so a caller driving one swatch per mark
   *  never has to special-case the unnamed case. A funnel's own repeated
   *  stage names are disambiguated ("Retry", "Retry (2)", …) so every
   *  entry's name is unique within its mark (`series.ts`'s `chartSeries`),
   *  matching `meta.series` exactly for that mark. */
  readonly name: string;
  /** Index into the INPUT's own `marks` array this series belongs to. */
  readonly markIndex: number;
  /** The shared, cross-mark style/palette index `paintGlyphChart` itself
   *  cycles line styles and the default colour palette on. */
  readonly styleIndex: number;
  /** This series' own mark-level `options.color` override when it has one,
   *  else the shared default palette entry at `styleIndex` — exactly like
   *  `resolveSeriesColor`, and `null` under `options.color: "none"` (see
   *  `GlyphChartSeriesPreviewOptions.color`), matching a real render's own
   *  `renderGlyphChart(..., { color: "none" })` paint nothing. */
  readonly color: string | null;
}

/** The subset of `GlyphChartRenderOptions` that changes what colour a
 *  series would resolve to — nothing else (target/charset/width/…) affects
 *  identity or colour, so `glyphChartSeriesPreview` takes only this. */
export interface GlyphChartSeriesPreviewOptions {
  /** Default: colour enabled (as if the caller had not chosen `"none"`) —
   *  a caller with no colour mode of its own (an agent, a script) gets the
   *  library's real default palette back, matching this function's
   *  behaviour before this option existed. Pass the SAME `color` the
   *  eventual `renderGlyphChart` call will use (`"none"` in particular) so
   *  a preview never claims a colour the render itself won't paint. */
  readonly color?: GlyphChartColorMode;
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
 * "Colours").
 *
 * Throws only a TAGGED error (`normalizeGlyphChartInput`'s `bad-chart-input`
 * for a malformed shape, or a `GLYPH_CHART_VALIDATION_RULES` id from
 * `validateGlyphChartSpec`) — never a raw, uncoded `TypeError` naming a
 * different entry point.
 */
export function glyphChartSeriesPreview(input: GlyphChartInput, options: GlyphChartSeriesPreviewOptions = {}): readonly GlyphChartSeriesPreviewEntry[] {
  const colorEnabled = options.color !== "none";
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
      color: resolveSeriesColor(series, colorEnabled),
    };
  });
}
