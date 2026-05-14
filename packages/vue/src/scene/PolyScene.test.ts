import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [[0, 0], [1, 0], [0, 1]],
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 1],
    [2, 0, 1],
    [2, 2, 1],
    [0, 2, 1],
  ],
  color: "#00ff00",
};

function renderScene(
  sceneProps: Record<string, unknown> = {},
  slotChildren?: () => VNode | VNode[]
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, sceneProps, slotChildren ? { default: slotChildren } : undefined),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("PolyScene (Vue) — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .polycss-scene element", () => {
    const { container } = renderScene();
    const scene = container.querySelector(".polycss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders slot children inside the scene", () => {
    const { container } = renderScene(
      {},
      () => h("div", { class: "my-child" }, "hello")
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });

  it("applies custom class to polycss-scene", () => {
    const { container } = renderScene({ class: "my-scene" });
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.classList.contains("my-scene")).toBe(true);
  });

  it("scene has data-polycss-lighting attribute", () => {
    const { container } = renderScene();
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.getAttribute("data-polycss-lighting")).toBe("baked");
  });

  it("scene leaves anchor positioning to base CSS", () => {
    const { container } = renderScene();
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    expect(scene.style.top).toBe("");
    expect(scene.style.left).toBe("");
    expect(scene.style.getPropertyValue("--scene-transform")).toContain("scale(");
  });
});

describe("PolyScene (Vue) — polygon rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders triangle u elements from the polygons prop", () => {
    const { container } = renderScene({ polygons: [TRIANGLE] });
    const poly = container.querySelector("u");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("u");
    expect(poly?.classList.contains("polycss-poly-atlas")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-solid")).toBe(false);
    expect(poly?.classList.contains("polycss-poly-textured")).toBe(false);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders multiple polygons", () => {
    const { container } = renderScene({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(2);
  });

  it("renders textured polygons as polygon s elements", () => {
    const { container } = renderScene({ polygons: [TEXTURED_TRIANGLE] });
    const poly = container.querySelector("s");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("s");
  });

  it("renders no poly elements when polygons prop is empty", () => {
    const { container } = renderScene({ polygons: [] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });

  it("renders no poly elements when polygons prop is omitted", () => {
    const { container } = renderScene({});
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });
});

describe("PolyScene (Vue) — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a centering wrapper div with translate3d when autoCenter=true", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: true,
    });
    const scene = container.querySelector(".polycss-scene");
    const children = Array.from(scene?.children ?? []);
    const hasTranslate = children.some((el) =>
      (el as HTMLElement).style.getPropertyValue("--offset-transform").includes("translate3d")
    );
    expect(hasTranslate).toBe(true);
  });

  it("does NOT render a centering wrapper when autoCenter=false", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: false,
    });
    const scene = container.querySelector(".polycss-scene");
    const children = Array.from(scene?.children ?? []);
    const hasTranslate = children.some((el) =>
      (el as HTMLElement).style.getPropertyValue("--offset-transform").includes("translate3d")
    );
    expect(hasTranslate).toBe(false);
  });

  it("autoCenter translate3d is non-zero for off-center polygon", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: true,
    });
    const scene = container.querySelector(".polycss-scene");
    const wrapper = Array.from(scene?.children ?? []).find((el) =>
      (el as HTMLElement).style.getPropertyValue("--offset-transform").includes("translate3d")
    ) as HTMLElement | undefined;
    expect(wrapper).toBeTruthy();
    expect(wrapper!.style.getPropertyValue("--offset-transform")).not.toBe("translate3d(0px, 0px, 0px)");
  });
});

describe("PolyScene (Vue) — debugShowBackfaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does not render SVG debug overlays when debugShowBackfaces=true", async () => {
    const { container } = renderScene({
      polygons: [TRIANGLE],
      debugShowBackfaces: true,
    });
    await nextTick();
    const debugFaces = container.querySelectorAll(".polycss-debug-backface");
    expect(debugFaces.length).toBe(0);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("PolyScene (Vue) — automatic merge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders polygons without a merge prop", () => {
    const { container } = renderScene({
      polygons: [TRIANGLE, QUAD],
    });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(2);
  });

  it("collapses coplanar same-color triangles", () => {
    const tri1: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      color: "#ff0000",
    };
    const tri2: Polygon = {
      vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const { container } = renderScene({
      polygons: [tri1, tri2],
    });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });
});

describe("PolyScene (Vue) — strategies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("disabling u makes a triangle render as something other than u", () => {
    const { container } = renderScene({
      polygons: [TRIANGLE],
      strategies: { disable: ["u"] },
    });
    expect(container.querySelector("u")).toBeNull();
    // Falls through to <i> (border-shape, when supported) or <s> (atlas fallback).
    const poly = container.querySelector("i,s");
    expect(poly).toBeTruthy();
  });

  it("disabling b, i, u makes every polygon render as s", () => {
    const { container } = renderScene({
      polygons: [TRIANGLE, QUAD],
      strategies: { disable: ["b", "i", "u"] },
    });
    const sElements = container.querySelectorAll("s");
    const otherElements = container.querySelectorAll("b,i,u");
    expect(otherElements.length).toBe(0);
    expect(sElements.length).toBe(2);
  });
});

describe("PolyScene (Vue) — error (no camera context)", () => {
  it("throws when used outside PolyCamera", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(PolyScene, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
    document.body.innerHTML = "";
  });
});
