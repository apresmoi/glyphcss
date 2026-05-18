import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { GlyphcssScene } from "./GlyphcssScene";
import { GlyphcssMesh } from "./GlyphcssMesh";
import { GlyphcssOrbitControls } from "../controls/GlyphcssOrbitControls";
import type { Polygon } from "@glyphcss/core";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function renderScene(
  sceneProps: Record<string, unknown> = {},
  slotChildren?: () => VNode | VNode[],
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, sceneProps, slotChildren ? { default: slotChildren } : undefined);
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssScene (Vue) — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyphcss-host element", () => {
    const { container } = renderScene();
    const host = container.querySelector(".glyphcss-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyphcss-scene element inside the host", async () => {
    const { container } = renderScene();
    await nextTick();
    const scene = container.querySelector(".glyphcss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyphcss-output <pre> inside the scene", async () => {
    const { container } = renderScene();
    await nextTick();
    const pre = container.querySelector(".glyphcss-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom class to the host element", () => {
    const { container } = renderScene({ class: "my-scene" });
    const host = container.querySelector(".glyphcss-host");
    expect(host?.classList.contains("my-scene")).toBe(true);
  });

  it("renders slot children inside the host", () => {
    const { container } = renderScene(
      {},
      () => h("div", { class: "my-child" }, "hello"),
    );
    const child = container.querySelector(".my-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });
});

describe("GlyphcssScene (Vue) — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", async () => {
    const { container } = renderScene({ cols: 40, rows: 12 });
    await nextTick();
    const scene = container.querySelector(".glyphcss-scene");
    expect(scene).toBeTruthy();
  });

  it("renders in wireframe mode without errors", () => {
    expect(() => renderScene({ mode: "wireframe" })).not.toThrow();
  });

  it("renders with useColors=false without errors", () => {
    expect(() => renderScene({ useColors: false })).not.toThrow();
  });
});

describe("GlyphcssScene (Vue) — GlyphcssMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphcssMesh without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphcssMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
    await nextTick();
  });

  it("GlyphcssMesh renders a wrapper div", async () => {
    const { container } = renderScene(
      {},
      () => h(GlyphcssMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    await nextTick();
    const mesh = container.querySelector(".glyphcss-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphcssScene (Vue) — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphcssOrbitControls mounts without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphcssOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
    await nextTick();
  });
});

describe("GlyphcssScene (Vue) — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphcssMesh throws when used outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssMesh, { polygons: [] });
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
