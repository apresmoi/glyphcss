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

const FLAT_TRIANGLE_VERTS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

const VERTICAL_QUAD_VERTS: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
];

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
      } as PolyProps),
    ),
  );
  return container;
}

function getPoly(container: HTMLElement): HTMLElement {
  const poly = container.querySelector("i") as HTMLElement | null;
  expect(poly).toBeTruthy();
  return poly!;
}

describe("Poly — solid color polygon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a polygon i element and no SVG", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.classList.contains("polycss-poly")).toBe(false);
    expect(poly.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(poly.classList.contains("polycss-poly-solid")).toBe(false);
    expect(poly.classList.contains("polycss-poly-textured")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("polygon i element has a matrix3d transform with 16 values", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    const match = poly.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });

  it("keeps class-owned constants out of inline styles", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.style.position).toBe("");
    expect(poly.style.left).toBe("");
    expect(poly.style.top).toBe("");
    expect(poly.style.transformOrigin).toBe("");
    expect(poly.style.backfaceVisibility).toBe("");
    expect(poly.style.backgroundRepeat).toBe("");
  });

  it("renders null for degenerate vertices", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    expect(container.querySelector("i")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders null for collinear vertices", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    });
    expect(container.querySelector("i")).toBeNull();
  });
});

describe("Poly — non-horizontal geometry", () => {
  it("renders a vertical quad as a polygon i element", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD_VERTS });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });

  it("renders an off-axis triangle as a polygon i element", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });
});

describe("Poly — texture without UVs", () => {
  it("renders a polygon i element", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
    });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
  });

  it("does not use CSS filter for baked texture lighting", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
    });
    expect(getPoly(container).style.filter).toBe("");
  });
});

describe("Poly — border-shape", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", {
      supports: vi.fn((property: string) => property === "border-shape"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders solid non-rect polygons with border-shape when supported", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.className).toBe("");
    expect(poly.style.boxSizing).toBe("border-box");
    expect(poly.style.borderStyle).toBe("solid");
    expect(poly.style.borderWidth).toBe("1px");
    expect(poly.style.borderColor).not.toBe("");
    expect(poly.style.getPropertyValue("border-shape")).toContain("polygon(");
    expect(poly.style.backgroundImage).toBe("");
  });

  it("keeps textured polygons on atlas when border-shape is supported", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
    });
    const poly = getPoly(container);
    expect(poly.style.boxSizing).toBe("");
    expect(poly.style.borderStyle).toBe("");
    expect(poly.style.borderWidth).toBe("");
    expect(poly.style.borderColor).toBe("");
    expect(poly.style.backgroundClip).toBe("");
  });

  it("falls back to atlas for solid non-rect polygons when border-shape is unsupported", () => {
    vi.stubGlobal("CSS", {
      supports: vi.fn(() => false),
    });

    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.style.getPropertyValue("border-shape")).toBe("");
  });

  it("falls back to atlas for solid non-rect polygons on non-desktop pointers", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query.includes("pointer: coarse") || query.includes("hover: none"),
    })));

    const container = renderPoly({ vertices: FLAT_TRIANGLE_VERTS });
    const poly = getPoly(container);
    expect(poly.style.getPropertyValue("border-shape")).toBe("");
  });
});

describe("Poly — UV-mapped texture", () => {
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

  it("renders a polygon i element when uvs + texture are provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });

});

describe("Poly — dynamic lighting", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:dyn-test"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits per-polygon normal vars in dynamic mode", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      textureLighting: "dynamic",
    });
    const poly = getPoly(container);
    // The calc-driven background-color + background-blend-mode now live
    // in the global stylesheet (scoped to data-polycss-lighting="dynamic"
    // on the scene). Per-polygon style only carries the surface normal —
    // much smaller payload per element on big meshes.
    expect(poly.style.getPropertyValue("--pnx")).not.toBe("");
    expect(poly.style.getPropertyValue("--pny")).not.toBe("");
    expect(poly.style.getPropertyValue("--pnz")).not.toBe("");
  });

  it("does not emit the dynamic style hooks in baked mode", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
    });
    const poly = getPoly(container);
    expect(poly.style.backgroundColor).toBe("");
    expect(poly.style.backgroundBlendMode).toBe("");
    expect(poly.style.getPropertyValue("--pnx")).toBe("");
    expect(poly.getAttribute("style") ?? "").not.toContain("mask-image");
  });
});

describe("Poly — debug backfaces", () => {
  it("does not render SVG debug overlays", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".polycss-debug-backface")).toBeNull();
  });
});

describe("Poly — transform props", () => {
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

  it("does not render a wrapper div when transforms are identity", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      scale: 1,
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeNull();
  });

  it("renders a wrapper div when rotation is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      rotation: [45, 0, 0],
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeTruthy();
  });
});

describe("Poly — DOM passthrough", () => {
  it("forwards aria-label", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      "aria-label": "my polygon",
    });
    expect(getPoly(container).getAttribute("aria-label")).toBe("my polygon");
  });

  it("forwards aria-hidden", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      "aria-hidden": true,
    });
    expect(getPoly(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("forwards data field as data-* attrs", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      data: { foo: "bar", num: 42 },
    });
    const poly = getPoly(container);
    expect(poly.getAttribute("data-foo")).toBe("bar");
    expect(poly.getAttribute("data-num")).toBe("42");
  });

  it("applies pointerEvents=none when passed", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      pointerEvents: "none",
    });
    expect(getPoly(container).style.pointerEvents).toBe("none");
  });

  it("appends custom className to the polygon element", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE_VERTS,
      className: "my-custom-class",
    });
    expect(getPoly(container).classList.contains("my-custom-class")).toBe(true);
  });
});
