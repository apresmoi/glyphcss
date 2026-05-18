import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphcssPerspectiveCamera } from "../api/createGlyphcssCamera";
import type { Polygon } from "@glyphcss/core";

/** Simple unit cube — 12 triangular polygons (2 per face × 6 faces). */
function makeCubePolygons(): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[number, number, number, number, number, number, number, number, number, string]> = [
    // front face  (z = 1)
    [-1, -1, 1,  1, -1, 1,  1,  1, 1, "#ff4444"],
    [-1, -1, 1,  1,  1, 1, -1,  1, 1, "#ff4444"],
    // back  (z = -1)
    [ 1, -1,-1, -1, -1,-1, -1,  1,-1, "#44ff44"],
    [ 1, -1,-1, -1,  1,-1,  1,  1,-1, "#44ff44"],
    // top   (y = 1)
    [-1,  1, 1,  1,  1, 1,  1,  1,-1, "#4444ff"],
    [-1,  1, 1,  1,  1,-1, -1,  1,-1, "#4444ff"],
    // bottom (y = -1)
    [-1, -1,-1,  1, -1,-1,  1, -1, 1, "#ffff44"],
    [-1, -1,-1,  1, -1, 1, -1, -1, 1, "#ffff44"],
    // right  (x = 1)
    [ 1, -1, 1,  1, -1,-1,  1,  1,-1, "#44ffff"],
    [ 1, -1, 1,  1,  1,-1,  1,  1, 1, "#44ffff"],
    // left   (x = -1)
    [-1, -1,-1, -1, -1, 1, -1,  1, 1, "#ff44ff"],
    [-1, -1,-1, -1,  1, 1, -1,  1,-1, "#ff44ff"],
  ];
  for (const [x0,y0,z0, x1,y1,z1, x2,y2,z2, color] of faces) {
    out.push({ vertices: [[x0,y0,z0],[x1,y1,z1],[x2,y2,z2]], color });
  }
  return out;
}

describe("rasterize", () => {
  it("renders a solid cube to non-empty text", () => {
    const camera = createGlyphcssPerspectiveCamera({ rotX: 0.4, rotY: 0.5, scale: 0.35 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: false,
    });
    const output = rasterize(ctx);
    expect(typeof output).toBe("string");
    // Must have newlines (multi-row grid)
    expect(output).toContain("\n");
    // Must have at least some non-space content (cube is visible)
    expect(output.replace(/\s/g, "").length).toBeGreaterThan(0);
  });

  it("renders wireframe mode to non-empty text", () => {
    const camera = createGlyphcssPerspectiveCamera({ scale: 0.3 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "wireframe",
      useColors: false,
    });
    const output = rasterize(ctx);
    expect(output.replace(/\s/g, "").length).toBeGreaterThan(0);
  });

  it("renders with colors producing html spans", () => {
    const camera = createGlyphcssPerspectiveCamera({ scale: 0.35 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: true,
    });
    const output = rasterize(ctx);
    // Color-enabled solid mode should produce span elements
    expect(output).toContain("<span");
  });

  it("produces exactly (rows - 1) newlines for a non-empty render", () => {
    const rows = 10;
    const camera = createGlyphcssPerspectiveCamera({ scale: 0.3 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 20, rows, cellAspect: 2.0 },
      polygons: makeCubePolygons(),
      mode: "solid",
      useColors: false,
    });
    const output = rasterize(ctx);
    const newlineCount = (output.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(rows - 1);
  });
});
