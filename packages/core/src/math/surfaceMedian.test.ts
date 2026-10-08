import { describe, expect, it } from "vitest";
import { createSurfaceMedianScratch, surfaceMedianOfBlock } from "./surfaceMedian";

describe("surfaceMedianOfBlock", () => {
  it("returns the flat value for a perfectly flat field", () => {
    const stride = 3;
    const values = new Float64Array([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const scratch = createSurfaceMedianScratch(4);
    expect(surfaceMedianOfBlock({ stride, values }, scratch, 0, 2, 0, 2)).toBeCloseTo(5, 10);
  });

  it("is the midpoint for a single cell that ramps uniformly west to east", () => {
    // Corners west=0/east=10 at every row: the surface is uniform on
    // [0, 10], so its area-median is exactly 5.
    const stride = 2;
    const values = new Float64Array([0, 10, 0, 10]);
    const scratch = createSurfaceMedianScratch(4);
    expect(surfaceMedianOfBlock({ stride, values }, scratch, 0, 1, 0, 1)).toBeCloseTo(5, 6);
  });

  it("reads the AREA rather than a 3-of-4 corner vote (AGENTS.md's Buenos Aires case)", () => {
    // Corners nw=-1, ne=-1, sw=+12, se=-1 — 3 of 4 corners negative, so a
    // sample/vote statistic returns -1 (still "underwater"), but the
    // SURFACE between them is mostly the sw corner's positive wedge: the
    // area-median must be positive.
    const stride = 2;
    const values = new Float64Array([-1, -1, 12, -1]);
    const scratch = createSurfaceMedianScratch(4);
    const median = surfaceMedianOfBlock({ stride, values }, scratch, 0, 1, 0, 1);
    expect(median).toBeGreaterThan(0);
  });

  it("lands exactly at the higher level when a point mass ties the low half (a flat-cell atom)", () => {
    // Block of two cells sharing a vertex: cell0 ramps 0 -> 10 west to
    // east (a uniform interval per strip); cell1 is FLAT at 10 (an atom).
    // Equal interval/atom mass means the CDF only reaches half exactly at
    // h = 10 (the atom), which the smallest-h-with-CDF->=half search must
    // return as 10, not linger just under it.
    const stride = 3;
    // row0: col0=0, col1=10, col2=10 ; row1: same (both rows identical).
    const values = new Float64Array([0, 10, 10, 0, 10, 10]);
    const scratch = createSurfaceMedianScratch(16);
    const median = surfaceMedianOfBlock({ stride, values }, scratch, 0, 2, 0, 1);
    expect(median).toBeCloseTo(10, 6);
  });

  it("scales strips down for a taller block without losing exactness along rows", () => {
    const stride = 2;
    const rows = 4;
    const values = new Float64Array(stride * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      values[r * stride] = 0;
      values[r * stride + 1] = 10;
    }
    const scratch = createSurfaceMedianScratch(rows * 4);
    expect(surfaceMedianOfBlock({ stride, values }, scratch, 0, 1, 0, rows)).toBeCloseTo(5, 5);
  });

  it("skips a cell with a non-finite corner rather than poisoning the block", () => {
    const stride = 3;
    // Left cell has a NaN corner; right cell is flat at 7.
    const values = new Float64Array([NaN, 7, 7, NaN, 7, 7]);
    const scratch = createSurfaceMedianScratch(8);
    const median = surfaceMedianOfBlock({ stride, values }, scratch, 0, 2, 0, 1);
    expect(median).toBeCloseTo(7, 6);
  });

  it("falls back to the 4-corner mean when every cell in the block is broken", () => {
    const stride = 3;
    // A poisoned middle column (col 1 = NaN) breaks BOTH cells of a
    // col-0..2 block, but the block's own 4 outer corners (col 0 and 2)
    // stay finite — the fallback the doc describes.
    const values = new Float64Array([10, NaN, 20, 30, NaN, 40]);
    const scratch = createSurfaceMedianScratch(8);
    const median = surfaceMedianOfBlock({ stride, values }, scratch, 0, 2, 0, 1);
    expect(median).toBeCloseTo((10 + 20 + 30 + 40) / 4, 10);
  });
});
