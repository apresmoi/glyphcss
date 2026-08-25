import { describe, expect, it } from "vitest";
import {
  buildCellGrid,
  encodeCellGridAtlas,
  encodeCellGridOutput,
  encodeGlyphAtlas,
  encodeGlyphBuffers,
  isGlyphAtlasEncodable,
} from "./cells";
import { GLYPH_FONT_ATLAS, glyphAtlasCodePoint } from "./fontAtlas";

const GLYPH_A = GLYPH_FONT_ATLAS.glyphs[0]!;
const GLYPH_B = GLYPH_FONT_ATLAS.glyphs[1]!;
const PALETTE = ["#ff0000", "#00ff00", "#0000ff"];

describe("isGlyphAtlasEncodable", () => {
  it("accepts a grid whose glyphs are all in the atlas and colors all in the palette", () => {
    const char = [GLYPH_A, GLYPH_B, " "];
    const color: (string | null)[] = ["#ff0000", "#00ff00", null];
    expect(isGlyphAtlasEncodable(char, color, 3, 1, PALETTE)).toBe(true);
  });

  it("rejects a grid with a glyph outside the atlas (a rune, dropped from the universal set — see build-atlas.py)", () => {
    const char = [GLYPH_A, "ᚠ"];
    const color: (string | null)[] = ["#ff0000", "#ff0000"];
    expect(isGlyphAtlasEncodable(char, color, 2, 1, PALETTE)).toBe(false);
  });

  it("rejects a grid with a color outside the supplied palette", () => {
    const char = [GLYPH_A, GLYPH_B];
    const color: (string | null)[] = ["#ff0000", "#123456"]; // not in PALETTE
    expect(isGlyphAtlasEncodable(char, color, 2, 1, PALETTE)).toBe(false);
  });

  it("rejects a non-blank cell with a null color", () => {
    const char = [GLYPH_A];
    const color: (string | null)[] = [null];
    expect(isGlyphAtlasEncodable(char, color, 1, 1, PALETTE)).toBe(false);
  });

  it("rejects an empty palette or a palette larger than the atlas's maxPaletteSize", () => {
    const char = [GLYPH_A];
    const color: (string | null)[] = ["#ff0000"];
    expect(isGlyphAtlasEncodable(char, color, 1, 1, [])).toBe(false);
    const tooMany = Array.from({ length: GLYPH_FONT_ATLAS.maxPaletteSize + 1 }, () => "#ff0000");
    expect(isGlyphAtlasEncodable(char, color, 1, 1, tooMany)).toBe(false);
  });

  it("blank cells never gate the decision, regardless of their color buffer value", () => {
    const char = [" ", " "];
    const color: (string | null)[] = [null, "#not-in-palette"];
    expect(isGlyphAtlasEncodable(char, color, 2, 1, PALETTE)).toBe(true);
  });
});

describe("encodeGlyphAtlas", () => {
  it("encodes every cell as the exact PUA code point glyphAtlasCodePoint predicts", () => {
    const char = [GLYPH_A, GLYPH_B];
    const color: (string | null)[] = ["#ff0000", "#0000ff"];
    const out = encodeGlyphAtlas(char, color, 2, 1, PALETTE);
    expect(out).toHaveLength(2);
    expect(out.codePointAt(0)).toBe(glyphAtlasCodePoint(GLYPH_A, 0));
    expect(out.codePointAt(1)).toBe(glyphAtlasCodePoint(GLYPH_B, 2));
  });

  it("produces plain text with zero <span>s and zero HTML escaping", () => {
    const char = ["&", "<", ">"]; // would be HTML-escaped under encodeGlyphBuffers
    const color: (string | null)[] = ["#ff0000", "#ff0000", "#ff0000"];
    const out = encodeGlyphAtlas(char, color, 3, 1, PALETTE);
    expect(out).not.toContain("<span");
    expect(out).not.toContain("&amp;");
    expect(out).not.toContain("&lt;");
  });

  it("maps blank cells straight to U+0020, consuming no palette slot", () => {
    const char = [" ", GLYPH_A];
    const color: (string | null)[] = [null, "#ff0000"];
    const out = encodeGlyphAtlas(char, color, 2, 1, PALETTE);
    expect(out.codePointAt(0)).toBe(0x20);
  });

  it("joins rows with \\n, matching encodeGlyphBuffers' line convention", () => {
    const char = [GLYPH_A, GLYPH_B];
    const color: (string | null)[] = ["#ff0000", "#00ff00"];
    const out = encodeGlyphAtlas(char, color, 1, 2, PALETTE);
    expect(out).toContain("\n");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("throws when a cell's glyph is outside the atlas — callers must guard with isGlyphAtlasEncodable first", () => {
    const char = ["ᚠ"];
    const color: (string | null)[] = ["#ff0000"];
    expect(() => encodeGlyphAtlas(char, color, 1, 1, PALETTE)).toThrow(TypeError);
  });

  it("throws when a cell's color is outside the supplied palette", () => {
    const char = [GLYPH_A];
    const color: (string | null)[] = ["#123456"];
    expect(() => encodeGlyphAtlas(char, color, 1, 1, PALETTE)).toThrow(TypeError);
  });
});

describe("encodeCellGridAtlas", () => {
  it("encodes a CellGrid the same way encodeGlyphAtlas encodes raw buffers", () => {
    const char = [GLYPH_A, GLYPH_B];
    const color: (string | null)[] = ["#ff0000", "#0000ff"];
    const grid = buildCellGrid(char, color, null, 2, 1);
    expect(encodeCellGridAtlas(grid, PALETTE)).toBe(encodeGlyphAtlas(char, color, 2, 1, PALETTE));
  });
});

describe("encodeCellGridOutput — the spans-vs-atlas seam", () => {
  const char = [GLYPH_A, GLYPH_B];
  const color: (string | null)[] = ["#ff0000", "#0000ff"];

  it("is byte-identical to encodeCellGrid when colorEncoding is omitted", () => {
    const grid = buildCellGrid(char, color, null, 2, 1);
    const withDefault = encodeCellGridOutput(grid, true, 0);
    const direct = encodeGlyphBuffers(char, color, 2, 1, true);
    expect(withDefault).toBe(direct);
  });

  it("is byte-identical to encodeCellGrid when colorEncoding is explicitly \"spans\"", () => {
    const grid = buildCellGrid(char, color, null, 2, 1);
    const out = encodeCellGridOutput(grid, true, 0, "spans", PALETTE);
    const direct = encodeGlyphBuffers(char, color, 2, 1, true);
    expect(out).toBe(direct);
  });

  it("routes to the atlas encoder when colorEncoding is \"atlas\" and the grid fits the palette", () => {
    const grid = buildCellGrid(char, color, null, 2, 1);
    const out = encodeCellGridOutput(grid, true, 0, "atlas", PALETTE);
    expect(out).not.toContain("<span");
    expect(out).toBe(encodeGlyphAtlas(char, color, 2, 1, PALETTE));
  });

  it("falls back to spans when colorEncoding is \"atlas\" but no atlasPalette is supplied", () => {
    const grid = buildCellGrid(char, color, null, 2, 1);
    const out = encodeCellGridOutput(grid, true, 0, "atlas", undefined);
    expect(out).toBe(encodeGlyphBuffers(char, color, 2, 1, true));
  });

  it("falls back to spans (whole-grid, not partial) when one cell's glyph is outside the atlas", () => {
    const mixedChar = [GLYPH_A, "ᚠ"];
    const grid = buildCellGrid(mixedChar, color, null, 2, 1);
    const out = encodeCellGridOutput(grid, true, 0, "atlas", PALETTE);
    // Whole-grid fallback: the fully-encodable first cell does NOT get
    // atlas-encoded while the second falls back — the entire render uses
    // spans, verified by the presence of a <span> wrapper.
    expect(out).toContain("<span");
    expect(out).toBe(encodeGlyphBuffers(mixedChar, color, 2, 1, true));
  });
});
