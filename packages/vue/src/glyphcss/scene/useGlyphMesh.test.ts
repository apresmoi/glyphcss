import { describe, it, expect, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { Polygon } from "@glyphcss/core";
import { GlyphScene } from "./GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { useGlyphMesh } from "./useGlyphMesh";

const TRI: Polygon[] = [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" }];

describe("useGlyphMesh (Vue) — mirrors the React hook", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("registers polygons with the parent scene and disposes on unmount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let captured: ReturnType<typeof useGlyphMesh> | null = null;

    const Child = {
      setup() {
        captured = useGlyphMesh(TRI);
        return () => null;
      },
    };
    const app = createApp({
      setup: () => () => h(GlyphPerspectiveCamera, {}, {
        default: () => h(GlyphScene, {}, { default: () => h(Child) }),
      }),
    });
    app.mount(container);
    await nextTick();

    expect(captured).not.toBeNull();
    expect(captured!.meshRef.value).not.toBeNull();
    expect(captured!.loading.value).toBe(false);

    app.unmount();
    expect(captured!.meshRef.value).toBeNull();
  });
});
