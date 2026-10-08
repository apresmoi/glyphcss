import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { glyphChartParametric3d, glyphChart3dSphereGrid, glyphChart3dTorusGrid } from "./parametric";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d } from "./render";

describe("glyphChartParametric3d — validation", () => {
  it("rejects a grid smaller than 2x2 with no wrap (parametric-too-small)", () => {
    expect(() => glyphChartParametric3d({ x: [[0]], y: [[0]], z: [[0]] })).toThrowError(/parametric-too-small/);
  });
  it("rejects mismatched grid shapes (parametric-ragged)", () => {
    expect(() => glyphChartParametric3d({
      x: [[0, 1], [0, 1]], y: [[0, 0]], z: [[0, 0], [1, 1]],
    })).toThrowError(/parametric-ragged/);
  });
  it("rejects a non-finite grid value (non-finite-data)", () => {
    expect(() => glyphChartParametric3d({
      x: [[0, 1], [0, 1]], y: [[0, 0], [1, 1]], z: [[0, Number.NaN], [0, 0]],
    })).toThrowError(/non-finite-data/);
  });
});

describe("glyphChart3dSphereGrid — geometric correctness", () => {
  it("every sampled point sits at exactly the requested radius", () => {
    const radius = 2.5;
    const { x, y, z } = glyphChart3dSphereGrid(radius, 12, 16);
    for (let r = 0; r < x.length; r++) {
      for (let c = 0; c < x[r]!.length; c++) {
        const d = Math.hypot(x[r]![c]!, y[r]![c]!, z[r]![c]!);
        expect(d).toBeCloseTo(radius, 6);
      }
    }
  });
});

describe("glyphChart3dTorusGrid — geometric correctness", () => {
  it("every sampled point's distance to the major-radius ring equals the minor radius (a torus's own defining property)", () => {
    const majorRadius = 1.4, minorRadius = 0.5;
    const { x, y, z } = glyphChart3dTorusGrid(majorRadius, minorRadius, 10, 14);
    for (let r = 0; r < x.length; r++) {
      for (let c = 0; c < x[r]!.length; c++) {
        const ringDist = Math.hypot(x[r]![c]!, y[r]![c]!) - majorRadius;
        const d = Math.hypot(ringDist, z[r]![c]!);
        expect(d).toBeCloseTo(minorRadius, 6);
      }
    }
  });
});

describe("glyphChartParametric3d — model and mesh", () => {
  it("a `value` grid drives the colour legend instead of z", () => {
    const { x, y, z } = glyphChart3dSphereGrid(1, 8, 8);
    const value = z.map((row) => row.map((v) => v * 100)); // a distinguishable, differently-scaled field
    const mark = glyphChartParametric3d({ x, y, z, value }, { wrapU: true });
    expect(mark.colorLegend).not.toBeNull();
    expect(mark.colorLegend!.domain[1]).toBeCloseTo(100, 4);
  });

  it("MUTATION: wrapU closes the mesh into a full ring — the quad count matches `rows-1` (no row wrap) x `cols` (wrapped) rather than `cols-1` (unwrapped)", () => {
    const { x, y, z } = glyphChart3dSphereGrid(1, 6, 8);
    const mark = glyphChartParametric3d({ x, y, z }, { wrapU: true });
    const object = glyphChartObject(mark);
    const surfaceMesh = object.meshes.find((m) => m.name === "surface")!;
    // Each quad -> 2 triangles -> 2 polygons. rowSteps = rows-1 = 5 (no
    // wrapV), colSteps = cols = 8 (wrapU) -> 40 quads -> 80 polygons.
    expect(surfaceMesh.polygons.length).toBe(2 * 5 * 8);
  });

  it("no wrap leaves an OPEN mesh — quad count is (rows-1) x (cols-1)", () => {
    const { x, y, z } = glyphChart3dSphereGrid(1, 6, 8);
    const mark = glyphChartParametric3d({ x, y, z });
    const object = glyphChartObject(mark);
    const surfaceMesh = object.meshes.find((m) => m.name === "surface")!;
    expect(surfaceMesh.polygons.length).toBe(2 * 5 * 7);
  });
});

describe("glyphChartParametric3d — render", () => {
  it("a sphere's braille render contains real braille dot glyphs", () => {
    const { x, y, z } = glyphChart3dSphereGrid(1, 16, 24);
    const mark = glyphChartParametric3d({ x, y, z }, { wrapU: true, axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(/[⠀-⣿]/.test(result.text)).toBe(true);
  });

  it("static == live: byte-identical to a live scene mount at the resolved camera", async () => {
    const { x, y, z } = glyphChart3dTorusGrid();
    // `color: "none"` — no colour legend, so the static exit reserves no
    // colorbar column and `plotCols === width`, matching the live scene's
    // own full-width mount exactly (the two are only byte-identical over the
    // SAME plot area; a colorbar's own chrome is static-exit-only).
    const mark = glyphChartParametric3d({ x, y, z }, { wrapU: true, wrapV: true, color: "none" });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "box", color: "none", width: 80, height: 30 });
    const object = glyphChartObject(mark, { charset: "box" });
    const camera = createGlyphOrthographicCamera({
      rotX: result.resolved.camera.rotX, rotY: result.resolved.camera.rotY,
      zoom: result.resolved.camera.zoom, center: [...result.resolved.camera.center] as [number, number],
    });
    camera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, { cols: 80, rows: 30, cellAspect: 1 / result.resolved.cellAspect, useColors: false, camera });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const live = (scene.output.textContent ?? "").split("\n").map((l) => l.padEnd(80)).join("\n");
    scene.destroy();
    expect(live).toBe(result.text.split("\n").map((l) => l.padEnd(80)).join("\n"));
  });
});
