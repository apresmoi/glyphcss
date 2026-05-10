import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "../types";
import { coverPlanarPolygons } from "./coverPlanarPolygons";

function areaOf(vertices: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[0];
    const b = vertices[i];
    const c = vertices[i + 1];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    total += Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ) / 2;
  }
  return total;
}

function totalArea(polygons: Polygon[]): number {
  return polygons.reduce((sum, polygon) => sum + areaOf(polygon.vertices), 0);
}

function rect(x0: number, y0: number, x1: number, y1: number, color = "#f00"): Polygon[] {
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], color },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], color },
  ];
}

describe("coverPlanarPolygons", () => {
  it("covers a triangulated rectangle with one generated quad", () => {
    const input = [
      ...rect(0, 0, 1, 1),
      ...rect(1, 0, 2, 1),
      ...rect(2, 0, 3, 1),
    ];

    const result = coverPlanarPolygons(input, { minGroupPolygons: 2 });

    expect(result).toHaveLength(1);
    expect(result[0].vertices).toHaveLength(4);
    expect(totalArea(result)).toBeCloseTo(totalArea(input), 8);
  });

  it("covers an L-shaped planar region with fewer convex polygons", () => {
    const input = [
      ...rect(0, 0, 1, 1),
      ...rect(1, 0, 2, 1),
      ...rect(0, 1, 1, 2),
    ];

    const result = coverPlanarPolygons(input, { minGroupPolygons: 2 });

    expect(result.length).toBeLessThan(input.length);
    expect(totalArea(result)).toBeCloseTo(totalArea(input), 8);
  });

  it("does not cover across material boundaries", () => {
    const input = [
      ...rect(0, 0, 1, 1, "#f00"),
      ...rect(1, 0, 2, 1, "#00f"),
    ];

    const result = coverPlanarPolygons(input, { minGroupPolygons: 2 });

    expect(result).toHaveLength(2);
    expect(new Set(result.map((polygon) => polygon.color))).toEqual(new Set(["#f00", "#00f"]));
  });

  it("leaves textured polygons untouched", () => {
    const input = rect(0, 0, 1, 1).map((polygon): Polygon => ({
      ...polygon,
      texture: "tex.png",
      uvs: [[0, 0], [1, 0], [1, 1]],
    }));

    const result = coverPlanarPolygons(input, { minGroupPolygons: 2 });

    expect(result).toEqual(input);
  });
});
