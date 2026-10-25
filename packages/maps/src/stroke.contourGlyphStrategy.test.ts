import type { CellGrid } from "glyphcss";
import { describe, expect, it } from "vitest";
import { stampGlyphMapContourGeometry, type GlyphMapContourPolyline } from "./stroke";

function surface(cols = 30, rows = 12): CellGrid {
  const n = cols * rows;
  return { cols, rows, screenX: new Int32Array(n), screenY: new Int32Array(n), char: Array(n).fill(" "), color: Array(n).fill(null), depth: new Float64Array(n) };
}

// Two levels crossing at a shallow slope and steeply, so oriented ink would pick `_`, `-`, `/` and `|`.
const lines: GlyphMapContourPolyline[] = [
  { level: 100, points: [{ col: 1.2, row: 2.3, depth: 1 }, { col: 28.4, row: 6.1, depth: 1 }] },
  { level: 200, points: [{ col: 4.5, row: 0.4, depth: 0.5 }, { col: 9.1, row: 11.6, depth: 0.5 }] },
];
const inked = (g: CellGrid) => g.char.filter((c) => c !== " ");

describe("contour glyph strategy", () => {
  it("draws every level in braille when asked, with no oriented ASCII left", () => {
    const g = surface();
    stampGlyphMapContourGeometry(g, lines, { experimentalGlyphStrategy: "braille" });
    expect(inked(g).length).toBeGreaterThan(20);
    for (const c of inked(g)) expect(c).toMatch(/[⠁-⣿]/u);
  });

  it("keeps one level's dots from hiding the next where they cross", () => {
    const braille = surface(), alone = surface();
    stampGlyphMapContourGeometry(braille, lines, { experimentalGlyphStrategy: "braille" });
    stampGlyphMapContourGeometry(alone, [lines[1]], { experimentalGlyphStrategy: "braille" });
    // Every cell the second level inks on its own is still inked (and holds at least its dots) with the first level under it.
    alone.char.forEach((c, i) => {
      if (c === " ") return;
      expect(braille.char[i]).not.toBe(" ");
      expect(((braille.char[i].codePointAt(0)! - 0x2800) & (c.codePointAt(0)! - 0x2800))).toBe(c.codePointAt(0)! - 0x2800);
    });
  });

  it("is oriented ASCII when omitted", () => {
    const g = surface();
    stampGlyphMapContourGeometry(g, lines);
    expect(inked(g).some((c) => /[⠀-⣿]/u.test(c))).toBe(false);
  });
});
