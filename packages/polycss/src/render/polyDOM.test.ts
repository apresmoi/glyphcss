import { describe, it, expect, vi, afterEach } from "vitest";
import { renderPoly } from "./polyDOM";
import { renderPolygonsWithTextureAtlas } from "./textureAtlas";
import type { Polygon } from "@layoutit/polycss-core";

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

describe("renderPoly — solid polygons", () => {
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

  it("uses background-color, not an atlas canvas, for full rectangular solid polygons", () => {
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

    const result = renderPolygonsWithTextureAtlas([VERTICAL_QUAD], { doc });
    const element = result.rendered[0].element;
    expect(canvases).toHaveLength(0);
    expect(element.style.backgroundColor).not.toBe("");
    result.dispose();
  });

  it("can render solid non-rect polygons with border-shape instead of an atlas canvas", () => {
    const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
    const doc = {
      defaultView: {
        CSS: {
          supports: (property: string) => property === "border-shape",
        },
      },
      createElement(tagName: string) {
        if (tagName === "canvas") {
          const canvas = { width: 0, height: 0, getContext: () => null };
          canvases.push(canvas);
          return canvas;
        }
        return document.createElement(tagName);
      },
    } as unknown as Document;

    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc });
    const element = result.rendered[0].element;
    expect(canvases).toHaveLength(0);
    expect(element.style.getPropertyValue("border-shape")).toContain("polygon(");
    expect(element.style.boxSizing).toBe("border-box");
    expect(element.style.borderStyle).toBe("solid");
    expect(element.style.borderWidth).toBe("1px");
    expect(element.style.borderColor).not.toBe("");
    expect(element.style.backgroundImage).toBe("");
    result.dispose();
  });

  it("uses the atlas fallback for solid non-rect polygons on non-desktop pointers", () => {
    const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
    const doc = {
      defaultView: {
        CSS: {
          supports: (property: string) => property === "border-shape",
        },
        matchMedia: (query: string) => ({
          matches: query.includes("pointer: coarse") || query.includes("hover: none"),
        }),
      },
      createElement(tagName: string) {
        if (tagName === "canvas") {
          const canvas = { width: 0, height: 0, getContext: () => null };
          canvases.push(canvas);
          return canvas;
        }
        return document.createElement(tagName);
      },
    } as unknown as Document;

    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc });
    const element = result.rendered[0].element;
    expect(canvases).toHaveLength(1);
    expect(element.style.getPropertyValue("border-shape")).toBe("");
    result.dispose();
  });

  it("keeps textured polygons on atlas even when border-shape is supported", () => {
    const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
    const doc = {
      defaultView: {
        CSS: {
          supports: (property: string) => property === "border-shape",
        },
      },
      createElement(tagName: string) {
        if (tagName === "canvas") {
          const canvas = { width: 0, height: 0, getContext: () => null };
          canvases.push(canvas);
          return canvas;
        }
        return document.createElement(tagName);
      },
    } as unknown as Document;

    const result = renderPolygonsWithTextureAtlas(
      [{ ...FLAT_TRIANGLE, texture: "https://example.com/tex.png" }],
      { doc },
    );
    const element = result.rendered[0].element;
    expect(canvases).toHaveLength(1);
    expect(element.style.getPropertyValue("border-shape")).toBe("");
    expect(element.style.backgroundClip).toBe("");
    result.dispose();
  });

  it("falls back to atlas for solid non-rect polygons when border-shape is unsupported", () => {
    const canvases: Array<{ width: number; height: number; getContext: () => null }> = [];
    const doc = {
      defaultView: {
        CSS: {
          supports: () => false,
        },
      },
      createElement(tagName: string) {
        if (tagName === "canvas") {
          const canvas = { width: 0, height: 0, getContext: () => null };
          canvases.push(canvas);
          return canvas;
        }
        return document.createElement(tagName);
      },
    } as unknown as Document;

    const result = renderPolygonsWithTextureAtlas([FLAT_TRIANGLE], { doc });
    const element = result.rendered[0].element;
    expect(canvases).toHaveLength(1);
    expect(element.style.getPropertyValue("border-shape")).toBe("");
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

  it("uses the smallest in-plane DOM box for untextured oblique polygons", () => {
    const obliqueTriangle: Polygon = {
      vertices: [
        [0, 0, 0],
        [1, 9, 0],
        [0, 10, 0],
      ],
      color: "#ffffff",
    };

    const result = renderPolygonsWithTextureAtlas([obliqueTriangle], { tileSize: 1 });
    const element = result.rendered[0].element;
    const matrix = extractMatrix(element);

    expect(parseFloat(element.style.width)).toBe(10);
    expect(parseFloat(element.style.height)).toBe(1);
    expect(matrix[0]).toBeCloseTo(-1, 6);
    expect(matrix[1]).toBeCloseTo(0, 6);
    expect(matrix[4]).toBeCloseTo(0, 6);
    expect(matrix[5]).toBeCloseTo(-1, 6);
    result.dispose();
  });

  it("keeps the first-edge transform basis for UV-mapped textured polygons", () => {
    const obliqueTriangle: Polygon = {
      vertices: [
        [0, 0, 0],
        [1, 9, 0],
        [0, 10, 0],
      ],
      color: "#ffffff",
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    };

    const result = renderPolygonsWithTextureAtlas([obliqueTriangle], { tileSize: 1 });
    const element = result.rendered[0].element;
    const matrix = extractMatrix(element);
    const expected = computeExpectedMatrix(obliqueTriangle.vertices as [number, number, number][], 1, 1);

    expect(parseFloat(element.style.width)).toBe(10);
    expect(parseFloat(element.style.height)).toBe(2);
    for (let i = 0; i < expected.length; i++) {
      expect(matrix[i]).toBeCloseTo(expected[i], 6);
    }
    result.dispose();
  });

  it("uses one basis for an untextured coplanar island when it keeps the DOM box tight", () => {
    const left: Polygon = {
      vertices: [
        [0, 0, 0],
        [0, 10, 0],
        [1, 10, 0],
      ],
      color: "#ff0000",
    };
    const right: Polygon = {
      vertices: [
        [0, 10, 0],
        [1, 20, 0],
        [1, 10, 0],
      ],
      color: "#ff0000",
    };

    const result = renderPolygonsWithTextureAtlas([left, right], { tileSize: 1 });
    const leftMatrix = extractMatrix(result.rendered[0].element);
    const rightMatrix = extractMatrix(result.rendered[1].element);

    expect(leftMatrix[0]).toBeCloseTo(rightMatrix[0], 6);
    expect(leftMatrix[1]).toBeCloseTo(rightMatrix[1], 6);
    expect(leftMatrix[4]).toBeCloseTo(rightMatrix[4], 6);
    expect(leftMatrix[5]).toBeCloseTo(rightMatrix[5], 6);
    result.dispose();
  });

  it("keeps the first-edge transform basis for shared textured seams", () => {
    const bladeFace: Polygon = {
      vertices: [
        [0, 0, 0],
        [1, 9, 0],
        [0, 10, 0],
      ],
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    };
    const bevelFace: Polygon = {
      vertices: [
        [1, 9, 0],
        [0, 0, 0],
        [0, 0, 1],
      ],
      texture: "https://example.com/tex.png",
      uvs: [[1, 0], [0, 0], [0, 1]],
    };

    const isolated = renderPolygonsWithTextureAtlas([bladeFace], { tileSize: 1 });
    const shared = renderPolygonsWithTextureAtlas([bladeFace, bevelFace], { tileSize: 1 });
    const sharedMatrix = extractMatrix(shared.rendered[0].element);
    const sharedEdgeMatrix = computeExpectedMatrix(bladeFace.vertices as [number, number, number][], 1, 1);

    const isolatedMatrix = extractMatrix(isolated.rendered[0].element);
    expect(isolatedMatrix[0]).toBeCloseTo(sharedEdgeMatrix[0], 6);
    expect(isolatedMatrix[1]).toBeCloseTo(sharedEdgeMatrix[1], 6);
    expect(isolatedMatrix[4]).toBeCloseTo(sharedEdgeMatrix[4], 6);
    expect(isolatedMatrix[5]).toBeCloseTo(sharedEdgeMatrix[5], 6);
    expect(sharedMatrix[0]).toBeCloseTo(sharedEdgeMatrix[0], 6);
    expect(sharedMatrix[1]).toBeCloseTo(sharedEdgeMatrix[1], 6);
    expect(sharedMatrix[4]).toBeCloseTo(sharedEdgeMatrix[4], 6);
    expect(sharedMatrix[5]).toBeCloseTo(sharedEdgeMatrix[5], 6);
    isolated.dispose();
    shared.dispose();
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

    const texturedTriangle = { ...FLAT_TRIANGLE, texture: "https://example.com/tex.png" };
    const full = renderPolygonsWithTextureAtlas([texturedTriangle], { doc, atlasScale: 1 });
    const half = renderPolygonsWithTextureAtlas([texturedTriangle], { doc, atlasScale: 0.5 });

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
      texture: "https://example.com/tex.png",
    };
    const largeScene = [largeQuad, largeQuad, largeQuad, largeQuad];

    const auto = collectCanvasSizes(largeScene, "auto");
    const half = collectCanvasSizes(largeScene, 0.5);
    const full = collectCanvasSizes(largeScene, 1);
    const autoMaxSide = Math.max(...auto.flatMap((page) => [page.width, page.height]));
    const halfMaxSide = Math.max(...half.flatMap((page) => [page.width, page.height]));
    const fullMaxSide = Math.max(...full.flatMap((page) => [page.width, page.height]));

    expect(auto).toHaveLength(half.length);
    expect(autoMaxSide).toBeLessThanOrEqual(halfMaxSide);
    expect(autoMaxSide).toBeLessThan(fullMaxSide);
  });

  it("auto atlasScale caps oversized runtime atlas bitmaps by workload", () => {
    const collectCanvasSizes = (
      polygons: Polygon[],
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
      const result = renderPolygonsWithTextureAtlas(polygons, { doc, atlasScale: "auto" });
      result.dispose();
      return canvases.map(({ width, height }) => ({ width, height }));
    };

    const hugeQuad: Polygon = {
      vertices: [
        [0, 0, 0],
        [80, 0, 0],
        [80, 80, 0],
        [0, 80, 0],
      ],
      color: "#ffffff",
      texture: "https://example.com/tex.png",
    };
    const auto = collectCanvasSizes([hugeQuad]);
    const maxSide = Math.max(...auto.flatMap((page) => [page.width, page.height]));
    const decodedBytes = auto.reduce((sum, page) => sum + page.width * page.height * 4, 0);

    expect(maxSide).toBeLessThanOrEqual(2048);
    expect(decodedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
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
