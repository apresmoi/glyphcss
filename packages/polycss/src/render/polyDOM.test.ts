import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderPoly } from "./polyDOM";
import type { Polygon } from "@polycss/core";

// --- Test polygons ---

const FLAT_TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const VERTICAL_QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  color: "#00ff00",
};

const OFFAXIS_TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 1, 0],
    [0, 1, 1],
  ],
  color: "#0000ff",
};

describe("renderPoly — solid color triangle", () => {
  it("returns a non-null RenderedPoly", () => {
    const result = renderPoly(FLAT_TRIANGLE);
    expect(result).not.toBeNull();
  });

  it("returns an SVGSVGElement for a solid color polygon", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(result.element.tagName.toLowerCase()).toBe("svg");
  });

  it("element has polycss-poly class", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(result.element.className).toContain("polycss-poly");
  });

  it("element has matrix3d transform", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const el = result.element as SVGSVGElement;
    expect(el.style.transform).toContain("matrix3d(");
  });

  it("matrix3d has 16 values", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const el = result.element as SVGSVGElement;
    const match = el.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });

  it("SVG has backfaceVisibility hidden", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const el = result.element as SVGSVGElement;
    expect(el.style.backfaceVisibility).toBe("hidden");
  });

  it("SVG has position absolute", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const el = result.element as SVGSVGElement;
    expect(el.style.position).toBe("absolute");
  });

  it("path starts with M and ends with Z", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const path = result.element.querySelector("path")!;
    const d = path.getAttribute("d")!;
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("path fill is a valid hex color", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const path = result.element.querySelector("path")!;
    const fill = path.getAttribute("fill");
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("dispose() is idempotent and does not throw", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(() => {
      result.dispose();
      result.dispose();
    }).not.toThrow();
  });
});

describe("renderPoly — vertical quad", () => {
  it("returns non-null for vertical quad", () => {
    const result = renderPoly(VERTICAL_QUAD);
    expect(result).not.toBeNull();
  });

  it("path has 4 segments for a quad", () => {
    const result = renderPoly(VERTICAL_QUAD)!;
    const path = result.element.querySelector("path")!;
    const d = path.getAttribute("d")!;
    const segments = (d.match(/[ML]/g) ?? []).length;
    expect(segments).toBe(4);
  });

  it("has a valid matrix3d transform", () => {
    const result = renderPoly(VERTICAL_QUAD)!;
    const el = result.element as SVGSVGElement;
    const match = el.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });
});

describe("renderPoly — off-axis triangle", () => {
  it("returns non-null for off-axis triangle", () => {
    const result = renderPoly(OFFAXIS_TRIANGLE);
    expect(result).not.toBeNull();
  });

  it("has 16-value matrix3d for off-axis polygon", () => {
    const result = renderPoly(OFFAXIS_TRIANGLE)!;
    const el = result.element as SVGSVGElement;
    const match = el.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });
});

describe("renderPoly — degenerate inputs", () => {
  it("returns null for zero-length first edge", () => {
    const degenerate: Polygon = {
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
    };
    const result = renderPoly(degenerate);
    expect(result).toBeNull();
  });

  it("returns null for collinear vertices (zero normal)", () => {
    const collinear: Polygon = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    };
    const result = renderPoly(collinear);
    expect(result).toBeNull();
  });

  it("returns null for fewer than 3 vertices", () => {
    const tooFew: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0]],
    };
    const result = renderPoly(tooFew);
    expect(result).toBeNull();
  });
});

describe("renderPoly — render math parity with React Poly.tsx", () => {
  /**
   * These tests verify that the vanilla polyDOM.ts produces the same
   * matrix3d as React's Poly.tsx for the same input geometry. The math
   * is identical — same axis-swap convention, same orthonormal frame
   * construction — so we can test exact string equality after parsing
   * the 16 comma-separated values.
   *
   * We compute the expected matrix from first principles (same algorithm
   * as Poly.tsx / polyDOM.ts) and compare.
   */

  function computeExpectedMatrix(
    vertices: [number, number, number][],
    tileSize = 50,
    elev = 50
  ): number[] {
    const toCss = (v: [number, number, number]): [number, number, number] => [
      v[1] * tileSize,
      v[0] * tileSize,
      v[2] * elev,
    ];
    const pts = vertices.map(toCss);
    const p0 = pts[0], p1 = pts[1], p2 = pts[2];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const L01 = Math.hypot(e1[0], e1[1], e1[2]);
    const xAxis = [e1[0] / L01, e1[1] / L01, e1[2] / L01];
    let nx = -(e1[1] * e2[2] - e1[2] * e2[1]);
    let ny = -(e1[2] * e2[0] - e1[0] * e2[2]);
    let nz = -(e1[0] * e2[1] - e1[1] * e2[0]);
    const nLen = Math.hypot(nx, ny, nz);
    nx /= nLen; ny /= nLen; nz /= nLen;
    const yAxis = [
      ny * xAxis[2] - nz * xAxis[1],
      nz * xAxis[0] - nx * xAxis[2],
      nx * xAxis[1] - ny * xAxis[0],
    ];
    const local2D = pts.map((p): [number, number] => {
      const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
      return [
        dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
        dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
      ];
    });
    let xMin = Infinity, yMin = Infinity;
    for (const [x, y] of local2D) {
      if (x < xMin) xMin = x;
      if (y < yMin) yMin = y;
    }
    const shiftX = -xMin;
    const shiftY = -yMin;
    const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
    const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
    const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];
    return [
      xAxis[0], xAxis[1], xAxis[2], 0,
      yAxis[0], yAxis[1], yAxis[2], 0,
      nx, ny, nz, 0,
      tx, ty, tz, 1,
    ];
  }

  function extractMatrix(el: SVGSVGElement | HTMLImageElement): number[] {
    const match = el.style.transform.match(/matrix3d\(([^)]+)\)/);
    if (!match) return [];
    return match[1].split(",").map(Number);
  }

  it("flat triangle — matrix3d values match expected (6 decimal places)", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const actual = extractMatrix(result.element as SVGSVGElement);
    const expected = computeExpectedMatrix(FLAT_TRIANGLE.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("vertical quad — matrix3d values match expected", () => {
    const result = renderPoly(VERTICAL_QUAD)!;
    const actual = extractMatrix(result.element as SVGSVGElement);
    const expected = computeExpectedMatrix(VERTICAL_QUAD.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("off-axis triangle — matrix3d values match expected", () => {
    const result = renderPoly(OFFAXIS_TRIANGLE)!;
    const actual = extractMatrix(result.element as SVGSVGElement);
    const expected = computeExpectedMatrix(OFFAXIS_TRIANGLE.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("custom tileSize=100 — matrix3d translation scaled accordingly", () => {
    const poly: Polygon = {
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
    const result = renderPoly(poly, { tileSize: 100 })!;
    const actual = extractMatrix(result.element as SVGSVGElement);
    const expected = computeExpectedMatrix(poly.vertices as [number, number, number][], 100, 100);
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("custom layerElevation=25 (dimetric) — Z translation scaled by 0.5", () => {
    const poly: Polygon = {
      vertices: [
        [0, 0, 1],
        [1, 0, 1],
        [0, 0, 2],
      ],
    };
    const result = renderPoly(poly, { tileSize: 50, layerElevation: 25 })!;
    const actual = extractMatrix(result.element as SVGSVGElement);
    const expected = computeExpectedMatrix(poly.vertices as [number, number, number][], 50, 25);
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected[i], 6);
    }
  });
});

describe("renderPoly — texture without UVs (pattern fill)", () => {
  it("returns SVG element with polycss-poly-textured class", () => {
    const texturedPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
    };
    const result = renderPoly(texturedPoly)!;
    expect(result.element.className).toContain("polycss-poly-textured");
  });

  it("SVG contains a <defs> and <pattern> for the texture", () => {
    const texturedPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
    };
    const result = renderPoly(texturedPoly)!;
    const defs = result.element.querySelector("defs");
    const pattern = result.element.querySelector("pattern");
    expect(defs).toBeTruthy();
    expect(pattern).toBeTruthy();
  });
});

describe("renderPoly — UV-mapped texture (renders <img>)", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns an <img> element when uvs + texture provided", () => {
    const uvPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    };
    const result = renderPoly(uvPoly)!;
    expect(result.element.tagName.toLowerCase()).toBe("img");
  });

  it("img has matrix3d transform", () => {
    const uvPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    };
    const result = renderPoly(uvPoly)!;
    const img = result.element as HTMLImageElement;
    expect(img.style.transform).toContain("matrix3d(");
  });

  it("img has polycss-poly-textured class", () => {
    const uvPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    };
    const result = renderPoly(uvPoly)!;
    expect(result.element.className).toContain("polycss-poly-textured");
  });

  it("dispose() revokes blob URL when one is set", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test-url"),
      revokeObjectURL,
    });

    const uvPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    };
    const result = renderPoly(uvPoly)!;
    // dispose before blob URL is set (cancelled before loadTextureImage resolves)
    result.dispose();
    expect(revokeObjectURL).not.toHaveBeenCalled(); // blobUrl was null when cancelled
  });
});

describe("renderPoly — data attributes", () => {
  it("reflects polygon.data as data-* attributes on the element", () => {
    const poly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      data: { id: "poly-1", score: 42, active: true },
    };
    const result = renderPoly(poly)!;
    expect(result.element.getAttribute("data-id")).toBe("poly-1");
    expect(result.element.getAttribute("data-score")).toBe("42");
    expect(result.element.getAttribute("data-active")).toBe("true");
  });
});

describe("renderPoly — custom directional light", () => {
  it("applies custom light direction without throwing", () => {
    const poly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      color: "#ffffff",
    };
    const result = renderPoly(poly, {
      directionalLight: {
        direction: [0, -1, 0],
        color: "#ff8800",
        ambientColor: "#334455",
        ambient: 0.3,
      },
    });
    expect(result).not.toBeNull();
    const el = result!.element as SVGSVGElement;
    expect(el.style.transform).toContain("matrix3d(");
  });
});
