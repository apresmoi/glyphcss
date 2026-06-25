import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphSceneStatic } from "./GlyphSceneStatic";
import { cubePolygons } from "@glyphcss/core";

const containers: HTMLElement[] = [];
function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("GlyphSceneStatic (React)", () => {
  it("renders a .glyph-output <pre> with compiled content, no runtime", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = render(
      <GlyphSceneStatic polygons={polys} cols={40} rows={16} autoCenter rotX={60} rotY={45} zoom={0.6} />,
    );
    const pre = el.querySelector("pre.glyph-output");
    expect(pre).not.toBeNull();
    expect((pre?.innerHTML ?? "").length).toBeGreaterThan(0);
    // colored output → spans
    expect(pre?.innerHTML).toContain("<span");
  });

  it("passes className/style through", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = render(<GlyphSceneStatic polygons={polys} cols={20} rows={8} className="hero" />);
    const pre = el.querySelector("pre.glyph-output");
    expect(pre?.className).toContain("hero");
  });
});
