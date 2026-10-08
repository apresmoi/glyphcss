import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { glyphChartLine3d, glyphChart3dLorenzAttractor } from "./line3d";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d } from "./render";

describe("glyphChartLine3d — validation", () => {
  it("rejects empty data (line3d-empty)", () => {
    expect(() => glyphChartLine3d([])).toThrowError(/line3d-empty/);
  });
  it("rejects a series with fewer than 2 points (line3d-too-short)", () => {
    expect(() => glyphChartLine3d([{ points: [[0, 0, 0]] }])).toThrowError(/line3d-too-short/);
  });
  it("rejects a non-finite point (non-finite-data)", () => {
    expect(() => glyphChartLine3d([[0, 0, 0], [1, Number.NaN, 1]])).toThrowError(/non-finite-data/);
  });
});

describe("glyphChartLine3d — model and mesh", () => {
  it("a bare point array becomes one unnamed series", () => {
    const mark = glyphChartLine3d([[0, 0, 0], [1, 1, 1], [2, 2, 2]]);
    expect(mark.series).toHaveLength(1);
    expect(mark.series[0]!.points).toHaveLength(3);
  });

  it("named series keep their own colour and point ordering", () => {
    const mark = glyphChartLine3d([
      { name: "A", color: "#ff0000", points: [[0, 0, 0], [1, 0, 0]] },
      { name: "B", points: [[0, 1, 0], [0, 2, 0], [0, 3, 0]] },
    ]);
    expect(mark.series.map((s) => s.name)).toEqual(["A", "B"]);
    expect(mark.series[0]!.color).toBe("#ff0000");
    expect(mark.series[1]!.points).toHaveLength(3);
  });

  it("MUTATION: the ribbon mesh has (points - 1) segments x 6 faces PER series — a flat/degenerate segment count would collapse this", () => {
    const mark = glyphChartLine3d([{ points: [[0, 0, 0], [1, 0, 0], [2, 1, 0], [3, 1, 1]] }]);
    const object = glyphChartObject(mark);
    const lineMesh = object.meshes.find((m) => m.name === "line")!;
    expect(lineMesh.polygons.length).toBe(3 * 6);
  });
});

describe("glyphChart3dLorenzAttractor — the computed example", () => {
  it("produces a bounded, non-degenerate trajectory (never collapses to the origin or diverges to infinity)", () => {
    const points = glyphChart3dLorenzAttractor(2000, 0.008);
    expect(points.length).toBe(2001);
    for (const p of points) {
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
    const xs = points.map((p) => p[0]);
    // The classic attractor spans roughly [-20, 20] on x — a collapsed or
    // exploded integration would fail this by orders of magnitude either way.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(200);
  });

  it("renders as a real 3D line chart with braille ink", () => {
    const mark = glyphChartLine3d([{ name: "Lorenz", points: glyphChart3dLorenzAttractor(3000, 0.008) }]);
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(/[⠀-⣿]/.test(result.text)).toBe(true);
  });
});

describe("glyphChartLine3d — render", () => {
  it("static == live: byte-identical to a live scene mount at the resolved camera", async () => {
    const mark = glyphChartLine3d([{ name: "helix", points: Array.from({ length: 60 }, (_, i) => [Math.cos(i * 0.3), Math.sin(i * 0.3), i * 0.05] as const) }]);
    const result = renderGlyphChart3d(mark, { target: "web", charset: "box", width: 80, height: 30 });
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
