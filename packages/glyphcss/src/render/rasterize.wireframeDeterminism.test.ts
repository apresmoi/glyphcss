import { describe, it, expect, vi } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { GlyphCamera } from "../api/createGlyphCamera";

function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

describe("rasterize — wireframe glyph picks are a function of the cell, not of chance", () => {
  const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
  const grid = { cols: 24, rows: 12, cellAspect: 2.0 };
  const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
  const render = () => rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false }));

  it("two renders of the same inputs are byte-identical and never consult Math.random", () => {
    const random = vi.spyOn(Math, "random");
    try {
      const first = render();
      const second = render();
      expect(first.trim().length).toBeGreaterThan(0);
      expect(second).toBe(first);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("keeps the palette's mixed texture: one stroke weight draws more than one glyph along a run", () => {
    const out = rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: 40, rows: 3, cellAspect: 2.0 },
      wireframe: [{ from: [1.5, 1.5, 0], to: [38.5, 1.5, 0], weight: 2, color: "#ffffff" }],
      mode: "wireframe",
      useColors: false,
    }));
    const glyphs = new Set([...out.split("\n")[1]!].filter((ch) => ch !== " "));
    expect(glyphs.size).toBeGreaterThan(1);
  });
});

describe("rasterize — wireframe walk visits the cell the line crosses", () => {
  const draw = (from: [number, number, number], to: [number, number, number], cols = 14, rows = 8) =>
    rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols, rows, cellAspect: 2.0 },
      wireframe: [{ from, to, weight: 2, color: "#ffffff" }],
      mode: "wireframe",
      useColors: false,
    })).split("\n").map((l) => [...l]);

  it("an edge 0.9 down a row inks that row, not the next one (floor, not round)", () => {
    const grid = draw([1, 2.9, 0], [10, 2.9, 0]);
    for (let c = 1; c <= 9; c++) {
      expect(grid[2]![c]).not.toBe(" ");
      expect(grid[3]![c]).toBe(" ");
    }
  });

  it("a shallow diagonal inks exactly one cell per column with no gap, whatever the slope", () => {
    for (const rise of [0.7, 1.9, 3.3, 4.6]) {
      const grid = draw([0.4, 0.3, 0], [12.4, 0.3 + rise, 0]);
      const rowsHit: number[] = [];
      for (let c = 1; c <= 11; c++) {
        const hit = grid.map((row, r) => (row[c] !== " " ? r : -1)).filter((r) => r >= 0);
        expect(hit.length).toBe(1);
        rowsHit.push(hit[0]!);
        // ...and it is the row the line passes through at the column's centre.
        expect(hit[0]).toBe(Math.floor(0.3 + (rise * (c + 0.5 - 0.4)) / 12));
      }
      for (let i = 1; i < rowsHit.length; i++) expect(Math.abs(rowsHit[i]! - rowsHit[i - 1]!)).toBeLessThanOrEqual(1);
    }
  });
});
