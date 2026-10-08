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

  // `charMode: "halfblock"` used to be a documented no-op in wireframe mode
  // (the scene rendered exactly as ASCII wireframe would). It now rasterizes
  // each wireframe edge directly at a 1×2 (top/bottom) subcell resolution,
  // mirroring `charMode: "braille"`'s own wireframe mechanism — see
  // `rasterize.ts`'s `WIREFRAME_SUBCELL_CONFIGS`. This test replaces the old
  // "falls back to ASCII" pin with the new contract; `rasterize.braille.test.ts`
  // covers the real no-op that remains (`solid`/`voxel`/`ink` modes).
  it("wireframe mode now renders real halfblock glyphs (▀▄█), no longer a no-op", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const ascii = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false }));
    const halfblock = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "halfblock" }));
    expect(halfblock).not.toBe(ascii);
    const nonSpace = halfblock.replace(/\s/g, "");
    expect(nonSpace.length).toBeGreaterThan(0);
    for (const ch of nonSpace) {
      expect(["▀", "▄", "█"]).toContain(ch);
    }
  });

  it("is still a documented no-op in solid mode's own no-op paths (ink, voxel): charMode halfblock never touches them", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 20, rows: 10, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const inkAscii = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "ink", useColors: false }));
    const inkHalfblock = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "ink", useColors: false, charMode: "halfblock" }));
    expect(inkHalfblock).toBe(inkAscii);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const voxelAscii = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "voxel", useColors: false }));
      const voxelHalfblock = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "voxel", useColors: false, charMode: "halfblock" }));
      expect(voxelHalfblock).toBe(voxelAscii);
    } finally {
      randomSpy.mockRestore();
    }
  });

  // D2 round 7 (`@glyphcss/diagrams/3d`'s "blocks" charset): halfblock/
  // quadrant + a mounted `transformCells` hook used to be a documented
  // no-op (fell back to the single-color ramp) — the fix in this round
  // makes it WORK, so a diagram's node-label overlay can render real
  // half-block/quadrant geometry with the labels stamped on top as
  // whole-cell overrides. These two tests replace the old "falls back"
  // pin with the new contract.
  it("a hook that touches NOTHING still renders real halfblock glyphs — byte-identical to no hook at all", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 20, rows: 10, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const identity = (g: CellGrid) => g;
    const withoutHook = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock" }));
    const withIdentityHook = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock", transformCells: identity }));
    expect(withIdentityHook).toBe(withoutHook);
    expect(withIdentityHook).toMatch(/[▀▄█]/);
  });

  it("a hook that writes one cell overrides it WHOLE (glyph + fg, bg cleared) while every other cell keeps real dual-colour halfblock ink", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 20, rows: 10, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const geometryOnly = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock" }));
    const stampOneCell = (g: CellGrid): CellGrid => {
      g.char[0] = "X";
      g.color[0] = "#ff0000";
      return g;
    };
    const withStamp = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock", transformCells: stampOneCell }));
    // The stamped cell renders as a plain single-colour span (glyph X, fg
    // #ff0000), never carrying a `background-color` — this is the "whole
    // cell override, bg cleared" contract, not a merge with whatever the
    // untouched dual-colour decision would have painted there.
    expect(withStamp).toMatch(/<span style="color:#ff0000">X<\/span>|^X/);
    expect(withStamp).not.toMatch(/background-color:#ff0000/);
    // Real halfblock ink survives elsewhere in the SAME render — the hook's
    // one-cell write doesn't collapse the whole frame back to the ramp path.
    expect(withStamp).toMatch(/[▀▄█]/);
    // And it's still genuinely DIFFERENT from the untouched geometry render
    // (the stamped cell changed), proving the merge is real, not a no-op
    // that happened to look the same.
    expect(withStamp).not.toBe(geometryOnly);
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
