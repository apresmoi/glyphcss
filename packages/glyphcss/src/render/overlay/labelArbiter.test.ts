import { describe, expect, it } from "vitest";
import type { CellGrid } from "../cells";
import { createGlyphLabelArbiter } from "./labelArbiter";

/**
 * Mutation-sensitive coverage for the fix in `labelArbiter.ts`'s `resolve()`:
 * a label must never print through a mesh (or a cross-layer `occluded`
 * cell) that isn't its own, even when the cover lands under a MIDDLE
 * character rather than the anchor. Each `it` names the mutation that must
 * turn it red — deleting the property under test, not merely asserting the
 * happy path.
 */
function makeGrid(cols: number, rows: number, opts?: { winnerMesh?: number[]; occluded?: number[] }): CellGrid {
  const n = cols * rows;
  const screenX = new Int32Array(n);
  const screenY = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    screenX[i] = i % cols;
    screenY[i] = (i / cols) | 0;
  }
  const grid: CellGrid = {
    cols,
    rows,
    char: new Array(n).fill(" "),
    color: new Array(n).fill(null),
    depth: new Float64Array(n).fill(-Infinity),
    screenX,
    screenY,
  };
  if (opts?.winnerMesh) grid.winnerMesh = new Int32Array(opts.winnerMesh);
  if (opts?.occluded) grid.occluded = new Uint8Array(opts.occluded);
  return grid;
}

function rowText(grid: CellGrid, row: number): string {
  return grid.char.slice(row * grid.cols, row * grid.cols + grid.cols).join("");
}

describe("createGlyphLabelArbiter", () => {
  it("drops the whole label when a foreign mesh covers a MIDDLE character, not just the anchor (mutation: check only the anchor cell) -> red", () => {
    // 5-wide "LABEL" at row 0, cols 0..4. winnerMesh id 7 (foreign, not in
    // ownMeshIds {1}) sits under column 2 — the "B" — while every other cell,
    // including the anchor, is unowned (-1).
    const grid = makeGrid(5, 1, { winnerMesh: [-1, -1, 7, -1, -1] });
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL", ownMeshIds: new Set([1]) });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("     ");
  });

  it("never hides a label behind its OWN mesh (mutation: treat own meshes as foreign) -> red", () => {
    const grid = makeGrid(5, 1, { winnerMesh: [1, 1, 1, 1, 1] });
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL", ownMeshIds: new Set([1]) });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("LABEL");
  });

  it("drops a label when a cross-layer occluded cell sits under a middle character (mutation: never check `grid.occluded`) -> red", () => {
    const grid = makeGrid(5, 1, { occluded: [0, 0, 1, 0, 0] });
    const arbiter = createGlyphLabelArbiter();
    // No ownMeshIds at all — occlusion is a cross-layer-ownership question,
    // independent of mesh identity, so it must still drop the label.
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL" });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("     ");
  });

  it("is byte-identical to the pre-fix behaviour when no mesh/occlusion buffers are involved anywhere", () => {
    const grid = makeGrid(5, 1);
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL" });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("LABEL");
  });

  it("still drops a label on an ordinary anchor-cell foreign cover (the pre-existing case stays covered)", () => {
    const grid = makeGrid(5, 1, { winnerMesh: [7, -1, -1, -1, -1] });
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL", ownMeshIds: new Set([1]) });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("     ");
  });

  it("a label running past the grid's own width is cropped, not treated as foreign-covered", () => {
    const grid = makeGrid(3, 1, { winnerMesh: [-1, -1, -1] });
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "a", priority: 0, col: 0, row: 0, text: "LABEL", ownMeshIds: new Set([1]) });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("LAB");
  });

  it("still resolves priority-then-id ordering and collision dropping exactly as before", () => {
    const grid = makeGrid(6, 1);
    const arbiter = createGlyphLabelArbiter();
    arbiter.place({ id: "low", priority: 0, col: 0, row: 0, text: "AAA" });
    arbiter.place({ id: "high", priority: 1, col: 0, row: 0, text: "BBB" });
    arbiter.resolve(grid);
    expect(rowText(grid, 0)).toBe("BBB   ");
  });
});
