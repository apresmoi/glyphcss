import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphcssScene } from "./GlyphcssScene";
import { GlyphcssGround } from "./GlyphcssGround";

function renderInScene(
  groundProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, { default: () => h(GlyphcssGround, groundProps) });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssGround (Vue) — mounts inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", async () => {
    expect(() => renderInScene()).not.toThrow();
    await nextTick();
  });

  it("renders a .glyphcss-mesh wrapper inside the scene", async () => {
    const { container } = renderInScene();
    await nextTick();
    expect(container.querySelector(".glyphcss-mesh")).toBeTruthy();
  });

  it("accepts size prop without throwing", async () => {
    expect(() => renderInScene({ size: 10 })).not.toThrow();
    await nextTick();
  });

  it("accepts color prop without throwing", async () => {
    expect(() => renderInScene({ color: "#888888" })).not.toThrow();
    await nextTick();
  });

  it("accepts position prop without throwing", async () => {
    expect(() => renderInScene({ position: [0, -1, 0] })).not.toThrow();
    await nextTick();
  });

  it("accepts id prop without throwing", async () => {
    expect(() => renderInScene({ id: "ground" })).not.toThrow();
    await nextTick();
  });

  it("sets data-glyphcss-mesh-id when id is provided", async () => {
    const { container } = renderInScene({ id: "ground-plane" });
    await nextTick();
    const mesh = container.querySelector("[data-glyphcss-mesh-id='ground-plane']");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphcssGround (Vue) — throws outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssGround, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
