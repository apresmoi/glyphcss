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
  mode?: "wireframe" | "solid"; charMode?: "ascii" | "braille" | "halfblock";
}): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const camera = createGlyphPerspectiveCamera({ rotX: opts.rotX, rotY: opts.rotY, zoom: opts.zoom });
  const scene = createGlyphScene(host, {
    camera, cols: opts.cols, rows: opts.rows, useColors: opts.useColors,
    mode: opts.mode, charMode: opts.charMode,
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

  it("braille wireframe, charMode set, matches the runtime render", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors: true } as const;
    const runtime = runtimeRender(polys, { ...cfg, mode: "wireframe", charMode: "braille" });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "wireframe", charMode: "braille",
    });
    expect(compiled.inner).toBe(runtime);
    // And it must actually differ from the ASCII wireframe render — otherwise
    // the option silently no-op'd instead of taking effect.
    const asciiCompiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "wireframe",
    });
    expect(compiled.inner).not.toBe(asciiCompiled.inner);
  });

  it("halfblock solid, charMode set, matches the runtime render", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true } as const;
    const runtime = runtimeRender(polys, { ...cfg, mode: "solid", charMode: "halfblock" });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid", charMode: "halfblock",
    });
    expect(compiled.inner).toBe(runtime);
  });

  it("omitting charMode is byte-identical to today (ascii default, unchanged)", () => {
    // Solid mode is deterministic (Lambert-shaded, no per-render random glyph
    // pick like wireframe's tier selection), so two separate compileScene
    // calls are directly comparable here.
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors: true } as const;
    const withoutOption = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
    });
    const explicitAscii = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      charMode: "ascii",
    });
    expect(withoutOption.inner).toBe(explicitAscii.inner);

    // And every pre-existing (no-charMode) call site is unaffected: the
    // original parity tests above already assert compileScene === runtime
    // render byte-for-byte with charMode entirely absent from both calls.
  });

  it("wraps output in a .glyph-output <pre>", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const r = compileScene({ polygons: polys, cols: 20, rows: 8 });
    expect(r.html.startsWith('<pre class="glyph-output">')).toBe(true);
    expect(r.html.endsWith("</pre>")).toBe(true);
    expect(r.cols).toBe(20);
  });
});
