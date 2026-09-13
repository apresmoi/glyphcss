import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";

describe("cell canvas: text() never rasterises", () => {
  it("a label written over a filled rect keeps its exact characters", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    canvas.fillRect(0, 0, 9, 2, { fill: "solid", color: "#111111" });
    canvas.text(1, 1, ["chart"], { color: "#ffffff" });
    const row1 = canvas.grid.char.slice(1 * 10, 1 * 10 + 10).join("");
    expect(row1.slice(1, 6)).toBe("chart");
  });

  it("a wide (CJK) glyph is folded to '?' and reported (mutation: drop the report -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    // U+4E2D "中" is a double-width East-Asian glyph: no single-cell fold
    // exists for it, so it must fall all the way to "?".
    canvas.text(0, 0, ["a中b"], {});
    const row0 = canvas.grid.char.slice(0, 10).join("");
    expect(row0.slice(0, 3)).toBe("a?b");
    // MUTATION CAUGHT: if `resolveTextGlyph` stopped pushing onto
    // `report.unsupportedGlyphs`, this array would stay empty even though a
    // glyph was folded.
    expect(canvas.report.unsupportedGlyphs).toContain("中");
    expect(canvas.report.foldedGlyphs).toHaveLength(0);
  });

  it("a decomposed grapheme (\"e\" + COMBINING ACUTE ACCENT) occupies exactly ONE cell and folds via NFD+strip to its base letter, not '?' (mutation: delete the NFD fold -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    // This is the string that actually exercises the fold: a grapheme
    // CLUSTER segmenter (Intl.Segmenter) groups "e" + U+0301 as ONE
    // user-perceived character, so `isSingleCellGlyph` rejects the 2-code-
    // unit cluster on length alone, and only THEN does the NFD-strip branch
    // run. A code-point splitter (Array.from) would have already separated
    // the accent before the fold ever saw it, which is why the "é" fixture
    // this test replaces never actually exercised this path — see
    // docs/design/canvas.md.
    const decomposedE = "éx";
    canvas.text(0, 0, [decomposedE], {});
    const row0 = canvas.grid.char.slice(0, 10).join("");
    // Exactly two cells: "e" (folded) + "x" — not three (which would mean
    // the accent was split into its own cell) and not "?x" (which is what
    // deleting the fold branch produces: the cluster fails, falls straight
    // to unsupported).
    expect(row0.slice(0, 2)).toBe("ex");
    expect(row0[2]).toBe(" ");
    expect(canvas.report.foldedGlyphs).toEqual([
      { from: "é", to: "e", col: 0, row: 0 },
    ]);
    expect(canvas.report.unsupportedGlyphs).not.toContain("é");
  });

  it("a fullwidth punctuation mark substitutes to its ASCII equivalent and is reported", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    canvas.text(0, 0, ["a，b"], {});
    const row0 = canvas.grid.char.slice(0, 10).join("");
    expect(row0.slice(0, 3)).toBe("a,b");
    expect(canvas.report.foldedGlyphs).toEqual([
      { from: "，", to: ",", col: 1, row: 0 },
    ]);
  });

  it("align centers/right-aligns around the anchor x", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 1, tier: "box" });
    canvas.text(5, 0, ["ab"], { align: "right" });
    expect(canvas.grid.char.slice(0, 10).join("")).toBe("    ab    ");
  });
});

describe("cell canvas: text() scale (web textScale affordance)", () => {
  it("scale 1 (default and explicit) is byte-identical to no scale at all — no textScale/textFiller write", () => {
    const bare = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    bare.text(1, 1, ["ab"], { color: "#ffffff" });
    const explicit = createGlyphCanvas({ cols: 10, rows: 3, tier: "box" });
    explicit.text(1, 1, ["ab"], { color: "#ffffff", scale: 1 });
    expect(explicit.grid.char).toEqual(bare.grid.char);
    expect(explicit.grid.color).toEqual(bare.grid.color);
    expect([...explicit.textScale]).toEqual([...bare.textScale]);
    expect([...explicit.textFiller]).toEqual([...bare.textFiller]);
    expect([...bare.textScale].every((v) => v === 0)).toBe(true);
    expect([...bare.textFiller].every((v) => v === 0)).toBe(true);
  });

  it("scale 2 writes the glyph at the origin cell and reserves a 2x2 OCCUPIED box, on a 2-column pitch per glyph", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 4, tier: "box" });
    canvas.text(0, 0, ["ab"], { color: "#ffffff", scale: 2 });
    // "a" origin at (0,0), "b" origin at (2,0) — 2-column pitch, not 1.
    expect(canvas.grid.char[0]).toBe("a");
    expect(canvas.grid.char[2]).toBe("b");
    expect(canvas.textScale[0]).toBe(2);
    expect(canvas.textScale[2]).toBe(2);
    // The remaining 3 cells of "a"'s 2x2 box: (1,0), (0,1), (1,1) — all
    // marked filler and blanked.
    const idx = (x: number, y: number) => y * 10 + x;
    for (const [x, y] of [[1, 0], [0, 1], [1, 1]] as const) {
      expect(canvas.textFiller[idx(x, y)]).toBe(1);
      expect(canvas.grid.char[idx(x, y)]).toBe(" ");
      expect(canvas.grid.color[idx(x, y)]).toBe(null);
    }
    // "b"'s own box: (3,0), (2,1), (3,1).
    for (const [x, y] of [[3, 0], [2, 1], [3, 1]] as const) {
      expect(canvas.textFiller[idx(x, y)]).toBe(1);
    }
  });

  it("a mark painted before a scaled label cannot show through the label's filler cells (mutation: skip the blank-out -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 4, tier: "box" });
    canvas.fillRect(0, 0, 9, 3, { fill: "solid", color: "#111111" });
    canvas.text(0, 0, ["a"], { color: "#ffffff", scale: 2 });
    expect(canvas.grid.char[1]).toBe(" "); // (1,0) filler, was solid ink
    expect(canvas.grid.char[10]).toBe(" "); // (0,1) filler
    expect(canvas.grid.char[11]).toBe(" "); // (1,1) filler
  });

  it("no painter can write into a scaled label's filler cells afterward (mutation: drop the textFiller guard -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 4, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#ffffff", scale: 2 });
    canvas.fillRect(0, 0, 9, 3, { fill: "solid", color: "#222222" });
    canvas.line({ x: 0, y: 0 }, { x: 9, y: 0 }, { color: "#333333" });
    canvas.arrowhead(1, 0, "e", { color: "#444444" });
    expect(canvas.grid.char[1]).toBe(" "); // (1,0)
    expect(canvas.grid.char[10]).toBe(" "); // (0,1)
    expect(canvas.grid.char[11]).toBe(" "); // (1,1)
    // The origin itself is untouched by the guard — a later mark can still
    // repaint it exactly like an ordinary scale-1 label (draw order still
    // resolves ties there); only the FILLER cells are protected.
  });

  it("rejects a non-integer or sub-1 scale", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 4, tier: "box" });
    expect(() => canvas.text(0, 0, ["a"], { scale: 1.5 })).toThrow(RangeError);
    expect(() => canvas.text(0, 0, ["a"], { scale: 0 })).toThrow(RangeError);
  });

  it("right/center align accounts for the scaled box width, not the raw glyph count", () => {
    const canvas = createGlyphCanvas({ cols: 20, rows: 4, tier: "box" });
    canvas.text(10, 0, ["ab"], { align: "right", scale: 2 });
    // boxWidth = 2*2 = 4; startX = 10 - 4 + 2 = 8; glyphs at x=8, x=10.
    expect(canvas.grid.char[8]).toBe("a");
    expect(canvas.grid.char[10]).toBe("b");
  });

  it("a multi-line scaled run spaces LINES on the scale row pitch too", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 6, tier: "box" });
    canvas.text(0, 0, ["a", "b"], { scale: 2 });
    expect(canvas.grid.char[0 * 10 + 0]).toBe("a");
    expect(canvas.grid.char[2 * 10 + 0]).toBe("b");
  });
});
