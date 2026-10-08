import { describe, it, expect, vi } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { cubePolygons } from "@glyphcss/core";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { WireframeEdge, Polygon } from "@glyphcss/core";

/**
 * `charMode: "quadrant"`/`"halfblock"` UNDER `mode: "wireframe"` — the gap
 * this closes: both used to be documented no-ops in wireframe mode (see the
 * now-updated tests in `rasterize.quadrant.test.ts`/`rasterize.halfblock.test.ts`),
 * silently falling back to the plain ASCII wireframe path. They now
 * rasterize each edge directly at a `WIREFRAME_SUBCELL_CONFIGS`-declared
 * subcell resolution — the exact same mechanism `charMode: "braille"`'s
 * wireframe path (`rasterize.braille.test.ts`, `rasterize.hiddenlines.test.ts`'s
 * braille `describe` block) already used, generalized rather than
 * duplicated (see `rasterize.ts`'s `rasterizeWireframeSubcell`).
 */

const COLS = 12;
const ROWS = 12;

/** Passes `v` straight through (including `z`) so edges land on exact
 *  integer/subcell coordinates — same fixture `rasterize.hiddenlines.test.ts` uses. */
function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

function surfaceQuad(z: number): Polygon {
  return {
    vertices: [
      [0, 0, z],
      [COLS, 0, z],
      [COLS, ROWS, z],
      [0, ROWS, z],
    ],
    color: "#888888",
  } as unknown as Polygon;
}

describe("rasterize — wireframe quadrant/halfblock sub-cell resolution (charMode)", () => {
  it("quadrant wireframe rasterizes at genuine 2×2 sub-cell resolution: a dot in one corner renders the exact corner glyph, not a rounded-up half", () => {
    // A zero-length edge ("dot") at (5.0, 5.0) — under quadrant's subX=2,
    // subY=2 scaling this lands at subcell (10,10), the TL corner of output
    // cell (5,5) exactly (baseSubX=10, baseSubY=10). This is only possible
    // because the edge is rasterized DIRECTLY at 2×2 resolution — the old
    // no-op path (cell-resolution ASCII stamp) has no notion of "which
    // corner", only "this cell has an edge".
    const ctx = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      wireframe: [{ from: [5.0, 5.0, 1], to: [5.0, 5.0, 1], weight: 2, color: "#ff0000" }],
      mode: "wireframe",
      charMode: "quadrant",
      useColors: false,
    });
    const out = rasterize(ctx);
    const cell = out.split("\n")[5]![5];
    expect(cell).toBe("▘");
  });

  it("the SAME dot under halfblock's coarser 1×2 split rounds up to the whole top half (▀), never the quadrant corner glyph — direct resolution, not a shared fold", () => {
    const ctx = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      wireframe: [{ from: [5.0, 5.0, 1], to: [5.0, 5.0, 1], weight: 2, color: "#ff0000" }],
      mode: "wireframe",
      charMode: "halfblock",
      useColors: false,
    });
    const out = rasterize(ctx);
    const cell = out.split("\n")[5]![5];
    expect(cell).toBe("▀");
    expect(cell).not.toBe("▘");
  });

  it("quadrant and halfblock wireframe render DIFFERENT output for the same cube (different sub-cell resolutions, never the same glyph stream)", () => {
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
    const grid = { cols: 30, rows: 15, cellAspect: 2.0 };
    const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });
    const ascii = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false }));
    const braille = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "braille" }));
    const quadrant = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "quadrant" }));
    const halfblock = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "halfblock" }));
    const outputs = [ascii, braille, quadrant, halfblock];
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        expect(outputs[i]).not.toBe(outputs[j]);
      }
    }
  });

  it("runs the transformCells hook for quadrant/halfblock wireframe output and reflects its mutations", () => {
    for (const charMode of ["quadrant", "halfblock"] as const) {
      let hookCalls = 0;
      const ctx = buildRasterizeContext({
        camera: createGlyphPerspectiveCamera({ zoom: 250, distance: 20 }),
        grid: { cols: 20, rows: 10, cellAspect: 2.0 },
        polygons: cubePolygons({ center: [0, 0, 0], size: 2 }),
        mode: "wireframe",
        useColors: false,
        charMode,
        transformCells: (grid) => {
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
    }
  });

  describe("hiddenLines: \"hide\" depth-tests quadrant/halfblock wireframe strokes, mirroring braille's own HLR contract", () => {
    // Per-charMode fixture: a diagonal cross for quadrant (subX=2 needs x
    // variation to land in different subcells) and a top/bottom dot pair for
    // halfblock (subX=1 collapses x entirely, so a diagonal edge's two
    // endpoints share one subcol and the edge alone already lights both
    // subrows — a dot pair isolates "front lights only the top subrow, back
    // lights only the bottom" instead). Both land inside output cell (col 5,
    // row 5)'s sub-cell block: y stays in [5.0, 5.9] for both configs' subY=2
    // scaling.
    const crossingEdgesByCharMode: Record<"quadrant" | "halfblock", { front: WireframeEdge; back: WireframeEdge }> = {
      quadrant: {
        front: { from: [5.0, 5.0, 1], to: [5.9, 5.9, 1], weight: 2, color: "#00ff00" },
        back: { from: [5.9, 5.0, 0], to: [5.0, 5.9, 0], weight: 2, color: "#ff0000" },
      },
      halfblock: {
        front: { from: [5.0, 5.0, 1], to: [5.0, 5.0, 1], weight: 2, color: "#00ff00" },
        back: { from: [5.0, 5.9, 0], to: [5.0, 5.9, 0], weight: 2, color: "#ff0000" },
      },
    };

    for (const charMode of ["quadrant", "halfblock"] as const) {
      it(`"hide" suppresses the occluded crossing stroke's cells for charMode ${charMode}, reproducing the front-only render`, () => {
        const { front, back } = crossingEdgesByCharMode[charMode];
        const frontOnly = rasterize(buildRasterizeContext({
          camera: passthroughCamera(),
          grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
          wireframe: [front],
          mode: "wireframe",
          charMode,
          useColors: false,
        }));
        const shown = rasterize(buildRasterizeContext({
          camera: passthroughCamera(),
          grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
          polygons: [surfaceQuad(1)],
          wireframe: [front, back],
          mode: "wireframe",
          charMode,
          useColors: false,
          hiddenLines: "show",
        }));
        const hidden = rasterize(buildRasterizeContext({
          camera: passthroughCamera(),
          grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
          polygons: [surfaceQuad(1)],
          wireframe: [front, back],
          mode: "wireframe",
          charMode,
          useColors: false,
          hiddenLines: "hide",
        }));
        // The occluded back stroke bleeds into the glyph under "show" ...
        expect(shown).not.toBe(frontOnly);
        // ... but "hide" suppresses it entirely, reproducing the front-only render.
        expect(hidden).toBe(frontOnly);
      });

      it(`is off by default and byte-identical to the pre-existing path for charMode ${charMode}`, () => {
        const { front, back } = crossingEdgesByCharMode[charMode];
        const base = {
          camera: passthroughCamera(),
          grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
          polygons: [surfaceQuad(1)],
          wireframe: [front, back],
          mode: "wireframe" as const,
          charMode,
          useColors: false,
        };
        const withoutOption = rasterize(buildRasterizeContext(base));
        const explicitlyShow = rasterize(buildRasterizeContext({ ...base, hiddenLines: "show" }));
        expect(explicitlyShow).toBe(withoutOption);
      });
    }
  });
});

describe("rasterize — byte-identity guard: every pre-existing (mode, charMode) combination is unaffected by the wireframe sub-cell generalization", () => {
  const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 35, zoom: 250, distance: 20 });
  const grid = { cols: 24, rows: 12, cellAspect: 2.0 };
  const polygons = cubePolygons({ center: [0, 0, 0], size: 2 });

  // Fixed, checked-in baselines (not re-derived from the current build) so a
  // regression in the generalized `rasterizeWireframeSubcell`/`drawSubcellLine`/
  // `foldSubStampToCells` machinery turns this file red instead of silently
  // comparing the new code against itself.
  it("ascii wireframe (charMode absent) is byte-identical", () => {
    // The ASCII wireframe glyph pick is itself randomized per cell — pin it
    // so the snapshot is deterministic across runs (same approach every
    // other charMode-isolation test in this file/`rasterize.braille.test.ts`
    // /`rasterize.quadrant.test.ts` uses).
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const out = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false }));
      expect(out).toMatchSnapshot();
    } finally {
      randomSpy.mockRestore();
    }
  });
  it("braille wireframe is byte-identical", () => {
    const out = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "wireframe", useColors: false, charMode: "braille" }));
    expect(out).toMatchSnapshot();
  });
  it("solid halfblock is byte-identical", () => {
    const out = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "halfblock" }));
    expect(out).toMatchSnapshot();
  });
  it("solid quadrant is byte-identical", () => {
    const out = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "solid", useColors: true, charMode: "quadrant" }));
    expect(out).toMatchSnapshot();
  });
  it("ink mode ignores charMode entirely regardless of value", () => {
    const base = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "ink", useColors: false }));
    for (const charMode of ["braille", "quadrant", "halfblock"] as const) {
      expect(rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "ink", useColors: false, charMode }))).toBe(base);
    }
  });
  it("voxel mode ignores charMode entirely regardless of value (falls through to the ASCII wireframe path)", () => {
    const base = rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "voxel", useColors: false }));
    for (const charMode of ["braille", "quadrant", "halfblock"] as const) {
      expect(rasterize(buildRasterizeContext({ camera, grid, polygons, mode: "voxel", useColors: false, charMode }))).toBe(base);
    }
  });
});
