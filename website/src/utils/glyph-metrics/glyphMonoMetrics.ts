/**
 * Glyph Mono's own measured advance/line-height ratio at `line-height: 1`
 * (the font every `web`-target `<pre>` on this site renders in —
 * AGENTS.md's "Targets and page" — measured with fontTools against
 * `glyph-mono.woff2`, 1200/2048 em; identical to `@glyphcss/charts`' own
 * `GLYPH_CHART_TARGET_DEFAULTS.web.cellAspect`, which was derived from the
 * exact same measurement, see AGENTS.md's "Arc shape and callouts"). It is
 * a property of the FONT FILE, not of any one page's render — `/diagrams`
 * has no `cellAspect` concept of its own (`GLYPH_DIAGRAM_TARGET_DEFAULTS`
 * carries none; `@glyphcss/diagrams`' canvas is built at the library's
 * plain default of 0.5), so this constant is what both `/charts`' and
 * `/diagrams`' own web-viewport-fill cell-count math share — converting a
 * measured pixel box into a cell count needs the font's REAL screen
 * geometry, never the diagram package's unrelated internal circle-drawing
 * default.
 */
export const GLYPH_MONO_WEB_CELL_ASPECT = 0.5859375;

/** A measured pixel box — the render's available viewport area on `web`,
 *  content-box only (no padding/border), `null` before the first real
 *  measurement lands (SSR, initial mount with no `ResizeObserver` support). */
export interface GlyphPixelBox {
  readonly width: number;
  readonly height: number;
}

/**
 * Converts a measured viewport pixel box into a cell grid size for a `web`
 * render — the SAME "font-size divides by density, render grid multiplies
 * by density, the on-screen box holds still" rule `chartsWorkbenchState.ts`'s
 * "Density" section already documents, just solved the other way: instead
 * of a fixed logical cell count scaled up, the cell count is DERIVED from
 * the real pixel box and the current (density-shrunk) cell size, so the
 * grid always exactly fills whatever box the reader's viewport actually
 * gives it — no fixed 96x32 grid smaller than the screen, and no grid
 * larger than it either.
 *
 * `baseFontPx` is the target's own UNSCALED font-size (`web`'s `13px`
 * base, `chartsWorkbenchState.ts`'s `CHARTS_DENSITY_BASE_FONT_PX`) —
 * `density` divides it exactly as the live `<pre>`'s own inline
 * `font-size: calc(<base>px / <density>)` does, so this reproduces the
 * SAME cell pixel size the browser is actually rendering at, never an
 * independent guess.
 */
export function glyphMonoWebGridSize(
  viewportPx: GlyphPixelBox,
  baseFontPx: number,
  density: number,
): { width: number; height: number } {
  const fontSizePx = baseFontPx / density;
  const cellWidthPx = fontSizePx * GLYPH_MONO_WEB_CELL_ASPECT;
  const cellHeightPx = fontSizePx;
  return {
    width: Math.max(1, Math.floor(viewportPx.width / cellWidthPx)),
    height: Math.max(1, Math.floor(viewportPx.height / cellHeightPx)),
  };
}
