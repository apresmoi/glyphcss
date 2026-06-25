import { describe, it, expect } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { compileScene } from "./compileScene";
import { icosahedronPolygons, cubePolygons } from "@glyphcss/core";

/**
 * The static compiler must produce byte-identical output to the runtime render
 * for the same inputs — otherwise a compiled page wouldn't match hydration.
 */
function runtimeRender(polys: ReturnType<typeof icosahedronPolygons>, opts: {
  rotX: number; rotY: number; zoom: number; cols: number; rows: number; useColors: boolean;
}): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const camera = createGlyphPerspectiveCamera({ rotX: opts.rotX, rotY: opts.rotY, zoom: opts.zoom });
  const scene = createGlyphScene(host, {
    camera, cols: opts.cols, rows: opts.rows, useColors: opts.useColors,
  });
  scene.add(polys);
  scene.rerender(); // createGlyphScene paints async (rAF); force a synchronous render
  const out = opts.useColors ? scene.output.innerHTML : scene.output.textContent ?? "";
  scene.destroy();
  host.remove();
  return out;
}

describe("compileScene — matches the runtime render", () => {
  for (const useColors of [true, false]) {
    it(`icosahedron, useColors=${useColors}`, () => {
      const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
      const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors };
      const runtime = runtimeRender(polys, cfg);
      const compiled = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      });
      // For colored output the runtime sets innerHTML (raw spans); compileScene's
      // `inner` is the same raw string. For plain output the runtime sets
      // textContent (the browser un-escapes); compileScene escapes for inlining,
      // so compare against the runtime's textContent directly.
      const expected = useColors ? runtime : runtime;
      const got = useColors ? compiled.inner : compiled.inner
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      expect(got).toBe(expected);
    });
  }

  it("cube matches at a different camera", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true };
    const runtime = runtimeRender(polys, cfg);
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows,
    });
    expect(compiled.inner).toBe(runtime);
  });

  it("wraps output in a .glyph-output <pre>", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const r = compileScene({ polygons: polys, cols: 20, rows: 8 });
    expect(r.html.startsWith('<pre class="glyph-output">')).toBe(true);
    expect(r.html.endsWith("</pre>")).toBe(true);
    expect(r.cols).toBe(20);
  });
});
