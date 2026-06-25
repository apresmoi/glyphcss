import { describe, it, expect } from "vitest";
import { decimatePolygons } from "./decimatePolygons";
import { cubePolygons } from "../helpers";
import type { Polygon, Vec3 } from "../types";

function bboxOf(polys: Polygon[]): { min: Vec3; max: Vec3 } {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const v of p.vertices) {
    for (let i = 0; i < 3; i++) { if (v[i] < min[i]) min[i] = v[i]; if (v[i] > max[i]) max[i] = v[i]; }
  }
  return { min, max };
}

// A dense sphere-ish mesh: many small triangles → over-detailed for a coarse grid.
function denseSphere(rings = 24, segs = 24): Polygon[] {
  const polys: Polygon[] = [];
  const at = (i: number, j: number): Vec3 => {
    const theta = (i / rings) * Math.PI;
    const phi = (j / segs) * 2 * Math.PI;
    return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    polys.push({ vertices: [at(i, j), at(i + 1, j), at(i + 1, j + 1)], color: "#ffffff" });
    polys.push({ vertices: [at(i, j), at(i + 1, j + 1), at(i, j + 1)], color: "#ffffff" });
  }
  return polys;
}

describe("decimatePolygons", () => {
  it("drastically reduces triangle count on an over-detailed mesh", () => {
    const dense = denseSphere(); // ~1150 tris
    const out = decimatePolygons(dense, { grid: 6 });
    expect(dense.length).toBeGreaterThan(800);
    expect(out.length).toBeLessThan(dense.length / 3);
    expect(out.length).toBeGreaterThan(0);
  });

  it("preserves the bounding box (silhouette) within one cell", () => {
    const dense = denseSphere();
    const grid = 10;
    const out = decimatePolygons(dense, { grid });
    const a = bboxOf(dense), b = bboxOf(out);
    const extent = Math.max(a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]);
    const tol = (extent / grid) * 1.01;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(b.min[i] - a.min[i])).toBeLessThanOrEqual(tol);
      expect(Math.abs(b.max[i] - a.max[i])).toBeLessThanOrEqual(tol);
    }
  });

  it("keeps every output polygon a real (non-degenerate) triangle", () => {
    const out = decimatePolygons(denseSphere(), { grid: 6 });
    for (const p of out) {
      const set = new Set(p.vertices.map((v) => v.join(",")));
      expect(set.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("is a no-op-ish for already-coarse meshes (cube stays a cube)", () => {
    const cube = cubePolygons({ center: [0, 0, 0], size: 2 });
    const out = decimatePolygons(cube, { grid: 64 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(cube.length);
  });

  it("handles empty input", () => {
    expect(decimatePolygons([], { grid: 8 })).toEqual([]);
  });

  it("a finer grid keeps more detail than a coarser one", () => {
    const dense = denseSphere();
    const coarse = decimatePolygons(dense, { grid: 4 });
    const fine = decimatePolygons(dense, { grid: 16 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});
