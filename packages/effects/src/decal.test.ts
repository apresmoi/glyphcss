/**
 * `glyphGridDecalEffect` (AGENTS.md "Charts" §7 "Exact glyphs") — the 1:1
 * nearest-sample gate packet F3's acceptance list names directly: "the
 * decal writes the exact chart glyph at 1:1 (mutation: switch its sampling
 * from nearest to bilinear, which must go red)". The source and target
 * grids below use an adjacent-cell CHECKERBOARD of contrasting colours
 * deliberately — a bilinear blend of two neighbours would land on a THIRD
 * colour no source cell carries, so asserting exact colour equality (not
 * merely glyph equality) is what actually catches that mutation.
 */
import { describe, expect, it } from "vitest";
import { buildCellGrid, composeGlyphEffects } from "glyphcss";
import { glyphGridDecalEffect } from "./decal";

function sourceGrid() {
  // 2x2, every cell a distinct glyph and a distinct, high-contrast colour.
  return buildCellGrid(
    ["A", "B", "C", "D"],
    ["#ff0000", "#00ff00", "#0000ff", "#ffff00"],
    new Float64Array(4),
    2,
    2,
  );
}

/** Same 2x2 shape as `sourceGrid`, but cell 1 is blank AND colourless — the exact-1:1 case `sourceGrid` alone can't exercise (a painted target starts blank/colourless too, so a bug that leaves it untouched is invisible). */
function sourceGridWithBlankCell() {
  return buildCellGrid(
    ["A", " ", "C", "D"],
    ["#ff0000", null, "#0000ff", "#ffff00"],
    new Float64Array(4),
    2,
    2,
  );
}

/** A blank 2x2 target whose `uv0` lands EXACTLY on each source cell's own centre — the 1:1 case. */
function targetGridAt1to1() {
  const uv0 = new Float32Array(8);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const i = row * 2 + col;
      uv0[i * 2] = (col + 0.5) / 2;
      uv0[i * 2 + 1] = (row + 0.5) / 2;
    }
  }
  return buildCellGrid([" ", " ", " ", " "], [null, null, null, null], new Float64Array(4), 2, 2, uv0);
}

/** Same `uv0` mapping as `targetGridAt1to1`, but every cell starts PAINTED and COLOURED — so "exact 1:1" can be told apart from "leaves the mesh's own glyph/colour showing through". */
function paintedTargetGridAt1to1() {
  const blank = targetGridAt1to1();
  return buildCellGrid(["Q", "Q", "Q", "Q"], ["#111111", "#111111", "#111111", "#111111"], new Float64Array(4), 2, 2, blank.surfaceUv!);
}

describe("glyphGridDecalEffect", () => {
  it("writes the exact chart glyph AND colour at 1:1 (never a blended colour)", () => {
    const source = sourceGrid();
    const target = targetGridAt1to1();
    const composed = composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: source },
    ]);
    expect(composed.char).toEqual(source.char);
    expect(composed.color).toEqual(source.color);
  });

  it("samples NEAREST at an off-centre uv0 near a source cell's shared corner — the checkerboard test's exact-texel-centre uv0 can never distinguish nearest from bilinear (mutation: switching to a bilinear blend must go red)", () => {
    const source = sourceGrid();
    // (0.499, 0.499) sits inside source cell (col 0, row 0) = "A"/red by
    // `Math.floor` (`floor(0.499 * 2) === 0` on both axes), but only 0.002
    // cells from (0.5, 0.5) — the shared CORNER of all four source cells,
    // the point where a bilinear reconstruction would blend in the largest
    // possible contribution from its neighbours (up to ~50% weight each),
    // landing on a colour no source cell carries.
    const uv0 = new Float32Array([0.499, 0.499]);
    const target = buildCellGrid([" "], [null], new Float64Array(1), 1, 1, uv0);
    const composed = composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: source },
    ]);
    expect(composed.char[0]).toBe("A");
    expect(composed.color[0]).toBe("#ff0000");
  });

  it("writes a blank source cell verbatim over a PAINTED target cell — a blend: \"over\" must not let the mesh's own glyph show through a deliberately blank source", () => {
    const source = sourceGridWithBlankCell();
    const target = paintedTargetGridAt1to1();
    const composed = composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: source },
    ]);
    // Cell 1's source is blank/colourless; every OTHER cell is a real
    // glyph+colour, so this also confirms a painted target is still fully
    // overwritten where the source has real content.
    expect(composed.char).toEqual(source.char);
    expect(composed.char[1]).toBe(" ");
  });

  it("writes a null source colour verbatim over a COLOURED target cell — the mesh's own colour must not survive underneath a colourless source", () => {
    const source = sourceGridWithBlankCell();
    const target = paintedTargetGridAt1to1();
    const composed = composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: source },
    ]);
    expect(composed.color).toEqual(source.color);
    expect(composed.color[1]).toBeNull();
  });

  it("leaves a cell with no authored uv0 untouched", () => {
    const source = sourceGrid();
    const uv0 = new Float32Array(8).fill(Number.NaN);
    // Only cell 0 carries a real UV, landing on source cell 3 ("D").
    uv0[0] = 0.9;
    uv0[1] = 0.9;
    const target = buildCellGrid(["x", "y", "z", "w"], [null, null, null, null], new Float64Array(4), 2, 2, uv0);
    const composed = composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: source },
    ]);
    expect(composed.char).toEqual(["D", "y", "z", "w"]);
  });

  it("rejects a program payload that isn't a well-formed CellGrid", () => {
    const target = targetGridAt1to1();
    expect(() => composeGlyphEffects(target, [
      { effect: glyphGridDecalEffect, program: { not: "a grid" }, blend: "replace" },
    ])).toThrow(TypeError);
  });

  it("composing twice at the same program gives byte-identical output", () => {
    const source = sourceGrid();
    const target = targetGridAt1to1();
    const layers: Parameters<typeof composeGlyphEffects>[1] = [
      { effect: glyphGridDecalEffect, program: source },
    ];
    const first = composeGlyphEffects(target, layers);
    const second = composeGlyphEffects(target, layers);
    expect(second.char).toEqual(first.char);
    expect(second.color).toEqual(first.color);
  });
});
