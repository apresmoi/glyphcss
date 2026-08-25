/**
 * Shared "can this scene actually use `colorEncoding: 'atlas'`?" check for
 * every page that exposes the atlas toggle (`/synth`, `/wordart`, `/gallery`,
 * the wired `/examples/*` pages). One implementation, reused everywhere, so
 * the disabled-state tooltip's reason can never drift into a wrong guess the
 * way the static-export button's did (see `packages/effects/src/staticExport.ts`'s
 * `glyphFieldSynthStaticExportUnsupportedReason` for that precedent) — the
 * structural checks below quote AGENTS.md's documented `colorEncoding`
 * no-op list verbatim, and the residual, content-dependent check calls
 * `glyphcss`'s own exported `isGlyphAtlasEncodable` predicate directly
 * against the actually-rendered stage `<pre>`, never a hand-maintained
 * mirror of its rules.
 *
 * Chicken-and-egg note: once a `<pre>` is ACTUALLY rendering
 * `colorEncoding: "atlas"` output, its DOM is zero-span PUA text — there is
 * no per-cell color left to read back out of it (see `fontAtlas.ts`'s PUA
 * mapping: a code point encodes a palette SLOT, not a color value, and the
 * DOM carries no per-character span to recover which slot). So this can only
 * be recomputed from a `"spans"` render. Every caller here follows the same
 * rule: recompute while the scene is rendering `"spans"`, and freeze the
 * last computed result once the caller switches to `"atlas"` — matching how
 * every other Dock `setEnabled` gate here already reads stable config state,
 * not a live per-frame simulation.
 */
import { GLYPH_FONT_ATLAS, isGlyphAtlasEncodable, isGlyphInFontAtlas } from "glyphcss";

export interface GlyphAtlasAvailability {
  /** `null` when available; otherwise the real, user-facing reason it's not. */
  reason: string | null;
  /** The palette to pass as `atlasPalette` when available; `undefined` otherwise. */
  atlasPalette: string[] | undefined;
}

export interface GlyphAtlasGateInputs {
  /** `colorEncoding: "atlas"` is a documented no-op when colors are off. */
  useColors: boolean;
  /** Only `"ascii"` is in the atlas's glyph-set scope (AGENTS.md). */
  charMode: "ascii" | "braille" | "halfblock" | "quadrant";
  /** Semantic output is a documented `colorEncoding` no-op. */
  glyphOutput?: "visible" | "semantic";
  /** An active `solidWeightRamp` selection is a documented `colorEncoding` no-op. */
  solidWeightRampActive?: boolean;
}

const UNAVAILABLE = (reason: string): GlyphAtlasAvailability => ({ reason, atlasPalette: undefined });

/**
 * Real availability check, run against the CURRENTLY rendered stage `<pre>`
 * (which must be in `"spans"` output — see the module doc). Structural gates
 * short-circuit first (cheap, and they're the same reasons
 * `isGlyphAtlasEncodable` would fail for internally); the residual
 * content-dependent gate parses the `<pre>`'s own rendered cells back into
 * `(char, color)` buffers and hands them straight to `isGlyphAtlasEncodable`.
 */
export function computeGlyphAtlasAvailability(
  pre: HTMLElement | null,
  gate: GlyphAtlasGateInputs,
): GlyphAtlasAvailability {
  if (!gate.useColors) return UNAVAILABLE("Atlas color encoding needs colors on (useColors is off).");
  if (gate.charMode !== "ascii") {
    return UNAVAILABLE(`Atlas color encoding only covers the "ascii" character mode (current: "${gate.charMode}").`);
  }
  if (gate.glyphOutput === "semantic") {
    return UNAVAILABLE("Atlas color encoding doesn't support semantic glyph output.");
  }
  if (gate.solidWeightRampActive) {
    return UNAVAILABLE("Atlas color encoding doesn't support an active solid weight ramp.");
  }
  if (!pre) return UNAVAILABLE("Nothing rendered yet.");

  const parsed = parsePreGrid(pre);
  if (!parsed) return UNAVAILABLE("Nothing rendered yet.");
  const { chars, colors, cols, rows } = parsed;

  for (const ch of chars) {
    if (ch !== " " && !isGlyphInFontAtlas(ch)) {
      return UNAVAILABLE(`Atlas color encoding doesn't cover this render's "${ch}" glyph.`);
    }
  }

  const palette: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    const c = colors[i];
    if (chars[i] === " " || c === null) continue;
    if (!seen.has(c)) {
      seen.add(c);
      palette.push(c);
      if (palette.length > GLYPH_FONT_ATLAS.maxPaletteSize) {
        return UNAVAILABLE(
          `This render uses more than ${GLYPH_FONT_ATLAS.maxPaletteSize} distinct colors — over the atlas's palette budget.`,
        );
      }
    }
  }
  if (palette.length === 0) return UNAVAILABLE("This render has no color to encode.");

  if (!isGlyphAtlasEncodable(chars, colors, cols, rows, palette)) {
    return UNAVAILABLE("This render's glyphs or colors aren't fully covered by the color-font atlas.");
  }
  return { reason: null, atlasPalette: palette };
}

interface ParsedPreGrid {
  chars: string[];
  colors: (string | null)[];
  cols: number;
  rows: number;
}

/**
 * Parse a `"spans"`-mode stage `<pre>`'s rendered cells back into the
 * `(char, color)` buffers `isGlyphAtlasEncodable` expects — same recursive
 * span-walk shape as the gallery's own `parseStripCells`
 * (`GalleryWorkbench/GalleryWorkbench.tsx`), generalized to the WHOLE grid
 * (no trim) since this needs real `cols`/`rows` to match cell indices.
 */
function parsePreGrid(pre: HTMLElement): ParsedPreGrid | null {
  const lines: { ch: string; color: string | null }[][] = [[]];
  let row = lines[0]!;
  const visit = (node: ChildNode, color: string | null): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      for (const ch of text) {
        if (ch === "\n") {
          row = [];
          lines.push(row);
        } else {
          row.push({ ch, color });
        }
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const next = el.style?.color ? rgbToHex(el.style.color) : color;
      el.childNodes.forEach((child) => visit(child, next));
    }
  };
  pre.childNodes.forEach((child) => visit(child, null));

  const rows = lines.length;
  let cols = 0;
  for (const r of lines) if (r.length > cols) cols = r.length;
  if (cols === 0 || rows === 0) return null;

  const chars: string[] = [];
  const colors: (string | null)[] = [];
  for (const r of lines) {
    for (let c = 0; c < cols; c++) {
      const cell = r[c];
      const ch = cell?.ch ?? " ";
      chars.push(ch);
      colors.push(ch === " " ? null : cell!.color);
    }
  }
  return { chars, colors, cols, rows };
}

/**
 * `el.style.color` normalizes an authored `#rrggbb` to `rgb(r, g, b)` when
 * read back from the DOM — convert back so it matches the `#rrggbb` strings
 * glyphcss's own color pipeline uses everywhere (`isGlyphAtlasEncodable` does
 * an exact string match, and `atlasPalette` entries must be `#rrggbb`).
 */
function rgbToHex(color: string): string | null {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (!m) return color.startsWith("#") ? color.toLowerCase() : null;
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}
