import { describe, it, expect } from "vitest";
import { normalizePolygons } from "./normalize";
import type { Polygon } from "../types";

describe("normalizePolygons — empty / null input", () => {
  it("returns empty result for empty input", () => {
    const r = normalizePolygons([]);
    expect(r.polygons).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("handles undefined gracefully", () => {
    const r = normalizePolygons(undefined as unknown as Polygon[]);
    expect(r.polygons).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("warns and drops polygons with missing vertices", () => {
    const r = normalizePolygons([{ vertices: undefined as unknown as Polygon["vertices"] }]);
    expect(r.polygons).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Polygon 0");
  });
});

describe("normalizePolygons — vertex count rules", () => {
  it("drops polygons with < 3 vertices", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0]] },
      { vertices: [[0, 0, 0], [1, 0, 0]] },
    ]);
    expect(r.polygons).toHaveLength(0);
    expect(r.warnings).toHaveLength(2);
  });

  it("keeps a valid triangle untouched", () => {
    const tri: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const r = normalizePolygons([tri]);
    expect(r.polygons).toHaveLength(1);
    expect(r.polygons[0].vertices).toEqual(tri.vertices);
    expect(r.polygons[0].color).toBe("#ff0000");
    expect(r.warnings).toEqual([]);
  });
});

describe("normalizePolygons — degenerate triangles", () => {
  it("drops collinear triangles", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
    ]);
    expect(r.polygons).toHaveLength(0);
    expect(r.warnings[0]).toContain("collinear");
  });

  it("drops triangles with coincident vertices", () => {
    const r = normalizePolygons([
      { vertices: [[1, 1, 1], [1, 1, 1], [2, 2, 2]] },
    ]);
    expect(r.polygons).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/coincident|zero-area/);
  });
});

describe("normalizePolygons — N-gon coplanarity", () => {
  it("keeps coplanar quads unchanged", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
    ]);
    expect(r.polygons).toHaveLength(1);
    expect(r.polygons[0].vertices).toHaveLength(4);
    expect(r.warnings).toEqual([]);
  });

  it("fan-triangulates non-coplanar quads", () => {
    // 4th vertex pulled significantly out of the z=0 plane.
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 5]] },
    ]);
    expect(r.polygons.length).toBeGreaterThan(1);
    for (const p of r.polygons) {
      expect(p.vertices).toHaveLength(3);
    }
    expect(r.warnings.some((w) => w.includes("fan-triangulated"))).toBe(true);
  });

  it("preserves uvs across fan-triangulation when uv-count matches", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 5]],
        uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
        texture: "tex.png",
      },
    ]);
    for (const p of r.polygons) {
      expect(p.uvs).toBeDefined();
      expect(p.uvs!).toHaveLength(3);
      expect(p.texture).toBe("tex.png");
    }
  });
});

describe("normalizePolygons — uvs validation", () => {
  it("strips uvs whose length doesn't match vertices.length", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        uvs: [[0, 0], [1, 0]], // length 2 != 3
        texture: "t.png",
      },
    ]);
    expect(r.polygons).toHaveLength(1);
    expect(r.polygons[0].uvs).toBeUndefined();
    expect(r.polygons[0].texture).toBe("t.png");
    expect(r.warnings.some((w) => w.includes("uvs length"))).toBe(true);
  });

  it("keeps uvs whose length matches", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        uvs: [[0, 0], [1, 0], [0, 1]],
      },
    ]);
    expect(r.polygons[0].uvs).toBeDefined();
    expect(r.polygons[0].uvs).toHaveLength(3);
  });
});

describe("normalizePolygons — color validation", () => {
  it("replaces invalid color with #cccccc", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "notacolor12345" },
    ]);
    expect(r.polygons[0].color).toBe("#cccccc");
    expect(r.warnings.some((w) => w.includes("invalid color"))).toBe(true);
  });

  it("keeps valid hex colors unchanged", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#abcdef" },
    ]);
    expect(r.polygons[0].color).toBe("#abcdef");
  });

  it("keeps valid rgb() colors unchanged", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "rgb(10, 20, 30)" },
    ]);
    expect(r.polygons[0].color).toBe("rgb(10, 20, 30)");
  });
});

describe("normalizePolygons — texture handling", () => {
  it("treats empty-string texture as unset (no warning)", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], texture: "" },
    ]);
    expect(r.polygons[0].texture).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("keeps both color and texture when both are set", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#abcdef", texture: "t.png" },
    ]);
    expect(r.polygons[0].color).toBe("#abcdef");
    expect(r.polygons[0].texture).toBe("t.png");
  });
});

describe("normalizePolygons — data sanitization", () => {
  it("keeps string/number/boolean keys", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        data: { id: "cell-1", row: 7, active: true },
      },
    ]);
    expect(r.polygons[0].data).toEqual({ id: "cell-1", row: 7, active: true });
    expect(r.warnings).toEqual([]);
  });

  it("drops non-primitive data values and warns", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        data: {
          id: "cell-1",
          // @ts-expect-error testing invalid value
          nested: { foo: "bar" },
          // @ts-expect-error testing invalid value
          list: [1, 2, 3],
        },
      },
    ]);
    expect(r.polygons[0].data).toEqual({ id: "cell-1" });
    expect(r.warnings.filter((w) => w.includes("non-primitive")).length).toBe(2);
  });

  it("leaves data unset when all keys are invalid", () => {
    const r = normalizePolygons([
      {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        // @ts-expect-error testing invalid value
        data: { nested: { x: 1 } },
      },
    ]);
    expect(r.polygons[0].data).toBeUndefined();
  });
});

describe("normalizePolygons — does NOT compute bbox", () => {
  it("does not add x/y/z fields to the output", () => {
    const r = normalizePolygons([
      { vertices: [[5, 10, 15], [6, 10, 15], [5, 11, 15]] },
    ]);
    const p = r.polygons[0] as Polygon & Record<string, unknown>;
    expect(p.x).toBeUndefined();
    expect(p.y).toBeUndefined();
    expect(p.z).toBeUndefined();
    expect(p.x2).toBeUndefined();
    expect(p.y2).toBeUndefined();
    expect(p.z2).toBeUndefined();
  });
});

describe("normalizePolygons — warning indices", () => {
  it("uses original input index in warnings (not output index)", () => {
    const r = normalizePolygons([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, // valid
      { vertices: [[0, 0, 0], [1, 0, 0]] },              // dropped (index 1)
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, // valid
    ]);
    expect(r.polygons).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Polygon 1");
  });
});
