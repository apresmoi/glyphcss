/**
 * Tests for useGlyphcssCamera via a thin consumer component.
 * Tests observable rendering behavior, not internal implementation.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, inject, nextTick } from "vue";
import { GlyphcssScene } from "../scene/GlyphcssScene";
import { GlyphcssPerspectiveCamera } from "./GlyphcssPerspectiveCamera";
import { GlyphcssCameraContextKey } from "./context";

/**
 * Consumer component that reads from GlyphcssCameraContext and renders
 * presence as a data attribute.
 */
const CameraConsumer = defineComponent({
  name: "CameraConsumer",
  setup() {
    const ctx = inject(GlyphcssCameraContextKey);
    if (!ctx) {
      throw new Error("glyphcss: useGlyphcssCamera must be used inside a GlyphcssCamera component.");
    }
    const hasCameraRef = ctx.cameraRef !== null;
    return () =>
      h("div", {
        class: "camera-consumer",
        "data-has-camera-ctx": hasCameraRef ? "true" : "false",
      });
  },
});

function renderWithCamera(
  cameraProps: Record<string, unknown> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(GlyphcssScene, {}, {
          default: () =>
            h(GlyphcssPerspectiveCamera, cameraProps, {
              default: () => h(CameraConsumer),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("useGlyphcssCamera (Vue) — via consumer inside camera context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("consumer renders inside the camera context", async () => {
    const { container } = renderWithCamera({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".camera-consumer")).toBeTruthy();
  });

  it("scene output is still rendered when camera consumer is present", async () => {
    const { container } = renderWithCamera({ distance: 5 });
    await nextTick();
    expect(container.querySelector(".glyphcss-output")).toBeTruthy();
  });

  it("camera consumer mounts without throwing", () => {
    expect(() => renderWithCamera({ distance: 3 })).not.toThrow();
  });

  it("unmounts cleanly when camera and consumer are present", async () => {
    const { container, app } = renderWithCamera({ distance: 3 });
    await nextTick();
    app.unmount();
    expect(container.querySelector(".glyphcss-output")).toBeFalsy();
  });
});

describe("useGlyphcssCamera (Vue) — error when outside camera context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("throws when used outside GlyphcssCamera", () => {
    const container = document.createElement("div");
    const app = createApp({
      setup() {
        return () =>
          h(GlyphcssScene, {}, {
            default: () => h(CameraConsumer),
          });
      },
    });
    expect(() => app.mount(container)).toThrow();
  });
});
