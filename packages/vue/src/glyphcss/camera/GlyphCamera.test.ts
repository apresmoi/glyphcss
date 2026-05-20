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
        h(GlyphScene, {}, {
          default: () => h(GlyphCamera, cameraProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphCamera (Vue alias for Perspective) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting GlyphCamera", async () => {
    const { container } = renderScene({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("accepts distance prop", () => {
    expect(() => renderScene({ distance: 8 })).not.toThrow();
  });

  it("accepts rotX/rotY props", () => {
    expect(() => renderScene({ rotX: 1, rotY: 0.5 })).not.toThrow();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ distance: 4 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphCamera (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphCamera, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
