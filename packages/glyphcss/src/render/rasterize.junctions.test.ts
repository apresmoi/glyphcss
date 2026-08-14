import { describe, it, expect, vi } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { WireframeEdge } from "@glyphcss/core";

/**
 * Box-drawing junction resolve pass (`wireframeJunctions`). This is a public
 * `RasterizeContextOptions` field, threaded through `createGlyphScene` and
 * mirrored across the React/Vue bindings and the `<glyph-scene>` custom
 * element's `wireframe-junctions` attribute.
 *
 * A fake identity camera (`project(v) => [v[0], v[1], 0]`) is used instead of
 * a real perspective/orthographic camera so every edge lands on an EXACT
 * integer cell coordinate — this test is about the mask → glyph resolve
 * logic, not camera projection, and real-camera axis alignment is already
 * covered indirectly by the "no visual regression" wireframe tests.
 */
function identityCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], 0, 1],
  } as unknown as GlyphCamera;
}

/**
 * A 6×6 grid (cols 2..8, rows 2..8) with a crossbar through the middle:
 *   - outer rectangle: (2,2)-(8,2)-(8,8)-(2,8)-(2,2)
 *   - internal vertical:   (5,2)-(5,8)
 *   - internal horizontal: (2,5)-(8,5)
 *
 * Produces every box-drawing glyph the junction set defines: 4 corners, 4
 * T-junctions, 1 crossing, and straight horizontal/vertical runs.
 */
function crossbarEdges(): WireframeEdge[] {
  return [
    { from: [2, 2, 0], to: [8, 2, 0] }, // top
    { from: [8, 2, 0], to: [8, 8, 0] }, // right
    { from: [8, 8, 0], to: [2, 8, 0] }, // bottom
    { from: [2, 8, 0], to: [2, 2, 0] }, // left
    { from: [5, 2, 0], to: [5, 8, 0] }, // internal vertical
    { from: [2, 5, 0], to: [8, 5, 0] }, // internal horizontal
  ];
}

const COLS = 12;
const ROWS = 12;

function cellAt(output: string, col: number, row: number): string {
  const lines = output.split("\n");
  return lines[row]![col]!;
}

describe("rasterize — wireframe box-drawing junction resolve pass (wireframeJunctions)", () => {
  it("resolves corners, T-junctions, a crossing, and straight runs to the correct glyphs", () => {
    const ctx = buildRasterizeContext({
      camera: identityCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      wireframe: crossbarEdges(),
      mode: "wireframe",
      useColors: false,
      wireframeJunctions: true,
    });
    const out = rasterize(ctx);

    // Corners.
    expect(cellAt(out, 2, 2)).toBe("┌");
    expect(cellAt(out, 8, 2)).toBe("┐");
    expect(cellAt(out, 2, 8)).toBe("└");
    expect(cellAt(out, 8, 8)).toBe("┘");

    // T-junctions.
    expect(cellAt(out, 5, 2)).toBe("┬");
    expect(cellAt(out, 5, 8)).toBe("┴");
    expect(cellAt(out, 2, 5)).toBe("├");
    expect(cellAt(out, 8, 5)).toBe("┤");

    // Crossing.
    expect(cellAt(out, 5, 5)).toBe("┼");

    // Straight runs (interior of each edge, away from any joint).
    expect(cellAt(out, 4, 2)).toBe("─"); // top edge
    expect(cellAt(out, 6, 8)).toBe("─"); // bottom edge
    expect(cellAt(out, 2, 4)).toBe("│"); // left edge
    expect(cellAt(out, 8, 6)).toBe("│"); // right edge
    expect(cellAt(out, 5, 4)).toBe("│"); // internal vertical, above the crossing
    expect(cellAt(out, 4, 5)).toBe("─"); // internal horizontal, left of the crossing

    // A cell untouched by any edge stays blank.
    expect(cellAt(out, 0, 0)).toBe(" ");
  });

  it("is off by default and byte-identical to the pre-existing random per-tier glyph pick", () => {
    // The default (no `wireframeJunctions`) glyph pick is itself randomized
    // per cell — pin it so this test isolates the option's effect only.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const base = {
        camera: identityCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        wireframe: crossbarEdges(),
        mode: "wireframe" as const,
        useColors: false,
      };
      const withoutOption = rasterize(buildRasterizeContext(base));
      const explicitlyOff = rasterize(buildRasterizeContext({ ...base, wireframeJunctions: false }));
      expect(explicitlyOff).toBe(withoutOption);

      // Sanity: the corner cell is NOT a box-drawing glyph when the pass is
      // off — it's whatever the random per-tier pick landed on.
      expect(cellAt(withoutOption, 2, 2)).not.toBe("┌");

      // Turning the pass on changes output for this scene.
      const withOption = rasterize(buildRasterizeContext({ ...base, wireframeJunctions: true }));
      expect(withOption).not.toBe(withoutOption);
      expect(cellAt(withOption, 2, 2)).toBe("┌");
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("leaves a diagonal-dominant edge's cells on the existing slope-glyph path (no mask contribution)", () => {
    const diagonal: WireframeEdge[] = [{ from: [2, 2, 0], to: [8, 8, 0] }];
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const base = {
        camera: identityCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        wireframe: diagonal,
        mode: "wireframe" as const,
        useColors: false,
      };
      const withoutOption = rasterize(buildRasterizeContext(base));
      const withOption = rasterize(buildRasterizeContext({ ...base, wireframeJunctions: true }));
      // A pure diagonal never rounds its two endpoints to the same row OR the
      // same column, so it contributes nothing to the mask — output is
      // unchanged by turning the pass on.
      expect(withOption).toBe(withoutOption);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
