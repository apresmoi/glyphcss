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
