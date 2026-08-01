import { describe, it, expect, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { rasterize, encodeHalfblockSolid } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera, createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { Polygon } from "@glyphcss/core";
import type { CellGrid } from "./cells";

/**
 * `charMode: "halfblock"` (B4) tests. Public `RasterizeContextOptions` field,
 * solid-mode-only, mirrored across React/Vue and the `<glyph-scene>`
 * `char-mode` attribute — same shape as the existing `charMode: "braille"`
 * tests in `rasterize.braille.test.ts`.
 */
describe("rasterize — halfblock solid (charMode)", () => {
  it("leaves the default (charMode absent / \"ascii\") solid path byte-identical", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const before = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true }));
    expect(before.replace(/\s/g, "").length).toBeGreaterThan(0);

    const withAscii = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "ascii" }));
    expect(withAscii).toBe(before);

    const withNoCharMode = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true }));
    expect(withNoCharMode).toBe(before);
  });

  it("is a documented no-op outside solid mode: wireframe output is unaffected by charMode halfblock", () => {
    // The ASCII wireframe glyph pick is itself randomized per cell, independent
    // of charMode — pin it so this test isolates charMode's effect only (same
    // approach as the analogous braille no-op test).
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
      const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
      const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
      const ctxAscii = buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false });
      const ctxHalfblock = buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "halfblock" });
      expect(rasterize(ctxHalfblock)).toBe(rasterize(ctxAscii));
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("is a documented no-op when combined with a transformCells hook: falls back to the single-color ramp path", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 20, rows: 10, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const identity = (g: CellGrid) => g;
    const withAsciiHook = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "ascii", transformCells: identity }));
    const withHalfblockHook = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock", transformCells: identity }));
    expect(withHalfblockHook).toBe(withAsciiHook);
    // Neither the ASCII ramp nor the fallback path ever emits a halfblock glyph.
    expect(withHalfblockHook).not.toMatch(/[▀▄█]/);
  });

  it("renders only halfblock glyphs (space/▀/▄/█) in solid mode when charMode is halfblock", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "solid",
      useColors: true,
      charMode: "halfblock",
    });
    const output = rasterize(ctx);
    const glyphs = output.replace(/<[^>]*>/g, "").replace(/\n/g, "");
    expect(glyphs.length).toBeGreaterThan(0);
    const nonSpace = glyphs.replace(/ /g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    for (const ch of nonSpace) {
      expect(["▀", "▄", "█"]).toContain(ch);
    }
  });

  it("produces (rows - 1) newlines, same as the ASCII solid path", () => {
    const rows = 12;
    const camera = createGlyphPerspectiveCamera({ zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 24, rows, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "solid",
      useColors: true,
      charMode: "halfblock",
    });
    const output = rasterize(ctx);
    const newlineCount = (output.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(rows - 1);
  });

  it("never paints an empty (uncovered) cell with a background", () => {
    // Deliberately small scene so plenty of grid cells have no geometry at all.
    const camera = createGlyphOrthographicCamera({ zoom: 40 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 1 }),
      mode: "solid",
      useColors: true,
      charMode: "halfblock",
    });
    const output = rasterize(ctx);
    // A styled run (color and/or background-color) must never contain a
    // space character — an empty subcell always forces fg=bg=null, which
    // breaks the run before any space is appended (see `encodeGlyphBuffersDual`).
    // Scan every `<span ...>…</span>` body directly rather than trusting a
    // single regex over the whole string.
    const spanBodies = [...output.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!);
    expect(spanBodies.length).toBeGreaterThan(0);
    for (const body of spanBodies) {
      expect(body).not.toContain(" ");
    }
  });

  describe("encodeHalfblockSolid — per-cell decision table (exported for direct testing)", () => {
    // outCols=1, outRows=1, S=2 → 2x2 subcells: indices [0,1] are the TOP row,
    // [2,3] are the BOTTOM row (inCols = outCols*S = 2).
    function oneCell(colors: (string | null)[], covered: boolean[]): { colorBuf: (string | null)[]; depthBuf: Float64Array } {
      const depthBuf = new Float64Array(covered.map((c) => (c ? 1 : -Infinity)));
      return { colorBuf: colors, depthBuf };
    }

    it("emits ▀ with fg=TOP color and bg=BOTTOM color when they differ (both subcells covered)", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#ff0000", "#ff0000", "#0000ff", "#0000ff"],
        [true, true, true, true],
      );
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#ff0000;background-color:#0000ff">▀</span>`);
    });

    it("emits █ with a single color (no background) when both subcells resolve to the SAME color", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#123456", "#123456", "#123456", "#123456"],
        [true, true, true, true],
      );
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#123456">█</span>`);
    });

    it("emits ▀ with fg only (no background) when only the TOP subcell is covered", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#ff0000", "#ff0000", null, null],
        [true, true, false, false],
      );
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#ff0000">▀</span>`);
    });

    it("emits ▄ with fg only (no background) when only the BOTTOM subcell is covered", () => {
      const { colorBuf, depthBuf } = oneCell(
        [null, null, "#00ff00", "#00ff00"],
        [false, false, true, true],
      );
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#00ff00">▄</span>`);
    });

    it("emits a bare space with no color/background when neither subcell is covered", () => {
      const { colorBuf, depthBuf } = oneCell([null, null, null, null], [false, false, false, false]);
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(" ");
    });

    it("merges two adjacent cells with identical fg+bg into a single span", () => {
      // Two output cells side by side, both differently-topped/bottomed the
      // SAME way → one merged run.
      const colorBuf: (string | null)[] = [
        "#ff0000", "#ff0000", "#ff0000", "#ff0000", // row 0 (top half), cols 0-1 each 2 wide
        "#0000ff", "#0000ff", "#0000ff", "#0000ff", // row 1 (bottom half)
      ];
      const depthBuf = new Float64Array(colorBuf.length).fill(1);
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 2, 1, 2, true);
      expect(out).toBe(`<span style="color:#ff0000;background-color:#0000ff">▀▀</span>`);
    });

    it("splits the run when only one of the two adjacent cells' colors differ", () => {
      const colorBuf: (string | null)[] = [
        "#ff0000", "#ff0000", "#ff0000", "#ff0000", // top row, both cells red
        "#0000ff", "#0000ff", "#00ff00", "#00ff00", // bottom row: cell 0 blue, cell 1 green
      ];
      const depthBuf = new Float64Array(colorBuf.length).fill(1);
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 2, 1, 2, true);
      expect(out).toBe(
        `<span style="color:#ff0000;background-color:#0000ff">▀</span>`
        + `<span style="color:#ff0000;background-color:#00ff00">▀</span>`,
      );
    });

    it("ignores color entirely (plain glyphs only) when useColors is false", () => {
      const { colorBuf, depthBuf } = oneCell(
        [null, null, null, null],
        [true, true, true, true],
      );
      const out = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, false);
      expect(out).toBe("█");
    });
  });

  describe("markup-size cost vs the current single-color path (measured, reported)", () => {
    it("reports raw and gzip byte counts for ascii vs halfblock on the same colored scene", () => {
      const camera = createGlyphPerspectiveCamera({ rotX: 32, rotY: 41, distance: 4, perspective: 800, zoom: 1500 });
      const polys: Polygon[] = [
        { vertices: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], color: "#c04030" },
        { vertices: [[0, 1, 0], [0, 0, 1], [-1, 0, 0]], color: "#30c040" },
        { vertices: [[0, 1, 0], [-1, 0, 0], [0, 0, -1]], color: "#3040c0" },
        { vertices: [[0, 1, 0], [0, 0, -1], [1, 0, 0]], color: "#c0c030" },
        { vertices: [[0, -1, 0], [0, 0, 1], [1, 0, 0]], color: "#c030c0" },
        { vertices: [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], color: "#30c0c0" },
        { vertices: [[0, -1, 0], [0, 0, -1], [-1, 0, 0]], color: "#a0a0a0" },
        { vertices: [[0, -1, 0], [1, 0, 0], [0, 0, -1]], color: "#804020" },
      ] as unknown as Polygon[];
      const grid = { cols: 70, rows: 40, cellAspect: 2 };
      const ascii = rasterize(buildRasterizeContext({
        camera, grid, polygons: polys, mode: "solid", useColors: true, smoothShading: true, creaseAngle: 40,
      }));
      const halfblock = rasterize(buildRasterizeContext({
        camera, grid, polygons: polys, mode: "solid", useColors: true, smoothShading: true, creaseAngle: 40, charMode: "halfblock",
      }));
      const asciiBytes = Buffer.byteLength(ascii, "utf8");
      const halfblockBytes = Buffer.byteLength(halfblock, "utf8");
      const asciiGzip = gzipSync(Buffer.from(ascii, "utf8")).length;
      const halfblockGzip = gzipSync(Buffer.from(halfblock, "utf8")).length;
      // eslint-disable-next-line no-console
      console.log(
        `B4 halfblock markup size — ascii: ${asciiBytes}B raw / ${asciiGzip}B gzip; `
        + `halfblock: ${halfblockBytes}B raw / ${halfblockGzip}B gzip; `
        + `delta: ${halfblockBytes - asciiBytes}B raw (${(((halfblockBytes - asciiBytes) / asciiBytes) * 100).toFixed(1)}%), `
        + `${halfblockGzip - asciiGzip}B gzip (${(((halfblockGzip - asciiGzip) / asciiGzip) * 100).toFixed(1)}%)`,
      );
      // Sanity bounds only (the console.log above is the reported measurement):
      // halfblock carries an extra `background-color:` on any cell whose top/
      // bottom subcells resolve to different colors, so it is expected to be
      // larger, not smaller — but should stay within the same order of
      // magnitude for a normally-shaded mesh (most triangle interiors shade
      // near-uniformly cell-to-cell, so many cells still collapse to `█`).
      expect(halfblockBytes).toBeGreaterThan(asciiBytes);
      expect(halfblockBytes).toBeLessThan(asciiBytes * 3);
      expect(halfblockGzip).toBeLessThan(asciiGzip * 3);
    });
  });
});
