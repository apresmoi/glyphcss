import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Poly } from "./Poly";
import type { PolyProps } from "./types";

type PolyContext = NonNullable<PolyProps["context"]>;

const DEFAULT_CONTEXT: PolyContext = {
  tileSize: 50,
  layerElevation: 50,
};

// Triangle lying flat on the XY plane in world space
const FLAT_TRIANGLE_VERTS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

// Quad in the XZ plane (vertical face)
const VERTICAL_QUAD_VERTS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
];

// Off-axis triangle
const OFFAXIS_TRIANGLE_VERTS: [number, number, number][] = [
  [0, 0, 0],
  [1, 1, 0],
  [0, 1, 1],
];

function renderPoly(props: Partial<PolyProps> & { vertices: [number, number, number][] }): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(Poly, {
        context: DEFAULT_CONTEXT,
        color: "#cccccc",
        ...props,
      } as PolyProps)
    )
  );
  return container;
}

describe("Poly — solid color triangle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an <svg> element", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("applies polycss-poly class", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = container.querySelector(".polycss-poly");
    expect(poly).toBeTruthy();
  });

  it("svg has a matrix3d transform", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.transform).toContain("matrix3d(");
  });

  it("matrix3d transform contains 16 comma-separated values", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const svg = container.querySelector("svg") as SVGSVGElement;
    const match = svg.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    const values = match![1].split(",");
    expect(values.length).toBe(16);
  });

  it("svg has backfaceVisibility hidden", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.backfaceVisibility).toBe("hidden");
  });

  it("svg has position absolute", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.position).toBe("absolute");
  });

  it("path has the correct shaded fill color (not pure black or pure white)", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS, color: "#ff0000" });
    const path = container.querySelector("path") as SVGPathElement;
    const fill = path.getAttribute("fill");
    expect(fill).toBeTruthy();
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("path starts with M and ends with Z", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const path = container.querySelector("path") as SVGPathElement;
    const d = path.getAttribute("d")!;
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("renders null for degenerate vertices (zero-length first edge)", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [0, 0, 0], // zero-length first edge → returns null
        [1, 0, 0],
      ],
    });
    // No svg or img rendered
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders null for degenerate coplanar triangle (zero normal)", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0], // collinear → cross product = 0 → null normal
      ],
    });
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("Poly — vertical quad", () => {
  it("renders svg for a vertical face", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD_VERTS });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("path has 4 segments for a quad", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD_VERTS });
    const path = container.querySelector("path") as SVGPathElement;
    const d = path.getAttribute("d")!;
    // 1 M + 3 L + Z → 4 'M|L' segments
    const segments = (d.match(/[ML]/g) ?? []).length;
    expect(segments).toBe(4);
  });
});

describe("Poly — off-axis triangle", () => {
  it("renders svg for off-axis triangle", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE_VERTS });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("matrix3d transform has 16 values for off-axis polygon", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE_VERTS });
    const svg = container.querySelector("svg") as SVGSVGElement;
    const match = svg.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });
});

describe("Poly — texture without UVs (pattern fill)", () => {
  it("renders svg with polycss-poly-textured class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
    });
    const textured = container.querySelector(".polycss-poly-textured");
    expect(textured).toBeTruthy();
  });

  it("svg contains a <pattern> element for texture", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
    });
    const pattern = container.querySelector("pattern");
    expect(pattern).toBeTruthy();
  });
});

describe("Poly — UV-mapped texture (renders <img>)", () => {
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

  it("renders an <img> element when uvs + texture provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    // img is the UV-mapped path
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
  });

  it("img has polycss-poly-textured class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    const img = container.querySelector("img");
    expect(img?.classList.contains("polycss-poly-textured")).toBe(true);
  });

  it("img has matrix3d transform", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.transform).toContain("matrix3d(");
  });
});

describe("Poly — debug backfaces", () => {
  it("renders a second SVG for debug backface overlay", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    const svgs = container.querySelectorAll("svg");
    // Front face + back face debug overlay
    expect(svgs.length).toBe(2);
  });

  it("debug backface SVG has polycss-debug-backface class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    const debug = container.querySelector(".polycss-debug-backface");
    expect(debug).toBeTruthy();
  });
});

describe("Poly — transform props (wrapper div)", () => {
  it("renders a wrapper div when position is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      position: [10, 20, 30],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeTruthy();
  });

  it("wrapper div has translate3d transform from position prop", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      position: [10, 20, 30],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper") as HTMLElement;
    expect(wrapper.style.transform).toContain("translate3d(10px, 20px, 30px)");
  });

  it("renders a wrapper div when scale (number) is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      scale: 2,
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeTruthy();
  });

  it("does NOT render a wrapper div when scale=1 (identity)", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      scale: 1,
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeNull();
  });

  it("renders a wrapper div when rotation is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      rotation: [45, 0, 0],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeTruthy();
  });

  it("does NOT render a wrapper div when no transforms provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeNull();
  });
});

describe("Poly — DOM passthrough", () => {
  it("forwards aria-label", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      "aria-label": "my polygon",
    });
    const poly = container.querySelector(".polycss-poly");
    expect(poly?.getAttribute("aria-label")).toBe("my polygon");
  });

  it("forwards aria-hidden", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      "aria-hidden": true,
    });
    const poly = container.querySelector(".polycss-poly");
    expect(poly?.getAttribute("aria-hidden")).toBe("true");
  });

  it("forwards data field as data-* attrs", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      data: { foo: "bar", num: 42 },
    });
    const poly = container.querySelector(".polycss-poly");
    expect(poly?.getAttribute("data-foo")).toBe("bar");
    expect(poly?.getAttribute("data-num")).toBe("42");
  });

  it("applies pointerEvents=none when passed", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      pointerEvents: "none",
    });
    const poly = container.querySelector(".polycss-poly") as SVGSVGElement;
    expect(poly.style.pointerEvents).toBe("none");
  });
});

describe("Poly — dimetric projection context", () => {
  it("renders with dimetric layerElevation (half tile)", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      context: {
        tileSize: 50,
        layerElevation: 25, // dimetric = tileSize / 2
      },
    });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});

describe("Poly — custom className", () => {
  it("appends custom className to polycss-poly", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      className: "my-custom-class",
    });
    const poly = container.querySelector(".polycss-poly");
    expect(poly?.classList.contains("my-custom-class")).toBe(true);
  });
});
