import { describe, it, expect, vi } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { WireframeEdge } from "@glyphcss/core";

/**
 * COLOR-TOLERANCE.md Phase 3 — public-surface wiring for `colorTolerance`.
 *
 * Phases 1/2 (commits 06a2462..55121dc) built the mechanism (`colorRunExtends`
 * in `render/cells.ts`, shared by `encodeGlyphBuffers`, `encodeGlyphBuffersDual`,
 * and `solidBufToString`'s unsafe branch) but no caller passed a non-zero
 * value — there was no scene option yet. This file proves the option actually
 * REACHES the render, using a fake identity camera (`project(v) => [v[0],
 * v[1], 0]`, the same pattern `rasterize.junctions.test.ts` uses) so every
 * edge lands on an exact integer cell — this test is about option plumbing,
 * not camera projection.
 *
 * It also pins the fix to a coverage gap this phase found: `rasterize()`'s
 * plain `charMode: "ascii"` wireframe/voxel no-hook path calls a SEPARATE
 * duplicated run-coalescer (`stampToGlyphs`) that COLOR-TOLERANCE.md's
 * review (Finding 5) never accounted for — only `solidBufToString`'s unsafe
 * branch was fixed. Without threading `colorTolerance` into `stampToGlyphs`
 * too, the single most common render path (default wireframe, no hook) would
 * silently ignore the option entirely.
 */
function identityCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], 0, 1],
  } as unknown as GlyphCamera;
}

const COLS = 12;
const ROWS = 3;

// Two horizontal edges on row 1, contiguous (cols 0-4 and 5-9), each a solid
// run of ONE color. #802020 -> #822020 is a redmean distance of ~3.16 (dr=2,
// rm=129: d2 = (2 + 129/256) * 4 ≈ 10.02, d ≈ 3.16) — small enough that a
// tolerance far below the metric's 0..765 range merges them, but the two
// strings are never `===`, so tolerance:0 must NOT merge them.
function nearColorEdges(): WireframeEdge[] {
  return [
    { from: [0, 1, 0], to: [4, 1, 0], color: "#802020" },
    { from: [5, 1, 0], to: [9, 1, 0], color: "#822020" },
  ];
}

function countSpans(html: string): number {
  return (html.match(/<span/g) ?? []).length;
}

function renderWithTolerance(colorTolerance?: number): string {
  const ctx = buildRasterizeContext({
    camera: identityCamera(),
    grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
    wireframe: nearColorEdges(),
    mode: "wireframe",
    useColors: true,
    colorTolerance,
  });
  return rasterize(ctx);
}

describe("rasterize — colorTolerance (COLOR-TOLERANCE.md Phase 3 wiring)", () => {
  it("default (colorTolerance omitted) keeps two distinct-color runs as two spans", () => {
    expect(countSpans(renderWithTolerance(undefined))).toBe(2);
  });

  it("colorTolerance: 0 is byte-identical to omitting the option", () => {
    // Wireframe glyph selection within a weight tier is `Math.random()`-driven
    // (unrelated to colorTolerance) — pin it so this is a genuine byte
    // comparison, not a flaky one.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(renderWithTolerance(0)).toBe(renderWithTolerance(undefined));
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("a tolerance above the pair's redmean distance merges the two runs into one span", () => {
    const merged = renderWithTolerance(20);
    expect(countSpans(merged)).toBe(1);
    // Merged cells are emitted at the RUN'S ANCHOR color (the first edge's),
    // not a blended color — the documented run-extension substitution.
    expect(merged).toContain("#802020");
    expect(merged).not.toContain("#822020");
  });

  it("a tolerance below the pair's redmean distance does not merge (still two spans)", () => {
    expect(countSpans(renderWithTolerance(1))).toBe(2);
  });

  it("NaN degrades to off (two spans, same as tolerance: 0)", () => {
    expect(countSpans(renderWithTolerance(NaN))).toBe(2);
  });

  it("a negative tolerance degrades to off (two spans)", () => {
    expect(countSpans(renderWithTolerance(-5))).toBe(2);
  });

  it("+Infinity merges unconditionally (one span)", () => {
    expect(countSpans(renderWithTolerance(Infinity))).toBe(1);
  });

  it("solid mode also honors colorTolerance (encodeGlyphBuffers / solidBufToString unsafe-branch call site)", () => {
    // Two adjacent single-triangle "cells" with near colors, flat shaded
    // (no lighting variation — the fixed vertex colors alone drive the
    // redmean distance), read through the identity camera exactly like the
    // wireframe fixture above. `charMode` is left at its "ascii" default (no
    // `solidWeightRamp`, no `transformCells` hook), so this exercises
    // `rasterize.ts`'s unsafe `solidBufToString` coalescer (rasterize.ts's
    // `finalWeight ? encodeGlyphBuffers(...) : solidBufToString(...)` branch)
    // — NOT the halfblock/quadrant call sites, despite this test's former
    // name claiming otherwise. See the two tests below for those.
    const polygons = [
      { vertices: [[0, 0, 0], [4, 0, 0], [4, 2, 0]] as [number, number, number][], color: "#802020" },
      { vertices: [[5, 0, 0], [9, 0, 0], [9, 2, 0]] as [number, number, number][], color: "#822020" },
    ];
    const ctxOff = buildRasterizeContext({
      camera: identityCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      polygons,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorTolerance: 0,
    });
    const ctxOn = buildRasterizeContext({
      camera: identityCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      polygons,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorTolerance: 20,
    });
    const off = rasterize(ctxOff);
    const on = rasterize(ctxOn);
    expect(countSpans(on)).toBeLessThan(countSpans(off));
  });

  // Two adjacent (touching at world x=3, no gap — a blank cell forces
  // nextColor = null, which unconditionally breaks a run regardless of
  // tolerance, so touching rectangles are required to exercise merging),
  // full-height (0..ROWS) near-color rectangles, each built from two
  // triangles so every subcell — top AND bottom for halfblock, all four
  // quadrants for quadrant — is uniformly covered by ONE color. The x=3
  // boundary is chosen (not the more "obvious" 4/5, verified empirically
  // against the real rasterizer) so it falls exactly on an output-cell
  // boundary at this grid's supersample resolution: any boundary that lands
  // MID-cell instead produces a genuine third two-tone boundary cell (its
  // own `background-color` alongside `color`) that structurally can never
  // merge with a plain single-color neighbor regardless of tolerance —
  // `colorRunExtends(null, nonNullColor)` is false unconditionally, by
  // design (a cell with no background is categorically distinct from one
  // with a background, not just "far" in redmean distance) — which would
  // make this test fail even with correct wiring. Landing on a clean
  // cell boundary avoids that structural case entirely, so every covered
  // cell resolves to the cheapest-markup same-color "█" glyph and the only
  // thing under test is whether `colorTolerance` reaches
  // `encodeGlyphBuffersDual` through `encodeHalfblockSolid`/
  // `encodeQuadrantSolid` (rasterize.ts:1883/:1893).
  function nearColorRects(): { vertices: [number, number, number][]; color: string }[] {
    // Y spans well past the grid's ROWS so every row is fully covered
    // regardless of any cellAspect/metrics scaling between world Y and
    // output row (verified empirically — 0..ROWS under-covers the last row).
    const Y0 = -50, Y1 = 50;
    return [
      { vertices: [[0, Y0, 0], [3, Y0, 0], [3, Y1, 0]], color: "#802020" },
      { vertices: [[0, Y0, 0], [3, Y1, 0], [0, Y1, 0]], color: "#802020" },
      { vertices: [[3, Y0, 0], [8, Y0, 0], [8, Y1, 0]], color: "#822020" },
      { vertices: [[3, Y0, 0], [8, Y1, 0], [3, Y1, 0]], color: "#822020" },
    ];
  }

  function renderCharModeWithTolerance(charMode: "halfblock" | "quadrant", colorTolerance: number): string {
    const ctx = buildRasterizeContext({
      camera: identityCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      polygons: nearColorRects(),
      mode: "solid",
      charMode,
      doubleSided: true,
      useColors: true,
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
      colorTolerance,
    });
    return rasterize(ctx);
  }

  it("charMode: halfblock honors colorTolerance (encodeHalfblockSolid call site, rasterize.ts:1883)", () => {
    const off = renderCharModeWithTolerance("halfblock", 0);
    const on = renderCharModeWithTolerance("halfblock", 20);
    // Under the mutation this test was written to catch — dropping
    // `scene.colorTolerance` from the `encodeHalfblockSolid` call — `on`
    // would be byte-identical to `off` (both effectively tolerance 0) and
    // this assertion fails.
    expect(countSpans(on)).toBeLessThan(countSpans(off));
    expect(countSpans(off)).toBe(ROWS * 2); // two distinct-color runs per row
    expect(countSpans(on)).toBe(ROWS); // merged into one run per row
  });

  it("charMode: quadrant honors colorTolerance (encodeQuadrantSolid call site, rasterize.ts:1893)", () => {
    const off = renderCharModeWithTolerance("quadrant", 0);
    const on = renderCharModeWithTolerance("quadrant", 20);
    // Under the mutation this test was written to catch — dropping
    // `scene.colorTolerance` from the `encodeQuadrantSolid` call — `on`
    // would be byte-identical to `off` and this assertion fails.
    expect(countSpans(on)).toBeLessThan(countSpans(off));
    expect(countSpans(off)).toBe(ROWS * 2);
    expect(countSpans(on)).toBe(ROWS);
  });
});
