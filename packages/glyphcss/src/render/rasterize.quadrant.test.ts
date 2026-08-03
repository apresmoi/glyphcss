import { describe, it, expect, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { rasterize, encodeHalfblockSolid, encodeQuadrantSolid } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera, createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { Polygon } from "@glyphcss/core";
import type { CellGrid } from "./cells";

/**
 * `charMode: "quadrant"` tests. Public `RasterizeContextOptions` field,
 * solid-mode-only, mirrored across React/Vue and the `<glyph-scene>`
 * `char-mode` attribute — same shape as `rasterize.halfblock.test.ts`, which
 * this mode generalizes from a 1×2 (top/bottom) subcell split to a full 2×2
 * split.
 */
describe("rasterize — quadrant solid (charMode)", () => {
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

  it("is a documented no-op outside solid mode: wireframe output is unaffected by charMode quadrant", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
      const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
      const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
      const ctxAscii = buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false });
      const ctxQuadrant = buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "quadrant" });
      expect(rasterize(ctxQuadrant)).toBe(rasterize(ctxAscii));
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
    const withQuadrantHook = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "quadrant", transformCells: identity }));
    expect(withQuadrantHook).toBe(withAsciiHook);
    // Neither the ASCII ramp nor the fallback path ever emits a quadrant glyph.
    expect(withQuadrantHook).not.toMatch(/[▘▝▖▗▀▄▌▐▚▞▛▜▙▟█]/);
  });

  it("renders only quadrant-set glyphs in solid mode when charMode is quadrant", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 30, rows: 15, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
      mode: "solid",
      useColors: true,
      charMode: "quadrant",
    });
    const output = rasterize(ctx);
    const glyphs = output.replace(/<[^>]*>/g, "").replace(/\n/g, "");
    expect(glyphs.length).toBeGreaterThan(0);
    const nonSpace = glyphs.replace(/ /g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    const QUADRANT_SET = ["▘", "▝", "▖", "▗", "▀", "▄", "▌", "▐", "▚", "▞", "▛", "▜", "▙", "▟", "█"];
    for (const ch of nonSpace) {
      expect(QUADRANT_SET).toContain(ch);
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
      charMode: "quadrant",
    });
    const output = rasterize(ctx);
    const newlineCount = (output.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(rows - 1);
  });

  it("never paints an empty (uncovered) cell with a background", () => {
    const camera = createGlyphOrthographicCamera({ zoom: 40 });
    const ctx = buildRasterizeContext({
      camera,
      grid: { cols: 40, rows: 20, cellAspect: 2.0 },
      polygons: cubePolygons({ center: [0, 0, 0], size: 1 }),
      mode: "solid",
      useColors: true,
      charMode: "quadrant",
    });
    const output = rasterize(ctx);
    const spanBodies = [...output.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!);
    expect(spanBodies.length).toBeGreaterThan(0);
    for (const body of spanBodies) {
      expect(body).not.toContain(" ");
    }
  });

  describe("encodeQuadrantSolid — per-cell decision table (exported for direct testing)", () => {
    // outCols=1, outRows=1, S=2 → 2x2 subcells laid out [TL, TR, BL, BR]
    // (inCols = outCols*S = 2): index 0=TL, 1=TR, 2=BL, 3=BR.
    function oneCell(colors: (string | null)[], covered: boolean[]): { colorBuf: (string | null)[]; depthBuf: Float64Array } {
      const depthBuf = new Float64Array(covered.map((c) => (c ? 1 : -Infinity)));
      return { colorBuf: colors, depthBuf };
    }

    it("emits █ with color only (no background) when all four quadrants are covered with the SAME color", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#123456", "#123456", "#123456", "#123456"],
        [true, true, true, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#123456">█</span>`);
    });

    it("emits ▚ (diagonal TL+BR) with fg/bg when a diagonal pair of quadrants is covered with two colors, all four covered", () => {
      // TL/BR bright, TR/BL dark → luminance split matches the diagonal exactly.
      const { colorBuf, depthBuf } = oneCell(
        ["#ffffff", "#000000", "#000000", "#ffffff"],
        [true, true, true, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#ffffff;background-color:#000000">▚</span>`);
    });

    it("emits ▞ (diagonal TR+BL) with fg/bg for the mirrored diagonal split", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#000000", "#ffffff", "#ffffff", "#000000"],
        [true, true, true, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#ffffff;background-color:#000000">▞</span>`);
    });

    it("emits the single-quadrant corner glyph (▘) when only TL is covered", () => {
      const { colorBuf, depthBuf } = oneCell(
        ["#ff0000", null, null, null],
        [true, false, false, false],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#ff0000">▘</span>`);
    });

    it("emits the single-quadrant corner glyph (▗) when only BR is covered", () => {
      const { colorBuf, depthBuf } = oneCell(
        [null, null, null, "#00ff00"],
        [false, false, false, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(`<span style="color:#00ff00">▗</span>`);
    });

    it("emits a bare space with no color/background when no quadrant is covered", () => {
      const { colorBuf, depthBuf } = oneCell([null, null, null, null], [false, false, false, false]);
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(out).toBe(" ");
    });

    it("collapses a partially-covered cell with different quadrant colors into one average fg, no background", () => {
      // TL and BR covered (diagonal), TR/BL empty — a real diagonal shape, but
      // with room for only ONE color (a background would paint the empty
      // TR/BL quadrants).
      const { colorBuf, depthBuf } = oneCell(
        ["#ff0000", null, null, "#0000ff"],
        [true, false, false, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      // (255,0,0) and (0,0,255) average to (127.5,0,127.5); toHex2 truncates
      // (`| 0`) rather than rounds, matching `encodeHalfblockSolid`'s color
      // averaging convention.
      expect(out).toBe(`<span style="color:#7f007f">▚</span>`);
    });

    it("merges two adjacent cells with identical fg+bg into a single span", () => {
      const colorBuf: (string | null)[] = [
        "#ffffff", "#000000", "#ffffff", "#000000", // row 0: cell0=[TL,TR]=[white,black] cell1=[TL,TR]=[white,black]
        "#000000", "#ffffff", "#000000", "#ffffff", // row 1: cell0=[BL,BR]=[black,white] cell1=[BL,BR]=[black,white]
      ];
      const depthBuf = new Float64Array(colorBuf.length).fill(1);
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 2, 1, 2, true);
      expect(out).toBe(`<span style="color:#ffffff;background-color:#000000">▚▚</span>`);
    });

    it("ignores color entirely (plain glyphs only) when useColors is false", () => {
      const { colorBuf, depthBuf } = oneCell(
        [null, null, null, null],
        [true, true, true, true],
      );
      const out = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, false);
      expect(out).toBe("█");
    });
  });

  describe("quadrant beats halfblock on shapes halfblock cannot represent", () => {
    it("a single-corner-covered cell resolves as a real corner glyph in quadrant, but rounds up to a full top half in halfblock", () => {
      // Only TL covered (S=2: subcell index 0 of [TL,TR,BL,BR]). Halfblock's
      // "top" region is the WHOLE top subcell row (TL+TR together) — a
      // single covered subcell anywhere in that row already reads as "top
      // covered", so it draws a full-width ▀ that silently includes the TR
      // corner, which has no geometry at all. Quadrant resolves the exact
      // silhouette as the single ▘ corner instead.
      const colorBuf: (string | null)[] = ["#ff0000", null, null, null];
      const depthBuf = new Float64Array([1, -Infinity, -Infinity, -Infinity]);

      const quadrantOut = encodeQuadrantSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(quadrantOut).toBe(`<span style="color:#ff0000">▘</span>`);

      const halfblockOut = encodeHalfblockSolid(colorBuf, depthBuf, 1, 1, 2, true);
      expect(halfblockOut).toBe(`<span style="color:#ff0000">▀</span>`);
      expect(halfblockOut).not.toBe(quadrantOut);
    });
  });

  describe("markup-size cost vs the current single-color path (measured, reported)", () => {
    it("reports raw and gzip byte counts for ascii vs quadrant on the same colored scene", () => {
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
      const quadrant = rasterize(buildRasterizeContext({
        camera, grid, polygons: polys, mode: "solid", useColors: true, smoothShading: true, creaseAngle: 40, charMode: "quadrant",
      }));
      const asciiBytes = Buffer.byteLength(ascii, "utf8");
      const quadrantBytes = Buffer.byteLength(quadrant, "utf8");
      const asciiGzip = gzipSync(Buffer.from(ascii, "utf8")).length;
      const quadrantGzip = gzipSync(Buffer.from(quadrant, "utf8")).length;
      // eslint-disable-next-line no-console
      console.log(
        `quadrant markup size — ascii: ${asciiBytes}B raw / ${asciiGzip}B gzip; `
        + `quadrant: ${quadrantBytes}B raw / ${quadrantGzip}B gzip; `
        + `delta: ${quadrantBytes - asciiBytes}B raw (${(((quadrantBytes - asciiBytes) / asciiBytes) * 100).toFixed(1)}%), `
        + `${quadrantGzip - asciiGzip}B gzip (${(((quadrantGzip - asciiGzip) / asciiGzip) * 100).toFixed(1)}%)`,
      );
      expect(quadrantBytes).toBeGreaterThan(asciiBytes);
      expect(quadrantBytes).toBeLessThan(asciiBytes * 3);
      expect(quadrantGzip).toBeLessThan(asciiGzip * 3);
    });
  });
});
