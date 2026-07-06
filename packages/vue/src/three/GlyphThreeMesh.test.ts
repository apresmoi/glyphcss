import { describe, expect, afterEach, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import { GlyphScene } from "../glyphcss/scene/GlyphScene";
import { GlyphThreeMesh } from "./GlyphThreeMesh";
import { GlyphThreePerspectiveCamera } from "./GlyphThreePerspectiveCamera";

describe("GlyphThreeMesh (Vue)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a Three-authored mesh inside a glyph scene", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphThreePerspectiveCamera, {
            fov: 45,
            aspect: 1,
            position: [4, 3, 6],
            lookAt: [0, 0.5, 0],
          }, {
            default: () =>
              h(GlyphScene, {}, {
                default: () =>
                  h(GlyphThreeMesh, {
                    id: "three-cube",
                    geometry: "cube",
                    position: [0, 0.5, 0],
                    rotation: [0, Math.PI / 4, 0],
                  }),
              }),
          });
      },
    });

    app.mount(container);
    await nextTick();

    expect(container.querySelector("[data-glyph-mesh-id='three-cube']")).toBeTruthy();
  });
});
