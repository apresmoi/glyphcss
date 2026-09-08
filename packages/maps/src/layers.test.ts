import { describe, expect, it } from "vitest";
import { glyphMapDeclutterLabels, glyphMapLabelAnchorFraction, glyphMapPointHeatmap, glyphMapVectorPolygons, glyphMapWrapLabel, GLYPH_MAP_LABEL_WRAP_CELLS, GLYPH_MAP_LABEL_WRAP_MAX_LINES } from "./layers";
import { glyphMapEquirectangular } from "./projection";

describe("map layer primitives", () => {
  const points = [
    { geometryType: "point" as const, properties: { population: 3 }, rings: [[[0, 0] as const]] },
    { geometryType: "point" as const, properties: { population: 1 }, rings: [[[8, 0] as const]] },
  ];

  it("declutters overlapping symbols greedily by priority", () => {
    const kept = glyphMapDeclutterLabels([
      { id: "small", col: 5, row: 5, label: "Small", priority: 1 },
      { id: "capital", col: 5, row: 5, label: "Capital", priority: 10 },
      { id: "remote", col: 30, row: 5, label: "Remote", priority: 0 },
    ]);
    expect(kept.map((x) => x.id)).toEqual(["capital", "remote"]);
  });

  it("builds a weighted point-density field with a stronger population peak", () => {
    const field = glyphMapPointHeatmap(points, { west: -10, east: 10, south: -10, north: 10 }, 20, 10, 1, "population");
    expect(field.max).toBeGreaterThan(0);
    expect(field.values[5 * 20 + 10]).toBeGreaterThan(field.values[5 * 20 + 18]);
  });

  it("builds fill roofs and real extrusion walls from attributes", () => {
    const feature = { geometryType: "polygon" as const, properties: { height: 12 }, rings: [[[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]] as const] };
    const fill = glyphMapVectorPolygons([feature], glyphMapEquirectangular(), { color: () => "#123456" });
    const extrusion = glyphMapVectorPolygons([feature], glyphMapEquirectangular(), { height: (f) => Number(f.properties?.height) });
    // The cap is triangulated (see `glyphMapVectorPolygons`'s "Holes" note —
    // glyphcss's own n-gon fan is only correct for a convex ring), so a square
    // roof is 2 triangles and the extrusion is that plus 4 walls.
    expect(fill).toHaveLength(2);
    expect(fill.every((p) => p.vertices.length === 3)).toBe(true);
    expect(fill.every((p) => p.color === "#123456")).toBe(true);
    expect(extrusion).toHaveLength(6);
    expect(new Set(extrusion.flatMap((p) => p.vertices.map((v) => v[2]))).size).toBe(2);
  });
});

/**
 * The declutter box is what a wrapped label makes or breaks: it is narrower
 * and taller than the one-line strip, and an arbiter that kept reserving the
 * strip would make wrapping INCREASE collisions — freeing columns nothing
 * draws in while letting a neighbour land on the second line.
 *
 * Every case below is a pair, because either half alone passes for a
 * half-fix.
 */
describe("glyphMapDeclutterLabels — a wrapped label's box", () => {
  const long = "Region de Magallanes y de la Antartica Chilena";
  const lines = glyphMapWrapLabel(long);

  const arbitrate = (neighbourCol: number, neighbourRow: number, wrapped: boolean) =>
    glyphMapDeclutterLabels([
      { id: "long", col: 60, row: 20, label: long, priority: 9, ...(wrapped ? { lines } : {}) },
      { id: "neighbour", col: neighbourCol, row: neighbourRow, label: "Punta", priority: 1 },
    ]).map((c) => c.id);

  it("is TALLER: a neighbour one row down clears the one-line strip and is caught by the wrapped block", () => {
    expect(arbitrate(60, 21, false)).toEqual(["long", "neighbour"]);
    expect(arbitrate(60, 21, true)).toEqual(["long"]);
  });

  it("is NARROWER: a neighbour 15 columns out is caught by the one-line strip and clears the wrapped block", () => {
    expect(arbitrate(75, 20, false)).toEqual(["long"]);
    expect(arbitrate(75, 20, true)).toEqual(["long", "neighbour"]);
  });

  it("leaves a candidate with no `lines` on exactly the box it always had — the contour path's box", () => {
    // Half-widths 46/2 and 5/2 sum to 25.5: at 26 columns apart the boxes
    // clear and both are placed, at 25 they overlap and the neighbour goes.
    // Both numbers are the UNWRAPPED string's, so a default that quietly
    // wrapped — or that measured anything but `label.length` — moves them.
    expect(long).toHaveLength(46);
    expect(arbitrate(60 + 26, 20, false)).toEqual(["long", "neighbour"]);
    expect(arbitrate(60 + 25, 20, false)).toEqual(["long"]);
    // And one row apart is still clear, because the box is still one row tall.
    expect(arbitrate(60, 21, false)).toEqual(["long", "neighbour"]);
  });

  it("measures the LONGEST line, not the whole string, and one row per line", () => {
    // Read back off probes that straddle each edge of the box the arbiter
    // reserved. Widest line 18, neighbour 5: they clear at 12 columns and
    // overlap at 11. Three rows against one: they clear at 2 rows and
    // overlap at 1.
    expect(Math.max(...lines.map((l) => l.length))).toBe(18);
    expect(lines).toHaveLength(3);
    expect(arbitrate(60 + 12, 20, true)).toEqual(["long", "neighbour"]);
    expect(arbitrate(60 + 11, 20, true)).toEqual(["long"]);
    expect(arbitrate(60, 22, true)).toEqual(["long", "neighbour"]);
    expect(arbitrate(60, 21, true)).toEqual(["long"]);
  });
});

/**
 * The wrap rule itself. The RENDERED consequences are pinned in
 * `widget.symbolWrap.test.ts`; what is here is the boundary and the shape of
 * the partition, which have no other home.
 */
describe("glyphMapWrapLabel", () => {
  it("returns the original string, not a rejoined copy, at or under the wrap width", () => {
    const at = "Aaaaaaaa Bbbbbbbbbbb";
    expect(at).toHaveLength(GLYPH_MAP_LABEL_WRAP_CELLS);
    const out = glyphMapWrapLabel(at);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(at);
  });

  it("balances rather than filling greedily", () => {
    // Greedy at 20 cells: `Region de Magallanes` / `y de la Antartica` /
    // `Chilena` — a 7-cell stub. Minimum raggedness spends the slack evenly.
    expect(glyphMapWrapLabel("Region de Magallanes y de la Antartica Chilena"))
      .toEqual(["Region de", "Magallanes y de la", "Antartica Chilena"]);
  });

  it("stops at the line cap and lets the last lines run long rather than growing a paragraph", () => {
    const many = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const out = glyphMapWrapLabel(many);
    expect(out).toHaveLength(GLYPH_MAP_LABEL_WRAP_MAX_LINES);
    expect(Math.max(...out.map((l) => l.length))).toBeGreaterThan(GLYPH_MAP_LABEL_WRAP_CELLS);
    expect(out.join(" ")).toBe(many);
  });
});

/**
 * An ANCHORED label's box, in the arbiter itself.
 *
 * `Zurich` is 6 cells: centred on column 60 it reserves `[57, 63]`, anchored
 * `left` it reserves `[60, 66]`. Every case below is a pair — a neighbour
 * only the moved box reaches and one only the centred box reached — because
 * either alone passes for an arbiter that ignored the anchor entirely (it
 * would keep the first) or one that moved the box the wrong way.
 */
describe("glyphMapDeclutterLabels — an anchored label's box", () => {
  const arbitrate = (neighbourCol: number, neighbourRow: number, extra: Record<string, unknown>) =>
    glyphMapDeclutterLabels([
      { id: "label", col: 60, row: 20, label: "Zurich", priority: 9, ...extra },
      { id: "neighbour", col: neighbourCol, row: neighbourRow, label: "Nb", priority: 1 },
    ]).map((c) => c.id);

  it("moves the reserved columns with a left/right anchor, in both directions", () => {
    // Column 65 is inside `[60, 66]` and outside `[57, 63]`.
    expect(arbitrate(65, 20, {})).toEqual(["label", "neighbour"]);
    expect(arbitrate(65, 20, { anchor: "left" })).toEqual(["label"]);
    // Column 58 is the mirror: inside the centred box, outside the moved one.
    expect(arbitrate(58, 20, {})).toEqual(["label"]);
    expect(arbitrate(58, 20, { anchor: "left" })).toEqual(["label", "neighbour"]);
    // `right` is the same claim with the sign flipped.
    expect(arbitrate(55, 20, { anchor: "right" })).toEqual(["label"]);
    expect(arbitrate(55, 20, {})).toEqual(["label", "neighbour"]);
  });

  it("moves the reserved ROWS with a top/bottom anchor", () => {
    // One row is the whole box height, so the row either side of the anchor
    // is reached by exactly one of the three placements.
    expect(arbitrate(60, 21, {})).toEqual(["label", "neighbour"]);
    expect(arbitrate(60, 21, { anchor: "top" })).toEqual(["label"]);
    expect(arbitrate(60, 19, { anchor: "top" })).toEqual(["label", "neighbour"]);
    expect(arbitrate(60, 19, { anchor: "bottom" })).toEqual(["label"]);
  });

  it("adds an offset in cells on top of whatever the anchor did", () => {
    // Centred plus 3 cells right is the same reservation `left` produced.
    expect(arbitrate(65, 20, { offset: [3, 0] })).toEqual(["label"]);
    expect(arbitrate(58, 20, { offset: [3, 0] })).toEqual(["label", "neighbour"]);
    // ...and it composes rather than replacing. `left` reserves [60, 66]; a
    // further 3 cells slides that whole box to [63, 69], so column 61 is
    // released and column 68 is newly taken.
    expect(arbitrate(61, 20, { anchor: "left" })).toEqual(["label"]);
    expect(arbitrate(61, 20, { anchor: "left", offset: [3, 0] })).toEqual(["label", "neighbour"]);
    expect(arbitrate(68, 20, { anchor: "left" })).toEqual(["label", "neighbour"]);
    expect(arbitrate(68, 20, { anchor: "left", offset: [3, 0] })).toEqual(["label"]);
  });

  it("is byte-identical for an omitted anchor and an explicit centred, zero-offset one", () => {
    for (const col of [55, 58, 60, 63, 65]) {
      expect(arbitrate(col, 20, { anchor: "center", offset: [0, 0] })).toEqual(arbitrate(col, 20, {}));
    }
  });

  it("leaves the CONTOUR call shape — padding, no anchor — exactly where it was", () => {
    // The contour path passes padX/padY and never an anchor. Its box stays
    // centred on the point and grows symmetrically, so a neighbour is
    // suppressed at the same distance on both sides.
    const contour = (neighbourCol: number) =>
      glyphMapDeclutterLabels([
        { id: "label", col: 60, row: 20, label: "5000", priority: 9 },
        { id: "neighbour", col: neighbourCol, row: 20, label: "5000", priority: 1 },
      ], 1, 1, 6, 1).map((c) => c.id);
    // Half-widths are 2 + 6 = 8 each, so anything inside 16 columns collides
    // and 16 clears — symmetrically.
    expect(contour(75)).toEqual(["label"]);
    expect(contour(45)).toEqual(["label"]);
    expect(contour(76)).toEqual(["label", "neighbour"]);
    expect(contour(44)).toEqual(["label", "neighbour"]);
  });
});

describe("glyphMapLabelAnchorFraction", () => {
  it("is the fraction of the label's own box the anchor displaces it by", () => {
    expect(glyphMapLabelAnchorFraction("center")).toEqual({ x: 0, y: 0 });
    expect(glyphMapLabelAnchorFraction("left")).toEqual({ x: 0.5, y: 0 });
    expect(glyphMapLabelAnchorFraction("right")).toEqual({ x: -0.5, y: 0 });
    expect(glyphMapLabelAnchorFraction("top")).toEqual({ x: 0, y: 0.5 });
    expect(glyphMapLabelAnchorFraction("bottom")).toEqual({ x: 0, y: -0.5 });
    expect(glyphMapLabelAnchorFraction("top-left")).toEqual({ x: 0.5, y: 0.5 });
    expect(glyphMapLabelAnchorFraction("bottom-right")).toEqual({ x: -0.5, y: -0.5 });
    // An omitted anchor is the centred one — the default the whole
    // byte-identity claim rests on.
    expect(glyphMapLabelAnchorFraction(undefined)).toEqual({ x: 0, y: 0 });
  });
});
