import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssOrbitControls } from "./GlyphcssOrbitControls";

type OrbitProps = {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
};

function renderScene(
  controlsProps: OrbitProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, {
          default: () => h(GlyphcssOrbitControls, controlsProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssOrbitControls (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting controls", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("mounts with drag=false", () => {
    expect(() => renderScene({ drag: false })).not.toThrow();
  });

  it("mounts with wheel=false", () => {
    expect(() => renderScene({ wheel: false })).not.toThrow();
  });

  it("mounts with invert=true", () => {
    expect(() => renderScene({ invert: true })).not.toThrow();
  });

  it("mounts with animate config", () => {
    expect(() =>
      renderScene({ animate: { speed: 0.5, axis: "y", pauseOnInteraction: true } }),
    ).not.toThrow();
  });

  it("reacts to drag prop change", async () => {
    const drag = ref(true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphcssScene, {}, {
            default: () => h(GlyphcssOrbitControls, { drag: drag.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyphcss-scene")).toBeTruthy();

    drag.value = false;
    await nextTick();
    expect(container.querySelector(".glyphcss-scene")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene();
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });

  it("can be mounted and remounted without leaks", async () => {
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    const a1 = createApp({
      setup() {
        return () => h(GlyphcssScene, {}, { default: () => h(GlyphcssOrbitControls, {}) });
      },
    });
    a1.mount(c1);
    await nextTick();
    a1.unmount();
    expect(c1.querySelector(".glyphcss-output")).toBeFalsy();

    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const a2 = createApp({
      setup() {
        return () => h(GlyphcssScene, {}, { default: () => h(GlyphcssOrbitControls, {}) });
      },
    });
    a2.mount(c2);
    await nextTick();
    expect(c2.querySelector(".glyphcss-host")).toBeTruthy();
    a2.unmount();
  });
});

describe("GlyphcssOrbitControls (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssOrbitControls, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
