// Glyph vocabularies the table/oracle are restricted to, each filtered to a
// face's SAFE set (present in the face, cell advance, real ink).

const BRAILLE = (g) => g.codePointAt(0) > 0x2800 && g.codePointAt(0) <= 0x28ff;

export const VOCABS = {
  all: { label: "every safe glyph", pick: () => true },
  ink: { label: "inkGlyphForTangent set + ─ │ ·", pick: (g) => "‾▔-_\\▏|▕/─│·".includes(g) },
  box: { label: "box strategy set ─│└┘┌┐├┤┬┴┼·", pick: (g) => "─│└┘┌┐├┤┬┴┼·".includes(g) },
  braille: { label: "braille U+2801–U+28FF", pick: BRAILLE },
  ascii: { label: "printable-ASCII line-ish", pick: (g) => g.length === 1 && g.codePointAt(0) < 0x7f },
};

export function safeGlyphs(fm) {
  return [...fm.masks.entries()].filter(([g, m]) => m.safe && g !== "⠀").map(([g]) => g);
}

export function vocabFor(fm, name) {
  return safeGlyphs(fm).filter(VOCABS[name].pick);
}

/** Ink mass per cell width of a vocabulary's horizontal-rule glyph — the DP's starting ink normaliser. */
export function refMassPerCw(fm, name) {
  const ref = { all: "─", ink: "-", box: "─", braille: "⠒", ascii: "-" }[name];
  const m = fm.masks.get(ref) ?? fm.masks.get("-");
  let s = 0;
  for (const v of m.a) s += v;
  return s;
}
