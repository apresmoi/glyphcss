import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { GlyphScene } from "./GlyphScene";
import { GlyphMesh } from "./GlyphMesh";
import { GlyphOrbitControls } from "../controls/GlyphOrbitControls";
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
        h(GlyphScene, sceneProps, slotChildren ? { default: slotChildren } : undefined);
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphScene (Vue) — basic rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders a .glyph-host element", () => {
    const { container } = renderScene();
    const host = container.querySelector(".glyph-host");
    expect(host).toBeTruthy();
  });

  it("renders a .glyph-scene element inside the host", async () => {
    const { container } = renderScene();
    await nextTick();
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders a .glyph-output <pre> inside the scene", async () => {
    const { container } = renderScene();
    await nextTick();
    const pre = container.querySelector(".glyph-output");
    expect(pre).toBeTruthy();
    expect(pre?.tagName.toLowerCase()).toBe("pre");
  });

  it("applies custom class to the host element", () => {
    const { container } = renderScene({ class: "my-scene" });
    const host = container.querySelector(".glyph-host");
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

describe("GlyphScene (Vue) — options forwarding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders with custom cols/rows", async () => {
    const { container } = renderScene({ cols: 40, rows: 12 });
    await nextTick();
    const scene = container.querySelector(".glyph-scene");
    expect(scene).toBeTruthy();
  });

  it("renders in wireframe mode without errors", () => {
    expect(() => renderScene({ mode: "wireframe" })).not.toThrow();
  });

  it("renders with useColors=false without errors", () => {
    expect(() => renderScene({ useColors: false })).not.toThrow();
  });
});

describe("GlyphScene (Vue) — GlyphMesh child", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts a GlyphMesh without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphMesh, { polygons: [POLYGON] }),
      ),
    ).not.toThrow();
    await nextTick();
  });

  it("GlyphMesh renders a wrapper div", async () => {
    const { container } = renderScene(
      {},
      () => h(GlyphMesh, { id: "test-mesh", polygons: [POLYGON] }),
    );
    await nextTick();
    const mesh = container.querySelector(".glyph-mesh");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphScene (Vue) — controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphOrbitControls mounts without throwing", async () => {
    expect(() =>
      renderScene(
        {},
        () => h(GlyphOrbitControls, { drag: false, wheel: false }),
      ),
    ).not.toThrow();
    await nextTick();
  });
});

describe("GlyphScene (Vue) — error (no context)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("GlyphMesh throws when used outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphMesh, { polygons: [] });
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
