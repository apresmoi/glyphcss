import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { glyphChartBars3d } from "./bars";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d } from "./render";

function table(): { x: number; y: number; v: number }[] {
  const rows: { x: number; y: number; v: number }[] = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) rows.push({ x, y, v: (x + 1) * (y + 1) });
  return rows;
}

describe("glyphChartBars3d — validation", () => {
  it("rejects empty data (bars-empty)", () => {
    expect(() => glyphChartBars3d([])).toThrowError(/bars-empty/);
  });
  it("rejects a non-finite channel (non-finite-data)", () => {
    expect(() => glyphChartBars3d([{ x: 0, y: 0, z: Number.NaN }])).toThrowError(/non-finite-data/);
  });
});

describe("glyphChartBars3d — model and mesh", () => {
  it("the z axis domain always includes 0 (a bar is drawn from the floor up)", () => {
    const mark = glyphChartBars3d([{ x: 0, y: 0, z: 50 }, { x: 1, y: 1, z: 80 }], { x: "x", y: "y", z: "z" });
    expect(mark.axes.z.domain[0]).toBeLessThanOrEqual(0);
  });

  it("MUTATION: a zero-height bar paints NO polygons — the mesh has one box (6 faces) per NONZERO bar only", () => {
    const mark = glyphChartBars3d([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 10 }, { x: 2, y: 2, z: 20 }], { x: "x", y: "y", z: "z" });
    const object = glyphChartObject(mark);
    const barsMesh = object.meshes.find((m) => m.name === "bars")!;
    expect(barsMesh.polygons.length).toBe(2 * 6);
  });

  it("bars never touch: adjacent bars' own footprints stay within half the tightest neighbour spacing", () => {
    const mark = glyphChartBars3d(table(), { x: "x", y: "y", z: "v" });
    expect(mark.barHalfWidth[0]).toBeLessThan(0.5); // < half the unit x spacing
    expect(mark.barHalfWidth[1]).toBeLessThan(0.5);
  });

  it("colour legend bands by height, endpoints at [min(0, dataMin), dataMax]", () => {
    const mark = glyphChartBars3d([{ x: 0, y: 0, z: -5 }, { x: 1, y: 1, z: 10 }], { x: "x", y: "y", z: "z" });
    expect(mark.colorLegend!.domain).toEqual([-5, 10]);
  });
});

describe("glyphChartBars3d — render", () => {
  it("braille render contains real braille glyphs", () => {
    const mark = glyphChartBars3d(table(), { x: "x", y: "y", z: "v" }, { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "v" } } });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(/[⠀-⣿]/.test(result.text)).toBe(true);
  });

  it("static == live: byte-identical to a live scene mount at the resolved camera", async () => {
    const mark = glyphChartBars3d(table(), { x: "x", y: "y", z: "v" }, { color: "none" });
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
