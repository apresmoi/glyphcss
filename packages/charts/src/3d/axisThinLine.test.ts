/**
 * `axisRender: "thin"` (USER FEEDBACK, verbatim: "I find it weird that the
 * only way that we have to do the axes is with this braille that makes the
 * axis a lot thicker than they should"; then, choosing it against the
 * ribbon: "those are the axes we should be using").
 *
 * `orientedRibbonPolygons` sweeps a full SIX-FACE box, so a wireframe
 * charMode traces that box's whole outline — four near-parallel long edges
 * at the axis's own scale, which is the reported thickness. `"thin"` emits
 * ONE degenerate face per axis whose vertices all lie on the segment, so the
 * same encoder traces exactly one line, at the same sub-cell resolution the
 * surface beside it is traced at.
 */
import { describe, expect, it } from "vitest";
import { glyphChartSurface } from "./surface";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d } from "./render";

const grid = Array.from({ length: 12 }, (_, i) => Array.from({ length: 10 }, (_, j) => 10 + i + j));
const mark = () => glyphChartSurface({ z: grid }, {}, { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } });

function axisPolygons(axisRender: "thin" | "geometry"): readonly { readonly vertices: readonly (readonly number[])[] }[] {
  const object = glyphChartObject(mark(), { charset: "braille", axisRender });
  const mesh = object.meshes.find((m) => m.name === "axis-lines");
  expect(mesh, `axisRender: "${axisRender}" must still mount an axis-lines mesh`).toBeDefined();
  return mesh!.polygons;
}

describe('3D axis lines — axisRender: "thin"', () => {
  it("draws ONE face per visible axis, where the ribbon draws a whole six-face box", () => {
    // 3 visible axes: the ribbon is 6 faces each, thin is 1 each.
    expect(axisPolygons("geometry")).toHaveLength(18);
    expect(axisPolygons("thin")).toHaveLength(3);
  });

  it("every thin face is DEGENERATE — all four vertices lie on the axis segment", () => {
    for (const polygon of axisPolygons("thin")) {
      const [a, b, c, d] = polygon.vertices as readonly (readonly number[])[];
      // `[from, to, to, from]` — exactly two distinct points, so the traced
      // outline is the segment itself and nothing else.
      expect(a).toEqual(d);
      expect(b).toEqual(c);
      expect(a).not.toEqual(b);
    }
  });

  it("MUTATION: the ribbon's own faces are NOT degenerate (so the test above can fail)", () => {
    const offEdge = axisPolygons("geometry").filter((p) => {
      const [a, , , d] = p.vertices as readonly (readonly number[])[];
      return JSON.stringify(a) !== JSON.stringify(d);
    });
    expect(offEdge.length).toBeGreaterThan(0);
  });

  it("is the DEFAULT for a wireframe render, and paints strictly less ink than the ribbon", () => {
    const ink = (text: string) => text.replace(/[ \n]/g, "").length;
    const dflt = renderGlyphChart3d(mark(), { charset: "braille", color: "none", width: 80, height: 26 });
    const ribbon = renderGlyphChart3d(mark(), { charset: "braille", color: "none", width: 80, height: 26, axisRender: "geometry" });
    const thin = renderGlyphChart3d(mark(), { charset: "braille", color: "none", width: 80, height: 26, axisRender: "thin" });
    expect(dflt.text).toBe(thin.text);
    expect(dflt.text).not.toBe(ribbon.text);
    expect(ink(thin.text)).toBeLessThan(ink(ribbon.text));
  });

  it('a SOLID style resolves "thin" back to the ribbon — a degenerate face has no area and would paint no axis at all', () => {
    const solidThin = renderGlyphChart3d(mark(), { charset: "box", color: "none", width: 80, height: 26, axisRender: "thin" });
    const solidRibbon = renderGlyphChart3d(mark(), { charset: "box", color: "none", width: 80, height: 26, axisRender: "geometry" });
    expect(solidThin.text).toBe(solidRibbon.text);
  });

  it("rejects an unknown value rather than silently falling back", () => {
    expect(() => renderGlyphChart3d(mark(), { axisRender: "fat" as never })).toThrow(/axisRender/);
  });
});
