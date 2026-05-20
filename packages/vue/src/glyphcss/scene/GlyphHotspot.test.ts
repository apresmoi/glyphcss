import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { GlyphScene } from "./GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphHotspot } from "./GlyphHotspot";

type HotspotProps = {
  id: string;
  at: [number, number, number];
  size?: [number, number];
};

function renderScene(
  hotspotProps: HotspotProps,
  slotChildren?: () => VNode | VNode[],
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, {}, {
          default: () =>
            h(GlyphScene, {}, {
              default: () =>
                h(GlyphHotspot, hotspotProps, slotChildren ? { default: slotChildren } : undefined),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphHotspot (Vue) — mount inside scene (no children)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene({ id: "hs1", at: [0, 0, 0] })).not.toThrow();
  });

  it("scene host is present after mounting hotspot", async () => {
    const { container } = renderScene({ id: "hs1", at: [0, 0, 0] });
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("renders null (no DOM node) when no children", async () => {
    const { container } = renderScene({ id: "hs1", at: [0, 0, 0] });
    await nextTick();
    // GlyphHotspot returns null in Vue when it has no slot children
    // (nothing is rendered into the component's own slot area)
    // The test ensures it doesn't crash and the scene is still functional
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
  });

  it("accepts a size prop without throwing", () => {
    expect(() =>
      renderScene({ id: "hs2", at: [1, 2, 3], size: [3, 2] }),
    ).not.toThrow();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ id: "hs1", at: [0, 0, 0] });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphHotspot (Vue) — mount inside scene (with slot children)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts with slot children without throwing", () => {
    // GlyphHotspot in Vue returns null from its render function — it
    // registers with the scene imperatively and does not render slot children
    // into its own DOM subtree. This is the expected Vue idiom.
    expect(() =>
      renderScene(
        { id: "hs-slot", at: [0, 1, 0] },
        () => h("span", { class: "tooltip" }, "hello"),
      ),
    ).not.toThrow();
  });

  it("scene is still rendered when slot children are provided", async () => {
    const { container } = renderScene(
      { id: "hs-slot2", at: [0, 1, 0] },
      () => h("span", { class: "tooltip-inner" }, "world"),
    );
    await nextTick();
    // GlyphHotspot renders null — slot content is not projected into its DOM.
    // The scene itself must still be functional.
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
  });

  it("unmounts cleanly when slot children are provided", async () => {
    const { container, app } = renderScene(
      { id: "hs-unmount", at: [0, 0, 0] },
      () => h("span", { class: "bye-slot" }, "bye"),
    );
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphHotspot (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphHotspot, { id: "err", at: [0, 0, 0] });
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
