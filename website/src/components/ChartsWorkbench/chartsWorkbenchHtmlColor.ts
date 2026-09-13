/**
 * Post-processing for the `html` exit `@glyphcss/charts`' `renderGlyphChart`
 * produces — used ONLY by `chartsWorkbenchRender.ts`'s web-target text-
 * scale fix (CHARTS-RESEARCH `REVIEW-batch4-codex.md` P1-3 / `-fable.md`
 * P1-5/P2-1): the library only emits `.glyph-text` scaled-text spans (the
 * `html` exit) when `color: "css"` is requested
 * (`packages/charts/src/render.ts` — `html` is populated only inside the
 * `color === "css"` branch), so a web-target render under `none` or an
 * ANSI colour mode never carries them — Density's own `textScale`
 * (AGENTS.md's "Charts" "Density") then shrinks every label along with
 * the marks, since the page's own font-size halving has nothing to
 * counteract it there.
 *
 * `layoutGlyphChart` never reads `color` (the pipeline is
 * `validate → transforms → scales → layout → paint → encode`, colour only
 * reaches the last two stages), so an `html` render taken at `color: "css"`
 * carries the IDENTICAL tick/title/legend layout — which cells are scaled-
 * text origins, and at what integer `textScale` — as the actually
 * requested colour mode would, whether or not that mode's own render can
 * itself produce `html`. `chartsWorkbenchRender.ts` takes that `css` render
 * purely to recover the scaled markup, then adapts its COLOUR to the
 * requested mode with the functions below rather than trusting its
 * content — stripped for `none`, requantized to the ANSI palette for
 * `ansi16`/`ansi256` (`truecolor` needs neither: 24-bit is numerically
 * identical to `css`'s own hex, so the caller uses that `html` as-is).
 */

const STYLE_ATTR = /(\s*)style="([^"]*)"/g;
const COLOR_DECL = /(?:^|;)\s*(?:color|background-color):#[0-9a-f]{6}\s*(?=;|$)/gi;
const HEX_COLOR = /#[0-9a-f]{6}/gi;

/**
 * Drops `color`/`background-color` from every `style="…"` attribute in a
 * chart's `html` render, leaving every other declaration (crucially a
 * `.glyph-text` span's `font-size`/`line-height`) untouched — a `color:
 * "none"` preview that still needs the scaled-text markup, since the
 * `css`-forced render this runs against necessarily painted real colour
 * into the canvas to produce `html` at all. A span left with no style
 * (a plain colour-only run) loses its now-pointless `style=""` attribute
 * entirely rather than keeping an empty one.
 */
export function stripChartHtmlColor(html: string): string {
  return html.replace(STYLE_ATTR, (_match, lead: string, style: string) => {
    const kept = style.replace(COLOR_DECL, "").replace(/^;+|;+$/g, "");
    return kept ? `${lead}style="${kept}"` : "";
  });
}

// The standard xterm 16-colour and 256-colour palettes — duplicated from
// `TargetPreview/ansiToSpans.ts` rather than imported (that module's own
// doc explains why: `packages/glyphcss/src/render/canvas/encode.ts` treats
// them as a private encoding detail and exports neither table).
const ANSI_16_RGB: readonly number[] = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
  0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];
const ANSI_256_RGB: readonly number[] = (() => {
  const table = ANSI_16_RGB.slice();
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table.push((levels[r]! << 16) | (levels[g]! << 8) | levels[b]!);
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + 10 * i;
    table.push((v << 16) | (v << 8) | v);
  }
  return table;
})();

/** Redmean colour distance — the same weighted metric AGENTS.md's "Render
 *  modes" cites for `colorTolerance` elsewhere in this codebase, reused
 *  here for visual consistency rather than a plain Euclidean distance. */
function redmean(a: number, b: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const rmean = (ar + br) / 2;
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}
function nearestAnsiHex(hex: string, depth: "16" | "256"): string {
  const table = depth === "16" ? ANSI_16_RGB : ANSI_256_RGB;
  const target = parseInt(hex.slice(1), 16);
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < table.length; i++) {
    const dist = redmean(target, table[i]!);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return `#${table[best]!.toString(16).padStart(6, "0")}`;
}

/**
 * Requantizes every hex colour inside a chart html's `style="…"` attributes
 * to the nearest `16`/`256`-colour ANSI palette entry — an approximate
 * PREVIEW of what the real `ansi16`/`ansi256` encoder would paint (the
 * true `ansi16`/`ansi256`-encoded text, the actual export byte, is
 * computed and returned separately by `chartsWorkbenchRender.ts` and is
 * never touched by this function). `truecolor` needs no requantization —
 * the caller uses the `css` html as-is for it.
 */
export function recolorChartHtmlForAnsiDepth(html: string, depth: "16" | "256"): string {
  return html.replace(STYLE_ATTR, (_match, lead: string, style: string) =>
    `${lead}style="${style.replace(HEX_COLOR, (hex) => nearestAnsiHex(hex, depth))}"`);
}

const TEXT_SCALE_STYLE = /font-size:(\d+)em;line-height:calc\(1 \/ \1\)/g;

/**
 * Corrects a `.glyph-text` span's baked-in `Nem`/`calc(1 / N)` pair — `N`
 * the integer `textScale` the LAYOUT reserved cells at (`renderGlyphChart`
 * requires a positive integer, `validateGlyphChartTextScale`) — to the
 * exact fractional em Density's own slider asked for (CHARTS-RESEARCH
 * `REVIEW-batch4-fable.md` P2-1): `textScale = round(density)` holds the
 * on-screen glyph at the page's own logical 13px only when `density` is
 * already an integer (13/d px base font × N em = 13px only at N === d);
 * at every other step (1.25, 1.5, 1.75, …) it reads 0.8×-1.33× off. The
 * RESERVED spacing (how many cells a scaled label's box occupies) stays
 * at the integer `textScale` the library laid out — only the glyph's own
 * VISUAL size inside that reserved box changes, so a fractional density
 * scales text exactly without needing the library to accept a fractional
 * `textScale` at all. A no-op when `logicalEm === textScale` (every
 * integer density), so the byte-identical case takes no extra regex pass.
 */
export function correctChartHtmlTextScale(html: string, textScale: number, logicalEm: number): string {
  if (logicalEm === textScale) return html;
  return html.replace(TEXT_SCALE_STYLE, `font-size:${logicalEm}em;line-height:calc(1 / ${logicalEm})`);
}
