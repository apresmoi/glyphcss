/**
 * ANSI SGR -> HTML span converter for the `terminal` target preview (packet
 * "renderers, legends, axes, table editor" item 3). `@glyphcss/charts`' and
 * `@glyphcss/diagrams`' `renderGlyphChart`/`renderGlyphDiagram` return raw
 * SGR-escaped text for `target: "terminal"` (`encodeGlyphCanvasAnsi` in
 * `packages/glyphcss/src/render/canvas/encode.ts`) — a real terminal decodes
 * that itself, but a browser preview has no terminal emulator, so this file
 * is the small one this package needs: parse the SAME SGR vocabulary that
 * encoder emits back into `(text, fg, bg)` runs and render them as `<span
 * style="color:…;background-color:…">` — the same structural contract
 * `encodeGlyphCanvasHtml` itself uses (top-level `<span>`s carrying both
 * channels, read back by `website/src/lib/glyphExportGrid.ts` for the
 * "Download SVG" export), so a terminal preview exports exactly as
 * accurately as a web one now.
 *
 * Covers everything the encoder can produce: 16-colour (30-37/40-47, bright
 * 90-97/100-107), 256-colour (`38;5;n` / `48;5;n`), truecolor (`38;2;r;g;b` /
 * `48;2;r;g;b`), and reset — a full reset (`0`, and every bare `\x1b[m` with
 * no codes at all) plus the two per-channel resets (`39` fg-only, `49`
 * bg-only) a real terminal also honours even though this codebase's own
 * encoder never emits them standalone. Unrecognized codes (e.g. bold) are
 * skipped rather than rejected — this is a best-effort PREVIEW of arbitrary
 * ANSI text, not a validator, and the production encoder never emits them
 * anyway.
 */

// The standard xterm 16-colour and 256-colour palettes — duplicated here
// (rather than imported) because `packages/glyphcss/src/render/canvas/
// encode.ts` doesn't export them: they are its own private encoding detail,
// and these are the well-known, standard xterm RGB values, not something
// this package invented.
const ANSI_16_RGB: readonly number[] = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0xff0000, 0x00ff00,
  0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
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

function hexOf(rgb: number): string {
  return `#${(rgb >>> 0).toString(16).padStart(6, "0")}`;
}

export interface AnsiSpan {
  readonly text: string;
  readonly fg?: string;
  readonly bg?: string;
}

const ANSI_ESCAPE = /\x1b\[([0-9;]*)m/g;

/** Parse an SGR-escaped string into `(text, fg?, bg?)` runs, in order. */
export function parseAnsiToSpans(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let fg: string | undefined;
  let bg: string | undefined;
  let lastIndex = 0;
  ANSI_ESCAPE.lastIndex = 0;
  const pushText = (text: string) => {
    if (text) spans.push({ text, fg, bg });
  };
  let match: RegExpExecArray | null;
  while ((match = ANSI_ESCAPE.exec(input))) {
    pushText(input.slice(lastIndex, match.index));
    lastIndex = ANSI_ESCAPE.lastIndex;
    const raw = match[1]!;
    const codes = raw.length ? raw.split(";").map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      if (code === 0) {
        fg = undefined;
        bg = undefined;
      } else if (code === 39) {
        fg = undefined;
      } else if (code === 49) {
        bg = undefined;
      } else if (code >= 30 && code <= 37) {
        fg = hexOf(ANSI_16_RGB[code - 30]!);
      } else if (code >= 90 && code <= 97) {
        fg = hexOf(ANSI_16_RGB[code - 90 + 8]!);
      } else if (code >= 40 && code <= 47) {
        bg = hexOf(ANSI_16_RGB[code - 40]!);
      } else if (code >= 100 && code <= 107) {
        bg = hexOf(ANSI_16_RGB[code - 100 + 8]!);
      } else if (code === 38 || code === 48) {
        const isBg = code === 48;
        const mode = codes[i + 1];
        if (mode === 5) {
          const hex = hexOf(ANSI_256_RGB[codes[i + 2]!] ?? 0);
          if (isBg) bg = hex;
          else fg = hex;
          i += 2;
        } else if (mode === 2) {
          const r = codes[i + 2]!,
            g = codes[i + 3]!,
            b = codes[i + 4]!;
          const hex = hexOf((r << 16) | (g << 8) | b);
          if (isBg) bg = hex;
          else fg = hex;
          i += 4;
        }
      }
      // Anything else (bold, italic, ...) is ignored — see file doc comment.
    }
  }
  pushText(input.slice(lastIndex));
  return spans;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render parsed spans as `innerHTML` — top-level `<span>`s only, matching `encodeGlyphCanvasHtml`. */
export function ansiSpansToHtml(spans: readonly AnsiSpan[]): string {
  return spans
    .map((span) => {
      const escaped = escapeHtml(span.text);
      if (span.fg === undefined && span.bg === undefined) return escaped;
      const style =
        span.fg !== undefined && span.bg !== undefined
          ? `color:${span.fg};background-color:${span.bg}`
          : span.fg !== undefined
            ? `color:${span.fg}`
            : `background-color:${span.bg}`;
      return `<span style="${style}">${escaped}</span>`;
    })
    .join("");
}

/** Convenience: SGR-escaped string straight to `innerHTML`. */
export function ansiToHtml(input: string): string {
  return ansiSpansToHtml(parseAnsiToSpans(input));
}
