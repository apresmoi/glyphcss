/**
 * Per-group COVERAGE-AWARE occlusion claims (`computeOcclusionIds` group
 * `occlusionContourPx`): the id-map re-rasters at 4x per axis so a claim
 * follows the artwork's real ink instead of a point sample, and the option's
 * value is an elliptical margin in SCREEN PX stamped around that ink before
 * the fine map reduces back to output resolution. Deleting the margin stamp
 * turns the growth expectations red; deleting its never-steal guard turns the
 * neighbour expectation red.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { computeOcclusionIds } from "./rasterize";

const COLS = 32;
const ROWS = 24;

function quad(z: number, x0 = -1, x1 = 1, y0 = -1, y1 = 1): Polygon {
  return {
    vertices: [[x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]],
    color: "#ffffff",
  };
}

const camera = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 });

/** Owner counts per id over the whole map. */
function counts(ids: Int32Array): Map<number, number> {
  const m = new Map<number, number>();
  for (const v of ids) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

describe("computeOcclusionIds occlusionContourPx", () => {
  it("contour claims are coverage-aware and a px margin grows them contour-wise", () => {
    // A small nearer quad over the base; with contour claims its owned-cell
    // count must be >= the point-sampled claim (coverage never loses cells),
    // and a px margin must add more.
    const mk = (contour?: number) => counts(computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },
        { polygons: [quad(1, -0.25, 0.25, -0.25, 0.25)], id: 7, ...(contour !== undefined ? { occlusionContourPx: contour } : {}) },
      ],
      camera(), COLS, ROWS, 2, 1,
      { cellWidth: 8, cellHeight: 16, centerCol: COLS / 2, centerRow: ROWS / 2 } as never,
    ));
    const point = mk().get(7) ?? 0;
    const tight = mk(0).get(7) ?? 0;
    const margin = mk(12).get(7) ?? 0;
    expect(tight).toBeGreaterThanOrEqual(point);            // coverage ⊇ point sample
    expect(margin).toBeGreaterThan(tight);                  // margin grows the claim
  });

  // The whole-output-cell claim margin `occlusionContourPx` has to be able to
  // express on its own: a small clean ground around fine artwork. A px margin
  // is an isotropic SCREEN reach, so on an 8x16 cell one cell-height of margin
  // buys one output row and two output cols — visually uniform, unlike a
  // cell-counted 8-neighbourhood grow, which is twice as tall as it is wide.
  it("a px margin reaches whole output cells of clean ground on every side", () => {
    const CW = 8, CH = 16;
    const spanOf = (px: number | undefined, ss: number) => {
      const ids = computeOcclusionIds(
        [
          { polygons: [quad(0)], id: 0 },
          { polygons: [quad(1, -0.25, 0.25, -0.25, 0.25)], id: 7, ...(px !== undefined ? { occlusionContourPx: px } : {}) },
        ],
        camera(), COLS, ROWS, 2, ss,
        { cols: COLS, rows: ROWS, cellAspect: 2, cellWidth: CW, cellHeight: CH } as never,
      );
      const cols = COLS * ss;
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== 7) continue;
        const r = (i / cols) | 0, c = i - r * cols;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
      return { cols: (maxC - minC + 1) / ss, rows: (maxR - minR + 1) / ss };
    };

    for (const ss of [1, 2]) {
      const tight = spanOf(0, ss);
      const one = spanOf(CH, ss);
      const two = spanOf(2 * CH, ss);
      expect(one.rows - tight.rows).toBeGreaterThanOrEqual(2);   // a full output cell each side
      expect(one.cols - tight.cols).toBeGreaterThanOrEqual(2);
      expect(two.rows).toBeGreaterThan(one.rows);                // and it keeps growing
      expect(two.cols).toBeGreaterThan(one.cols);
    }
  });

  it("the reduced map keeps output resolution and other groups' claims", () => {
    const base = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 0 }, { polygons: [quad(1, 0, 0.5)], id: 9 }],
      camera(), COLS, ROWS, 2,
    );
    const withContour = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },
        { polygons: [quad(1, 0, 0.5)], id: 9 },
        { polygons: [quad(1, -0.5, -0.25)], id: 7, occlusionContourPx: 0 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(withContour.length).toBe(base.length);           // output resolution kept
    expect(counts(withContour).get(9)).toBe(counts(base).get(9)); // 9 untouched
  });
});
