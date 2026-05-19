import { describe, expect, it } from "vitest";
import { axesHelperPolygons } from "./axesPolygons";
import { octahedronPolygons } from "./octahedronPolygons";
import { tetrahedronPolygons } from "./tetrahedronPolygons";
import { cubePolygons } from "./cubePolygons";
import { dodecahedronPolygons } from "./dodecahedronPolygons";
import { icosahedronPolygons } from "./icosahedronPolygons";
import { spherePolygons } from "./spherePolygons";
import { cylinderPolygons } from "./cylinderPolygons";
import { conePolygons } from "./conePolygons";
import { torusPolygons } from "./torusPolygons";
import { pyramidPolygons } from "./pyramidPolygons";
import { prismPolygons } from "./prismPolygons";
import { antiprismPolygons } from "./antiprismPolygons";
import { bipyramidPolygons } from "./bipyramidPolygons";
import { trapezohedronPolygons } from "./trapezohedronPolygons";

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

describe("spherePolygons", () => {
  it("returns 80 triangles at default subdivisions=1", () => {
    const polygons = spherePolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(80);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("returns 20 triangles at subdivisions=0 (bare icosahedron)", () => {
    const polygons = spherePolygons({ center: [0, 0, 0], size: 1, subdivisions: 0 });
    expect(polygons).toHaveLength(20);
  });

  it("returns 320 triangles at subdivisions=2", () => {
    const polygons = spherePolygons({ center: [0, 0, 0], size: 1, subdivisions: 2 });
    expect(polygons).toHaveLength(320);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = spherePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies exactly on the sphere surface (distance from center == size)", () => {
    const size = 2.5;
    const polygons = spherePolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("center offset shifts all vertices by that offset", () => {
    const offset: [number, number, number] = [3, -1, 5];
    const base = spherePolygons({ center: [0, 0, 0], size: 1 });
    const moved = spherePolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    const bCx = allBase.reduce((s, v) => s + v[0], 0) / n;
    const bCy = allBase.reduce((s, v) => s + v[1], 0) / n;
    const bCz = allBase.reduce((s, v) => s + v[2], 0) / n;
    const mCx = allMoved.reduce((s, v) => s + v[0], 0) / n;
    const mCy = allMoved.reduce((s, v) => s + v[1], 0) / n;
    const mCz = allMoved.reduce((s, v) => s + v[2], 0) / n;
    expect(mCx - bCx).toBeCloseTo(3, 5);
    expect(mCy - bCy).toBeCloseTo(-1, 5);
    expect(mCz - bCz).toBeCloseTo(5, 5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = spherePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = spherePolygons({ center: [0, 0, 0], size: 1, color: "#123456" });
    for (const p of colorPolygons) expect(p.color).toBe("#123456");
  });
});

describe("cylinderPolygons", () => {
  it("returns sides + 2 polygons at defaults (16 + 2 = 18)", () => {
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(polygons).toHaveLength(18);
  });

  it("respects a custom sides value", () => {
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    expect(polygons).toHaveLength(10); // 8 + 2
  });

  it("side quads have 4 vertices, caps have sides vertices", () => {
    const sides = 10;
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < sides; i++) expect(polygons[i].vertices).toHaveLength(4);
    expect(polygons[sides].vertices).toHaveLength(sides);     // top cap
    expect(polygons[sides + 1].vertices).toHaveLength(sides); // bottom cap
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("center offset shifts all vertex centroids", () => {
    const offset: [number, number, number] = [1, 2, 3];
    const base = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    const moved = cylinderPolygons({ center: offset, radius: 1, height: 2 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2, color: "#aabbcc" });
    for (const p of colorPolygons) expect(p.color).toBe("#aabbcc");
  });
});

describe("conePolygons", () => {
  it("returns sides + 1 polygons at defaults (16 + 1 = 17)", () => {
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(polygons).toHaveLength(17);
  });

  it("respects a custom sides value", () => {
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 6 });
    expect(polygons).toHaveLength(7); // 6 + 1
  });

  it("side faces are triangles, base cap is an N-gon", () => {
    const sides = 8;
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < sides; i++) expect(polygons[i].vertices).toHaveLength(3);
    expect(polygons[sides].vertices).toHaveLength(sides);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("center offset shifts all vertex centroids", () => {
    const offset: [number, number, number] = [5, 0, -2];
    const base = conePolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    const moved = conePolygons({ center: offset, radius: 1, height: 2 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(5, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2, color: "#ff0000" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff0000");
  });
});

describe("torusPolygons", () => {
  it("returns segments * sides quads at defaults (24 * 12 = 288)", () => {
    const polygons = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5 });
    expect(polygons).toHaveLength(288);
    for (const p of polygons) expect(p.vertices).toHaveLength(4);
  });

  it("respects custom segments and sides values", () => {
    const polygons = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5, segments: 8, sides: 6 });
    expect(polygons).toHaveLength(48); // 8 * 6
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("center offset shifts all vertex centroids", () => {
    const offset: [number, number, number] = [2, 4, -3];
    const base = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5 });
    const moved = torusPolygons({ center: offset, majorRadius: 2, minorRadius: 0.5 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(4, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-3, 5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = torusPolygons({ center: [0, 0, 0], majorRadius: 2, minorRadius: 0.5, color: "#00ff00" });
    for (const p of colorPolygons) expect(p.color).toBe("#00ff00");
  });
});

describe("pyramidPolygons", () => {
  it("returns sides + 1 polygons at defaults (4 + 1 = 5, square pyramid)", () => {
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(polygons).toHaveLength(5);
  });

  it("respects a custom sides value", () => {
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 6 });
    expect(polygons).toHaveLength(7); // 6 + 1
  });

  it("side faces are triangles, base cap is an N-gon", () => {
    const sides = 5;
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < sides; i++) expect(polygons[i].vertices).toHaveLength(3);
    expect(polygons[sides].vertices).toHaveLength(sides);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("center offset shifts all vertex centroids", () => {
    const offset: [number, number, number] = [-1, 3, 2];
    const base = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    const moved = pyramidPolygons({ center: offset, radius: 1, height: 2 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2, color: "#654321" });
    for (const p of colorPolygons) expect(p.color).toBe("#654321");
  });
});

describe("prismPolygons", () => {
  it("returns sides + 2 polygons at defaults (6 + 2 = 8)", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(polygons).toHaveLength(8);
  });

  it("respects sides=3 (triangular prism, 5 polygons)", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 3 });
    expect(polygons).toHaveLength(5); // 3 + 2
  });

  it("respects sides=8 (octagonal prism, 10 polygons)", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    expect(polygons).toHaveLength(10); // 8 + 2
  });

  it("side faces are quads, cap faces are N-gons", () => {
    const sides = 6;
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < sides; i++) expect(polygons[i].vertices).toHaveLength(4);
    expect(polygons[sides].vertices).toHaveLength(sides);     // top cap
    expect(polygons[sides + 1].vertices).toHaveLength(sides); // bottom cap
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2, color: "#aabbcc" });
    for (const p of colorPolygons) expect(p.color).toBe("#aabbcc");
  });

  it("center offset shifts the bounding box centroid by exactly the offset", () => {
    const offset: [number, number, number] = [3, -1, 2];
    const base = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    const moved = prismPolygons({ center: offset, radius: 1, height: 2 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });
});

describe("antiprismPolygons", () => {
  it("returns 2*sides + 2 polygons at defaults (2*6 + 2 = 14)", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(polygons).toHaveLength(14);
  });

  it("respects sides=3 (triangular antiprism, 8 polygons)", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 3 });
    expect(polygons).toHaveLength(8); // 2*3 + 2
  });

  it("respects sides=8 (octagonal antiprism, 18 polygons)", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    expect(polygons).toHaveLength(18); // 2*8 + 2
  });

  it("side faces are triangles, cap faces are N-gons", () => {
    const sides = 6;
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < 2 * sides; i++) expect(polygons[i].vertices).toHaveLength(3);
    expect(polygons[2 * sides].vertices).toHaveLength(sides);     // top cap
    expect(polygons[2 * sides + 1].vertices).toHaveLength(sides); // bottom cap
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2, color: "#112233" });
    for (const p of colorPolygons) expect(p.color).toBe("#112233");
  });

  it("center offset shifts the bounding box centroid by exactly the offset", () => {
    const offset: [number, number, number] = [1, 4, -2];
    const base = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    const moved = antiprismPolygons({ center: offset, radius: 1, height: 2 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(4, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });
});

describe("bipyramidPolygons", () => {
  it("returns 2*sides polygons at defaults (2*6 = 12)", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    expect(polygons).toHaveLength(12);
  });

  it("respects sides=3 (triangular bipyramid, 6 polygons)", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 3 });
    expect(polygons).toHaveLength(6); // 2*3
  });

  it("respects sides=8 (octagonal bipyramid, 16 polygons)", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 8 });
    expect(polygons).toHaveLength(16); // 2*8
  });

  it("every face is a triangle", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, color: "#ff8800" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff8800");
  });

  it("center offset shifts the bounding box centroid by exactly the offset", () => {
    const offset: [number, number, number] = [-2, 5, 1];
    const base = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    const moved = bipyramidPolygons({ center: offset, radius: 1, halfHeight: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(5, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(1, 5);
  });
});

describe("trapezohedronPolygons", () => {
  it("returns 2*sides polygons at defaults (2*5 = 10)", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    expect(polygons).toHaveLength(10);
  });

  it("respects sides=3 (trigonal trapezohedron, 6 polygons)", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 3 });
    expect(polygons).toHaveLength(6); // 2*3
  });

  it("respects sides=8 (octagonal trapezohedron, 16 polygons)", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 8 });
    expect(polygons).toHaveLength(16); // 2*8
  });

  it("every face is a kite (4 vertices)", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of polygons) expect(p.vertices).toHaveLength(4);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, color: "#abcdef" });
    for (const p of colorPolygons) expect(p.color).toBe("#abcdef");
  });

  it("center offset shifts the bounding box centroid by exactly the offset", () => {
    const offset: [number, number, number] = [2, -3, 4];
    const base = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    const moved = trapezohedronPolygons({ center: offset, radius: 1, halfHeight: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-3, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(4, 5);
  });

  it("each kite face is planar (4th vertex lies on the plane of the first 3)", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    for (const p of polygons) {
      const [a, b, c, d] = p.vertices as [[number,number,number],[number,number,number],[number,number,number],[number,number,number]];
      // Normal from first 3 vertices
      const ab: [number,number,number] = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      const ac: [number,number,number] = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const nx = ab[1]*ac[2] - ab[2]*ac[1];
      const ny = ab[2]*ac[0] - ab[0]*ac[2];
      const nz = ab[0]*ac[1] - ab[1]*ac[0];
      // Signed distance of 4th vertex from the plane
      const ad: [number,number,number] = [d[0]-a[0], d[1]-a[1], d[2]-a[2]];
      const dot = ad[0]*nx + ad[1]*ny + ad[2]*nz;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      const residual = Math.abs(dot) / (len || 1);
      expect(residual).toBeLessThan(1e-6);
    }
  });
});
