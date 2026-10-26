import { describe, expect, it } from "vitest";
import { decodeGlyphAtlasCodePoint, GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_BRAILLE_DOTS, type GlyphFontAtlas } from "glyphcss";
import { createGlyphFluidCells, type GlyphFluidCells } from "./cells";
import { GlyphFluidEncoder, glyphFluidPaletteCss } from "./encode";

function cellsOf(cols: number, rows: number, fill: (k: number) => [number, number]): GlyphFluidCells {
  const c = createGlyphFluidCells(cols, rows);
  for (let k = 0; k < cols * rows; k++) {
    const [m, rgb] = fill(k);
    c.mask[k] = m;
    c.rgb[k] = rgb;
    if (m) c.drawn++;
  }
  return c;
}

/** Decode atlas text back to (glyph, slot) per cell, by code point. */
function decode(text: string, atlas: GlyphFontAtlas = GLYPH_FONT_ATLAS_BRAILLE_DOTS) {
  const rows = text.split("\n");
  return rows.map((row) => [...row].map((ch) => decodeGlyphAtlasCodePoint(ch.codePointAt(0)!, atlas)!));
}

describe("GlyphFluidEncoder", () => {
  it("encodes every cell's braille pattern through core's atlas, blank cells as spaces", () => {
    let clock = 0;
    const enc = new GlyphFluidEncoder({ encoding: "atlas", monoColor: "#6f8f82", now: () => clock });
    const cells = cellsOf(16, 16, (k) => [k % 256, k % 256 ? 0x102030 + (k % 7) * 0x080808 : 0]);
    const frame = enc.encode(cells);
    const grid = decode(frame.text);
    expect(grid).toHaveLength(16);
    for (let k = 0; k < 256; k++) {
      const d = grid[Math.floor(k / 16)]![k % 16]!;
      expect(d.glyph).toBe(k ? String.fromCharCode(0x2800 + k) : " ");
      if (k) expect(frame.palette[d.paletteSlot]).toBe("#" + cells.rgb[k]!.toString(16).padStart(6, "0"));
    }
    // 7 distinct colours fit the 30 slots exactly: lossless
    expect(frame.palette).toHaveLength(7);
    expect(frame.drawn).toBe(255);
  });

  it("keeps slots and the palette generation stable while colours hold, and repools on drift after the floor", () => {
    let clock = 0;
    const enc = new GlyphFluidEncoder({ encoding: "atlas", monoColor: "#6f8f82", now: () => clock });
    // more colours than slots, so the quantizer actually reduces
    const a = cellsOf(40, 20, (k) => [0xff, ((k * 37) % 256 << 16) | ((k * 11) % 256 << 8) | 0x40]);
    const f0 = enc.encode(a);
    expect(f0.palette.length).toBeLessThanOrEqual(GLYPH_FONT_ATLAS.maxPaletteSize);
    clock += 16;
    const f1 = enc.encode(a);
    expect(f1.paletteGeneration).toBe(f0.paletteGeneration);
    expect(f1.text).toBe(f0.text);
    // a wholesale hue change drifts; the 250 ms floor holds it, then it repools
    const b = cellsOf(40, 20, () => [0xff, 0x00ff00]);
    clock += 16;
    expect(enc.encode(b).paletteGeneration).toBe(f0.paletteGeneration);
    clock += 300;
    expect(enc.encode(b).paletteGeneration).toBeGreaterThan(f0.paletteGeneration);
  });

  it("mono puts every lit cell in slot 0 of a one-colour palette", () => {
    const enc = new GlyphFluidEncoder({ encoding: "mono", monoColor: "#6f8f82", now: () => 0 });
    const frame = enc.encode(cellsOf(8, 2, (k) => [k % 3 ? 0x47 : 0, 0xff0000 + k]));
    expect(frame.palette).toEqual(["#6f8f82"]);
    for (const row of decode(frame.text)) for (const d of row) if (d.glyph !== " ") expect(d.paletteSlot).toBe(0);
  });

  it("plain falls back to real braille code points with U+2800 for blanks", () => {
    const enc = new GlyphFluidEncoder({ encoding: "plain", monoColor: "#6f8f82", now: () => 0 });
    expect(enc.encode(cellsOf(3, 2, (k) => [k === 1 ? 0xff : 0, 0])).text).toBe("⠀⣿⠀\n⠀⠀⠀");
  });

  it("emits a palette rule for the face's atlas family (braille-dots by default)", () => {
    expect(glyphFluidPaletteCss("--f", ["#010203", "#aabbcc"])).toBe(
      `@font-palette-values --f{font-family:"${GLYPH_FONT_ATLAS_BRAILLE_DOTS.family}";override-colors:0 #010203, 1 #aabbcc;}`,
    );
    expect(glyphFluidPaletteCss("--f", ["#010203"], "universal")).toBe(
      `@font-palette-values --f{font-family:"${GLYPH_FONT_ATLAS.family}";override-colors:0 #010203;}`,
    );
  });

  it("encodes the same cells and slots against either face; only the code points differ", () => {
    const cells = cellsOf(16, 16, (k) => [k % 256, k % 256 ? 0x102030 + (k % 5) * 0x080808 : 0]);
    const dots = new GlyphFluidEncoder({ encoding: "atlas", monoColor: "#6f8f82", now: () => 0 }).encode(cells);
    const uni = new GlyphFluidEncoder({ encoding: "atlas", monoColor: "#6f8f82", now: () => 0, face: "universal" }).encode(cells);
    expect(dots.palette).toEqual(uni.palette);
    expect(decode(dots.text)).toEqual(decode(uni.text, GLYPH_FONT_ATLAS));
    expect(dots.text).not.toBe(uni.text);
    // braille-dots: lit cell = U+F0000 + slot * 256 + mask
    const first = [...dots.text][1]!.codePointAt(0)!;
    expect(first).toBe(0xf0000 + decode(dots.text)[0]![1]!.paletteSlot * 256 + 1);
  });
});
