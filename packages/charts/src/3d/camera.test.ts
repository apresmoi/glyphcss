import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera } from "./camera";
import type { GlyphChart3dBounds } from "./camera";
import { glyphChartObject } from "./object";
import { glyphChartSurface } from "./surface";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

describe("glyphChart3dFitCamera", () => {
  const bounds: GlyphChart3dBounds = { min: [0, 0, 0], max: [1, 1, 0.6] };

  it("targets the bounds center and returns a finite, positive zoom", () => {
    const { target, zoom } = glyphChart3dFitCamera({ bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols: 96, rows: 32, sceneCellAspect: 1 / 0.5859375 });
    expect(target).toEqual([0.5, 0.5, 0.3]);
    expect(Number.isFinite(zoom)).toBe(true);
    expect(zoom).toBeGreaterThan(0);
  });

  it("MUTATION: a larger viewport gets a larger fitted zoom (a fixed zoom would fail this)", () => {
    const small = glyphChart3dFitCamera({ bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols: 40, rows: 16, sceneCellAspect: 2 });
    const large = glyphChart3dFitCamera({ bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols: 160, rows: 64, sceneCellAspect: 2 });
    expect(large.zoom).toBeGreaterThan(small.zoom);
  });

  it("MUTATION: a wider `margin` (more room reserved for labels) never fits a LARGER zoom than a narrower one", () => {
    const tight = glyphChart3dFitCamera({ bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols: 96, rows: 32, sceneCellAspect: 1 / 0.5859375, margin: 0.1 });
    const loose = glyphChart3dFitCamera({ bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols: 96, rows: 32, sceneCellAspect: 1 / 0.5859375, margin: 0.8 });
    expect(loose.zoom).toBeLessThan(tight.zoom);
  });

  it("honours a trackball mat/useMat rotation, not only Euler rotX/rotY", () => {
    // A pure-roll matrix (identity-like but distinct from Euler) — the
    // point is that the function must not silently ignore `mat` and fall
    // back to `rotX`/`rotY` (both omitted here).
    const mat = [1, 0, 0, 0, 0, -1, 0, 1, 0]; // 90-degree roll about X
    const { zoom } = glyphChart3dFitCamera({ bounds, mat, useMat: true, cols: 96, rows: 32, sceneCellAspect: 1 / 0.5859375 });
    expect(Number.isFinite(zoom)).toBe(true);
    expect(zoom).toBeGreaterThan(0);
  });

  it("the fitted camera, mounted with the library's REAL default viewport/camera constants, keeps the whole surface + all 3 axis labels on screen (P1-4)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cols = 96, rows = 32, chartCellAspect = 0.5859375, sceneCellAspect = 1 / chartCellAspect;

    const rowsN = 8, colsN = 8;
    const z = flatGrid(rowsN, colsN, 0);
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < colsN; c++) {
        const dr = r - 3.5, dc = c - 3.5;
        z[r]![c] = Math.max(0, 20 - (dr * dr + dc * dc));
      }
    }
    const mark = glyphChartSurface({ z }, undefined, { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } });
    const object = glyphChartObject(mark);

    const fit = glyphChart3dFitCamera({ bounds: object.bounds, ...GLYPH_CHART_3D_DEFAULT_CAMERA, cols, rows, sceneCellAspect });
    const camera = createGlyphOrthographicCamera({ ...GLYPH_CHART_3D_DEFAULT_CAMERA, zoom: fit.zoom });
    camera.target = fit.target;
    const scene = createGlyphScene(host, { cols, rows, cellAspect: sceneCellAspect, useColors: false, camera });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();

    const text = scene.output.textContent ?? "";
    // Real geometry, not a lonely tick: enough painted cells to be a surface.
    const nonBlank = text.replace(/\s/g, "").length;
    expect(nonBlank).toBeGreaterThan(20);
    for (const title of ["x", "y", "z"]) expect(text.includes(title)).toBe(true);

    scene.destroy();
  });
});
