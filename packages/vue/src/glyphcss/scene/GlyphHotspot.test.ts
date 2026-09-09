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

  it("teleports slot children into the hotspot overlay element", async () => {
    const { container } = renderScene(
      { id: "hs-slot", at: [0, 1, 0] },
      () => h("span", { class: "tooltip" }, "hello"),
    );
    await nextTick();
    // Children are teleported into the div.glyph-hotspot[data-hotspot-id] overlay.
    const overlay = container.querySelector("[data-hotspot-id='hs-slot']");
    expect(overlay).toBeTruthy();
    expect(overlay?.querySelector(".tooltip")).toBeTruthy();
  });

  it("renders slot content inside the hotspot overlay", async () => {
    const { container } = renderScene(
      { id: "hs-slot2", at: [0, 1, 0] },
      () => h("span", { class: "tooltip-inner" }, "world"),
    );
    await nextTick();
    const tooltip = container.querySelector(".tooltip-inner");
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toBe("world");
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

/**
 * Mirrors React's own "moving the anchor" case (`packages/react/.../
 * GlyphHotspot.test.tsx`). `GlyphHotspotHandle.setAt` exists so a moving
 * anchor does not destroy the overlay element — its doc: remove-and-re-add
 * "destroys and re-creates the element, losing whatever the consumer wrote on
 * it and restarting any CSS transition on it" — and the slot content is
 * teleported into that element, so re-creating it tears the teleport down and
 * builds it again.
 */
describe("GlyphHotspot (Vue) — moving the anchor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps the overlay element and its slot content across an `at` change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = { at: [0, 0, 0] as [number, number, number] };
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () => h(GlyphScene, {}, {
              default: () => h(GlyphHotspot, { id: "hs-move", at: state.at }, {
                default: () => h("span", { class: "tooltip" }, "hi"),
              }),
            }),
          });
      },
    });
    const vm = app.mount(container) as unknown as { $forceUpdate: () => void };
    await nextTick();

    const overlay = container.querySelector("[data-hotspot-id='hs-move']");
    const child = container.querySelector(".tooltip");
    expect(overlay).toBeTruthy();
    expect(child).toBeTruthy();

    state.at = [0, 5, 0];
    vm.$forceUpdate();
    await nextTick();
    await nextTick();

    // The SAME nodes, not equal-looking replacements.
    expect(container.querySelector("[data-hotspot-id='hs-move']")).toBe(overlay);
    expect(container.querySelector(".tooltip")).toBe(child);
    expect(container.querySelectorAll("[data-hotspot-id='hs-move']").length).toBe(1);
    app.unmount();
  });

  it("still re-registers when the id changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const state = { id: "first" };
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () => h(GlyphScene, {}, {
              default: () => h(GlyphHotspot, { id: state.id, at: [0, 0, 0] as [number, number, number] }, {
                default: () => h("span", { class: "tooltip" }, "hi"),
              }),
            }),
          });
      },
    });
    const vm = app.mount(container) as unknown as { $forceUpdate: () => void };
    await nextTick();
    expect(container.querySelector("[data-hotspot-id='first']")).toBeTruthy();

    state.id = "second";
    vm.$forceUpdate();
    await nextTick();
    await nextTick();
    expect(container.querySelector("[data-hotspot-id='first']")).toBeFalsy();
    expect(container.querySelector("[data-hotspot-id='second']")).toBeTruthy();
    app.unmount();
  });
});
