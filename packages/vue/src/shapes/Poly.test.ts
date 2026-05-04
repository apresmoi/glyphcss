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

describe("Poly (Vue) — solid color triangle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an <svg> element", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("applies polycss-poly class", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    expect(container.querySelector(".polycss-poly")).toBeTruthy();
  });

  it("svg has a matrix3d transform", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.transform).toContain("matrix3d(");
  });

  it("matrix3d transform contains 16 comma-separated values", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const svg = container.querySelector("svg") as SVGSVGElement;
    const match = svg.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    const values = match![1].split(",");
    expect(values.length).toBe(16);
  });

  it("svg has backfaceVisibility hidden", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.backfaceVisibility).toBe("hidden");
  });

  it("svg has position absolute", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg.style.position).toBe("absolute");
  });

  it("path fill is a valid hex color string", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE, color: "#ff0000" });
    const path = container.querySelector("path") as SVGPathElement;
    const fill = path.getAttribute("fill");
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("path starts with M and ends with Z", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    const path = container.querySelector("path") as SVGPathElement;
    const d = path.getAttribute("d")!;
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("renders nothing for degenerate zero-length first edge", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders nothing for collinear vertices (zero normal)", () => {
    const container = renderPoly({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    });
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("Poly (Vue) — vertical quad", () => {
  it("renders svg for a vertical face", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD });
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("path has 4 segments (1 M + 3 L) for a quad", () => {
    const container = renderPoly({ vertices: VERTICAL_QUAD });
    const path = container.querySelector("path") as SVGPathElement;
    const d = path.getAttribute("d")!;
    const segments = (d.match(/[ML]/g) ?? []).length;
    expect(segments).toBe(4);
  });
});

describe("Poly (Vue) — off-axis triangle", () => {
  it("renders svg for off-axis triangle", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE });
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("matrix3d has 16 values for off-axis polygon", () => {
    const container = renderPoly({ vertices: OFFAXIS_TRIANGLE });
    const svg = container.querySelector("svg") as SVGSVGElement;
    const match = svg.style.transform.match(/matrix3d\(([^)]+)\)/);
    expect(match).toBeTruthy();
    expect(match![1].split(",").length).toBe(16);
  });
});

describe("Poly (Vue) — texture without UVs (pattern fill)", () => {
  it("renders svg with polycss-poly-textured class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
    });
    expect(container.querySelector(".polycss-poly-textured")).toBeTruthy();
  });

  it("svg contains a <pattern> element for texture", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
    });
    expect(container.querySelector("pattern")).toBeTruthy();
  });
});

describe("Poly (Vue) — UV-mapped texture (renders <img>)", () => {
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
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
  });

  it("img has polycss-poly-textured class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      texture: "https://example.com/tex.png",
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    const img = container.querySelector("img");
    expect(img?.className).toContain("polycss-poly-textured");
  });

  it("img has matrix3d transform", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
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

describe("Poly (Vue) — debug backfaces", () => {
  it("renders a second SVG for debug backface overlay", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
  });

  it("debug backface SVG has polycss-debug-backface class", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      context: {
        ...DEFAULT_CONTEXT,
        debugShowBackfaces: true,
      },
    });
    expect(container.querySelector(".polycss-debug-backface")).toBeTruthy();
  });
});

describe("Poly (Vue) — transform props (wrapper div)", () => {
  it("renders a wrapper div when position is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      position: [10, 20, 30],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper");
    expect(wrapper).toBeTruthy();
  });

  it("wrapper div has translate3d from position prop", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      position: [10, 20, 30],
    });
    const wrapper = container.querySelector(".polycss-poly-wrapper") as HTMLElement;
    expect(wrapper.style.transform).toContain("translate3d(10px, 20px, 30px)");
  });

  it("renders a wrapper div when scale (number ≠ 1) is provided", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      scale: 2,
    });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeTruthy();
  });

  it("does NOT render a wrapper div for scale=1", () => {
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

  it("does NOT render a wrapper div when no transforms are provided", () => {
    const container = renderPoly({ vertices: FLAT_TRIANGLE });
    expect(container.querySelector(".polycss-poly-wrapper")).toBeNull();
  });
});

describe("Poly (Vue) — DOM passthrough via attrs", () => {
  it("reflects data field as data-* attributes", () => {
    const container = renderPoly({
      vertices: FLAT_TRIANGLE,
      data: { foo: "bar", num: 42 },
    });
    // Vue Poly reflects polygon.data on the inner SVG/img
    const poly = container.querySelector(".polycss-poly");
    expect(poly?.getAttribute("data-foo")).toBe("bar");
    expect(poly?.getAttribute("data-num")).toBe("42");
  });
});
