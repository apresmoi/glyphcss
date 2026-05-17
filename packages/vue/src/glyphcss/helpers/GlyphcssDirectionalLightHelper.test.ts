import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssDirectionalLightHelper } from "./GlyphcssDirectionalLightHelper";
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
        h(GlyphcssScene, {}, {
          default: () => h(GlyphcssDirectionalLightHelper, helperProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssDirectionalLightHelper (Vue) — mount inside scene", () => {
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
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting light helper", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
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
          h(GlyphcssScene, {}, {
            default: () =>
              h(GlyphcssDirectionalLightHelper, { position: position.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();

    position.value = [2, 2, 2];
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ position: [1, 1, 1] });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssDirectionalLightHelper (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssDirectionalLightHelper, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
