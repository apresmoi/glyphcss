import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphDirectionalLightHelper } from "./GlyphDirectionalLightHelper";
import type { Vec3 } from "@glyphcss/core";

type LightHelperProps = {
  position?: Vec3;
  color?: string;
  size?: number;
};

function renderScene(
  helperProps: LightHelperProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphScene, {}, {
          default: () => h(GlyphDirectionalLightHelper, helperProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphDirectionalLightHelper (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting light helper", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting light helper", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts custom position", () => {
    expect(() => renderScene({ position: [2, 3, 4] })).not.toThrow();
  });

  it("accepts custom color", () => {
    expect(() => renderScene({ color: "#ff0000" })).not.toThrow();
  });

  it("accepts custom size", () => {
    expect(() => renderScene({ size: 0.5 })).not.toThrow();
  });

  it("accepts all custom props combined", () => {
    expect(() =>
      renderScene({ position: [5, 5, 5], color: "#00ff00", size: 0.2 }),
    ).not.toThrow();
  });

  it("reacts to position prop change", async () => {
    const position = ref<Vec3>([1, 1, 1]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, {
            default: () =>
              h(GlyphDirectionalLightHelper, { position: position.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();

    position.value = [2, 2, 2];
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ position: [1, 1, 1] });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphDirectionalLightHelper (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphDirectionalLightHelper, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
