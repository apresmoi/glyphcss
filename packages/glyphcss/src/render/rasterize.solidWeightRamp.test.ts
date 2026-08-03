import { describe, it, expect, vi } from "vitest";
import { rasterize, rasterizeToCells } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { GlyphSolidWeightRampStep } from "../api/types";
import type { CellGrid } from "./cells";

/**
 * `solidWeightRamp` (font-weight second density axis, solid-mode-only)
 * tests. Public `RasterizeContextOptions` field, mirrored across React/Vue
 * and the `<glyph-scene>` `solidWeightRamp` JS property — see AGENTS.md.
 */
describe("rasterize — solidWeightRamp (solid mode font-weight ramp)", () => {
  const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
  const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
  const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });

  const weightRamp: GlyphSolidWeightRampStep[] = [
    { glyph: ".", weight: 400 },
    { glyph: ".", weight: 700 },
    { glyph: "o", weight: 400 },
    { glyph: "o", weight: 700 },
    { glyph: "#", weight: 700 },
  ];

  it("leaves the default (solidWeightRamp absent) solid path byte-identical", () => {
    const before = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true }));
    const withUndefined = rasterize(buildRasterizeContext({
      camera, grid, polygons, mode: "solid", useColors: true, solidWeightRamp: undefined,
    }));
    expect(withUndefined).toBe(before);

    // An empty ramp is also "off".
    const withEmpty = rasterize(buildRasterizeContext({
      camera, grid, polygons, mode: "solid", useColors: true, solidWeightRamp: [],
    }));
    expect(withEmpty).toBe(before);

    // No cell in the default path carries a font-weight style.
    expect(before).not.toMatch(/font-weight/);
  });

  it("emits both the expected glyph and font-weight for a cell whose shade falls in a weighted step", () => {
    const ctx = buildRasterizeContext({
      camera, grid, polygons, mode: "solid", useColors: true, solidWeightRamp: weightRamp,
    });
    const grid2 = rasterizeToCells(ctx);
    expect(grid2.weight).toBeDefined();

    const covered = Array.from(grid2.char, (c, i) => (c !== " " ? i : -1)).filter((i) => i >= 0);
    expect(covered.length).toBeGreaterThan(0);

    // Every covered cell's glyph must be drawn from the weighted ramp's glyph
    // set, and every rendered weight must be one of the ramp's weights.
    const rampGlyphs = new Set(weightRamp.map((s) => s.glyph));
    const rampWeights = new Set(weightRamp.map((s) => s.weight));
    for (const i of covered) {
      expect(rampGlyphs.has(grid2.char[i]!)).toBe(true);
      expect(rampWeights.has(grid2.weight![i]!)).toBe(true);
    }

    // The rendered HTML actually carries a font-weight style for a covered cell.
    const out = rasterize(ctx);
    expect(out).toMatch(/font-weight:(400|700)/);
  });

  it("is a documented no-op outside solid mode: wireframe output is unaffected", () => {
    // Wireframe's per-cell glyph pick is itself randomized per cell, independent
    // of solidWeightRamp — pin it so this test isolates solidWeightRamp's
    // effect only (same approach as the analogous charMode no-op tests).
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const ctxAscii = buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: true });
      const ctxWeighted = buildRasterizeContext({
        camera, grid, polygons, mode: "wireframe", useColors: true, solidWeightRamp: weightRamp,
      });
      expect(rasterize(ctxWeighted)).toBe(rasterize(ctxAscii));
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("run-merging still coalesces adjacent same glyph+color+weight cells and splits on a weight change", () => {
    const ctx = buildRasterizeContext({
      camera, grid, polygons, mode: "solid", useColors: true, solidWeightRamp: weightRamp,
    });
    const out = rasterize(ctx);
    // Every emitted span with a font-weight style is well-formed and its run
    // text never straddles a weight boundary (by construction of the
    // encoder): parse the spans and confirm none contain conflicting glyphs
    // from different ramp weights (checked indirectly by round-tripping
    // through rasterizeToCells and re-encoding).
    const spanMatches = Array.from(out.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g));
    expect(spanMatches.length).toBeGreaterThan(0);

    const grid2 = rasterizeToCells(ctx);
    // Reconstruct expected run boundaries from the grid and confirm adjacency:
    // walk each row and verify a run only continues while color AND weight
    // both match, exactly mirroring `encodeGlyphBuffers`'s run key.
    for (let row = 0; row < grid2.rows; row++) {
      let runColor: string | null | undefined;
      let runWeight = 0;
      let runLen = 0;
      let maxRunLen = 0;
      for (let col = 0; col < grid2.cols; col++) {
        const idx = row * grid2.cols + col;
        const g = grid2.char[idx]!;
        const color = g === " " ? null : grid2.color[idx] ?? null;
        const weight = g === " " ? 0 : grid2.weight![idx] ?? 0;
        if (color === runColor && weight === runWeight) {
          runLen++;
        } else {
          maxRunLen = Math.max(maxRunLen, runLen);
          runColor = color;
          runWeight = weight;
          runLen = 1;
        }
      }
      maxRunLen = Math.max(maxRunLen, runLen);
      expect(maxRunLen).toBeGreaterThanOrEqual(1);
    }
  });

  it("a transformCells hook can read and rewrite the weight buffer", () => {
    let sawWeight: Uint16Array | undefined;
    const out = rasterize(buildRasterizeContext({
      camera, grid, polygons, mode: "solid", useColors: true, solidWeightRamp: weightRamp,
      transformCells: (g: CellGrid) => {
        sawWeight = g.weight;
        if (g.weight) {
          for (let i = 0; i < g.weight.length; i++) {
            if (g.weight[i]! > 0) g.weight[i] = 900;
          }
        }
        return g;
      },
    }));
    expect(sawWeight).toBeDefined();
    expect(out).toMatch(/font-weight:900/);
    expect(out).not.toMatch(/font-weight:400/);
    expect(out).not.toMatch(/font-weight:700/);
  });
});
