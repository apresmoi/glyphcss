import { describe, it, expect, vi } from "vitest";
import { rasterize, rasterizeToCells, drawSubcellLine } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera, createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { cubePolygons, icosahedronPolygons } from "@glyphcss/core";
import type { CellGrid } from "./cells";

/** Runs `drawSubcellLine` into a fresh subcell stamp and returns the set of lit `"x,y"` dots. */
function litDots(x0: number, y0: number, x1: number, y1: number, subCols = 400, subRows = 400): Set<string> {
  const stamp = new Uint8Array(subCols * subRows);
  drawSubcellLine(stamp, null, null, x0, y0, x1, y1, subCols, subRows, subCols >> 1, 1, null);
  const dots = new Set<string>();
  for (let y = 0; y < subRows; y++) {
    for (let x = 0; x < subCols; x++) {
      if (stamp[y * subCols + x]) dots.add(`${x},${y}`);
    }
  }
  return dots;
}

/**
 * Braille subcell wireframe encoding (`charMode: "braille"`) tests. This is a
 * public `RasterizeContextOptions` field, threaded through `createGlyphScene`
 * and mirrored across the React/Vue bindings and the `<glyph-scene>` custom
 * element's `char-mode` attribute.
 */
describe("rasterize — braille wireframe (charMode)", () => {
  it("leaves the default (charMode absent / \"ascii\") wireframe path byte-identical", () => {
    // The existing ASCII wireframe glyph pick is itself randomized per cell
    // (`glyphs.thin/normal/core[(Math.random() * n) | 0]`), independent of
    // charMode — pin it so this test isolates charMode's effect only.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
      const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
      const ctxA = buildRasterizeContext({
        camera,
        grid,
        polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
        mode: "wireframe",
        useColors: false,
      });
      const before = rasterize(ctxA);
      expect(before.replace(/\s/g, "").length).toBeGreaterThan(0);

      // Same context, charMode explicitly "ascii" — must match.
      const ctxB = buildRasterizeContext({
        camera,
        grid,
        polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
        mode: "wireframe",
        useColors: false,
        charMode: "ascii",
      });
      expect(rasterize(ctxB)).toBe(before);

      // No charMode property at all (the real default) — must also match.
      const ctxC = buildRasterizeContext({
        camera,
        grid,
        polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
        mode: "wireframe",
        useColors: false,
      });
      expect(rasterize(ctxC)).toBe(before);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("renders a cube wireframe as braille-only glyphs (U+2800..U+28FF) when charMode is \"braille\"", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "wireframe",
      useColors: false,
      charMode: "braille",
    });
    const output = rasterize(ctx);
    const nonSpace = output.replace(/\s/g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    for (const ch of nonSpace) {
      const code = ch.codePointAt(0)!;
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28ff);
    }
  });

  it("renders an icosahedron wireframe as braille-only glyphs when charMode is \"braille\"", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 15, rotY: 40, zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: icosahedronPolygons({ center: [0, 0, 0], size: 2 }),
      mode: "wireframe",
      useColors: false,
      charMode: "braille",
    });
    const output = rasterize(ctx);
    const nonSpace = output.replace(/\s/g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    for (const ch of nonSpace) {
      const code = ch.codePointAt(0)!;
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28ff);
    }
  });

  it("produces (rows - 1) newlines, same as the ASCII wireframe path", () => {
    const rows = 12;
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 24, rows, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "wireframe",
      useColors: false,
      charMode: "braille",
    });
    const output = rasterize(ctx);
    const newlineCount = (output.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(rows - 1);
  });

  it("emits colored spans when useColors is true, same run-coalescing shape as ASCII wireframe", () => {
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "wireframe",
      useColors: true,
      charMode: "braille",
    });
    const output = rasterize(ctx);
    expect(output).toContain("<span");
  });

  it("is a documented no-op in solid mode: charMode braille does not change solid output", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 20, rows: 10, cellAspect: 2.0 };
    const ctxAscii = buildRasterizeContext({
      camera,
      grid,
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "solid",
      useColors: false,
    });
    const ctxBraille = buildRasterizeContext({
      camera,
      grid,
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "solid",
      useColors: false,
      charMode: "braille",
    });
    expect(rasterize(ctxBraille)).toBe(rasterize(ctxAscii));
  });

  it("runs the transformCells hook for braille output and reflects its mutations", () => {
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    let hookCalls = 0;
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 20, rows: 10, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "wireframe",
      useColors: false,
      charMode: "braille",
      transformCells: (grid: CellGrid) => {
        hookCalls++;
        for (let i = 0; i < grid.char.length; i++) {
          if (grid.char[i] !== " ") grid.char[i] = "X";
        }
        return grid;
      },
    });
    const output = rasterize(ctx);
    expect(hookCalls).toBe(1);
    const nonSpace = output.replace(/\s/g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    expect(nonSpace).toBe("X".repeat(nonSpace.length));
  });

  it("never lights a braille dot in a cell without also attributing that cell's edge color", () => {
    // Regression for border flicker: the braille path used to rasterize each
    // edge TWICE — once at cell resolution via `a[0] | 0` (truncate-toward-
    // zero) just to pick a color, and once at 2×4 subcell resolution via
    // `Math.floor(a[0] * 2)` to build the dot mask. `| 0` and `Math.floor`
    // disagree for negative coordinates (exactly what near-border geometry
    // produces), so a cell could get lit dots from the subcell pass while the
    // independent color pass never covered it — the cell renders with no
    // color (falls back to default) even though a colored edge crosses it.
    // As the camera moves, which cells land in this "colorless" bucket
    // shifts every frame, which reads as flicker at the borders.
    //
    // This edge is placed so its projected line crosses x = 0 at a fractional
    // negative column (col ≈ -0.56 at its top end) — before the fix, cell
    // (0, 10) received a lit dot from the subcell pass but no colorBuf entry
    // from the independent cell-resolution color pass.
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
    const ctx = buildRasterizeContext({
      camera,
      grid,
      polygons: [],
      wireframe: [
        { from: [11.0, -1, 0], to: [11.0, 1, 0], color: "#ff0000", weight: 2 },
      ],
      mode: "wireframe",
      useColors: true,
      charMode: "braille",
    });
    const cells = rasterizeToCells(ctx);
    expect(cells.color).not.toBeNull();
    let litCells = 0;
    for (let i = 0; i < cells.char.length; i++) {
      if (cells.char[i] === " ") continue;
      litCells++;
      expect(cells.color![i]).toBe("#ff0000");
    }
    // Sanity: the edge actually produced lit cells — otherwise the assertion
    // above would vacuously pass.
    expect(litCells).toBeGreaterThan(0);
  });

  // Regression for the left/right asymmetric-stroke defect: `featureEdges`
  // fixes a from/to order per mesh edge from vertex authoring order, not
  // from screen-space geometry, so a bilaterally-symmetric mesh's left- and
  // right-side edges can walk the subcell Bresenham in opposite relative
  // directions. The plain 8-connected Bresenham previously in
  // `drawSubcellLine` was both direction-dependent (mirror-asymmetric) and
  // only 8-connected (diagonal steps could skip the shared-edge dot a sparse
  // braille glyph needs to read as continuous).
  describe("drawSubcellLine — direction/mirror/connectivity regressions", () => {
    it("is endpoint-order independent: from→to equals to→from", () => {
      // (5,5)→(25,7): a shallow, mostly-horizontal diagonal — exactly the
      // shape of slope that exposed the bug (33% of random endpoint pairs
      // disagreed pre-fix; this concrete pair is one of them).
      const fwd = litDots(5, 5, 25, 7);
      const bwd = litDots(25, 7, 5, 5);
      expect(bwd).toEqual(fwd);
    });

    it("is endpoint-order independent across a random sweep", () => {
      let mismatches = 0;
      for (let i = 0; i < 500; i++) {
        const x0 = Math.floor(Math.random() * 200) - 100;
        const y0 = Math.floor(Math.random() * 200) - 100;
        const x1 = Math.floor(Math.random() * 200) - 100;
        const y1 = Math.floor(Math.random() * 200) - 100;
        if (x0 === x1 && y0 === y1) continue;
        const fwd = litDots(x0, y0, x1, y1);
        const bwd = litDots(x1, y1, x0, y0);
        if (fwd.size !== bwd.size || [...fwd].some((d) => !bwd.has(d))) mismatches++;
      }
      expect(mismatches).toBe(0);
    });

    it("produces a mirror-image dot pattern for a mirrored edge", () => {
      // Mirror around subcol 200 (negate x, keep y): a right-leaning
      // diagonal and its explicit left-leaning mirror twin.
      const W = 200;
      const original = litDots(50, 30, 90, 70);
      const mirrored = litDots(W - 50, 30, W - 90, 70);
      const expectedMirrored = new Set([...original].map((d) => {
        const [x, y] = d.split(",").map(Number);
        return `${W - x},${y}`;
      }));
      expect(mirrored).toEqual(expectedMirrored);
    });

    it("is mirror-symmetric across a random sweep", () => {
      const W = 200;
      let mismatches = 0;
      for (let i = 0; i < 500; i++) {
        const x0 = Math.floor(Math.random() * 200);
        const y0 = Math.floor(Math.random() * 200) - 100;
        const x1 = Math.floor(Math.random() * 200);
        const y1 = Math.floor(Math.random() * 200) - 100;
        if (x0 === x1 && y0 === y1) continue;
        const original = litDots(x0, y0, x1, y1);
        const mirrored = litDots(W - x0, y0, W - x1, y1);
        const expectedMirrored = new Set([...original].map((d) => {
          const [x, y] = d.split(",").map(Number);
          return `${W - x},${y}`;
        }));
        if (mirrored.size !== expectedMirrored.size || [...mirrored].some((d) => !expectedMirrored.has(d))) mismatches++;
      }
      expect(mismatches).toBe(0);
    });

    it("lights a 4-connected path: no two consecutive dots (by row) are diagonal-only neighbors", () => {
      // A steep-ish diagonal that previously produced 8-connected-only
      // (corner-touching) consecutive dots — visually a broken stroke once
      // folded to sparse braille glyphs.
      const dots = [...litDots(2, 3, 40, 25)].map((d) => d.split(",").map(Number) as [number, number]);
      dots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      // Walk row-by-row: within each row's dots and across adjacent rows,
      // every dot must have a 4-connected neighbor also in the set (not
      // strictly required to be "the next in sort order" — instead verify
      // the whole set forms a single connected component under 4-adjacency).
      const set = new Set(dots.map(([x, y]) => `${x},${y}`));
      const start = dots[0]!;
      const visited = new Set<string>([`${start[0]},${start[1]}`]);
      const stack = [start];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
          const key = `${nx},${ny}`;
          if (set.has(key) && !visited.has(key)) {
            visited.add(key);
            stack.push([nx, ny]);
          }
        }
      }
      expect(visited.size).toBe(set.size);
    });

    it("terminates for randomized, negative, out-of-range, equal, and single-point endpoint pairs", () => {
      const stamp = new Uint8Array(4);
      // Single/equal point.
      expect(() => drawSubcellLine(stamp, null, null, 0, 0, 0, 0, 2, 2, 2, 1, null)).not.toThrow();
      expect(() => drawSubcellLine(stamp, null, null, 5, 5, 5, 5, 2, 2, 2, 1, null)).not.toThrow();
      // Out-of-range (well outside the stamp bounds) and negative endpoints.
      for (let i = 0; i < 20000; i++) {
        const x0 = Math.floor(Math.random() * 4000) - 2000;
        const y0 = Math.floor(Math.random() * 4000) - 2000;
        const x1 = Math.floor(Math.random() * 4000) - 2000;
        const y1 = Math.floor(Math.random() * 4000) - 2000;
        expect(() => drawSubcellLine(stamp, null, null, x0, y0, x1, y1, 2, 2, 2, 1, null)).not.toThrow();
      }
    });
  });
});
