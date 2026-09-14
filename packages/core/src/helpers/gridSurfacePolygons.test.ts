import { describe, expect, it } from "vitest";
import { gridSurfacePolygons } from "./gridSurfacePolygons";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

describe("gridSurfacePolygons", () => {
  it("builds 2 triangles per quad, CCW from +z, over a flat grid", () => {
    const { polygons, decimation } = gridSurfacePolygons({ z: flatGrid(3, 3) });
    // 2x2 quads (3x3 vertices) x 2 triangles.
    expect(polygons).toHaveLength(8);
    expect(decimation.decimated).toBe(false);
    for (const p of polygons) {
      expect(p.vertices).toHaveLength(3);
      const [a, b, c] = p.vertices;
      const e1 = [b![0] - a![0], b![1] - a![1]] as const;
      const e2 = [c![0] - a![0], c![1] - a![1]] as const;
      const cross = e1[0] * e2[1] - e1[1] * e2[0];
      expect(cross).toBeGreaterThan(0); // CCW as seen from +z
    }
  });

  it("normalizes x/y to [0,1] uniformly by default", () => {
    const { polygons } = gridSurfacePolygons({ z: flatGrid(2, 2) });
    const xs = polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    const ys = polygons.flatMap((p) => p.vertices.map((v) => v[1]));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(1);
  });

  it("carries z straight through as the vertex height", () => {
    const z = [
      [0, 0.5],
      [1, 0.25],
    ];
    const { polygons } = gridSurfacePolygons({ z });
    const zs = polygons.flatMap((p) => p.vertices.map((v) => v[2])).sort((a, b) => a - b);
    expect(zs).toContain(0);
    expect(zs).toContain(0.25);
    expect(zs).toContain(0.5);
    expect(zs).toContain(1);
  });

  it("reports the global argmax/argmin grid indices", () => {
    const z = [
      [0, 0, 0],
      [0, 9, 0],
      [0, 0, -3],
    ];
    const { argmax, argmin } = gridSurfacePolygons({ z });
    expect(argmax).toEqual({ row: 1, col: 1 });
    expect(argmin).toEqual({ row: 2, col: 2 });
  });

  it("MUTATION: decimation always keeps the argmax and argmin lines", () => {
    // A 9x9 grid decimated down to 2 quads/axis (3 vertices/axis) would,
    // under plain uniform sampling, land its samples at indices 0/4/8 —
    // missing a peak/trough placed off that lattice.
    const rows = 9, cols = 9;
    const z = flatGrid(rows, cols, 0);
    z[2]![6] = 100; // argmax off the uniform 0/4/8 lattice
    z[7]![1] = -100; // argmin off the uniform 0/4/8 lattice
    const { decimation, argmax, argmin } = gridSurfacePolygons({ z }, { maxQuadsX: 2, maxQuadsY: 2 });
    expect(decimation.rowIndices).toContain(argmax.row);
    expect(decimation.colIndices).toContain(argmax.col);
    expect(decimation.rowIndices).toContain(argmin.row);
    expect(decimation.colIndices).toContain(argmin.col);
    expect(decimation.decimated).toBe(true);
    // The property under test: a plain uniform 3-of-9 sample (no
    // required-index nudging) lands at [0, 4, 8] on both axes, which
    // contains NEITHER extremum placed here — so dropping the nudge turns
    // the assertions above red.
    const uniformOnly = [0, 4, 8];
    expect(uniformOnly.includes(argmax.row) || uniformOnly.includes(argmax.col)).toBe(false);
    expect(uniformOnly.includes(argmin.row) || uniformOnly.includes(argmin.col)).toBe(false);
  });

  it("never exceeds the requested quad budget even after nudging in required lines", () => {
    const rows = 20, cols = 20;
    const z = flatGrid(rows, cols, 0);
    z[5]![5] = 50;
    z[15]![15] = -50;
    const { decimation } = gridSurfacePolygons({ z }, { maxQuadsX: 4, maxQuadsY: 4 });
    expect(decimation.rowIndices.length).toBeLessThanOrEqual(5);
    expect(decimation.colIndices.length).toBeLessThanOrEqual(5);
  });

  it("passes the ORIGINAL (pre-decimation) block bounds to the colour callback", () => {
    const rows = 5, cols = 5;
    const z = flatGrid(rows, cols, 0);
    const blocks: Array<{ row0: number; row1: number; col0: number; col1: number }> = [];
    gridSurfacePolygons({ z }, {
      maxQuadsX: 2,
      maxQuadsY: 2,
      color: (block) => {
        blocks.push(block);
        return "#112233";
      },
    });
    for (const b of blocks) {
      expect(b.row1).toBeGreaterThan(b.row0);
      expect(b.col1).toBeGreaterThan(b.col0);
      expect(b.row1).toBeLessThanOrEqual(rows - 1);
      expect(b.col1).toBeLessThanOrEqual(cols - 1);
    }
    // 2x2 quads => 4 colour calls (one per quad, both triangles share it).
    expect(blocks).toHaveLength(4);
  });

  it("colours both triangles of a quad identically", () => {
    const z = flatGrid(2, 2, 0);
    const { polygons } = gridSurfacePolygons({ z }, { color: () => "#abcdef" });
    expect(polygons).toHaveLength(2);
    expect(polygons[0]!.color).toBe("#abcdef");
    expect(polygons[1]!.color).toBe("#abcdef");
  });

  it("leaves a quad uncoloured when the colour callback returns undefined", () => {
    const z = flatGrid(2, 2, 0);
    const { polygons } = gridSurfacePolygons({ z }, { color: () => undefined });
    for (const p of polygons) expect(p.color).toBeUndefined();
  });

  it("rejects a grid smaller than 2x2", () => {
    expect(() => gridSurfacePolygons({ z: [[0]] })).toThrow(RangeError);
  });

  it("rejects a ragged grid", () => {
    expect(() => gridSurfacePolygons({ z: [[0, 0], [0]] })).toThrow(RangeError);
  });

  it("rejects non-finite z", () => {
    expect(() => gridSurfacePolygons({ z: [[0, NaN], [0, 0]] })).toThrow(RangeError);
  });

  it("splits each quad on its own shorter 3D diagonal", () => {
    // A saddle-shaped 2x2 grid where the nw-se diagonal is intentionally
    // much taller (and thus longer) than the ne-sw diagonal.
    const z = [
      [0, 5],
      [5, 10],
    ];
    const { polygons } = gridSurfacePolygons({ z });
    // ne=(1,0,5), sw=(0,1,5) — a flat diagonal (z equal at both ends);
    // nw=(0,0,0), se=(1,1,10) — a much taller diagonal. The shorter
    // diagonal (ne-sw) must be the shared edge: both triangles contain
    // ne AND sw.
    const containsPoint = (v: readonly number[], p: readonly number[]) =>
      Math.abs(v[0]! - p[0]!) < 1e-9 && Math.abs(v[1]! - p[1]!) < 1e-9 && Math.abs(v[2]! - p[2]!) < 1e-9;
    for (const poly of polygons) {
      const hasNe = poly.vertices.some((v) => containsPoint(v, [1, 0, 5]));
      const hasSw = poly.vertices.some((v) => containsPoint(v, [0, 1, 5]));
      expect(hasNe && hasSw).toBe(true);
    }
  });
});
