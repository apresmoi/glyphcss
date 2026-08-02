import { describe, it, expect } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { extrudeContours, groupShapes, type Pt } from "./extrude";

/**
 * Real TrueType data for Fontsource's Roboto 700 (`latin-700-normal.ttf`, the
 * font `loadGoogleFont` fetches for the website's WordArt page), glyph "h",
 * flattened at curveSteps=4 — the exact shape that used to break `ink` mode
 * ("the right side lines of the h ... blink out as the camera rotates").
 * The bundled `test/fixtures/Roboto-Bold.ttf` glyph "h" is a single simple
 * contour and does NOT reproduce this bug (verified while diagnosing it), so
 * this fixture is a real, hand-captured production case, not a guess: the
 * font draws the letter as TWO separate simple contours — a stem rectangle
 * and an arch+leg — that overlap without either nesting inside the other
 * (a nonzero-winding-rule construction). `groupShapes` used to test only a
 * single probe point for containment, and that stem/arch overlap put a probe
 * point of one inside the other by coincidence, misclassifying the arch as a
 * "hole" of the stem even though it isn't contained by it. earcut then
 * triangulated a hole poking outside its outer boundary, producing a cap
 * whose edges didn't match the (correctly built) extrusion walls: a
 * non-watertight mesh with dozens of boundary (degree-1) edges whose
 * visibility flickers as the camera rotates in `ink` mode.
 */
const H_STEM: Pt[] = [
  [393, 1536],
  [393, 0],
  [105, 0],
  [105, 1536],
];
const H_ARCH: Pt[] = [
  [352, 579], [273, 579], [275.25, 634.40625], [281, 687.625], [290.25, 738.65625],
  [303, 787.5], [319.0625, 833.6875], [338.25, 876.75], [360.5625, 916.6875],
  [386, 953.5], [414.34375, 986.78125], [445.375, 1016.125], [479.09375, 1041.53125],
  [515.5, 1063], [554.28125, 1080.0625], [595.125, 1092.25], [638.03125, 1099.5625],
  [683, 1102], [722.09375, 1100.59375], [759.375, 1096.375], [794.84375, 1089.34375],
  [828.5, 1079.5], [860.125, 1066.5625], [889.5, 1050.25], [916.625, 1030.5625],
  [941.5, 1007.5], [963.90625, 980.84375], [983.625, 950.375], [1000.65625, 916.09375],
  [1015, 878], [1026.375, 835.875], [1034.5, 789.5], [1039.375, 738.875], [1041, 684],
  [1041, 0], [751, 0], [751, 686], [749.71875, 720.09375], [745.875, 750.375],
  [739.46875, 776.84375], [730.5, 799.5], [719.125, 818.75], [705.5, 835],
  [689.625, 848.25], [671.5, 858.5], [651.15625, 866.15625], [628.625, 871.625],
  [603.90625, 874.90625], [577, 876], [547.15625, 874.5625], [519.625, 870.25],
  [494.40625, 863.0625], [471.5, 853], [450.84375, 840.40625], [432.375, 825.625],
  [416.09375, 808.65625], [402, 789.5], [389.875, 768.40625], [379.5, 745.625],
  [370.875, 721.15625], [364, 695], [358.75, 667.5], [355, 639], [352.75, 609.5],
];

/** A genuinely nested outer+hole pair (like "o"), as a not-broken control case. */
const RING_OUTER: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
const RING_HOLE: Pt[] = [[20, 20], [20, 80], [80, 80], [80, 20]];

describe("groupShapes", () => {
  it("keeps overlapping non-nested contours (stem + arch) as separate outers, not a false hole", () => {
    const shapes = groupShapes([H_STEM, H_ARCH]);
    expect(shapes).toHaveLength(2);
    for (const shape of shapes) expect(shape.holes).toHaveLength(0);
    const lens = shapes.map((s) => s.outer.length).sort((a, b) => a - b);
    expect(lens).toEqual([4, 64]);
  });

  it("still nests a genuinely contained hole (unrelated to the overlap fix)", () => {
    const shapes = groupShapes([RING_OUTER, RING_HOLE]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].outer).toHaveLength(4);
    expect(shapes[0].holes).toHaveLength(1);
  });

  it("still routes fully-mutual overlap (every contour nested in another) through the union fallback", () => {
    // Three squares, each shifted so its own probe point sits inside the
    // next, cyclically — none properly contains any other by area, but a
    // single-point test alone would find each "inside" something. This is
    // the pre-existing depth-all-odd escape hatch; the crossing check must
    // not regress it.
    const a: Pt[] = [[0, 0], [60, 0], [60, 60], [0, 60]];
    const b: Pt[] = [[30, 30], [90, 30], [90, 90], [30, 90]];
    const c: Pt[] = [[15, 45], [75, 45], [75, 105], [15, 105]];
    const shapes = groupShapes([a, b, c]);
    expect(shapes).toHaveLength(3);
    for (const shape of shapes) expect(shape.holes).toHaveLength(0);
  });
});

/** Every edge (as an undirected pair of exact-float vertex positions) must be
 * shared by exactly two polygon-boundary edges for the solid to be watertight
 * — the same shared-edge adjacency `ink` mode's rasteriser relies on. */
function edgeDegreeHistogram(polys: Polygon[]): Record<number, number> {
  const vertKey = (p: readonly number[]) => p.map((n) => n.toFixed(9)).join(",");
  const ids = new Map<string, number>();
  const idOf = (p: readonly number[]) => {
    const k = vertKey(p);
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    return id;
  };
  const counts = new Map<string, number>();
  for (const poly of polys) {
    const n = poly.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = idOf(poly.vertices[i]);
      const b = idOf(poly.vertices[(i + 1) % n]);
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const hist: Record<number, number> = {};
  for (const c of counts.values()) hist[c] = (hist[c] ?? 0) + 1;
  return hist;
}

describe("extrudeContours watertightness", () => {
  const shapes = groupShapes([H_STEM, H_ARCH]);

  it.each(["flat", "bevel"] as const)("is watertight (every edge degree 2) for profile=%s", (profile) => {
    const polys = extrudeContours(shapes, {
      depth: 80,
      profile,
      profileSegments: 3,
      maxInset: 100 * 0.045,
      stops: [{ at: 0.5 }],
    });
    const hist = edgeDegreeHistogram(polys);
    expect(Object.keys(hist).sort()).toEqual(["2"]);
  });

  it("the o-like nested ring (holes) also stays watertight in both profiles", () => {
    const ringShapes = groupShapes([RING_OUTER, RING_HOLE]);
    for (const profile of ["flat", "bevel"] as const) {
      const polys = extrudeContours(ringShapes, {
        depth: 30,
        profile,
        profileSegments: 3,
        maxInset: 100 * 0.045,
        stops: [{ at: 0.5 }],
      });
      const hist = edgeDegreeHistogram(polys);
      expect(Object.keys(hist).sort()).toEqual(["2"]);
    }
  });
});
