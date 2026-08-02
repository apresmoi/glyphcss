import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * Regression test for the reported "sides instead of front" defect on
 * extruded word-art in `mode: "ink"`: a front-face silhouette contour and a
 * farther extrusion side-wall silhouette both resolve to `rank: 1` (both are
 * silhouette edges), so the old conflict resolution — `rank` first, then
 * WHICHEVER SEGMENT RASTERIZED LAST for equal rank — let a farther stroke
 * win over a nearer one purely by draw order, with no regard for depth.
 *
 * This file is new (not a modification of `rasterize.ink.test.ts` or
 * `rasterize.ink.hiddenlines.test.ts`) so the existing ink suites stay
 * untouched. Uses the same passthrough-camera pattern as
 * `rasterize.ink.hiddenlines.test.ts` so world-space `z` IS the camera-space
 * depth the fix must consult (`p[2]`, "larger = nearer" — the same
 * convention `fillDepthTri`'s `z > depth[idx]` test uses).
 */
function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

const COLS = 30;
const ROWS = 20;

/** A single kept silhouette edge from `a` to `b` (one front-facing triangle,
 * one back-facing triangle, apexes offset in screen-space only — `z` on `a`/
 * `b` themselves carries the edge's own camera-space depth, independent of
 * which triangle is front/back-facing since facing is a screen-space (x, y)
 * area-sign test under the passthrough camera). */
function silhouetteEdge(a: Vec3, b: Vec3, perp: [number, number, number], color: string): Polygon[] {
  const apexFront: Vec3 = [a[0] + perp[0], a[1] + perp[1], a[2]];
  const apexBack: Vec3 = [a[0] - perp[0], a[1] - perp[1], a[2]];
  return [
    { vertices: [a, b, apexFront], color },
    { vertices: [a, b, apexBack], color: "#000000" },
  ];
}

function cellAt(output: string, col: number, row: number): string {
  const lines = output.split("\n");
  return lines[row]![col]!;
}

describe("rasterize — ink equal-rank conflict resolves by depth, not draw order", () => {
  it("a nearer silhouette edge wins its contested cell over a farther one drawn LAST", () => {
    // Both edges share the same screen-space (x, y) run (y = 10, x from 10
    // to 20) so every sample cell they touch is contested — only world `z`
    // differs. `near` (z = 10, larger = nearer) is listed FIRST; `far`
    // (z = -10) is listed LAST, so under the old draw-order rule `far`
    // overwrites `near`'s cells since it rasterizes after it.
    const near = silhouetteEdge([10, 10, 10], [20, 10, 10], [0, -3, 0], "#ff0000");
    const far = silhouetteEdge([10, 10, -10], [20, 10, -10], [0, -3, 0], "#0000ff");
    const polygons = [...near, ...far];

    const withHelper = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 1.0 },
      polygons,
      mode: "ink",
      useColors: true,
    });

    // Plain (uncolored) render to read the character grid directly (colored
    // output wraps runs in spans) — confirm a stroke is actually drawn.
    const plainCtx = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 1.0 },
      polygons,
      mode: "ink",
      useColors: false,
    });
    const plain = rasterize(plainCtx);
    const midCell = cellAt(plain, 15, 10);
    expect(midCell).not.toBe(" ");

    // Colored output: the contested cell must carry the NEARER edge's color
    // (`#ff0000`), never the farther one's (`#0000ff`), regardless of which
    // was drawn last.
    const colored = rasterize(withHelper);
    expect(colored).toContain("#ff0000");
    expect(colored).not.toContain("#0000ff");
  });

  it("swapping draw order (far first, near last) still resolves to the nearer edge", () => {
    // Same geometry, reversed polygon order — proves the winner is
    // determined by depth, not by "whichever happens to be listed first".
    const near = silhouetteEdge([10, 10, 10], [20, 10, 10], [0, -3, 0], "#ff0000");
    const far = silhouetteEdge([10, 10, -10], [20, 10, -10], [0, -3, 0], "#0000ff");
    const polygons = [...far, ...near];

    const ctx = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 1.0 },
      polygons,
      mode: "ink",
      useColors: true,
    });
    const colored = rasterize(ctx);
    expect(colored).toContain("#ff0000");
    expect(colored).not.toContain("#0000ff");
  });
});
