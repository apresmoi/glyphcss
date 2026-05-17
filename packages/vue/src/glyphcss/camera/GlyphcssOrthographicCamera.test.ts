import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssOrthographicCamera } from "./GlyphcssOrthographicCamera";

type OrthoProps = {
  rotX?: number;
  rotY?: number;
  zoom?: number;
  center?: [number, number];
};

function renderScene(
  cameraProps: OrthoProps = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, {
          default: () => h(GlyphcssOrthographicCamera, cameraProps),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("GlyphcssOrthographicCamera (Vue) — mount inside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts without throwing", () => {
    expect(() => renderScene()).not.toThrow();
  });

  it("scene host is present after mounting orthographic camera", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyphcss-host")).toBeTruthy();
  });

  it("scene output <pre> is present after mounting orthographic camera", async () => {
    const { container } = renderScene();
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("accepts zoom prop without throwing", () => {
    expect(() => renderScene({ zoom: 0.6 })).not.toThrow();
  });

  it("accepts rotX and rotY props without throwing", () => {
    expect(() => renderScene({ rotX: 0.3, rotY: 0.8 })).not.toThrow();
  });

  it("accepts center prop without throwing", () => {
    expect(() => renderScene({ center: [0.4, 0.6] })).not.toThrow();
  });

  it("reacts to zoom prop change", async () => {
    const zoom = ref(0.4);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphcssScene, {}, {
            default: () => h(GlyphcssOrthographicCamera, { zoom: zoom.value }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();

    zoom.value = 0.8;
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const { container, app } = renderScene({ zoom: 0.5 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("GlyphcssOrthographicCamera (Vue) — outside scene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when mounted outside GlyphcssScene", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () => h(GlyphcssOrthographicCamera, {});
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
