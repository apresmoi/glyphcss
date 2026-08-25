/**
 * Shared "copy the rendered ASCII" support for /synth and /wordart. The stage
 * `<pre class="glyph-output">` carries color `<span>`s in colored-output mode,
 * so the button must read `textContent` (never `innerHTML`) to get plain text.
 *
 * Rows are space-padded to the grid width — trimming each line's TRAILING
 * whitespace makes a pasted copy usable; LEADING whitespace is the art's own
 * left offset and must survive untouched.
 *
 * Under `colorEncoding: "atlas"`, `textContent` is Private Use Area code
 * points (glyphcss's colour-font atlas — see `glyphcss`'s `render/fontAtlas.ts`),
 * not the original glyphs, so a plain copy would paste unreadable PUA
 * characters. `decodeGlyphAtlasText` is the reverse map this file is the
 * single chokepoint for: both `/synth` and `/wordart`'s "Copy ASCII" read
 * through `extractAsciiFromPre`, so decoding here covers both callers. It is
 * a documented no-op on `"spans"` output — every code point in a
 * `colorEncoding: "spans"` render is already outside the atlas's occupied
 * PUA range, so `decodeGlyphAtlasText` returns its input unchanged (verified
 * by the byte-identity test, not assumed).
 */
import { decodeGlyphAtlasText } from "glyphcss";

/** Trim trailing whitespace from every line, leaving leading whitespace intact. */
export function trimTrailingWhitespacePerLine(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** Extract the copy-ready ASCII string from a stage `<pre>`, or `null` if there's nothing to copy. */
export function extractAsciiFromPre(pre: HTMLElement | null): string | null {
  const raw = pre?.textContent ?? "";
  if (!raw.trim()) return null;
  return trimTrailingWhitespacePerLine(decodeGlyphAtlasText(raw));
}
