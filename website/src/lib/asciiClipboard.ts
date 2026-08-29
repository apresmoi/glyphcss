/**
 * Shared "copy the rendered ASCII" support for every page with a copy button. The stage
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
 * single chokepoint for: every "Copy ASCII" button reads through
 * `extractAsciiFromPre`, so decoding here covers all of them. It is a
 * documented no-op on `"spans"` output — every code point in a
 * `colorEncoding: "spans"` render is already outside the atlas's occupied
 * PUA range, so `decodeGlyphAtlasText` returns its input unchanged (verified
 * by the byte-identity test, not assumed).
 *
 * WHICH atlas decodes is resolved per `<pre>`, not fixed: glyphcss ships two
 * variants over the same PUA range with different glyph moduli (universal 212,
 * ASCII 94), so decoding against the wrong one returns real but wrong glyphs.
 * `glyphAtlasForFamily` reads the answer off the `font-family` the renderer
 * pins on each output `<pre>`, so a page whose scenes use different variants
 * copies each correctly.
 *
 * ── Colour, for the rich-HTML flavour ───────────────────────────────────
 *
 * A copy that also offers `text/html` (the gallery's coloured paste, and
 * `/examples/image`'s) needs per-cell COLOUR, which atlas output does not
 * carry in the DOM: a PUA code point names a palette SLOT, and the colours
 * live in the `@font-palette-values` block `createGlyphScene` injected.
 * {@link glyphAtlasCellsFromPre} recovers both by reading that block —
 * resolving the slot exactly the way the browser does, rather than
 * approximating the colour or dropping it. It returns `null` for a `"spans"`
 * render, where the existing span-walk already has the colour.
 */
import { decodeGlyphAtlasCodePoint, decodeGlyphAtlasText, glyphAtlasForFamily, GLYPH_FONT_ATLAS } from "glyphcss";

/**
 * The atlas that painted this `<pre>`. A `<pre>` with no atlas family pinned
 * carries no atlas encoding to decode, so the universal atlas — whose range
 * check then passes nothing through — keeps the decode a no-op rather than
 * making the caller special-case it.
 */
function atlasForPre(pre: HTMLElement | null) {
  return glyphAtlasForFamily(pre?.style.fontFamily) ?? GLYPH_FONT_ATLAS;
}

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
  return trimTrailingWhitespacePerLine(decodeGlyphAtlasText(raw, atlasForPre(pre)));
}

/** One decoded cell of an atlas-encoded `<pre>`: the real glyph, plus its slot's colour. */
export interface GlyphAtlasCell {
  ch: string;
  color?: string;
}

/**
 * Palette colours a scene's own `@font-palette-values` block declares, indexed
 * by slot. `null` when this `<pre>` is not using an atlas palette — which is
 * also how a caller detects a `"spans"` render.
 */
export function glyphAtlasPaletteForPre(pre: HTMLElement | null): string[] | null {
  const name = pre?.style.getPropertyValue("font-palette");
  if (!name) return null;
  const doc = pre!.ownerDocument;
  const block = Array.from(doc.head.querySelectorAll("style"), (el) => el.textContent ?? "")
    .find((css) => css.includes(`@font-palette-values ${name}`));
  if (!block) return null;
  const overrides = /override-colors:([^;}]+)/.exec(block)?.[1];
  if (!overrides) return null;
  const palette: string[] = [];
  for (const entry of overrides.split(",")) {
    const m = /(\d+)\s+(#[0-9a-fA-F]{6})/.exec(entry);
    if (m) palette[Number(m[1])] = m[2]!.toLowerCase();
  }
  return palette.length > 0 ? palette : null;
}

/**
 * Rows of decoded `(glyph, colour)` cells for an ATLAS-encoded `<pre>`, or
 * `null` when it isn't one (no palette block, or its text carries no atlas
 * code point). Newlines split rows, matching every other grid walk here.
 */
export function glyphAtlasCellsFromPre(pre: HTMLElement | null): GlyphAtlasCell[][] | null {
  const palette = glyphAtlasPaletteForPre(pre);
  if (!palette) return null;
  const atlas = atlasForPre(pre);
  const text = pre!.textContent ?? "";
  const rows: GlyphAtlasCell[][] = [[]];
  let row = rows[0]!;
  let sawAtlas = false;
  for (const ch of text) {
    if (ch === "\n") {
      row = [];
      rows.push(row);
      continue;
    }
    const cp = ch.codePointAt(0)!;
    const decoded = cp >= atlas.puaStart ? decodeGlyphAtlasCodePoint(cp, atlas) : undefined;
    if (decoded && decoded.paletteSlot >= 0) {
      sawAtlas = true;
      const color = palette[decoded.paletteSlot];
      row.push(color ? { ch: decoded.glyph, color } : { ch: decoded.glyph });
    } else {
      row.push({ ch: decoded ? decoded.glyph : ch });
    }
  }
  return sawAtlas ? rows : null;
}
