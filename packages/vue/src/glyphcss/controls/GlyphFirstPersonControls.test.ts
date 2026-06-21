import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphFirstPersonControls } from "./GlyphFirstPersonControls";

type FPControlsProps = {
  lookEnabled?: boolean;
  moveEnabled?: boolean;
  moveSpeed?: number;
  lookSensitivity?: number;
  invertY?: boolean;
};

function renderScene(
  controlsProps: FPControlsProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphPerspectiveCamera, {}, {
          default: () =>
            h(GlyphScene, {}, {
              default: () => h(GlyphFirstPersonControls, controlsProps),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphFirstPersonControls (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting first-person controls", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("accepts lookEnabled=false without throwing", () => {
    expect(() => renderScene({ lookEnabled: false })).not.toThrow();
  });

  it("accepts moveEnabled=false without throwing", () => {
    expect(() => renderScene({ moveEnabled: false })).not.toThrow();
  });

  it("accepts custom moveSpeed and lookSensitivity", () => {
    expect(() => renderScene({ moveSpeed: 0.1, lookSensitivity: 0.01 })).not.toThrow();
  });

  it("accepts invertY=true", () => {
    expect(() => renderScene({ invertY: true })).not.toThrow();
  });

  it("reacts to lookEnabled prop change", async () => {
    const drag = ref(true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphPerspectiveCamera, {}, {
            default: () =>
              h(GlyphScene, {}, {
                default: () => h(GlyphFirstPersonControls, { lookEnabled: drag.value }),
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyph-scene")).toBeTruthy();

    drag.value = false;
    await nextTick();
    expect(container.querySelector(".glyph-scene")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene();
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphFirstPersonControls (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphFirstPersonControls, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
