import { describe, it, expect } from "vitest";
import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";
import { buildRasterizeContext } from "../../api/rasterizeContext";
import { createGlyphOrthographicCamera } from "../../api/createGlyphCamera";
import { rasterize } from "../rasterize";
import { createGlyphCanvas } from "./canvas";
import { glyphCanvasTextureSampler } from "./sampler";

describe("glyphCanvasTextureSampler — dimensions", () => {
  it("is exact: width/height are cellCount * texelsPerCell, never padded or rounded", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 2, tier: "box" });
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [2, 3] });
    expect(sampler.width).toBe(6);
    expect(sampler.height).toBe(6);
    expect(sampler.data.length).toBe(6 * 6 * 4);
  });

  it("defaults to [2, 4] texels per cell", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 4, tier: "ascii" });
    const sampler = glyphCanvasTextureSampler(canvas);
    expect(sampler.width).toBe(10);
    expect(sampler.height).toBe(16);
  });

  it("a `rect` samples an exact sub-region", () => {
    const canvas = createGlyphCanvas({ cols: 8, rows: 8, tier: "box" });
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1], rect: { x0: 2, y0: 3, x1: 5, y1: 4 } });
    expect(sampler.width).toBe(4); // 5-2+1
    expect(sampler.height).toBe(2); // 4-3+1
  });

  it("rejects a non-positive-integer texelsPerCell", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 2 });
    expect(() => glyphCanvasTextureSampler(canvas, { texelsPerCell: [0, 4] })).toThrow(RangeError);
  });
});

/**
 * A 2-cell (1-row) canvas, entirely `shade: "solid"` filled so its `[1,1]`
 * (one texel per cell) sampler reproduces the canvas's own two `fillRect`
 * colours EXACTLY — the acceptance test's own "1:1" wording.
 */
function twoCellCanvas(leftColor: string, rightColor: string) {
  const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
  canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: leftColor });
  canvas.fillRect(1, 0, 1, 0, { fill: "solid", color: rightColor });
  return canvas;
}

/**
 * Renders ONE quad, `x` in `[xMin, xMax]`, UV-mapped `u` in `[uMin, uMax]`
 * against the given sampler, through the REAL rasteriser
 * (`buildRasterizeContext` + `rasterize`, the same pure entry
 * `textureSampling.test.ts` uses) via `setTextureSamplers`'s own contract
 * (`ctx.textureSamplers`, what the scene handle forwards to). Full ambient,
 * no directional light, so a texel's colour passes straight through
 * unshaded — the render IS the sampled colour, nothing else to account for.
 */
function renderQuadColors(sampler: ReturnType<typeof glyphCanvasTextureSampler>, xMin: number, xMax: number, uMin: number, uMax: number): string[] {
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 400 });
  const quad: Polygon = {
    vertices: [[xMin, -1, 0], [xMin, 1, 0], [xMax, 1, 0], [xMax, -1, 0]] as Vec3[],
    texture: "tex",
    uvs: [[uMin, 0], [uMin, 1], [uMax, 1], [uMax, 0]] as Vec2[],
  };
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: 40, rows: 40, cellAspect: 2 },
    polygons: [quad],
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
  ctx.textureSamplers = new Map([["tex", sampler]]);
  const out = rasterize(ctx);
  return [...new Set([...out.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("glyphCanvasTextureSampler — a chart on a quad at 1:1 reproduces its fg colours", () => {
  it("the LEFT cell's colour renders on the left half of the quad, and only that colour", () => {
    const canvas = twoCellCanvas("#ff0000", "#00ff00");
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1] });
    // u in [0, 0.499] always floors to column 0 (sampler.width === 2).
    const colors = renderQuadColors(sampler, -1, 0, 0, 0.499);
    expect(colors).toEqual(["#ff0000"]);
  });

  it("the RIGHT cell's colour renders on the right half of the quad, and only that colour", () => {
    const canvas = twoCellCanvas("#ff0000", "#00ff00");
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1] });
    // u in [0.501, 0.999] always floors to column 1.
    const colors = renderQuadColors(sampler, 0, 1, 0.501, 0.999);
    expect(colors).toEqual(["#00ff00"]);
  });

  it("swapping the canvas's fg colours swaps which side renders which colour — the sampler is not hard-coded to a position", () => {
    const swapped = twoCellCanvas("#00ff00", "#ff0000"); // left/right reversed vs. the test above
    const sampler = glyphCanvasTextureSampler(swapped, { texelsPerCell: [1, 1] });
    const leftColors = renderQuadColors(sampler, -1, 0, 0, 0.499);
    const rightColors = renderQuadColors(sampler, 0, 1, 0.501, 0.999);
    expect(leftColors).toEqual(["#00ff00"]);
    expect(rightColors).toEqual(["#ff0000"]);
  });
});

describe("glyphCanvasTextureSampler — bg and transparency", () => {
  it("a non-ink cell with a bg colour renders that bg, not the fg", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: { shade: 0 }, color: "#ff0000", bg: "#0000ff" });
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1] });
    expect(sampler.data[0]).toBe(0); // r
    expect(sampler.data[1]).toBe(0); // g
    expect(sampler.data[2]).toBe(255); // b
    expect(sampler.data[3]).toBe(255); // a
  });

  it("a non-ink cell with no bg is fully transparent (alpha 0), not black", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: { shade: 0 }, color: "#ff0000" });
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1] });
    expect(sampler.data[3]).toBe(0);
  });

  it("an ink cell with no explicit colour (null fg) reads as opaque white — the host's own colour passes through unmodulated", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid" }); // no `color` option
    const sampler = glyphCanvasTextureSampler(canvas, { texelsPerCell: [1, 1] });
    expect([...sampler.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });
});
