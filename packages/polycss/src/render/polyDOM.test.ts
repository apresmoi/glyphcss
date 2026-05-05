import { describe, it, expect, vi, afterEach } from "vitest";
import { renderPoly } from "./polyDOM";
import { renderPolygonsWithTextureAtlas } from "./textureAtlas";
import type { Polygon } from "@polycss/core";

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

function extractMatrix(el: HTMLElement): number[] {
  const match = el.style.transform.match(/matrix3d\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(",").map(Number);
}

function computeExpectedMatrix(
  vertices: [number, number, number][],
  tileSize = 50,
  elev = tileSize,
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

describe("renderPoly — atlas-backed solid polygons", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a polygon i element for a solid color polygon", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(result).not.toBeNull();
    expect(result.element.tagName.toLowerCase()).toBe("i");
    expect(result.element.classList.contains("polycss-poly")).toBe(false);
    expect(result.element.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(result.element.classList.contains("polycss-poly-solid")).toBe(false);
    expect(result.element.classList.contains("polycss-poly-textured")).toBe(false);
    result.dispose();
  });

  it("keeps class-owned constants out of inline styles", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(result.element.style.transform).toContain("matrix3d(");
    expect(extractMatrix(result.element).length).toBe(16);
    expect(result.element.style.position).toBe("");
    expect(result.element.style.left).toBe("");
    expect(result.element.style.top).toBe("");
    expect(result.element.style.transformOrigin).toBe("");
    expect(result.element.style.backfaceVisibility).toBe("");
    expect(result.element.style.backgroundRepeat).toBe("");
    result.dispose();
  });

  it("returns polygon i elements for vertical and off-axis polygons", () => {
    const vertical = renderPoly(VERTICAL_QUAD)!;
    const offAxis = renderPoly(OFFAXIS_TRIANGLE)!;
    expect(vertical.element.tagName.toLowerCase()).toBe("i");
    expect(offAxis.element.tagName.toLowerCase()).toBe("i");
    vertical.dispose();
    offAxis.dispose();
  });

  it("dispose() is idempotent and does not throw", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    expect(() => {
      result.dispose();
      result.dispose();
    }).not.toThrow();
  });
});

describe("renderPoly — degenerate inputs", () => {
  it("returns null for zero-length first edge", () => {
    const result = renderPoly({
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    expect(result).toBeNull();
  });

  it("returns null for collinear vertices", () => {
    const result = renderPoly({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    });
    expect(result).toBeNull();
  });

  it("returns null for fewer than 3 vertices", () => {
    const result = renderPoly({
      vertices: [[0, 0, 0], [1, 0, 0]],
    });
    expect(result).toBeNull();
  });
});

describe("renderPoly — matrix math parity", () => {
  it("flat triangle matrix3d values match expected", () => {
    const result = renderPoly(FLAT_TRIANGLE)!;
    const actual = extractMatrix(result.element);
    const expected = computeExpectedMatrix(FLAT_TRIANGLE.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
    result.dispose();
  });

  it("vertical quad matrix3d values match expected", () => {
    const result = renderPoly(VERTICAL_QUAD)!;
    const actual = extractMatrix(result.element);
    const expected = computeExpectedMatrix(VERTICAL_QUAD.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
    result.dispose();
  });

  it("off-axis triangle matrix3d values match expected", () => {
    const result = renderPoly(OFFAXIS_TRIANGLE)!;
    const actual = extractMatrix(result.element);
    const expected = computeExpectedMatrix(OFFAXIS_TRIANGLE.vertices as [number, number, number][]);
    expect(actual.length).toBe(16);
    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
    result.dispose();
  });

  it("custom tileSize and layerElevation scale translation", () => {
    const poly: Polygon = {
      vertices: [
        [0, 0, 1],
        [1, 0, 1],
        [0, 0, 2],
      ],
    };
    const result = renderPoly(poly, { tileSize: 50, layerElevation: 25 })!;
    const actual = extractMatrix(result.element);
    const expected = computeExpectedMatrix(poly.vertices as [number, number, number][], 50, 25);
    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
    result.dispose();
  });
});

describe("renderPolygonsWithTextureAtlas", () => {
  it("returns a polygon i element for a solid polygon", () => {
    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE]);
    const element = result.rendered[0].element;
    expect(element.tagName.toLowerCase()).toBe("i");
    expect(element.classList.contains("polycss-poly")).toBe(false);
    expect(element.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(element.classList.contains("polycss-poly-solid")).toBe(false);
    expect(element.classList.contains("polycss-poly-textured")).toBe(false);
    expect(element.style.transform).toContain("matrix3d(");
    result.dispose();
  });

  it("returns a polygon i element for texture without UVs", () => {
    const texturedPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
    };
    const result = renderPolygonsWithTextureAtlas([texturedPoly]);
    const element = result.rendered[0].element;
    expect(element.tagName.toLowerCase()).toBe("i");
    expect(element.classList.contains("polycss-poly")).toBe(false);
    expect(element.classList.contains("polycss-poly-textured")).toBe(false);
    expect(element.style.transform).toContain("matrix3d(");
    expect(element.style.filter).toBe("");
    result.dispose();
  });

  it("returns a polygon i element for UV-mapped texture", () => {
    const uvPoly: Polygon = {
      vertices: FLAT_TRIANGLE.vertices,
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    };
    const result = renderPolygonsWithTextureAtlas([uvPoly]);
    const element = result.rendered[0].element;
    expect(element.tagName.toLowerCase()).toBe("i");
    expect(element.classList.contains("polycss-poly")).toBe(false);
    expect(element.style.transform).toContain("matrix3d(");
    result.dispose();
  });

  it("emits per-polygon normal vars in dynamic mode", () => {
    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { textureLighting: "dynamic" });
    const element = result.rendered[0].element;
    // The calc-driven background-color + background-blend-mode now live
    // in the global stylesheet (scoped to data-polycss-lighting="dynamic"
    // on the scene). Per-polygon style only carries the surface normal
    // — much smaller payload per element on big meshes.
    expect(element.style.getPropertyValue("--polycss-nx")).not.toBe("");
    expect(element.style.getPropertyValue("--polycss-ny")).not.toBe("");
    expect(element.style.getPropertyValue("--polycss-nz")).not.toBe("");
    result.dispose();
  });

  it("does not emit dynamic style hooks in baked mode", () => {
    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { textureLighting: "baked" });
    const element = result.rendered[0].element;
    expect(element.style.backgroundColor).toBe("");
    expect(element.style.backgroundBlendMode).toBe("");
    expect(element.style.getPropertyValue("--polycss-nx")).toBe("");
    result.dispose();
  });

  it("scales generated atlas canvas dimensions when atlasScale is set", () => {
    const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
    const doc = {
      createElement(tagName: string) {
        if (tagName === "canvas") {
          const canvas = { width: 0, height: 0, getContext: () => null };
          canvases.push(canvas);
          return canvas;
        }
        return document.createElement(tagName);
      },
    } as unknown as Document;

    const full = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc, atlasScale: 1 });
    const half = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc, atlasScale: 0.5 });

    expect(canvases).toHaveLength(2);
    expect(canvases[1].width).toBeLessThan(canvases[0].width);
    expect(canvases[1].height).toBeLessThan(canvases[0].height);

    full.dispose();
    half.dispose();
  });

  it("auto atlasScale downscales large packed atlas pages", () => {
    const collectCanvasSizes = (
      polygons: Polygon[],
      atlasScale: number | "auto",
    ): Array<{ width: number; height: number }> => {
      const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
      const doc = {
        createElement(tagName: string) {
          if (tagName === "canvas") {
            const canvas = { width: 0, height: 0, getContext: () => null };
            canvases.push(canvas);
            return canvas;
          }
          return document.createElement(tagName);
        },
      } as unknown as Document;
      const result = renderPolygonsWithTextureAtlas(polygons, { doc, atlasScale });
      result.dispose();
      return canvases.map(({ width, height }) => ({ width, height }));
    };

    const largeQuad: Polygon = {
      vertices: [
        [0, 0, 0],
        [80, 0, 0],
        [80, 80, 0],
        [0, 80, 0],
      ],
      color: "#ffffff",
    };
    const largeScene = [largeQuad, largeQuad, largeQuad, largeQuad];

    const auto = collectCanvasSizes(largeScene, "auto");
    const half = collectCanvasSizes(largeScene, 0.5);
    const full = collectCanvasSizes(largeScene, 1);

    expect(auto).toHaveLength(half.length);
    expect(auto[0].width).toBe(half[0].width);
    expect(auto[0].height).toBe(half[0].height);
    expect(auto[0].width).toBeLessThan(full[0].width);
    expect(auto[0].height).toBeLessThan(full[0].height);
  });
});

describe("renderPoly — data attributes and lighting", () => {
  it("reflects polygon.data as data-* attributes on the element", () => {
    const result = renderPoly({
      vertices: FLAT_TRIANGLE.vertices,
      data: { id: "poly-1", score: 42, active: true },
    })!;
    expect(result.element.getAttribute("data-id")).toBe("poly-1");
    expect(result.element.getAttribute("data-score")).toBe("42");
    expect(result.element.getAttribute("data-active")).toBe("true");
    result.dispose();
  });

  it("applies custom light direction without throwing", () => {
    const result = renderPoly({
      vertices: FLAT_TRIANGLE.vertices,
      color: "#ffffff",
    }, {
      directionalLight: {
        direction: [0, -1, 0],
        color: "#ff8800",
        ambientColor: "#334455",
        ambient: 0.3,
      },
    })!;
    expect(result.element.style.transform).toContain("matrix3d(");
    result.dispose();
  });
});
