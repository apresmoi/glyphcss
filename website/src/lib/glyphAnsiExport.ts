/**
 * Shared "export the rendered glyph output as ANSI truecolour text" support
 * — the sibling of `asciiClipboard.ts`'s "Copy ASCII" and
 * `glyphSvgExport.ts`'s "Download SVG". glyphcss's render already IS text;
 * SVG wraps that text in a graphics container to do something text already
 * does, while ANSI escape sequences are a native colour format FOR text —
 * `cat`-ing the downloaded `.ans` file in any modern terminal (iTerm2,
 * recent Terminal.app, Windows Terminal, most Linux terminals) renders it
 * exactly as it renders on the page. Both a "Copy ANSI" (clipboard) and a
 * "Download .ans" (file) action are offered, mirroring the existing
 * Copy-ASCII/Download-SVG pairing: a terminal artifact is arguably most
 * useful as a file you can `cat`, but copy is one click for pasting straight
 * into a terminal or another text surface.
 *
 * Builds on the same shared per-cell grid + row-run merge
 * (`glyphExportGrid.ts`) `glyphSvgExport.ts` uses — the two exporters turn
 * an identical merged run into different output (a `<text>`/`<rect>` pair
 * there, an escape sequence here), so the `<pre>` is decoded and its
 * adjacent same-`(color,background)` cells merged exactly once, and both
 * exporters produce identical TEXT and COLOURS for the same render under
 * either `colorEncoding` (`"spans"` or `"atlas"`) — verified in the test
 * file the same way `glyphSvgExport.test.ts` verifies its own parity.
 *
 * ── Truecolour, not the 256-colour cube ──────────────────────────────────
 *
 * glyphcss emits arbitrary hex/rgb colours (Lambert-shaded ramps, palette
 * quantization, atlas slots); the 256-colour cube would quantise those
 * again on top. `38;2;R;G;Bm` (foreground) / `48;2;R;G;Bm` (background) is
 * the ISO-8613-3 truecolour SGR form, widely supported but NOT universal —
 * a terminal without truecolour support (rare today, but e.g. plain Linux
 * `tty`) will misrender or ignore these codes; see the "why this format"
 * callout in the `/synth`/`/wordart` export bar tooltip.
 *
 * ── One escape per colour change, not per cell ───────────────────────────
 *
 * A per-cell escape would multiply file size roughly by the average run
 * length for no visual difference (the same argument that governs
 * `glyphSvgExport.ts`'s one-`<text>`-per-run choice). This file instead
 * tracks the ACTIVE terminal SGR state across a row and only emits an
 * escape when a run's `(color, background)` differs from that state —
 * since {@link glyphExportRuns} already merges same-state adjacent cells,
 * consecutive runs always differ from one another, so this is "one escape
 * per run" in practice (with a single exception: a row's very first run
 * needs no escape at all if it's already uncolored, since the terminal
 * starts each line in the default state already).
 *
 * ── Reset discipline ──────────────────────────────────────────────────────
 *
 * Every non-blank output line ends with an unconditional `\x1b[0m`,
 * regardless of whether that line used any colour — so a file truncated or
 * piped through something that stops mid-stream can never leave the
 * viewer's terminal in a coloured state. This costs at most one extra
 * escape per line, negligible next to the per-cell blowup the run-merging
 * above avoids.
 *
 * ── Whitespace ────────────────────────────────────────────────────────────
 *
 * Trailing whitespace is trimmed per line via
 * {@link trimRowTrailingWhitespace} — but only AFTER accounting for
 * background colour: a trailing halfblock/quadrant cell with a real
 * `background` is visible even when its glyph is a plain space, and must
 * survive the trim (shared with `glyphSvgExport.ts`, see that trim
 * function's own doc). Leading whitespace is the art's own offset and is
 * always preserved, emitted as plain uncolored spaces.
 */
import { glyphExportGridFromPre, glyphExportRuns, trimRowTrailingWhitespace, type GlyphExportGrid, type GlyphExportRun } from "./glyphExportGrid";

const ESC = "\x1b[";
const RESET = "\x1b[0m";

/** Parse a CSS colour string (`#rgb`, `#rrggbb`, or `rgb(...)`/`rgba(...)`) into 0-255 RGB channels. */
function parseColorChannels(color: string): [number, number, number] | null {
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (hex3) return [parseInt(hex3[1]! + hex3[1], 16), parseInt(hex3[2]! + hex3[2], 16), parseInt(hex3[3]! + hex3[3], 16)];
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex6) return [parseInt(hex6[1]!, 16), parseInt(hex6[2]!, 16), parseInt(hex6[3]!, 16)];
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (rgb) return [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3]))];
  return null;
}

/** Build the truecolour SGR escape for a run's `(color, background)` state, or the plain reset if both are unset. */
function sgrForState(color: string | null, background: string | null): string {
  const codes: string[] = [];
  const fg = color ? parseColorChannels(color) : null;
  if (fg) codes.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
  const bg = background ? parseColorChannels(background) : null;
  if (bg) codes.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
  return codes.length > 0 ? `${ESC}${codes.join(";")}m` : RESET;
}

/**
 * Render a grid to an ANSI escape-coded string — one line per row, one
 * escape per colour-state change (see file doc), unconditionally reset at
 * the end of every non-blank line. `null` rows (no cells after trimming)
 * emit an empty line with no escapes.
 */
export function buildGlyphAnsi(grid: GlyphExportGrid): string {
  const lines: string[] = [];
  for (const rowRuns of glyphExportRuns(grid)) {
    if (rowRuns.length === 0) {
      lines.push("");
      continue;
    }
    let out = "";
    let activeColor: string | null = null;
    let activeBackground: string | null = null;
    for (const run of rowRuns as GlyphExportRun[]) {
      if (run.color !== activeColor || run.background !== activeBackground) {
        out += sgrForState(run.color, run.background);
        activeColor = run.color;
        activeBackground = run.background;
      }
      out += run.text;
    }
    out += RESET;
    lines.push(out);
  }
  return lines.join("\n");
}

/**
 * Build the export ANSI string for a stage `<pre>`, or `null` if there's
 * nothing rendered — mirrors `extractAsciiFromPre`'s/`glyphSvgFromPre`'s own
 * contract.
 */
export function glyphAnsiFromPre(pre: HTMLElement | null): string | null {
  const grid = glyphExportGridFromPre(pre);
  if (!grid) return null;
  return buildGlyphAnsi(grid);
}

/**
 * Download the currently rendered stage `<pre>` as a standalone `.ans` file
 * — the "Download .ans" button's handler, next to "Copy ANSI". Returns
 * `false` (nothing downloaded) when there's nothing rendered, so the caller
 * can surface the same idle/error transient `handleDownloadSvg` already
 * uses.
 */
export function downloadGlyphAnsi(pre: HTMLElement | null, filename: string): boolean {
  const ansi = glyphAnsiFromPre(pre);
  if (ansi === null) return false;
  const blob = new Blob([ansi], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// Re-exported for callers/tests that want to trim a row the same
// background-aware way this file's line-building does, without reaching
// into `glyphExportGrid.ts` directly.
export { trimRowTrailingWhitespace };
