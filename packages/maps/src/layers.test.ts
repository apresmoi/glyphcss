import { describe, expect, it } from "vitest";
import { glyphMapDeclutterLabels, glyphMapPointHeatmap, glyphMapVectorPolygons } from "./layers";
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
