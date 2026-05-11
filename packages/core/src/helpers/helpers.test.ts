import { describe, expect, it } from "vitest";
import { axesHelperPolygons } from "./axesPolygons";
import { octahedronPolygons } from "./octahedronPolygons";

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
