import { describe, expect, it } from "vitest";
import { cuboctahedronPolygons } from "./cuboctahedronPolygons";
import { icosidodecahedronPolygons } from "./icosidodecahedronPolygons";
import { truncatedTetrahedronPolygons } from "./truncatedTetrahedronPolygons";
import { truncatedCubePolygons } from "./truncatedCubePolygons";
import { truncatedOctahedronPolygons } from "./truncatedOctahedronPolygons";
import { truncatedDodecahedronPolygons } from "./truncatedDodecahedronPolygons";
import { truncatedIcosahedronPolygons } from "./truncatedIcosahedronPolygons";
import { truncatedCuboctahedronPolygons } from "./truncatedCuboctahedronPolygons";
import { truncatedIcosidodecahedronPolygons } from "./truncatedIcosidodecahedronPolygons";
import { rhombicuboctahedronPolygons } from "./rhombicuboctahedronPolygons";
import { rhombicosidodecahedronPolygons } from "./rhombicosidodecahedronPolygons";
import { snubCubePolygons } from "./snubCubePolygons";
import { snubDodecahedronPolygons } from "./snubDodecahedronPolygons";
import { smallStellatedDodecahedronPolygons } from "./smallStellatedDodecahedronPolygons";
import { greatDodecahedronPolygons } from "./greatDodecahedronPolygons";
import { greatStellatedDodecahedronPolygons } from "./greatStellatedDodecahedronPolygons";
import { greatIcosahedronPolygons } from "./greatIcosahedronPolygons";
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
import { rhombicDodecahedronPolygons } from "./rhombicDodecahedronPolygons";
import { rhombicTriacontahedronPolygons } from "./rhombicTriacontahedronPolygons";
import { triakisTetrahedronPolygons } from "./triakisTetrahedronPolygons";
import { triakisOctahedronPolygons } from "./triakisOctahedronPolygons";
import { tetrakisHexahedronPolygons } from "./tetrakisHexahedronPolygons";
import { triakisIcosahedronPolygons } from "./triakisIcosahedronPolygons";
import { pentakisDodecahedronPolygons } from "./pentakisDodecahedronPolygons";
import { disdyakisDodecahedronPolygons } from "./disdyakisDodecahedronPolygons";
import { disdyakisTriacontahedronPolygons } from "./disdyakisTriacontahedronPolygons";
import { deltoidalIcositetrahedronPolygons } from "./deltoidalIcositetrahedronPolygons";
import { deltoidalHexecontahedronPolygons } from "./deltoidalHexecontahedronPolygons";
import { pentagonalIcositetrahedronPolygons } from "./pentagonalIcositetrahedronPolygons";
import { pentagonalHexecontahedronPolygons } from "./pentagonalHexecontahedronPolygons";

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

// ── Winding correctness tests (Bug 1 guard) ───────────────────────────────
//
// For each axially-symmetric helper we verify that the face normal of the
// first SIDE face (index 0) points OUTWARD — i.e. the dot product of the
// face normal with the face centroid (radial direction) is positive.
//
// Convention: outward normal = (B - A) × (C - A) for CCW winding from outside.

function crossProduct(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): [number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function faceCentroid(verts: readonly [number, number, number][]): [number, number, number] {
  const n = verts.length;
  return [
    verts.reduce((s, v) => s + v[0], 0) / n,
    verts.reduce((s, v) => s + v[1], 0) / n,
    verts.reduce((s, v) => s + v[2], 0) / n,
  ];
}

/** Positive dot → normal points outward (same general direction as centroid from origin). */
function normalDotCentroid(poly: { vertices: [number, number, number][] }): number {
  const [a, b, c] = poly.vertices as [number, number, number][];
  const n = crossProduct(a, b, c);
  const cen = faceCentroid(poly.vertices as [number, number, number][]);
  return n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2];
}

describe("conePolygons — outward normals", () => {
  it("side triangle [0] has an outward-facing normal", () => {
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    // polygons[0] is the first side triangle; its centroid is in the +X half-space.
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all side triangles have outward-facing normals", () => {
    const polygons = conePolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    for (let i = 0; i < 8; i++) {
      expect(normalDotCentroid(polygons[i] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("pyramidPolygons — outward normals", () => {
  it("side triangle [0] has an outward-facing normal", () => {
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all side triangles have outward-facing normals", () => {
    const polygons = pyramidPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 6 });
    for (let i = 0; i < 6; i++) {
      expect(normalDotCentroid(polygons[i] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("cylinderPolygons — outward normals", () => {
  it("side quad [0] has an outward-facing normal", () => {
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all side quads have outward-facing normals", () => {
    const polygons = cylinderPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    for (let i = 0; i < 8; i++) {
      expect(normalDotCentroid(polygons[i] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("prismPolygons — outward normals", () => {
  it("side quad [0] has an outward-facing normal", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all side quads have outward-facing normals", () => {
    const polygons = prismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides: 8 });
    for (let i = 0; i < 8; i++) {
      expect(normalDotCentroid(polygons[i] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("bipyramidPolygons — outward normals", () => {
  it("first upper triangle has an outward-facing normal", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("first lower triangle has an outward-facing normal", () => {
    const sides = 6;
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides });
    expect(normalDotCentroid(polygons[sides] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all faces have outward-facing normals", () => {
    const polygons = bipyramidPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 8 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("antiprismPolygons — outward normals", () => {
  it("first up-triangle has an outward-facing normal", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("first down-triangle has an outward-facing normal", () => {
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2 });
    expect(normalDotCentroid(polygons[1] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all side triangles have outward-facing normals", () => {
    const sides = 6;
    const polygons = antiprismPolygons({ center: [0, 0, 0], radius: 1, height: 2, sides });
    for (let i = 0; i < 2 * sides; i++) {
      expect(normalDotCentroid(polygons[i] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("trapezohedronPolygons — outward normals", () => {
  it("first upper kite has an outward-facing normal", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1 });
    expect(normalDotCentroid(polygons[0] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("first lower kite has an outward-facing normal", () => {
    const sides = 5;
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides });
    expect(normalDotCentroid(polygons[sides] as { vertices: [number, number, number][] })).toBeGreaterThan(0);
  });

  it("all faces have outward-facing normals", () => {
    const polygons = trapezohedronPolygons({ center: [0, 0, 0], radius: 1, halfHeight: 1, sides: 6 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("smallStellatedDodecahedronPolygons", () => {
  it("returns 60 triangular faces (12 pentagrams × 5 triangles)", () => {
    const polygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(60);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#abcdef" });
    for (const p of colorPolygons) expect(p.color).toBe("#abcdef");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [3, -2, 5];
    const base = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = smallStellatedDodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(5, 5);
  });

  it("all non-centroid vertices lie on the circumscribing sphere (distance == size)", () => {
    const size = 2;
    const polygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size });
    // The centroid vertices sit strictly inside the sphere; the outer vertices
    // (vertices 1 and 2 of each triangle) are icosahedron vertices on the sphere.
    for (const p of polygons) {
      for (const vtx of [p.vertices[1], p.vertices[2]]) {
        const [x, y, z] = vtx;
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("the 12 distinct pentagram centroids lie strictly inside the circumscribing sphere", () => {
    const size = 1;
    const polygons = smallStellatedDodecahedronPolygons({ center: [0, 0, 0], size });
    // vertex[0] of each triangle is the pentagram centroid; 5 triangles share
    // each centroid so there are 12 distinct centroids.
    const centroids = new Map<string, [number, number, number]>();
    for (const p of polygons) {
      const [x, y, z] = p.vertices[0];
      const key = `${x.toFixed(8)},${y.toFixed(8)},${z.toFixed(8)}`;
      centroids.set(key, [x, y, z]);
    }
    expect(centroids.size).toBe(12);
    for (const [x, y, z] of centroids.values()) {
      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeLessThan(size);
    }
  });
});

describe("greatDodecahedronPolygons", () => {
  it("returns 12 pentagonal faces", () => {
    const polygons = greatDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(12);
    for (const p of polygons) expect(p.vertices).toHaveLength(5);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = greatDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = greatDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = greatDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#123456" });
    for (const p of colorPolygons) expect(p.color).toBe("#123456");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [1, 4, -2];
    const base = greatDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = greatDodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(4, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });

  it("all vertices lie on the circumscribing sphere (distance == size)", () => {
    const size = 3;
    const polygons = greatDodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });
});

describe("greatStellatedDodecahedronPolygons", () => {
  it("returns 60 triangular faces (12 pentagrams × 5 triangles)", () => {
    const polygons = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(60);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff8800" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff8800");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [-1, 2, 4];
    const base = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = greatStellatedDodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(4, 5);
  });

  it("all non-centroid vertices lie on the circumscribing sphere (distance == size)", () => {
    const size = 2;
    const polygons = greatStellatedDodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const vtx of [p.vertices[1], p.vertices[2]]) {
        const [x, y, z] = vtx;
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });
});

describe("greatIcosahedronPolygons", () => {
  it("returns 20 triangular faces", () => {
    const polygons = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(20);
    for (const p of polygons) expect(p.vertices).toHaveLength(3);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff0000" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff0000");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [2, -3, 1];
    const base = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = greatIcosahedronPolygons({ center: offset, size: 1 });
    for (let i = 0; i < base.length; i++) {
      for (let j = 0; j < 3; j++) {
        expect(moved[i].vertices[j][0]).toBeCloseTo(base[i].vertices[j][0] + 2, 10);
        expect(moved[i].vertices[j][1]).toBeCloseTo(base[i].vertices[j][1] - 3, 10);
        expect(moved[i].vertices[j][2]).toBeCloseTo(base[i].vertices[j][2] + 1, 10);
      }
    }
  });

  it("all vertices lie on the circumscribing sphere (distance == size)", () => {
    const size = 2.5;
    const polygons = greatIcosahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("all 20 faces are non-degenerate (positive area)", () => {
    const polygons = greatIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      const [a, b, c] = p.vertices as [[number,number,number],[number,number,number],[number,number,number]];
      const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
      const acx = c[0]-a[0], acy = c[1]-a[1], acz = c[2]-a[2];
      const nx = aby*acz - abz*acy;
      const ny = abz*acx - abx*acz;
      const nz = abx*acy - aby*acx;
      const area2 = Math.sqrt(nx*nx + ny*ny + nz*nz);
      expect(area2).toBeGreaterThan(1e-6);
    }
  });
});

describe("cuboctahedronPolygons", () => {
  it("returns 14 faces total (8 triangles + 6 squares)", () => {
    const polygons = cuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(14);
    const tris = polygons.filter((p) => p.vertices.length === 3);
    const quads = polygons.filter((p) => p.vertices.length === 4);
    expect(tris).toHaveLength(8);
    expect(quads).toHaveLength(6);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = cuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2.5;
    const polygons = cuboctahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = cuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = cuboctahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aabbcc" });
    for (const p of colorPolygons) expect(p.color).toBe("#aabbcc");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [3, -1, 2];
    const base = cuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = cuboctahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });

  it("all 14 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = cuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("icosidodecahedronPolygons", () => {
  it("returns 32 faces total (20 triangles + 12 pentagons)", () => {
    const polygons = icosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(32);
    const tris = polygons.filter((p) => p.vertices.length === 3);
    const pentas = polygons.filter((p) => p.vertices.length === 5);
    expect(tris).toHaveLength(20);
    expect(pentas).toHaveLength(12);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = icosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 3;
    const polygons = icosidodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = icosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = icosidodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff8800" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff8800");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [2, -4, 1];
    const base = icosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = icosidodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-4, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(1, 5);
  });
});

describe("truncatedTetrahedronPolygons", () => {
  it("returns 8 faces total (4 triangles + 4 hexagons)", () => {
    const polygons = truncatedTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(8);
    const tris = polygons.filter((p) => p.vertices.length === 3);
    const hexes = polygons.filter((p) => p.vertices.length === 6);
    expect(tris).toHaveLength(4);
    expect(hexes).toHaveLength(4);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = truncatedTetrahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedTetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#123456" });
    for (const p of colorPolygons) expect(p.color).toBe("#123456");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [1, 2, -3];
    const base = truncatedTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedTetrahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-3, 5);
  });
});

describe("truncatedCubePolygons", () => {
  it("returns 14 faces total (8 triangles + 6 octagons)", () => {
    const polygons = truncatedCubePolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(14);
    const tris = polygons.filter((p) => p.vertices.length === 3);
    const octs = polygons.filter((p) => p.vertices.length === 8);
    expect(tris).toHaveLength(8);
    expect(octs).toHaveLength(6);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedCubePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = truncatedCubePolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedCubePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedCubePolygons({ center: [0, 0, 0], size: 1, color: "#abcdef" });
    for (const p of colorPolygons) expect(p.color).toBe("#abcdef");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [-2, 3, 5];
    const base = truncatedCubePolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedCubePolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(5, 5);
  });
});

describe("truncatedOctahedronPolygons", () => {
  it("returns 14 faces total (6 squares + 8 hexagons)", () => {
    const polygons = truncatedOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(14);
    const quads = polygons.filter((p) => p.vertices.length === 4);
    const hexes = polygons.filter((p) => p.vertices.length === 6);
    expect(quads).toHaveLength(6);
    expect(hexes).toHaveLength(8);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 3;
    const polygons = truncatedOctahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 8);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedOctahedronPolygons({ center: [0, 0, 0], size: 1, color: "#fedcba" });
    for (const p of colorPolygons) expect(p.color).toBe("#fedcba");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [4, -2, 3];
    const base = truncatedOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedOctahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(4, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });
});

describe("truncatedDodecahedronPolygons", () => {
  it("returns 32 faces total (20 triangles + 12 decagons)", () => {
    const polygons = truncatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(32);
    const tris = polygons.filter((p) => p.vertices.length === 3);
    const decas = polygons.filter((p) => p.vertices.length === 10);
    expect(tris).toHaveLength(20);
    expect(decas).toHaveLength(12);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = truncatedDodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aabbcc" });
    for (const p of colorPolygons) expect(p.color).toBe("#aabbcc");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [1, -2, 3];
    const base = truncatedDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedDodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });
});

describe("truncatedIcosahedronPolygons", () => {
  it("returns 32 faces total (12 pentagons + 20 hexagons)", () => {
    const polygons = truncatedIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(32);
    const pentas = polygons.filter((p) => p.vertices.length === 5);
    const hexes = polygons.filter((p) => p.vertices.length === 6);
    expect(pentas).toHaveLength(12);
    expect(hexes).toHaveLength(20);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 3;
    const polygons = truncatedIcosahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedIcosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#112233" });
    for (const p of colorPolygons) expect(p.color).toBe("#112233");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [2, 3, -1];
    const base = truncatedIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedIcosahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-1, 5);
  });
});

describe("truncatedCuboctahedronPolygons", () => {
  it("returns 26 faces total (12 squares + 8 hexagons + 6 octagons)", () => {
    const polygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(26);
    const squares = polygons.filter((p) => p.vertices.length === 4);
    const hexes   = polygons.filter((p) => p.vertices.length === 6);
    const octs    = polygons.filter((p) => p.vertices.length === 8);
    expect(squares).toHaveLength(12);
    expect(hexes).toHaveLength(8);
    expect(octs).toHaveLength(6);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1, color: "#c0ffee" });
    for (const p of colorPolygons) expect(p.color).toBe("#c0ffee");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [-1, 4, 2];
    const base = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedCuboctahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(4, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });

  it("all 26 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = truncatedCuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("truncatedIcosidodecahedronPolygons", () => {
  it("returns 62 faces total (30 squares + 20 hexagons + 12 decagons)", () => {
    const polygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(62);
    const squares = polygons.filter((p) => p.vertices.length === 4);
    const hexes   = polygons.filter((p) => p.vertices.length === 6);
    const decas   = polygons.filter((p) => p.vertices.length === 10);
    expect(squares).toHaveLength(30);
    expect(hexes).toHaveLength(20);
    expect(decas).toHaveLength(12);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff8800" });
    for (const p of colorPolygons) expect(p.color).toBe("#ff8800");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [5, -3, 1];
    const base = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = truncatedIcosidodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(5, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-3, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(1, 5);
  });

  it("all 62 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = truncatedIcosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("rhombicuboctahedronPolygons", () => {
  it("returns 26 faces total (8 triangles + 18 squares)", () => {
    const polygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(26);
    const tris    = polygons.filter((p) => p.vertices.length === 3);
    const squares = polygons.filter((p) => p.vertices.length === 4);
    expect(tris).toHaveLength(8);
    expect(squares).toHaveLength(18);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2.5;
    const polygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ab4567" });
    for (const p of colorPolygons) expect(p.color).toBe("#ab4567");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [3, 0, -2];
    const base = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = rhombicuboctahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(0, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });

  it("all 26 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = rhombicuboctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("rhombicosidodecahedronPolygons", () => {
  it("returns 62 faces total (20 triangles + 30 squares + 12 pentagons)", () => {
    const polygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(62);
    const tris    = polygons.filter((p) => p.vertices.length === 3);
    const squares = polygons.filter((p) => p.vertices.length === 4);
    const pentas  = polygons.filter((p) => p.vertices.length === 5);
    expect(tris).toHaveLength(20);
    expect(squares).toHaveLength(30);
    expect(pentas).toHaveLength(12);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#fedcba" });
    for (const p of colorPolygons) expect(p.color).toBe("#fedcba");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [-2, 1, 4];
    const base = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = rhombicosidodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(4, 5);
  });

  it("all 62 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = rhombicosidodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("snubCubePolygons", () => {
  it("returns 38 faces total (32 triangles + 6 squares)", () => {
    const polygons = snubCubePolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(38);
    const tris    = polygons.filter((p) => p.vertices.length === 3);
    const squares = polygons.filter((p) => p.vertices.length === 4);
    expect(tris).toHaveLength(32);
    expect(squares).toHaveLength(6);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = snubCubePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 3;
    const polygons = snubCubePolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = snubCubePolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = snubCubePolygons({ center: [0, 0, 0], size: 1, color: "#0077ff" });
    for (const p of colorPolygons) expect(p.color).toBe("#0077ff");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [1, 2, -3];
    const base = snubCubePolygons({ center: [0, 0, 0], size: 1 });
    const moved = snubCubePolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-3, 5);
  });

  it("all 38 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = snubCubePolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

describe("snubDodecahedronPolygons", () => {
  it("returns 92 faces total (80 triangles + 12 pentagons)", () => {
    const polygons = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(polygons).toHaveLength(92);
    const tris   = polygons.filter((p) => p.vertices.length === 3);
    const pentas = polygons.filter((p) => p.vertices.length === 5);
    expect(tris).toHaveLength(80);
    expect(pentas).toHaveLength(12);
  });

  it("all polygon vertices have length 3 and contain finite numbers", () => {
    const polygons = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of polygons) {
      for (const vtx of p.vertices) {
        expect(vtx).toHaveLength(3);
        for (const coord of vtx) expect(Number.isFinite(coord)).toBe(true);
      }
    }
  });

  it("every vertex lies on the circumscribing sphere (distance from center == size)", () => {
    const size = 2;
    const polygons = snubDodecahedronPolygons({ center: [0, 0, 0], size });
    for (const p of polygons) {
      for (const [x, y, z] of p.vertices) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(size, 5);
      }
    }
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const defaultPolygons = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const p of defaultPolygons) expect(p.color).toBe("#ffffff");
    const colorPolygons = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aaff00" });
    for (const p of colorPolygons) expect(p.color).toBe("#aaff00");
  });

  it("center offset shifts the bounding box centroid by the offset", () => {
    const offset: [number, number, number] = [2, -1, 3];
    const base = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = snubDodecahedronPolygons({ center: offset, size: 1 });
    const allBase = base.flatMap((p) => p.vertices);
    const allMoved = moved.flatMap((p) => p.vertices);
    const n = allBase.length;
    expect(allMoved.reduce((s, v) => s + v[0], 0) / n - allBase.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(allMoved.reduce((s, v) => s + v[1], 0) / n - allBase.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-1, 5);
    expect(allMoved.reduce((s, v) => s + v[2], 0) / n - allBase.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });

  it("all 92 faces have outward-facing normals (CCW winding from outside)", () => {
    const polygons = snubDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const poly of polygons) {
      expect(normalDotCentroid(poly as { vertices: [number, number, number][] })).toBeGreaterThan(0);
    }
  });
});

// ── Catalan polyhedra ────────────────────────────────────────────────────────

/** Residual distance of all vertices after the first 3 from the plane of the first 3. */
function maxPlanarResidual(verts: readonly (readonly [number, number, number])[]): number {
  if (verts.length <= 3) return 0;
  const [a, b, c] = verts as [[number,number,number],[number,number,number],[number,number,number]];
  const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
  const acx = c[0]-a[0], acy = c[1]-a[1], acz = c[2]-a[2];
  const nx = aby*acz - abz*acy;
  const ny = abz*acx - abx*acz;
  const nz = abx*acy - aby*acx;
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
  if (len < 1e-12) return 0;
  let max = 0;
  for (let k = 3; k < verts.length; k++) {
    const dx = verts[k][0]-a[0], dy = verts[k][1]-a[1], dz = verts[k][2]-a[2];
    const dist = Math.abs(dx*nx + dy*ny + dz*nz) / len;
    if (dist > max) max = dist;
  }
  return max;
}

describe("rhombicDodecahedronPolygons", () => {
  it("returns 12 rhombic (4-vertex) faces", () => {
    const p = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(12);
    for (const f of p) expect(f.vertices).toHaveLength(4);
  });

  it("all vertex coords are finite", () => {
    const p = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar (4th vertex within 1e-5 of the plane of the first 3)", () => {
    const p = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aabb11" });
    for (const f of col) expect(f.color).toBe("#aabb11");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [3, -2, 5];
    const base = rhombicDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = rhombicDodecahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-2, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(5, 5);
  });
});

describe("rhombicTriacontahedronPolygons", () => {
  it("returns 30 rhombic (4-vertex) faces", () => {
    const p = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(30);
    for (const f of p) expect(f.vertices).toHaveLength(4);
  });

  it("all vertex coords are finite", () => {
    const p = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar", () => {
    const p = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1, color: "#cc1122" });
    for (const f of col) expect(f.color).toBe("#cc1122");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [1, 2, 3];
    const base = rhombicTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = rhombicTriacontahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });
});

describe("triakisTetrahedronPolygons", () => {
  it("returns 12 triangular faces", () => {
    const p = triakisTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(12);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = triakisTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = triakisTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = triakisTetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#001122" });
    for (const f of col) expect(f.color).toBe("#001122");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [4, -1, 2];
    const base = triakisTetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = triakisTetrahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(4, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-1, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });
});

describe("triakisOctahedronPolygons", () => {
  it("returns 24 triangular faces", () => {
    const p = triakisOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(24);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = triakisOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = triakisOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = triakisOctahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff8800" });
    for (const f of col) expect(f.color).toBe("#ff8800");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [-3, 0, 2];
    const base = triakisOctahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = triakisOctahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-3, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(0, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });
});

describe("tetrakisHexahedronPolygons", () => {
  it("returns 24 triangular faces", () => {
    const p = tetrakisHexahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(24);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = tetrakisHexahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = tetrakisHexahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = tetrakisHexahedronPolygons({ center: [0, 0, 0], size: 1, color: "#00aaff" });
    for (const f of col) expect(f.color).toBe("#00aaff");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [2, 3, -1];
    const base = tetrakisHexahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = tetrakisHexahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(3, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-1, 5);
  });
});

describe("triakisIcosahedronPolygons", () => {
  it("returns 60 triangular faces", () => {
    const p = triakisIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(60);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = triakisIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = triakisIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = triakisIcosahedronPolygons({ center: [0, 0, 0], size: 1, color: "#112233" });
    for (const f of col) expect(f.color).toBe("#112233");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [5, -5, 5];
    const base = triakisIcosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = triakisIcosahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(5, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-5, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(5, 5);
  });
});

describe("pentakisDodecahedronPolygons", () => {
  it("returns 60 triangular faces", () => {
    const p = pentakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(60);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = pentakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = pentakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = pentakisDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#abcdef" });
    for (const f of col) expect(f.color).toBe("#abcdef");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [0, 4, -2];
    const base = pentakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = pentakisDodecahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(0, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(4, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });
});

describe("disdyakisDodecahedronPolygons", () => {
  it("returns 48 triangular faces", () => {
    const p = disdyakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(48);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = disdyakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = disdyakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = disdyakisDodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff0077" });
    for (const f of col) expect(f.color).toBe("#ff0077");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [-1, 3, 2];
    const base = disdyakisDodecahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = disdyakisDodecahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-1, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(3, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(2, 5);
  });
});

describe("disdyakisTriacontahedronPolygons", () => {
  it("returns 120 triangular faces", () => {
    const p = disdyakisTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(120);
    for (const f of p) expect(f.vertices).toHaveLength(3);
  });

  it("all vertex coords are finite", () => {
    const p = disdyakisTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = disdyakisTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = disdyakisTriacontahedronPolygons({ center: [0, 0, 0], size: 1, color: "#7700cc" });
    for (const f of col) expect(f.color).toBe("#7700cc");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [2, -3, 1];
    const base = disdyakisTriacontahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = disdyakisTriacontahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(2, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-3, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(1, 5);
  });
});

describe("deltoidalIcositetrahedronPolygons", () => {
  it("returns 24 kite (4-vertex) faces", () => {
    const p = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(24);
    for (const f of p) expect(f.vertices).toHaveLength(4);
  });

  it("all vertex coords are finite", () => {
    const p = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar", () => {
    const p = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#123456" });
    for (const f of col) expect(f.color).toBe("#123456");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [1, -4, 3];
    const base = deltoidalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = deltoidalIcositetrahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(1, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(-4, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(3, 5);
  });
});

describe("deltoidalHexecontahedronPolygons", () => {
  it("returns 60 kite (4-vertex) faces", () => {
    const p = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(60);
    for (const f of p) expect(f.vertices).toHaveLength(4);
  });

  it("all vertex coords are finite", () => {
    const p = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar", () => {
    const p = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1, color: "#654321" });
    for (const f of col) expect(f.color).toBe("#654321");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [-2, 1, 4];
    const base = deltoidalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = deltoidalHexecontahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-2, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(1, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(4, 5);
  });
});

describe("pentagonalIcositetrahedronPolygons", () => {
  it("returns 24 pentagonal (5-vertex) faces", () => {
    const p = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(24);
    for (const f of p) expect(f.vertices).toHaveLength(5);
  });

  it("all vertex coords are finite", () => {
    const p = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar (all 5 vertices within 1e-5 of the plane of the first 3)", () => {
    const p = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1, color: "#0077ff" });
    for (const f of col) expect(f.color).toBe("#0077ff");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [3, 1, -2];
    const base = pentagonalIcositetrahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = pentagonalIcositetrahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(3, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(1, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-2, 5);
  });
});

describe("pentagonalHexecontahedronPolygons", () => {
  it("returns 60 pentagonal (5-vertex) faces", () => {
    const p = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    expect(p).toHaveLength(60);
    for (const f of p) expect(f.vertices).toHaveLength(5);
  });

  it("all vertex coords are finite", () => {
    const p = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) for (const v of f.vertices) for (const c of v) expect(Number.isFinite(c)).toBe(true);
  });

  it("each face is planar (all 5 vertices within 1e-5 of the plane of the first 3)", () => {
    const p = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of p) expect(maxPlanarResidual(f.vertices)).toBeLessThan(1e-5);
  });

  it("color defaults to #ffffff and propagates when supplied", () => {
    const def = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    for (const f of def) expect(f.color).toBe("#ffffff");
    const col = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1, color: "#aaff00" });
    for (const f of col) expect(f.color).toBe("#aaff00");
  });

  it("center offset shifts bounding-box centroid", () => {
    const offset: [number, number, number] = [-1, 2, -3];
    const base = pentagonalHexecontahedronPolygons({ center: [0, 0, 0], size: 1 });
    const moved = pentagonalHexecontahedronPolygons({ center: offset, size: 1 });
    const bv = base.flatMap((p) => p.vertices), mv = moved.flatMap((p) => p.vertices);
    const n = bv.length;
    expect(mv.reduce((s, v) => s + v[0], 0) / n - bv.reduce((s, v) => s + v[0], 0) / n).toBeCloseTo(-1, 5);
    expect(mv.reduce((s, v) => s + v[1], 0) / n - bv.reduce((s, v) => s + v[1], 0) / n).toBeCloseTo(2, 5);
    expect(mv.reduce((s, v) => s + v[2], 0) / n - bv.reduce((s, v) => s + v[2], 0) / n).toBeCloseTo(-3, 5);
  });
});
