import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import type { Polygon } from "@polycss/core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
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

  it("includes dimetric class when projection=dimetric", () => {
    const { container } = renderScene({ projection: "dimetric" });
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.classList.contains("polycss-projection--dimetric")).toBe(true);
  });

  it("does NOT include dimetric class when projection=cubic", () => {
    const { container } = renderScene({ projection: "cubic" });
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.classList.contains("polycss-projection--dimetric")).toBe(false);
  });

  it("scene has data-polycss-depth-offset='0'", () => {
    const { container } = renderScene();
    const scene = container.querySelector(".polycss-scene");
    expect(scene?.getAttribute("data-polycss-depth-offset")).toBe("0");
  });

  it("scene is positioned at top:50% left:50%", () => {
    const { container } = renderScene();
    const scene = container.querySelector(".polycss-scene") as HTMLElement;
    expect(scene.style.top).toBe("50%");
    expect(scene.style.left).toBe("50%");
  });
});

describe("PolyScene (Vue) — polygon rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders SVG polygon elements from the polygons prop", () => {
    const { container } = renderScene({ polygons: [TRIANGLE] });
    const polys = container.querySelectorAll(".polycss-poly");
    expect(polys.length).toBeGreaterThan(0);
  });

  it("renders multiple polygons", () => {
    const { container } = renderScene({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll(".polycss-poly");
    expect(polys.length).toBe(2);
  });

  it("renders no poly elements when polygons prop is empty", () => {
    const { container } = renderScene({ polygons: [] });
    const polys = container.querySelectorAll(".polycss-poly");
    expect(polys.length).toBe(0);
  });

  it("renders no poly elements when polygons prop is omitted", () => {
    const { container } = renderScene({});
    const polys = container.querySelectorAll(".polycss-poly");
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
      (el as HTMLElement).style.transform?.includes("translate3d")
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
      (el as HTMLElement).style.transform?.includes("translate3d")
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
      (el as HTMLElement).style.transform?.includes("translate3d")
    ) as HTMLElement | undefined;
    expect(wrapper).toBeTruthy();
    expect(wrapper!.style.transform).not.toBe("translate3d(0px, 0px, 0px)");
  });
});

describe("PolyScene (Vue) — debugShowBackfaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders debug backface SVGs when debugShowBackfaces=true", async () => {
    const { container } = renderScene({
      polygons: [TRIANGLE],
      debugShowBackfaces: true,
    });
    await nextTick();
    const debugFaces = container.querySelectorAll(".polycss-debug-backface");
    expect(debugFaces.length).toBeGreaterThan(0);
  });
});

describe("PolyScene (Vue) — merge option", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("merge='off' passes two polygons through", () => {
    const { container } = renderScene({
      polygons: [TRIANGLE, QUAD],
      merge: "off",
    });
    const polys = container.querySelectorAll(".polycss-poly");
    expect(polys.length).toBe(2);
  });

  it("merge='auto' still renders polygons", () => {
    const { container } = renderScene({
      polygons: [TRIANGLE, QUAD],
      merge: "auto",
    });
    const polys = container.querySelectorAll(".polycss-poly");
    expect(polys.length).toBeGreaterThan(0);
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
