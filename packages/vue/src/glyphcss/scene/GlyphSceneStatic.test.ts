import { describe, it, expect, afterEach } from "vitest";
import { createApp, h } from "vue";
import { GlyphSceneStatic } from "./GlyphSceneStatic";
import { cubePolygons } from "@glyphcss/core";

function mount(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({ setup() { return () => h(GlyphSceneStatic, props); } });
  app.mount(container);
  return container;
}

describe("GlyphSceneStatic (Vue)", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("renders a .glyph-output <pre> with compiled content, no runtime", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = mount({ polygons: polys, cols: 40, rows: 16, autoCenter: true, rotX: 60, rotY: 45, zoom: 0.6 });
    const pre = el.querySelector("pre.glyph-output");
    expect(pre).not.toBeNull();
    expect((pre?.innerHTML ?? "").length).toBeGreaterThan(0);
    expect(pre?.innerHTML).toContain("<span");
  });

  it("respects useColors=false (plain text, no spans)", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = mount({ polygons: polys, cols: 30, rows: 12, autoCenter: true, useColors: false });
    const pre = el.querySelector("pre.glyph-output");
    expect(pre?.innerHTML).not.toContain("<span");
  });
});
