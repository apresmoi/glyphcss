/**
 * Post-processing for the `html` exit `@glyphcss/charts`' `renderGlyphChart`
 * produces — used by `chartsWorkbenchRender.ts`'s web-target text-scale fix
 * (CHARTS-RESEARCH `REVIEW-batch4-codex.md` P1-3 / `-fable.md` P1-5/P2-1,
 * N1/N2 `REVIEW-batch4-fixes-opus.md`). The library now emits `.glyph-text`
 * scaled-text markup for the CALLER's own requested colour mode whenever
 * `textScale > 1` (`packages/charts/src/render.ts`'s own doc — N2), so this
 * module no longer strips or requantizes colour on the page side at all;
 * `correctChartHtmlTextScale` below is the one thing that remains genuinely
 * page-owned, because only the page knows the slider's FRACTIONAL density —
 * the library's own `textScale` must stay the positive integer it laid
 * reserved cells out at.
 */

/**
 * Corrects a `.glyph-text` span's baked-in `display:inline-block;
 * font-size:Nem;line-height:calc(1 / N);width:1ch` quadruple — `N` the
 * integer `textScale` the LAYOUT reserved cells at (`renderGlyphChart`
 * requires a positive integer, `validateGlyphChartTextScale`) — to the
 * exact fractional em Density's own slider asked for (CHARTS-RESEARCH
 * `REVIEW-batch4-fable.md` P2-1): `textScale = round(density)` holds the
 * on-screen glyph at the page's own logical 13px only when `density` is
 * already an integer (13/d px base font × N em = 13px only at N === d);
 * at every other step (1.25, 1.5, 1.75, …) it reads 0.8×-1.33× off.
 *
 * `width` must be corrected in the SAME pass as `font-size` (N1,
 * CHARTS-RESEARCH `REVIEW-batch4-fixes-opus.md`): the library's own
 * `width:1ch` reserves exactly `N` ancestor cells ONLY while `font-size`
 * stays at `Nem` — `ch` is measured at THIS element's own (already scaled)
 * font-size, so shrinking `font-size` alone shrinks the reservation right
 * along with the glyph, and nothing else in the row's flow holds the
 * vacated space (every row after the origin's own drifted left, up to
 * 24.9 cells measured at `d = 2.5` before this fix). Re-deriving the
 * reservation from the CAPTURED `N` and the new `logicalEm` —
 * `calc(N / logicalEm * 1ch)` — keeps it pinned at `N` ancestor cells
 * regardless of what size the glyph itself paints at: at `logicalEm`'s own
 * (scaled) font-size, `1ch` already equals `logicalEm` ancestor cells, so
 * dividing by `logicalEm` before multiplying by the reserved `N` cancels
 * the scale back out exactly (`(N / logicalEm) * (logicalEm * baseCh) ===
 * N * baseCh`).
 *
 * A no-op when `logicalEm === textScale` (every integer density, including
 * the library's own baseline `width:1ch`), so the byte-identical case
 * takes no extra regex pass.
 */
const TEXT_SCALE_STYLE = /display:inline-block;font-size:(\d+)em;line-height:calc\(1 \/ \1\);width:1ch/g;

export function correctChartHtmlTextScale(html: string, textScale: number, logicalEm: number): string {
  if (logicalEm === textScale) return html;
  return html.replace(
    TEXT_SCALE_STYLE,
    (_match, capturedScale: string) =>
      `display:inline-block;font-size:${logicalEm}em;line-height:calc(1 / ${logicalEm});width:calc(${capturedScale} / ${logicalEm} * 1ch)`,
  );
}
