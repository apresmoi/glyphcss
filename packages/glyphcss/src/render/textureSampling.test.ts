import { describe, it, expect } from "vitest";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import type { TextureSampler } from "@glyphcss/core";

// A 2×2 texture: red / green / blue / white quadrants.
const sampler: TextureSampler = {
  width: 2,
  height: 2,
  lowDetail: false,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, /**/ 0, 255, 0, 255,
    0, 0, 255, 255, /**/ 255, 255, 255, 255,
  ]),
};

// Flat quad in the X-Y plane, UV-mapped 0..1 over the whole face. doubleSided so
// winding never culls it (a flat billboard).
const quad = {
  vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]] as [number, number, number][],
  texture: "tex",
  uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] as [number, number][],
};

function renderColors(withSamplers: boolean): string[] {
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 400 });
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: 40, rows: 40, cellAspect: 2 },
    polygons: [{ ...quad }],
    mode: "solid",
    useColors: true,
    doubleSided: true,
    // Full ambient, no directional → the texel passes through unshaded.
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
  if (withSamplers) ctx.textureSamplers = new Map([["tex", sampler]]);
  const out = rasterize(ctx);
  return [...new Set([...out.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

describe("per-cell texture sampling", () => {
  it("samples the texture per cell — all four texel colors appear", () => {
    const colors = renderColors(true);
    expect(colors).toEqual(expect.arrayContaining(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]));
  });

  it("without a sampler, the same quad renders flat (no per-cell texel colors)", () => {
    const colors = renderColors(false);
    expect(colors).not.toEqual(expect.arrayContaining(["#ff0000", "#00ff00", "#0000ff"]));
  });
});
