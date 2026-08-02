import { describe, it, expect } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { Polygon, Vec3 } from "@glyphcss/core";

/**
 * Regression coverage for the IDENTITY-based `hiddenLines: "hide"` design in
 * `mode: "ink"` (see the doc comment above `buildInkOcclusionMap` in
 * `rasterize.ts`, and `research/contour-first-text/decisions.md`'s
 * 2026-08-02 entries for the two ruled-out margin-based attempts this
 * replaces). `rasterize.ink.hiddenlines.test.ts` already covers the public
 * option's basic show/hide contract against an UNRELATED huge occluder; this
 * file adds the case that motivated the identity redesign specifically: a
 * DIFFERENT, nearby triangle that shares a vertex with a kept silhouette edge
 * (the same situation a densely tessellated convex mesh's own silhouette
 * creates) must NOT hide that edge, while a triangle with no shared vertex —
 * a genuinely separate surface — still does.
 *
 * Same passthrough-camera pattern as the sibling ink HLR test files, so
 * world-space `z` IS the camera-space depth the occlusion test consults.
 */
function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

const COLS = 30;
const ROWS = 20;

/** A single kept silhouette edge from `a` to `b` (one front-facing triangle,
 * one back-facing triangle sharing the same two edge vertices) — see
 * `rasterize.ink.hiddenlines.test.ts` for the identical helper. */
function silhouetteEdge(a: Vec3, b: Vec3, perp: [number, number, number]): Polygon[] {
  const apexFront: Vec3 = [a[0] + perp[0], a[1] + perp[1], a[2] + perp[2] + 1];
  const apexBack: Vec3 = [a[0] - perp[0], a[1] - perp[1], a[2] - perp[2] - 1];
  return [
    { vertices: [a, b, apexFront], color: "#ff0000" },
    { vertices: [a, b, apexBack], color: "#00ff00" },
  ];
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

describe("rasterize — ink hiddenLines identity exemption", () => {
  it("a nearer triangle SHARING one of the edge's own vertices does not hide the edge", () => {
    const A: Vec3 = [10, 10, 0];
    const B: Vec3 = [15, 10, 0];
    const edge = silhouetteEdge(A, B, [0, -3, 0]);
    // A separate triangle whose FIRST vertex is literally `B` (same array
    // values, so `inkVertexKey` matches it into the edge's vertex ring), with
    // its other two vertices placed so its screen footprint covers the
    // mid-edge cell (12, 10) at z=3 — strictly nearer than the edge's own
    // z=0. Simulates a neighboring facet on a curved surface: NOT one of the
    // edge's 2 literal adjacent faces, but touching one of its endpoints.
    const neighbor: Polygon = { vertices: [B, [9, 9, 3], [9, 11, 3]], color: "#0000ff" };
    const polys = [...edge, neighbor];

    const shown = inkRasterize(polys, "show");
    const hidden = inkRasterize(polys, "hide");
    expect(["‾", "-", "_"]).toContain(cellAt(shown, 12, 10));
    // The neighbor is nearer at (12, 10) in raw depth terms, but it shares a
    // vertex with this edge, so it must NOT occlude it.
    expect(cellAt(hidden, 12, 10)).toBe(cellAt(shown, 12, 10));
    expect(hidden).toBe(shown);
  });

  it("a nearer triangle sharing NO vertex with the edge hides it at the cells it covers", () => {
    const A: Vec3 = [10, 10, 0];
    const B: Vec3 = [15, 10, 0];
    const edge = silhouetteEdge(A, B, [0, -3, 0]);
    // A genuinely separate surface (no shared vertex) — huge and FLAT well
    // past the edge's own geometry on every side, so the local depth
    // gradient at the tested cell is 0 (no nearby boundary with a DIFFERENT
    // surface to inflate the gradient-scaled allowance) and only the real,
    // large depth gap (3 vs 0) is being tested.
    const foreignOccluder: Polygon = {
      vertices: [
        [-1000, -1000, 3],
        [1000, -1000, 3],
        [1000, 1000, 3],
        [-1000, 1000, 3],
      ],
      color: "#0000ff",
    } as unknown as Polygon;
    const polys = [...edge, foreignOccluder];

    const shown = inkRasterize(polys, "show");
    const hidden = inkRasterize(polys, "hide");
    expect(["‾", "-", "_"]).toContain(cellAt(shown, 12, 10));
    // No shared vertex and a real depth gap (3 vs 0, far past the local
    // gradient allowance on a flat occluder) — this cell must be hidden.
    expect(cellAt(hidden, 12, 10)).toBe(" ");
    expect(hidden).not.toBe(shown);
  });
});
