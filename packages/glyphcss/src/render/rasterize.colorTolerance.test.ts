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

  it("solid mode also honors colorTolerance (encodeGlyphBuffers / halfblock / quadrant call sites)", () => {
    // Two adjacent single-triangle "cells" with near colors, flat shaded
    // (no lighting variation — the fixed vertex colors alone drive the
    // redmean distance), read through the identity camera exactly like the
    // wireframe fixture above.
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
});
