import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, h } from "vue";
import { Poly } from "./Poly";
import type { PolyContext } from "./Poly";

const DEFAULT_CONTEXT: PolyContext = {
  tileSize: 50,
  layerElevation: 50,
};

const FLAT_TRIANGLE: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

const VERTICAL_QUAD: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
];

const OFFAXIS_TRIANGLE: [number, number, number][] = [
  [0, 0, 0],
  [1, 1, 0],
  [0, 1, 1],
];

function renderPoly(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () =>
        h(Poly, {
          context: DEFAULT_CONTEXT,
          color: "#cccccc",
          ...props,
        });
    },
  });
  app.mount(container);
  return container;
}

function getPoly(container: HTMLElement): HTMLElement {
  const poly = container.querySelector("i") as HTMLElement | null;
  expect(poly).toBeTruthy();
  return poly!;
}

describe("Poly (Vue) — solid color polygon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a polygon i element and no SVG", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.classList.contains("polycss-poly")).toBe(false);
    expect(poly.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(poly.classList.contains("polycss-poly-solid")).toBe(false);
    expect(poly.classList.contains("polycss-poly-textured")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("polygon i element has a matrix3d transform with 16 values", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const poly = getPoly(container);
    const match = poly.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });

  it("keeps class-owned constants out of inline styles", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const poly = getPoly(container);
    expect(poly.style.position).toBe("");
    expect(poly.style.left).toBe("");
    expect(poly.style.top).toBe("");
    expect(poly.style.transformOrigin).toBe("");
    expect(poly.style.backfaceVisibility).toBe("");
    expect(poly.style.backgroundRepeat).toBe("");
  });

  it("does not apply texture filter to solid faces", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      textureLighting: "filter",
    });
    expect(getPoly(container).style.filter).toBe("");
  });

  it("renders nothing for degenerate zero-length first edge", () => {
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

  it("renders nothing for collinear vertices", () => {
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

describe("Poly (Vue) — non-horizontal geometry", () => {
  it("renders a vertical quad as a polygon i element", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });

  it("renders an off-axis triangle as a polygon i element", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });
});

describe("Poly (Vue) — texture without UVs", () => {
  it("renders a polygon i element", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
    });
    expect(getPoly(container).tagName.toLowerCase()).toBe("i");
  });

  it("does not use CSS filter for baked texture lighting", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
    });
    expect(getPoly(container).style.filter).toBe("");
  });

  it("uses CSS filter when textureLighting=filter", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
      textureLighting: "filter",
    });
    expect(getPoly(container).style.filter).toContain("brightness(");
  });
});

describe("Poly (Vue) — UV-mapped texture", () => {
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
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
      uvs: [[0, 0], [1, 0], [0, 1]],
    });
    const poly = getPoly(container);
    expect(poly.tagName.toLowerCase()).toBe("i");
    expect(poly.style.transform).toContain("matrix3d(");
  });

  it("uses CSS filter when textureLighting=filter", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
      textureLighting: "filter",
      uvs: [[0, 0], [1, 0], [0, 1]],
    });
    expect(getPoly(container).style.filter).toContain("brightness(");
  });
});

describe("Poly (Vue) — debug backfaces", () => {
  it("does not render SVG debug overlays", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".polycss-debug-backface")).toBeNull();
  });
});

describe("Poly (Vue) — transform props", () => {
  it("renders a wrapper div when position is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      position: [10, 20, 30],
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeTruthy();
  });

  it("wrapper div has translate3d from position prop", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      position: [10, 20, 30],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper") as HTMLElement;
    expect(wrapper.style.transform).toContain("translate3d(10px, 20px, 30px)");
  });

  it("does not render a wrapper div for scale=1", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      scale: 1,
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeNull();
  });

  it("renders a wrapper div when rotation is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      rotation: [45, 0, 0],
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeTruthy();
  });
});

describe("Poly (Vue) — DOM passthrough via attrs", () => {
  it("reflects data field as data-* attributes", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      data: { foo: "bar", num: 42 },
    });
    const poly = getPoly(container);
    expect(poly.getAttribute("data-foo")).toBe("bar");
    expect(poly.getAttribute("data-num")).toBe("42");
  });
});
