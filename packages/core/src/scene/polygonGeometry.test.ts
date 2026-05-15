import { describe, it, expect } from "vitest";
import { computeTexturePaintMetrics, polygonFaces } from "./polygonGeometry";
import type { Polygon } from "../types";

describe("polygonFaces", () => {
  const tri: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    color: "#ff0000",
  };

  it("returns an array with exactly 1 face for a valid triangle", () => {
    const faces = polygonFaces(tri);
    expect(faces).toHaveLength(1);
  });

  it("face.v mirrors the polygon vertices", () => {
    const faces = polygonFaces(tri);
    expect(faces[0].v).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  });

  it("face.color mirrors the polygon color", () => {
    const faces = polygonFaces(tri);
    expect(faces[0].color).toBe("#ff0000");
  });

  it("face.v is a deep copy (mutation doesn't affect original)", () => {
    const faces = polygonFaces(tri);
    faces[0].v[0][0] = 99;
    // original polygon is unchanged
    expect(tri.vertices[0][0]).toBe(0);
  });

  it("returns empty array for polygon with 2 vertices (degenerate)", () => {
    const p: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]] };
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("returns empty array for polygon with 0 vertices", () => {
    const p: Polygon = { vertices: [] };
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("returns empty array when vertices is undefined-like", () => {
    // Defensive — some callers may pass a partially-built polygon
    const p = { vertices: null } as unknown as Polygon;
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("works for a quad (4 vertices) — returns single face with 4 vertices", () => {
    const quad: Polygon = {
      vertices: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
      color: "#0000ff",
    };
    const faces = polygonFaces(quad);
    expect(faces).toHaveLength(1);
    expect(faces[0].v).toHaveLength(4);
  });

  it("color is undefined when polygon has no color", () => {
    const p: Polygon = { vertices: [[0,0,0],[1,0,0],[0,1,0]] };
    const faces = polygonFaces(p);
    expect(faces[0].color).toBeUndefined();
  });
});

describe("computeTexturePaintMetrics", () => {
  const tex = "https://example.com/t.png";

  it("returns zeros for empty input", () => {
    const m = computeTexturePaintMetrics([]);
    expect(m.totalPolygons).toBe(0);
    expect(m.measuredPolygons).toBe(0);
    expect(m.elementArea).toBe(0);
    expect(m.polygonArea).toBe(0);
    expect(m.transparentRatio).toBe(0);
    expect(m.overdrawRatio).toBe(0);
  });

  it("an axis-aligned textured quad has no overdraw — element area == polygon area", () => {
    // 1×1 quad at tileSize 100 → 100×100 element box, fully filled by the quad.
    const quad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: tex,
    };
    const m = computeTexturePaintMetrics([quad]);
    expect(m.measuredPolygons).toBe(1);
    expect(m.texturedPolygons).toBe(1);
    expect(m.elementArea).toBe(m.polygonArea);
    expect(m.transparentArea).toBe(0);
    expect(m.transparentRatio).toBe(0);
    expect(m.overdrawRatio).toBeCloseTo(1, 5);
  });

  it("a right triangle fills half its bounding box (~50% transparent)", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: tex,
    };
    const m = computeTexturePaintMetrics([tri]);
    expect(m.measuredPolygons).toBe(1);
    // overdraw = element / polygon ≈ 2 (triangle is half its bbox).
    expect(m.overdrawRatio).toBeGreaterThan(1.9);
    expect(m.overdrawRatio).toBeLessThan(2.1);
    expect(m.transparentRatio).toBeGreaterThan(0.49);
    expect(m.transparentRatio).toBeLessThan(0.51);
    expect(m.worstTransparentRatio).toBe(m.transparentRatio);
  });

  it("skips untextured polygons when texturedOnly is true (the default)", () => {
    const quad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
      // no texture
    };
    const m = computeTexturePaintMetrics([quad]);
    expect(m.totalPolygons).toBe(1);
    expect(m.measuredPolygons).toBe(0);
    expect(m.elementArea).toBe(0);
  });

  it("includes untextured polygons when texturedOnly is false", () => {
    const quad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const m = computeTexturePaintMetrics([quad], { texturedOnly: false });
    expect(m.measuredPolygons).toBe(1);
    expect(m.texturedPolygons).toBe(0);
    expect(m.elementArea).toBeGreaterThan(0);
  });

  it("degenerate polygons (< 3 vertices) are skipped", () => {
    const line: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]], texture: tex };
    const empty: Polygon = { vertices: [], texture: tex };
    const m = computeTexturePaintMetrics([line, empty]);
    expect(m.totalPolygons).toBe(2);
    expect(m.measuredPolygons).toBe(0);
  });

  it("polygons collinear in 3D (zero normal) are skipped", () => {
    // All three points on the X-axis → degenerate (no surface normal).
    const collinear: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      texture: tex,
    };
    const m = computeTexturePaintMetrics([collinear]);
    expect(m.measuredPolygons).toBe(0);
  });

  it("scales linearly with tileSize", () => {
    const quad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: tex,
    };
    const small = computeTexturePaintMetrics([quad], { tileSize: 50 });
    const large = computeTexturePaintMetrics([quad], { tileSize: 100 });
    // Doubling tileSize quadruples area for a 2D quad.
    expect(large.elementArea / small.elementArea).toBeCloseTo(4, 1);
    expect(large.polygonArea / small.polygonArea).toBeCloseTo(4, 1);
  });

  it("layerElevation only affects polygons with Z extent", () => {
    const flatQuad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: tex,
    };
    const m1 = computeTexturePaintMetrics([flatQuad], { tileSize: 100, layerElevation: 100 });
    const m2 = computeTexturePaintMetrics([flatQuad], { tileSize: 100, layerElevation: 1000 });
    // Z-flat polygon: layerElevation shouldn't change its 2D-projected area.
    expect(m1.elementArea).toBe(m2.elementArea);
    expect(m1.polygonArea).toBeCloseTo(m2.polygonArea, 5);
  });

  it("aggregates worstTransparentRatio across a mixed batch", () => {
    const fullQuad: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: tex,
    };
    const rightTri: Polygon = {
      // Right triangle is always ~50% of its tightest bbox.
      vertices: [[0, 0, 0], [10, 0, 0], [10, 1, 0]],
      texture: tex,
    };
    const m = computeTexturePaintMetrics([fullQuad, rightTri]);
    expect(m.measuredPolygons).toBe(2);
    // The triangle drives worstTransparentRatio (the quad's is ~0).
    expect(m.worstTransparentRatio).toBeGreaterThan(0.45);
    expect(m.worstTransparentRatio).toBeLessThan(0.55);
    // Aggregate transparent ratio is below the per-polygon worst (the full
    // quad pulls it down).
    expect(m.transparentRatio).toBeGreaterThan(0);
    expect(m.transparentRatio).toBeLessThan(m.worstTransparentRatio);
  });

  it("non-axis-aligned quad in 3D still projects to its native plane", () => {
    // 1×1 quad lying on the Z=X plane (45° tilted around Y).
    // Its tightest 2D-projected element box should be ~ (sqrt2*tileSize)
    // × tileSize regardless of orientation in world space.
    const tilted: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]],
      texture: tex,
    };
    const m = computeTexturePaintMetrics([tilted], { tileSize: 100, layerElevation: 100 });
    expect(m.measuredPolygons).toBe(1);
    // For a planar quad the polygon area equals the element-box area (no
    // transparent slack in its own plane), even after a 3D tilt.
    expect(m.transparentRatio).toBeLessThan(0.05);
    expect(m.overdrawRatio).toBeLessThan(1.1);
  });
});
