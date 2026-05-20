import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "./GlyphPerspectiveCamera";

type CameraProps = {
  rotX?: number;
  rotY?: number;
  distance?: number;
  zoom?: number;
  stretch?: number;
  center?: [number, number];
};

function renderScene(
  cameraProps: CameraProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphScene, {}, {
          default: () => h(GlyphPerspectiveCamera, cameraProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphPerspectiveCamera (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting camera", async () => {
    const { container } = renderScene({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".glyph-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting camera", async () => {
    const { container } = renderScene({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
  });

  it("accepts distance prop without throwing", () => {
    expect(() => renderScene({ distance: 10 })).not.toThrow();
  });

  it("accepts rotX and rotY props without throwing", () => {
    expect(() => renderScene({ rotX: 0.5, rotY: 1.2 })).not.toThrow();
  });

  it("accepts zoom prop without throwing", () => {
    expect(() => renderScene({ zoom: 0.6 })).not.toThrow();
  });

  it("accepts stretch prop without throwing", () => {
    expect(() => renderScene({ stretch: 1.5 })).not.toThrow();
  });

  it("accepts center prop without throwing", () => {
    expect(() => renderScene({ center: [0.3, 0.7] })).not.toThrow();
  });

  it("reacts to distance prop change", async () => {
    const distance = ref(3);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, {
            default: () => h(GlyphPerspectiveCamera, { distance: distance.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();

    distance.value = 7;
    await nextTick();
    expect(container.querySelector(".glyph-output")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ distance: 3 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyph-output")).toBeFalsy();
  });
});

describe("GlyphPerspectiveCamera (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphPerspectiveCamera, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
