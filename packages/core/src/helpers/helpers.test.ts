import { describe, expect, it } from "vitest";
import { axesHelperPolygons } from "./axesPolygons";
import { octahedronPolygons } from "./octahedronPolygons";
import { tetrahedronPolygons } from "./tetrahedronPolygons";
import { cubePolygons } from "./cubePolygons";
import { dodecahedronPolygons } from "./dodecahedronPolygons";
import { icosahedronPolygons } from "./icosahedronPolygons";

describe("axesHelperPolygons", () => {
  it("returns 18 quads (6 per axis × 3 axes)", () => {
    const polygons = axesHelperPolygons({ size: 4 });
    expect(polygons).toHaveLength(18);
    for (const p of polygons) expect(p.vertices).toHaveLength(4);
  });

  it("uses red/green/blue defaults for X/Y/Z", () => {
    const polygons = axesHelperPolygons({ size: 4 });
    expect(polygons[0].color).toBe("#ff3a3a");   // X bar (first 6)
    expect(polygons[6].color).toBe("#3aff3a");   // Y bar (next 6)
    expect(polygons[12].color).toBe("#3a8aff");  // Z bar (last 6)
  });

  it("respects custom axis colors", () => {
    const polygons = axesHelperPolygons({
      size: 4,
      xColor: "#aa0000",
      yColor: "#00bb00",
      zColor: "#0000cc",
    });
    expect(polygons[0].color).toBe("#aa0000");
    expect(polygons[6].color).toBe("#00bb00");
    expect(polygons[12].color).toBe("#0000cc");
  });

  it("each X-axis bar vertex has only +X (or 0) world coordinates by default", () => {
    const xBar = axesHelperPolygons({ size: 5, thickness: 0.04 }).slice(0, 6);
    for (const poly of xBar) {
      for (const [x] of poly.vertices) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it("negative=true extends each bar through the origin (−size to +size)", () => {
    const xBar = axesHelperPolygons({ size: 5, thickness: 0.04, negative: true }).slice(0, 6);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const poly of xBar) {
      for (const [x] of poly.vertices) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    expect(minX).toBe(-5);
    expect(maxX).toBe(5);
  });

  it("scales the bar cross-section by `thickness * size / 2`", () => {
    const polygons = axesHelperPolygons({ size: 10, thickness: 0.1 });
    // Y- and Z-coordinates of the X-axis bar should range over ±0.5
    const xBar = polygons.slice(0, 6);
    let maxY = -Infinity;
    for (const poly of xBar) {
      for (const [, y] of poly.vertices) if (y > maxY) maxY = y;
    }
    expect(maxY).toBeCloseTo(0.5, 5);
  });
});

describe("octahedronPolygons", () => {
  it("returns 8 triangular faces", () => {
    const polygons = octahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ffd54a" });
    expect(polygons).toHaveLength(8);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("centers all six pole vertices around the given center", () => {
    const polygons = octahedronPolygons({ center: [10, 20, 30], size: 2, color: "#ffd54a" });
    const allVerts = polygons.flatMap((p) => p.vertices);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of allVerts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    expect((minX + maxX) / 2).toBe(10);
    expect((minY + maxY) / 2).toBe(20);
    expect((minZ + maxZ) / 2).toBe(30);
    expect(maxX - minX).toBe(4);
  });

  it("propagates the color to every face", () => {
    const polygons = octahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff00ff" });
    for (const p of polygons) expect(p.color).toBe("#ff00ff");
  });

  it("uses white as the default color", () => {
    const polygons = octahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) expect(p.color).toBe("#ffffff");
  });
});

describe("tetrahedronPolygons", () => {
  it("returns 4 triangular faces", () => {
    const polygons = tetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff0000" });
    expect(polygons).toHaveLength(4);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygons have valid vertex arrays", () => {
    const polygons = tetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(typeof coord).toBe("number");
      }
    }
  });

  it("size option scales vertices linearly", () => {
    const small = tetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const large = tetrahedronPolygons({ center: [0, 0, 0], size: 3 });
    // Simpler sanity: max extent doubles proportionally.
    const allSmall = small.flatMap((p) => p.vertices);
    const allLarge = large.flatMap((p) => p.vertices);
    const maxSmall = Math.max(...allSmall.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    const maxLarge = Math.max(...allLarge.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    expect(maxLarge).toBeCloseTo(maxSmall * 3, 5);
  });

  it("position option translates the whole mesh", () => {
    const offset: [number, number, number] = [5, 10, 15];
    const base = tetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = tetrahedronPolygons({ center: offset, size: 1 });
    for (let i = 0; i < base.length; i++) {
      for (let j = 0; j < 3; j++) {
        expect(moved[i].vertices[j][0]).toBeCloseTo(base[i].vertices[j][0] + 5, 10);
        expect(moved[i].vertices[j][1]).toBeCloseTo(base[i].vertices[j][1] + 10, 10);
        expect(moved[i].vertices[j][2]).toBeCloseTo(base[i].vertices[j][2] + 15, 10);
      }
    }
  });

  it("color option propagates to every polygon", () => {
    const polygons = tetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#abcdef" });
    for (const p of polygons) expect(p.color).toBe("#abcdef");
  });

  it("uses white as the default color", () => {
    const polygons = tetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) expect(p.color).toBe("#ffffff");
  });
});

describe("cubePolygons", () => {
  it("returns 6 square faces", () => {
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2, color: "#00ff00" });
    expect(polygons).toHaveLength(6);
    for (const p of polygons) expect(p.vertices).toHaveLength(4);
  });

  it("all polygons have valid vertex arrays", () => {
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(typeof coord).toBe("number");
      }
    }
  });

  it("size option controls the edge length", () => {
    const polygons = cubePolygons({ center: [0, 0, 0], size: 4 });
    const allVerts = polygons.flatMap((p) => p.vertices);
    const maxCoord = Math.max(...allVerts.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    expect(maxCoord).toBeCloseTo(2, 10); // half-extent = size/2 = 2
  });

  it("position option translates the whole mesh", () => {
    const offset: [number, number, number] = [3, -2, 7];
    const base = cubePolygons({ center: [0, 0, 0], size: 1 });
    const moved = cubePolygons({ center: offset, size: 1 });
    for (let i = 0; i < base.length; i++) {
      for (let j = 0; j < 4; j++) {
        expect(moved[i].vertices[j][0]).toBeCloseTo(base[i].vertices[j][0] + 3, 10);
        expect(moved[i].vertices[j][1]).toBeCloseTo(base[i].vertices[j][1] - 2, 10);
        expect(moved[i].vertices[j][2]).toBeCloseTo(base[i].vertices[j][2] + 7, 10);
      }
    }
  });

  it("color option propagates to every polygon", () => {
    const polygons = cubePolygons({ center: [0, 0, 0], size: 1, color: "#112233" });
    for (const p of polygons) expect(p.color).toBe("#112233");
  });

  it("uses white as the default color", () => {
    const polygons = cubePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) expect(p.color).toBe("#ffffff");
  });
});

describe("dodecahedronPolygons", () => {
  it("returns 12 pentagonal faces", () => {
    const polygons = dodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#0000ff" });
    expect(polygons).toHaveLength(12);
    for (const p of polygons) expect(p.vertices).toHaveLength(5);
  });

  it("all polygons have valid vertex arrays", () => {
    const polygons = dodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(typeof coord).toBe("number");
      }
    }
  });

  it("size option scales vertices linearly", () => {
    const small = dodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const large = dodecahedronPolygons({ center: [0, 0, 0], size: 2 });
    const allSmall = small.flatMap((p) => p.vertices);
    const allLarge = large.flatMap((p) => p.vertices);
    const maxSmall = Math.max(...allSmall.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    const maxLarge = Math.max(...allLarge.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    expect(maxLarge).toBeCloseTo(maxSmall * 2, 5);
  });

  it("position option translates the whole mesh", () => {
    const offset: [number, number, number] = [1, 2, 3];
    const base = dodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = dodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    // Centroid of all vertices should shift by the offset.
    const n = allBase.length;
    const cx = allBase.reduce((s, v) => s + v[0], 0) / n;
    const cy = allBase.reduce((s, v) => s + v[1], 0) / n;
    const cz = allBase.reduce((s, v) => s + v[2], 0) / n;
    const mx = allMoved.reduce((s, v) => s + v[0], 0) / n;
    const my = allMoved.reduce((s, v) => s + v[1], 0) / n;
    const mz = allMoved.reduce((s, v) => s + v[2], 0) / n;
    expect(mx - cx).toBeCloseTo(1, 5);
    expect(my - cy).toBeCloseTo(2, 5);
    expect(mz - cz).toBeCloseTo(3, 5);
  });

  it("color option propagates to every polygon", () => {
    const polygons = dodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#fedcba" });
    for (const p of polygons) expect(p.color).toBe("#fedcba");
  });

  it("uses white as the default color", () => {
    const polygons = dodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) expect(p.color).toBe("#ffffff");
  });
});

describe("icosahedronPolygons", () => {
  it("returns 20 triangular faces", () => {
    const polygons = icosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff8800" });
    expect(polygons).toHaveLength(20);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygons have valid vertex arrays", () => {
    const polygons = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(typeof coord).toBe("number");
      }
    }
  });

  it("size option scales vertices linearly", () => {
    const small = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const large = icosahedronPolygons({ center: [0, 0, 0], size: 4 });
    const allSmall = small.flatMap((p) => p.vertices);
    const allLarge = large.flatMap((p) => p.vertices);
    const maxSmall = Math.max(...allSmall.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    const maxLarge = Math.max(...allLarge.flatMap(([x, y, z]) => [Math.abs(x), Math.abs(y), Math.abs(z)]));
    expect(maxLarge).toBeCloseTo(maxSmall * 4, 5);
  });

  it("position option translates the whole mesh", () => {
    const offset: [number, number, number] = [-5, 0, 3];
    const base = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = icosahedronPolygons({ center: offset, size: 1 });
    for (let i = 0; i < base.length; i++) {
      for (let j = 0; j < 3; j++) {
        expect(moved[i].vertices[j][0]).toBeCloseTo(base[i].vertices[j][0] - 5, 10);
        expect(moved[i].vertices[j][1]).toBeCloseTo(base[i].vertices[j][1] + 0, 10);
        expect(moved[i].vertices[j][2]).toBeCloseTo(base[i].vertices[j][2] + 3, 10);
      }
    }
  });

  it("color option propagates to every polygon", () => {
    const polygons = icosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aabbcc" });
    for (const p of polygons) expect(p.color).toBe("#aabbcc");
  });

  it("uses white as the default color", () => {
    const polygons = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) expect(p.color).toBe("#ffffff");
  });
});
