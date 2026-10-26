import { expect, it } from "vitest";
import { encodeCellGridOutput, encodeCellGrid, encodeCellGridAtlas, isGlyphAtlasEncodable, type CellGrid } from "./cells";
import { createGlyphAtlasPaletteQuantizer } from "./paletteQuantize";

it("preserves causal atlas history, generation, deferred repools and encoded bytes through transactions", () => {
  let clock = 0;
  const options = { maxSize: 3, driftThreshold: 2, now: () => clock };
  const actual = createGlyphAtlasPaletteQuantizer(options), oracle = createGlyphAtlasPaletteQuantizer(options);
  let repools = 0;
  for (let frame = 0; frame < 20; frame++) {
    clock += [10, 300, 17][frame % 3];
    actual.beginTransaction(); oracle.beginTransaction();
    for (let layer = 0; layer < 3; layer++) {
      const char = Array.from({ length: 200 }, (_, i) => i % 7 === 0 ? " " : ["@", ".", "⣿"][i % 3]);
      const color: (string | null)[] = char.map((_, i) => i % 13 === 0 ? "#AaBBcc" : `#${((i % 2 + frame * 3 + layer) * 100037 & 0xffffff).toString(16).padStart(6, "0")}`);
      if (layer === 1 && frame % 2 === 0) char[199] = "ᚡ";
      if (layer === 2 && frame % 3 === 0) color[199] = null;
      const grid: CellGrid = { char, color, cols: 20, rows: 10, screenX: new Int32Array(200), screenY: new Int32Array(200), depth: new Float64Array(200) };
      const out = encodeCellGridOutput(grid, true, 0, "atlas", actual);
      const eligible = isGlyphAtlasEncodable(char, color, 20, 10);
      const palette = eligible ? oracle.resolveGlyphAtlasPalette(char, color, 200) : undefined;
      expect(out).toEqual(palette?.length ? { text: encodeCellGridAtlas(grid, palette), encoding: "atlas" }
        : { text: encodeCellGrid(grid, true), encoding: "spans" });
      expect(actual.palette).toEqual(oracle.palette);
      expect(actual.generation).toBe(oracle.generation);
      expect(actual.repoolDeferredMs()).toBe(oracle.repoolDeferredMs());
      repools = actual.generation;
    }
    actual.endTransaction(); oracle.endTransaction();
  }
  expect(repools).toBeGreaterThan(2);
});

it("does not bypass custom or replaced palette resolvers and never ingests ineligible frames", () => {
  const grid: CellGrid = { cols: 3, rows: 1, char: ["@", ".", "⣿"], color: ["#abcdef", "#ABCDEF", "#abcdef"], screenX: new Int32Array(3), screenY: new Int32Array(3), depth: new Float64Array(3) };
  let calls = 0;
  const custom = { resolveGlyphAtlasPalette(char: readonly string[], color: readonly (string | null)[], n: number) {
    expect(char).toBe(grid.char); expect(color).toBe(grid.color); expect(n).toBe(3); calls++; return ["#abcdef"];
  }};
  expect(encodeCellGridOutput(grid, true, 0, "atlas", custom).encoding).toBe("atlas");
  const q = createGlyphAtlasPaletteQuantizer();
  q.resolveGlyphAtlasPalette = custom.resolveGlyphAtlasPalette;
  encodeCellGridOutput(grid, true, 0, "atlas", q);
  expect(calls).toBe(2);
  grid.char[1] = "ᚡ";
  expect(encodeCellGridOutput(grid, true, 0, "atlas", custom).encoding).toBe("spans");
  expect(calls).toBe(2);
});
