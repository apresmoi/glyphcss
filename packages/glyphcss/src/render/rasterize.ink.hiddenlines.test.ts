import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * `hiddenLines: "hide"` in `mode: "ink"` — see AGENTS.md and
 * `research/contour-first-text/decisions.md` (2026-08-02 entries) for the
 * design: a kept silhouette/crease edge is hidden only when EVERY sample
 * along its length fails a slope-scaled depth test against a solid surface
 * prepass, not per-sample like the two ruled-out attempts. This file is
 * new (not a modification of `rasterize.ink.test.ts`) so the existing ink
 * test suite stays untouched.
 *
 * A camera whose `project` passes `v` straight through (including `z`) is
 * used so camera-space depth is directly authored via each vertex's own
 * `z` component — this is about the depth-test/bias logic, not real camera
 * projection math (same pattern `rasterize.hiddenlines.test.ts` uses for the
 * wireframe path).
 */
function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

const COLS = 30;
const ROWS = 20;

/** A single kept silhouette edge from `a` to `b`: one front-facing triangle
 * (apex offset `+perp`, nudged toward the camera in z) and one back-facing
 * triangle (apex offset `-perp`, nudged away) — front/back flip at this edge
 * makes it a genuine silhouette, kept by `rasterizeInk` regardless of HLR. */
function silhouetteEdge(a: Vec3, b: Vec3, perp: [number, number, number]): Polygon[] {
  const apexFront: Vec3 = [a[0] + perp[0], a[1] + perp[1], a[2] + perp[2] + 1];
  const apexBack: Vec3 = [a[0] - perp[0], a[1] - perp[1], a[2] - perp[2] - 1];
  return [
    { vertices: [a, b, apexFront], color: "#ff0000" },
    { vertices: [a, b, apexBack], color: "#00ff00" },
  ];
}

/** A huge flat quad, far outside the `COLS × ROWS` grid on every side, at a
 * constant depth `z` — a "surface" that covers every on-screen cell in the
 * depth prepass without any of its own boundary edges crossing the grid
 * (each boundary edge runs along a constant x or y coordinate outside
 * `[0, COLS)` / `[0, ROWS)`, so it never competes for a tested cell). */
function hugeSurfaceQuad(z: number): Polygon {
  return {
    vertices: [
      [-1000, -1000, z],
      [1000, -1000, z],
      [1000, 1000, z],
      [-1000, 1000, z],
    ],
    color: "#888888",
  } as unknown as Polygon;
}

function cellAt(output: string, col: number, row: number): string {
  const lines = output.split("\n");
  return lines[row]![col]!;
}

function inkRasterize(polygons: Polygon[], hiddenLines?: "show" | "hide"): string {
  const ctx = buildRasterizeContext({
    camera: passthroughCamera(),
    grid: { cols: COLS, rows: ROWS, cellAspect: 1.0 },
    polygons,
    mode: "ink",
    useColors: false,
    ...(hiddenLines ? { hiddenLines } : {}),
  });
  return rasterize(ctx);
}

describe("rasterize — ink hidden-line removal (hiddenLines)", () => {
  it('is off by default and "show" is byte-identical to no option at all', () => {
    const polys = [...silhouetteEdge([10, 10, 0], [15, 10, 0], [0, -3, 0]), hugeSurfaceQuad(-50)];
    const withoutOption = inkRasterize(polys);
    const explicitlyShow = inkRasterize(polys, "show");
    expect(explicitlyShow).toBe(withoutOption);
  });

  it("a genuinely occluded edge (behind a solid surface by a real margin at every sample) does not draw under \"hide\"", () => {
    // The edge sits at z=0; a flat occluding surface sits at z=10, well in
    // front of it (larger z = nearer, matching fillDepthTri's convention) —
    // every sample along the edge fails the depth test.
    const polys = [...silhouetteEdge([10, 10, 0], [15, 10, 0], [0, -3, 0]), hugeSurfaceQuad(10)];
    const shown = inkRasterize(polys, "show");
    const hidden = inkRasterize(polys, "hide");
    // Ground truth: the edge alone rendered with no occluder at all — "show"
    // must reproduce this exactly (nothing to hide against), proving the
    // edge really is drawn absent the occluder.
    const edgeAlone = inkRasterize([...silhouetteEdge([10, 10, 0], [15, 10, 0], [0, -3, 0])]);
    expect(shown).toBe(edgeAlone);
    expect(["‾", "-", "_"]).toContain(cellAt(shown, 12, 10));
    // "hide" drops the whole edge — the cell it would have inked is blank.
    expect(cellAt(hidden, 12, 10)).toBe(" ");
    expect(hidden).not.toBe(shown);
  });

  it("a grazing silhouette edge lying ON the surface it outlines still draws under \"hide\" — the regression both prior HLR attempts failed", () => {
    // The edge's own baseline sits at the SAME z as the occluding surface
    // (0), so every sample lies AT surface depth, well within the bias —
    // this is the case a per-sample test (tried twice, see decisions.md)
    // could not distinguish from genuine occlusion, eating up to ~46% of a
    // sphere's silhouette. The per-edge "ALL samples must fail" rule must
    // leave this fully visible.
    const polys = [...silhouetteEdge([10, 10, 0], [15, 10, 0], [0, -3, 0]), hugeSurfaceQuad(0)];
    const shown = inkRasterize(polys, "show");
    const hidden = inkRasterize(polys, "hide");
    expect(["‾", "-", "_"]).toContain(cellAt(shown, 12, 10));
    expect(cellAt(hidden, 12, 10)).toBe(cellAt(shown, 12, 10));
    expect(hidden).toBe(shown);
  });

  it('"hide" leaves an edge visible when there is no surface at all to occlude against', () => {
    const polys = silhouetteEdge([10, 10, 0], [15, 10, 0], [0, -3, 0]);
    const hidden = inkRasterize(polys, "hide");
    expect(["‾", "-", "_"]).toContain(cellAt(hidden, 12, 10));
  });
});
