/**
 * `computeOcclusionIds` honours `Polygon.hidden`.
 *
 * `Polygon.hidden` is the consumer-driven cull: a polygon carrying it paints
 * nothing, casts nothing and receives nothing. Every other polygon loop in
 * `render/rasterize.ts` skips it — the solid paint loop, the wireframe loop,
 * the ink loop, both shadow passes. The cross-layer occlusion id-map was the
 * one that did not, and unlike the others its omission is not a wasted
 * projection but a WRONG ANSWER: the map's cells are claims, and a claim by a
 * polygon that paints nothing blanks every other layer at a cell where its
 * own layer then shows sky.
 *
 * ## The statement being pinned
 *
 * Honouring `hidden` here is exactly equivalence with REMOVAL — the id-map of
 * a scene whose culled polygons carry the flag is cell-for-cell the id-map of
 * the same scene with those polygons deleted. That is what `hidden` means
 * everywhere else in the renderer, and it is what makes the rendered
 * difference justifiable rather than merely different: the new output is the
 * output of the scene the consumer's cull describes.
 *
 * ## Mutation check
 *
 * Delete `|| poly.hidden` from `computeOcclusionIds`' polygon loop and the
 * first two clauses here go red (64 claimed instead of 0, and the removal
 * equivalence breaks on every pose).
 */
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import { buildGlyphPolygonCullChunks } from "../api/rasterizeContext";
import { computeOcclusionIds } from "./rasterize";

const COLS = 8;
const ROWS = 8;
const ASPECT = 2;

const ortho = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 50 });

/** A quad in the X/Y plane at depth `z`, spanning the whole 8x8 map. */
function plate(z: number, hidden = false): Polygon {
  return {
    vertices: [[-4, -4, z], [4, -4, z], [4, 4, z], [-4, 4, z]],
    color: "#ffffff",
    ...(hidden ? { hidden: true } : {}),
  };
}

const count = (ids: Int32Array, id: number): number => {
  let n = 0;
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) n++;
  return n;
};

describe("computeOcclusionIds and Polygon.hidden", () => {
  it("a hidden polygon claims nothing, and the layer behind it claims what it used to", () => {
    const detail = plate(-1);
    const shown = computeOcclusionIds([{ polygons: [plate(1)], id: 0 }, { polygons: [detail], id: 7 }], ortho(), COLS, ROWS, ASPECT);
    // The control: a VISIBLE near plate legitimately owns every cell.
    expect(count(shown, 0)).toBe(COLS * ROWS);
    expect(count(shown, 7)).toBe(0);

    const culled = computeOcclusionIds([{ polygons: [plate(1, true)], id: 0 }, { polygons: [detail], id: 7 }], ortho(), COLS, ROWS, ASPECT);
    expect(count(culled, 0)).toBe(0);
    expect(count(culled, 7)).toBe(COLS * ROWS);
  });

  it("is cell-for-cell the id-map of the same scene with the culled polygons deleted", () => {
    // A street-level block: walls + caps under a positioned perspective
    // camera standing inside the geometry, so the near-plane clip, the
    // depth fork and the back-face verdict are all live. 85% hidden is the
    // ratio `@glyphcss/maps`' walk-mode wall cull produces.
    let n = 0;
    const polys: Polygon[] = [];
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      if (x === 0 && y === 0) continue;
      const cx = x * 9, cy = y * 9, w = 3, h = 3 + ((x * 7 + y * 5 + 40) % 9);
      const c: Vec3[] = [[cx - w, cy - w, 0], [cx + w, cy - w, 0], [cx + w, cy + w, 0], [cx - w, cy + w, 0]];
      for (let e = 0; e < 4; e++) {
        const a = c[e]!, b = c[(e + 1) % 4]!;
        polys.push({ vertices: [a, b, [b[0], b[1], h], [a[0], a[1], h]], color: "#8d8478", ...((n++ % 20) >= 3 ? { hidden: true } : {}) });
      }
      polys.push({ vertices: c.map((v) => [v[0], v[1], h] as Vec3), color: "#8d8478", ...((n++ % 20) >= 3 ? { hidden: true } : {}) });
    }
    const kept = polys.filter((p) => !p.hidden);
    expect(kept.length / polys.length).toBeLessThan(0.2);
    const road: Polygon[] = [{ vertices: [[-7, -30, 0.02], [7, -30, 0.02], [7, 30, 0.02], [-7, 30, 0.02]], color: "#c8c2a8" }];
    const ground: Polygon[] = [{ vertices: [[-40, -40, 0], [40, -40, 0], [40, 40, 0], [-40, 40, 0]], color: "#3d3d42" }];

    const poses = [
      () => createGlyphPerspectiveCamera({ rotX: 86, rotY: 0, zoom: 30, position: [0, -18, 2.2] }),
      () => createGlyphPerspectiveCamera({ rotX: 74, rotY: 24, zoom: 30, position: [-6, -20, 3.5] }),
      () => createGlyphOrthographicCamera({ rotX: 60, rotY: 30, zoom: 8 }),
    ];
    for (const pose of poses) {
      const cam = pose();
      const withFlags = computeOcclusionIds(
        [{ polygons: [...ground, ...polys], id: 0 }, { polygons: road, id: 3 }], cam, 96, 40, ASPECT, 1, undefined, null, null, false);
      const removed = computeOcclusionIds(
        [{ polygons: [...ground, ...kept], id: 0 }, { polygons: road, id: 3 }], cam, 96, 40, ASPECT, 1, undefined, null, null, false);
      expect(Array.from(withFlags)).toEqual(Array.from(removed));
      // The pose is worth measuring: the cull really does hand cells over.
      expect(count(withFlags, 3)).toBeGreaterThan(0);
    }
  });

  it("skips the hidden polygon whether or not its run survives the cull", () => {
    // The `hidden` skip and the run cull are independent gates on the same
    // loop: a hidden polygon inside a run that is NOT culled must still be
    // skipped, which is what this asserts by giving the run a box the camera
    // cannot reject.
    const near = plate(1, true);
    const chunks = buildGlyphPolygonCullChunks([near]);
    const ids = computeOcclusionIds(
      [{ polygons: [near], id: 0, cullChunks: chunks ?? undefined }, { polygons: [plate(-1)], id: 7 }],
      ortho(), COLS, ROWS, ASPECT);
    expect(count(ids, 0)).toBe(0);
    expect(count(ids, 7)).toBe(COLS * ROWS);
  });
});
