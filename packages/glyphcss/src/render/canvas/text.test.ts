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
