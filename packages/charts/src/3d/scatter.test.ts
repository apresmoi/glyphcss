import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { glyphChartScatter3d } from "./scatter";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d } from "./render";

function points(n: number, seed = 1): { x: number; y: number; z: number; g: string; c: number }[] {
  const out = [];
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    out.push({ x: rand() * 10, y: rand() * 10, z: rand() * 10, g: i % 3 === 0 ? "a" : i % 3 === 1 ? "b" : "c", c: rand() * 100 });
  }
  return out;
}

describe("glyphChartScatter3d — validation", () => {
  it("rejects empty data (scatter-empty)", () => {
    expect(() => glyphChartScatter3d([])).toThrowError(/scatter-empty/);
  });
  it("rejects a non-finite channel (non-finite-data)", () => {
    expect(() => glyphChartScatter3d([{ x: 1, y: 2, z: Number.NaN }])).toThrowError(/non-finite-data/);
  });
  it("rejects series AND color together (scatter-bad-channel)", () => {
    expect(() => glyphChartScatter3d(
      [{ x: 1, y: 2, z: 3, s: "a", c: 1 }],
      { series: "s", color: "c" },
    )).toThrowError(/scatter-bad-channel/);
  });
});

describe("glyphChartScatter3d — model", () => {
  it("assigns distinct series colours in first-seen order", () => {
    const mark = glyphChartScatter3d(points(9), { series: "g" });
    expect(mark.series.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(new Set(mark.series.map((s) => s.color)).size).toBe(3);
  });

  it("a numeric color channel produces a colour legend banded over its own domain", () => {
    const mark = glyphChartScatter3d(points(20), { color: "c" });
    expect(mark.colorLegend).not.toBeNull();
    expect(mark.series).toHaveLength(0);
    for (const p of mark.points) expect(p.colorValue).toBeTypeOf("number");
  });

  it("color: 'none' drops the legend even with a numeric color channel", () => {
    const mark = glyphChartScatter3d(points(10), { color: "c" }, { color: "none" });
    expect(mark.colorLegend).toBeNull();
  });

  it("MUTATION: a size channel produces DIFFERENT marker sizes across points — a flat channel would collapse them all to the same value", () => {
    const mark = glyphChartScatter3d(points(20), { size: "c" });
    const sizes = new Set(mark.points.map((p) => p.markerSize));
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe("glyphChartScatter3d — object/mesh", () => {
  it("builds ONE 'points' mesh (plus 'axis-lines' by default) with one marker's worth of polygons per point", () => {
    const mark = glyphChartScatter3d(points(5));
    const object = glyphChartObject(mark);
    const pointsMesh = object.meshes.find((m) => m.name === "points")!;
    // An octahedron is 8 faces — the default shape with no series.
    expect(pointsMesh.polygons.length).toBe(5 * 8);
  });

  it("MUTATION: monochrome cycles marker SHAPE by series — polygon counts per point differ across series (cube=6, octahedron=8, tetrahedron=4)", () => {
    const mark = glyphChartScatter3d([
      { x: 0, y: 0, z: 0, g: "a" }, { x: 1, y: 1, z: 1, g: "b" }, { x: 2, y: 2, z: 2, g: "c" },
    ], { series: "g" });
    const object = glyphChartObject(mark, { monochrome: true });
    const pointsMesh = object.meshes.find((m) => m.name === "points")!;
    // cube(6) + octahedron(8) + tetrahedron(4) = 18 faces total for 3 points, one per series.
    expect(pointsMesh.polygons.length).toBe(6 + 8 + 4);
  });
});

describe("glyphChartScatter3d — render", () => {
  it("braille render contains real braille glyphs (geometry, not a downgrade)", () => {
    const mark = glyphChartScatter3d(points(12), { series: "g" });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(/[⠀-⣿]/.test(result.text)).toBe(true);
  });

  it("a numeric color channel reserves a colorbar column", () => {
    const mark = glyphChartScatter3d(points(12), { color: "c" });
    const withLegend = renderGlyphChart3d(mark, { target: "web", charset: "ascii", color: "css", width: 96, height: 32 });
    const noLegendMark = glyphChartScatter3d(points(12), { color: "c" }, { color: "none" });
    const withoutLegend = renderGlyphChart3d(noLegendMark, { target: "web", charset: "ascii", color: "css", width: 96, height: 32 });
    // The colorbar's own swatch column paints solid full-ink glyphs the
    // uncoloured render never has any reason to produce at all.
    expect(withLegend.text).not.toBe(withoutLegend.text);
  });

  it("static == live: renderGlyphChart3d's own frame is byte-identical to mounting the SAME object in a live createGlyphScene at the resolved camera", async () => {
    const mark = glyphChartScatter3d(points(15), { series: "g" });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "box", width: 80, height: 30 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({
      rotX: result.resolved.camera.rotX, rotY: result.resolved.camera.rotY,
      zoom: result.resolved.camera.zoom, center: [...result.resolved.camera.center] as [number, number],
    });
    const object = glyphChartObject(mark, { charset: "box" });
    camera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const scene = createGlyphScene(host, { cols: 80, rows: 30, cellAspect: 1 / result.resolved.cellAspect, useColors: false, camera });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const live = (scene.output.textContent ?? "").split("\n").map((l) => l.padEnd(80)).join("\n");
    scene.destroy();
    const staticText = result.text.split("\n").map((l) => l.padEnd(80)).join("\n");
    expect(live).toBe(staticText);
  });
});
