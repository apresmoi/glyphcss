/**
 * Per-group occlusion-claim DILATION (`computeOcclusionIds` group
 * `occlusionDilate`): a group's claim grows by N id-map cells so fine artwork
 * keeps a small clean ground, converting ONLY base-layer (first group) or
 * unclaimed cells — never another detail group's. Deleting the dilation pass
 * turns the ring expectations red; deleting its never-steal guard turns the
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

describe("computeOcclusionIds occlusionDilate", () => {
  it("dilate grows a detail group's claim into base-owned cells, one ring per step", () => {
    const run = (dilate: number) => counts(computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },                                   // base, full screen, farther
        { polygons: [quad(1, -0.25, 0.25, -0.25, 0.25)], id: 7, occlusionDilate: dilate }, // small nearer quad
      ],
      camera(), COLS, ROWS, 2,
    ));
    const none = run(0).get(7) ?? 0;
    const one = run(1).get(7) ?? 0;
    const two = run(2).get(7) ?? 0;
    expect(none).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(none);                                    // ring added
    expect(two).toBeGreaterThan(one);                                     // grows per step
  });

  it("a dilated claim never steals from another detail group", () => {
    // Two abutting nearer quads over the base; the left dilates aggressively.
    const ids = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },
        { polygons: [quad(1, -0.5, 0, -0.5, 0.5)], id: 7, occlusionDilate: 4 },
        { polygons: [quad(1, 0, 0.5, -0.5, 0.5)], id: 9 },
      ],
      camera(), COLS, ROWS, 2,
    );
    const withoutDilate = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },
        { polygons: [quad(1, -0.5, 0, -0.5, 0.5)], id: 7 },
        { polygons: [quad(1, 0, 0.5, -0.5, 0.5)], id: 9 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(counts(ids).get(9)).toBe(counts(withoutDilate).get(9));        // 9's claim untouched
    expect(counts(ids).get(7)!).toBeGreaterThan(counts(withoutDilate).get(7)!);
  });

  it("omitted / zero dilate keeps the claim byte-identical", () => {
    const a = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 0 }, { polygons: [quad(1, -0.25, 0.25)], id: 7 }],
      camera(), COLS, ROWS, 2,
    );
    const b = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 0 }, { polygons: [quad(1, -0.25, 0.25)], id: 7, occlusionDilate: 0 }],
      camera(), COLS, ROWS, 2,
    );
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  // The map is rastered at the scene's SUPERSAMPLE, so a fixed pass count
  // grows one SUBCELL per pass — the same `occlusionDilate` would buy half
  // the margin the moment a scene turns supersampling on.
  it("the dilation unit is an OUTPUT cell at every supersample", () => {
    /** Claim bbox of `id`, measured in OUTPUT cells. */
    const spanOf = (dilate: number, ss: number): { cols: number; rows: number } => {
      const cols = COLS * ss;
      const ids = computeOcclusionIds(
        [
          { polygons: [quad(0)], id: 0 },
          { polygons: [quad(1, -0.25, 0.25, -0.25, 0.25)], id: 7, occlusionDilate: dilate },
        ],
        camera(), COLS, ROWS, 2, ss,
      );
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== 7) continue;
        const r = (i / cols) | 0, c = i - r * cols;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
      return { cols: (maxC - minC + 1) / ss, rows: (maxR - minR + 1) / ss };
    };

    for (const dilate of [1, 2, 3]) {
      const growth1 = spanOf(dilate, 1);
      const base1 = spanOf(0, 1);
      const growth2 = spanOf(dilate, 2);
      const base2 = spanOf(0, 2);
      expect(growth1.cols - base1.cols).toBe(dilate * 2);
      expect(growth1.rows - base1.rows).toBe(dilate * 2);
      expect(growth2.cols - base2.cols).toBe(dilate * 2);
      expect(growth2.rows - base2.rows).toBe(dilate * 2);
    }
  });
});

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
