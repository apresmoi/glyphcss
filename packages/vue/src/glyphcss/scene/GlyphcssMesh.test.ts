import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphcssScene } from "./GlyphcssScene";
import { GlyphcssMesh } from "./GlyphcssMesh";
import type { Polygon } from "@glyphcss/core";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function renderMesh(
  meshProps: Record<string, unknown>,
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, { default: () => h(GlyphcssMesh, meshProps) });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssMesh (Vue) — id prop wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("sets data-glyphcss-mesh-id on the wrapper div when id is given", async () => {
    const { container } = renderMesh({ id: "my-mesh", polygons: [POLYGON] });
    await nextTick();
    const el = container.querySelector("[data-glyphcss-mesh-id='my-mesh']");
    expect(el).toBeTruthy();
  });
});

describe("GlyphcssMesh (Vue) — event props accepted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("accepts onPointerDown without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerDown: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onPointerUp without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerUp: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onPointerMove without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerMove: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onPointerEnter without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerEnter: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onPointerLeave without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onPointerLeave: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onClick without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onClick: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });

  it("accepts onWheel without throwing", async () => {
    expect(() =>
      renderMesh({ polygons: [POLYGON], onWheel: vi.fn() }),
    ).not.toThrow();
    await nextTick();
  });
});
