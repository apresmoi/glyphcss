import { expect, it } from "vitest";
import { histogramGlyphAtlasGrid, isGlyphAtlasEncodable } from "./cells";
import { GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII } from "./fontAtlas";
import { histogramGridColors } from "./paletteQuantize";

it("matches separate eligibility and ordered histogram passes, including sparse and invalid cells", () => {
  for (const atlas of [GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII]) {
    for (let frame = 0; frame < 100; frame++) {
      const char = Array.from({ length: 160 }, (_, i) => i % 7 === 0 ? " " : atlas.glyphs[(i + frame) % atlas.glyphs.length]!);
      const color: (string | null)[] = char.map((_, i) => ["#000000", "#123456", "#abcdef", "#123456"][(i >> 2) % 4]!);
      if (frame % 5 === 1) char[19] = "🦀";
      if (frame % 5 === 2) color[23] = "red";
      if (frame % 5 === 3) color[11] = null;
      if (frame % 5 === 4) { delete char[15]; color[15] = frame % 2 ? "invalid" : "#aabbcc"; }
      const expected = isGlyphAtlasEncodable(char, color, 16, 10, undefined, atlas)
        ? [...histogramGridColors(char, color, 160)] : undefined;
      const actual = histogramGlyphAtlasGrid(char, color, 16, 10, atlas);
      expect(actual && [...actual]).toEqual(expected);
    }
    expect(histogramGlyphAtlasGrid([], [], 2, 2, atlas)).toBeUndefined();
    expect([...histogramGlyphAtlasGrid([" ", " "], ["bad", null], 2, 1, atlas)!]).toEqual([]);
  }
});
