// Style consistency: how much a stroke mixes visual glyph families. Not part
// of the static rubric total (which stays reproducible); reported alongside it.
//
// Families are by LOOK, not Unicode block, so inkGlyphForTangent's deliberate
// ‾ ▔ - _ ▏ | ▕ / \ mix counts as one family (thin strokes):
//   dots    braille, · • ˙ ⋅ ∙
//   strokes ASCII punctuation, box drawing, ‾, the thin eighth blocks ▔ ▁ ▏ ▕
//   blocks  every other block element (▀ ▄ █ ▌ ▐ ░ ▒ ▓ quadrants, thicker eighths)
//   symbols everything else (◆ ⊕ ✦ …)
// style = fraction of a stroke's non-blank cells outside its majority family.

export const STYLE_WEIGHT = 1.0;
export const STYLE_FAMILIES = ["dots", "strokes", "blocks", "symbols"];

export function familyOf(g) {
  const c = g.codePointAt(0);
  if ((c >= 0x2800 && c <= 0x28ff) || "·•˙⋅∙".includes(g)) return "dots";
  if ((c >= 0x21 && c < 0x7f) || (c >= 0x2500 && c <= 0x257f) || "‾▔▁▏▕".includes(g)) return "strokes";
  if (c >= 0x2580 && c <= 0x259f) return "blocks";
  return "symbols";
}

/** cells: [{glyph}] or [[col,row,glyph]]. */
export function styleTerm(cells) {
  const counts = new Map();
  let n = 0;
  for (const c of cells) {
    const g = Array.isArray(c) ? c[2] : c.glyph;
    if (g === " ") continue;
    const f = familyOf(g);
    counts.set(f, (counts.get(f) ?? 0) + 1);
    n++;
  }
  if (!n) return 0;
  return 1 - Math.max(...counts.values()) / n;
}
