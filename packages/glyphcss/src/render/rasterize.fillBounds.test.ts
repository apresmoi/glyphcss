/**
 * `fillDepthTri`'s sample bounds — the id-map / surface-depth rasterizer's.
 *
 * It samples at INTEGER `(x, y)`, so its bounding box is `ceil(min) ..
 * floor(max)` (the form `scanFillTriangle` has always used) and not `floor(min)
 * .. ceil(max)`: an integer outside the triangle's own bbox cannot be inside
 * the triangle, so the wider form only sampled it in order to reject it.
 *
 * Narrowing it that far is byte-identical and therefore invisible in output.
 * What is NOT invisible is narrowing it one step further, which silently loses
 * a column and a row off every claimed footprint — so what these clauses pin is
 * the INCLUSIVE boundary: a quad whose screen edge lands exactly on an integer
 * sample claims that sample, and a quad that falls strictly between two samples
 * claims neither.
 *
 * Expectations are derived from the camera's OWN projection of the quad rather
 * than from an assumed cell size, so the test states the rule instead of
 * restating an arithmetic accident.
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { computeOcclusionIds } from "./rasterize";

const COLS = 41;
const ROWS = 21;
const ASPECT = 2;

/** Straight down the Z axis, so the quad's screen box is axis-aligned. */
const camera = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 50 });

function claimedBox(ids: Int32Array, id: number): { minC: number; maxC: number; minR: number; maxR: number; n: number } {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity, n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (ids[r * COLS + c] !== id) continue;
      n++;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
  }
  return { minC, maxC, minR, maxR, n };
}

/** The quad's own projected screen box, in fractional cells. */
function screenBox(quad: Polygon): { x0: number; x1: number; y0: number; y1: number } {
  const cam = camera();
  const pts = quad.vertices.map((v) => cam.project(v as Vec3, COLS, ROWS, ASPECT));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * `colLo..colHi` is the axis that becomes screen COLUMNS and `rowLo..rowHi` the
 * one that becomes rows. The camera's axis swap puts `world[1]` on screen X and
 * `world[0]` on screen Y, so naming the arguments after the SCREEN axes keeps
 * each clause below about the thing it is testing.
 */
function quad(colLo: number, colHi: number, rowLo: number, rowHi: number): Polygon {
  return {
    vertices: [[rowLo, colLo, 0], [rowHi, colLo, 0], [rowHi, colHi, 0], [rowLo, colHi, 0]],
    color: "#ffffff",
  };
}

/** The smallest world step that moves the projection by exactly one column. */
function worldPerCol(): number {
  const cam = camera();
  const a = cam.project([0, 0, 0], COLS, ROWS, ASPECT)[0];
  const b = cam.project([0, 1, 0], COLS, ROWS, ASPECT)[0];
  return 1 / (b - a);
}

describe("fillDepthTri integer-sample bounds", () => {
  it("claims exactly the integer samples inside the projected box, boundary included", () => {
    const q = quad(-2, 2, -1, 1);
    const box = screenBox(q);
    const ids = computeOcclusionIds([{ polygons: [q], id: 3 }], camera(), COLS, ROWS, ASPECT);
    expect(claimedBox(ids, 3)).toEqual({
      minC: Math.max(0, Math.ceil(box.x0)),
      maxC: Math.min(COLS - 1, Math.floor(box.x1)),
      minR: Math.max(0, Math.ceil(box.y0)),
      maxR: Math.min(ROWS - 1, Math.floor(box.y1)),
      n: (Math.min(COLS - 1, Math.floor(box.x1)) - Math.max(0, Math.ceil(box.x0)) + 1)
        * (Math.min(ROWS - 1, Math.floor(box.y1)) - Math.max(0, Math.ceil(box.y0)) + 1),
    });
  });

  it("claims nothing when the footprint falls strictly between two samples", () => {
    // A sliver 0.4 of a COLUMN wide, placed between two integers: no integer
    // sample lies inside it, so the wide bounds only sampled it to reject it.
    const w = worldPerCol();
    const q = quad(0.7 * w, 0.9 * w, -1, 1);
    const box = screenBox(q);
    expect(Math.ceil(box.x0)).toBeGreaterThan(Math.floor(box.x1));   // the premise
    const ids = computeOcclusionIds([{ polygons: [q], id: 3 }], camera(), COLS, ROWS, ASPECT);
    expect(claimedBox(ids, 3).n).toBe(0);
  });

  it("a footprint that only just reaches one sample still claims that column", () => {
    const w = worldPerCol();
    const q = quad(0.2 * w, 1 * w, -1, 1);
    const box = screenBox(q);
    const only = Math.ceil(box.x0);
    expect(Math.floor(box.x1)).toBe(only);                            // the premise
    const ids = computeOcclusionIds([{ polygons: [q], id: 3 }], camera(), COLS, ROWS, ASPECT);
    const claimed = claimedBox(ids, 3);
    expect(claimed.minC).toBe(only);
    expect(claimed.maxC).toBe(only);
  });
});
