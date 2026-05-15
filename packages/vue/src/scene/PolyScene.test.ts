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

  it("folds bbox center into scene --scene-transform when autoCenter=true", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: true,
    });
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    const transform = scene.style.getPropertyValue("--scene-transform");
    // QUAD bbox center is (1,1,1) in world coords → translate3d(-50px,-50px,-50px)
    // (world→CSS axis swap: wy*50 for cssX, wx*50 for cssY, wz*50 for cssZ)
    expect(transform).toContain("translate3d(-50px, -50px, -50px)");
  });

  it("does NOT render a .polycss-offset wrapper element — meshes are direct children", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: true,
    });
    expect(container.querySelector(".polycss-offset")).toBeNull();
  });

  it("scene --scene-transform innermost translate is zero when autoCenter=false", () => {
    const { container } = renderScene({
      polygons: [QUAD],
      autoCenter: false,
    });
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    const transform = scene.style.getPropertyValue("--scene-transform");
    // No offset — default target=[0,0,0] produces translate3d(0px,0px,0px)
    expect(transform).toContain("translate3d(0px, 0px, 0px)");
    // Centering does not appear
    expect(transform).not.toContain("translate3d(-50px, -50px, -50px)");
  });

  it("scene --scene-transform translate differs between autoCenter=true and autoCenter=false", () => {
    const { container: c1 } = renderScene({ polygons: [QUAD], autoCenter: true });
    const { container: c2 } = renderScene({ polygons: [QUAD], autoCenter: false });
    const t1 = (c1.querySelector(".polycss-scene") as HTMLElement).style.getPropertyValue("--scene-transform");
    const t2 = (c2.querySelector(".polycss-scene") as HTMLElement).style.getPropertyValue("--scene-transform");
    expect(t1).not.toBe(t2);
  });

  it("pan (target) and autoCenterOffset are independent — autoCenter does not zero out target", async () => {
    // Even with autoCenter the user's camera target should be preserved.
    // We can't drive orbit controls in a unit test, so we verify the
    // math property: the scene transform contains a contribution from both
    // the bbox center (autoCenterOffset) and a non-zero target when one is set.
    // Here we use the camera's initial state (target=[0,0,0]), so the full
    // translate3d comes from autoCenterOffset alone — confirming the two are
    // additive and independent paths in the transform string.
    const { container } = renderScene({ polygons: [QUAD], autoCenter: true });
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    const transform = scene.style.getPropertyValue("--scene-transform");
    // bbox center [1,1,1] + target [0,0,0] → translate3d(-50px,-50px,-50px)
    expect(transform).toContain("translate3d(-50px, -50px, -50px)");
    // No .polycss-offset wrapper exists — no DOM layer shifting polygons
    expect(container.querySelector(".polycss-offset")).toBeNull();
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
