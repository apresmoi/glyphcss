import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphScene } from "./GlyphScene";
import { GlyphGround } from "./GlyphGround";

function renderInScene(
  groundProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphScene, {}, { default: () => h(GlyphGround, groundProps) });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphGround (Vue) — mounts inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", async () => {
    expect(() => renderInScene()).not.toThrow();
    await nextTick();
  });

  it("renders a .glyph-mesh wrapper inside the scene", async () => {
    const { container } = renderInScene();
    await nextTick();
    expect(container.querySelector(".glyph-mesh")).toBeTruthy();
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

  it("sets data-glyph-mesh-id when id is provided", async () => {
    const { container } = renderInScene({ id: "ground-plane" });
    await nextTick();
    const mesh = container.querySelector("[data-glyph-mesh-id='ground-plane']");
    expect(mesh).toBeTruthy();
  });
});

describe("GlyphGround (Vue) — throws outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphGround, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
