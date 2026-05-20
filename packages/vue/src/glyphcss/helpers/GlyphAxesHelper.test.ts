import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphAxesHelper } from "./GlyphAxesHelper";

function renderScene(
  helperProps: { size?: number } = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphScene, {}, {
          default: () => h(GlyphAxesHelper, helperProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphAxesHelper (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting axes helper", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting axes helper", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts size=2 without throwing", () => {
    expect(() => renderScene({ size: 2 })).not.toThrow();
  });

  it("accepts size=0.5 without throwing", () => {
    expect(() => renderScene({ size: 0.5 })).not.toThrow();
  });

  it("uses default size=1 without throwing", () => {
    expect(() => renderScene({})).not.toThrow();
  });

  it("reacts to size prop change", async () => {
    const size = ref(1);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, {
            default: () => h(GlyphAxesHelper, { size: size.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();

    size.value = 3;
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ size: 1 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });

  it("can be mounted and remounted without leaks", async () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const a1 = createApp({
      setup() {
        return () => h(GlyphScene, {}, { default: () => h(GlyphAxesHelper, {}) });
      },
    });
    a1.mount(c1);
    await nextTick();
    a1.unmount();
    expect(c1.querySelector(".glyph-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const a2 = createApp({
      setup() {
        return () => h(GlyphScene, {}, { default: () => h(GlyphAxesHelper, { size: 2 }) });
      },
    });
    a2.mount(c2);
    await nextTick();
    expect(c2.querySelector(".glyph-host")).toBeTruthy();
    a2.unmount();
  });
});

describe("GlyphAxesHelper (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphAxesHelper, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
