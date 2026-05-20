import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphCamera } from "./GlyphCamera";

function renderScene(
  cameraProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphCamera, cameraProps, {
          default: () => h(GlyphScene, {}),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphCamera (Vue alias for Orthographic) — wraps scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting GlyphCamera", async () => {
    const { container } = renderScene({ zoom: 0.5 });
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("accepts zoom prop", () => {
    expect(() => renderScene({ zoom: 0.8 })).not.toThrow();
  });

  it("accepts rotX/rotY props", () => {
    expect(() => renderScene({ rotX: 1, rotY: 0.5 })).not.toThrow();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ zoom: 0.4 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphCamera (Vue) — standalone (no scene child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing when used without a scene child", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphCamera, {});
      },
    });
    expect(() => app.mount(container)).not.toThrow();
    app.unmount();
  });
});
