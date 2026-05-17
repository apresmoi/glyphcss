import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssCamera } from "./GlyphcssCamera";

function renderScene(
  cameraProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, {
          default: () => h(GlyphcssCamera, cameraProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssCamera (Vue alias for Perspective) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting GlyphcssCamera", async () => {
    const { container } = renderScene({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
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
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssCamera (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssCamera, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
