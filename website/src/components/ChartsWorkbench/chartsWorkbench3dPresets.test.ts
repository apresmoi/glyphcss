// Packet C6 — every 3D preset actually mounts (a real `glyphChartObject` in
// a real `createGlyphScene`, the same primitive `Charts3dViewport.tsx`
// mounts, mirroring `charts3dEffectTargeting.test.ts`'s own headless
// mount pattern) and renders a non-empty static thumbnail
// (`renderCharts3dStatic`, the same call the preset tray's own thumbnail
// memo uses). Each test names the mutation that would turn it red.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function(child) {
    try { return removeChild.call(this, child); }
    catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild")) throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "DOMException", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { describe, expect, it, vi } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera, glyphChartObject } from "@glyphcss/charts/3d";
import { createCharts3dViewState, resolveCharts3dView } from "./chartsWorkbench3d";
import { renderCharts3dStatic } from "./chartsWorkbench3dRender";
import { CHARTS_3D_DATASETS } from "./datasets/chart3d";

const COLS = 60, ROWS = 24, CELL_ASPECT = 2.0;

describe("every 3D preset mounts a real live scene with non-empty painted output", () => {
  it.each(CHARTS_3D_DATASETS)("$id ($markType)", (dataset) => {
    const resolved = resolveCharts3dView(createCharts3dViewState(dataset.id));
    expect(resolved.ok, dataset.id).toBe(true);
    if (!resolved.ok) return;
    const object = glyphChartObject(resolved.resolved.mark);
    const fit = glyphChart3dFitCamera({
      bounds: object.bounds, rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY,
      cols: COLS, rows: ROWS, sceneCellAspect: CELL_ASPECT,
    });
    const camera = createGlyphOrthographicCamera({ rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY, zoom: fit.zoom });
    camera.target = fit.target;
    const host = document.createElement("div");
    const scene = createGlyphScene(host, { cols: COLS, rows: ROWS, cellAspect: CELL_ASPECT, mode: "solid", useColors: true, doubleSided: true, camera });
    scene.addObject(object);
    scene.rerender();
    const text = scene.output.textContent ?? "";
    scene.destroy();
    // Mutation check: a scene that painted nothing (an empty/all-blank
    // grid — a bad camera fit, an empty mesh) would leave `text` all
    // spaces/newlines; a real render always paints SOME non-blank glyph.
    expect(text.replace(/[\s\n]/g, "").length, `${dataset.id} painted nothing`).toBeGreaterThan(0);
  });
});

describe("every 3D preset renders a non-empty static thumbnail (the tray's own render call)", () => {
  it.each(CHARTS_3D_DATASETS)("$id ($markType)", (dataset) => {
    const out = renderCharts3dStatic({
      view: createCharts3dViewState(dataset.id), target: "web", charset: "ascii", color: "css", width: 24, height: 8,
    });
    expect(out.ok, dataset.id).toBe(true);
    if (!out.ok) return;
    expect(out.text.replace(/[\s\n]/g, "").length, `${dataset.id} thumbnail is blank`).toBeGreaterThan(0);
  });
});
