import { describe, it, expect } from "vitest";
import { cullInteriorPolygons } from "./cullInteriorPolygons";
import type { Polygon } from "../types";

// Quad on a given plane, normal pointing along `normalAxis` (positive direction).
function axisQuad(
  cx: number, cy: number, cz: number,
  normalAxis: "x" | "y" | "z",
  sign: 1 | -1,
  size = 1,
): Polygon {
  const h = size / 2;
  if (normalAxis === "x") {
    // Quad in YZ plane at x=cx.
    if (sign > 0) {
      return { vertices: [[cx, cy - h, cz - h], [cx, cy + h, cz - h], [cx, cy + h, cz + h], [cx, cy - h, cz + h]] };
    }
    return { vertices: [[cx, cy - h, cz - h], [cx, cy - h, cz + h], [cx, cy + h, cz + h], [cx, cy + h, cz - h]] };
  }
  if (normalAxis === "y") {
    if (sign > 0) {
      return { vertices: [[cx - h, cy, cz - h], [cx - h, cy, cz + h], [cx + h, cy, cz + h], [cx + h, cy, cz - h]] };
    }
    return { vertices: [[cx - h, cy, cz - h], [cx + h, cy, cz - h], [cx + h, cy, cz + h], [cx - h, cy, cz + h]] };
  }
  // z
  if (sign > 0) {
    return { vertices: [[cx - h, cy - h, cz], [cx + h, cy - h, cz], [cx + h, cy + h, cz], [cx - h, cy + h, cz]] };
  }
  return { vertices: [[cx - h, cy - h, cz], [cx - h, cy + h, cz], [cx + h, cy + h, cz], [cx + h, cy - h, cz]] };
}

// Build a closed cube at (cx, cy, cz) with edge size `size`. 6 outward-facing quads.
function cubeOutward(cx: number, cy: number, cz: number, size = 1): Polygon[] {
  const h = size / 2;
  return [
    axisQuad(cx + h, cy, cz, "x", 1, size),
    axisQuad(cx - h, cy, cz, "x", -1, size),
    axisQuad(cx, cy + h, cz, "y", 1, size),
    axisQuad(cx, cy - h, cz, "y", -1, size),
    axisQuad(cx, cy, cz + h, "z", 1, size),
    axisQuad(cx, cy, cz - h, "z", -1, size),
  ];
}

describe("cullInteriorPolygons", () => {
  it("returns the input unchanged when no polygons are interior", () => {
    // A single hollow cube — every face faces outward.
    const cube = cubeOutward(0, 0, 0, 4);
    const out = cullInteriorPolygons(cube);
    expect(out.length).toBe(cube.length);
  });

  it("culls a polygon fully enclosed by an outer cube", () => {
    // Outer hollow cube + one tiny quad floating at its center.
    const outer = cubeOutward(0, 0, 0, 10);
    const interior = axisQuad(0, 0, 0, "z", 1, 0.1);
    const out = cullInteriorPolygons([...outer, interior]);
    expect(out.length).toBe(outer.length); // interior dropped
    // None of the kept polygons is the interior quad — verify by vertex coords.
    const interiorVerts = JSON.stringify(interior.vertices);
    expect(out.some((p) => JSON.stringify(p.vertices) === interiorVerts)).toBe(false);
  });

  it("culls multiple interior polygons inside the same outer shell", () => {
    const outer = cubeOutward(0, 0, 0, 10);
    const interiors = [
      axisQuad(0, 0, 0, "z", 1, 0.1),
      axisQuad(1, 1, 1, "x", -1, 0.1),
      axisQuad(-2, -1, 0.5, "y", 1, 0.1),
    ];
    const out = cullInteriorPolygons([...outer, ...interiors]);
    expect(out.length).toBe(outer.length);
  });

  it("keeps a polygon that pokes out past the outer shell", () => {
    // Outer cube + a quad far outside it — should not be culled even though
    // it has no neighbors near it.
    const outer = cubeOutward(0, 0, 0, 4);
    const farQuad = axisQuad(20, 0, 0, "z", 1, 0.5);
    const out = cullInteriorPolygons([...outer, farQuad]);
    expect(out.length).toBe(outer.length + 1);
  });

  it("returns the input directly when there are too few polygons", () => {
    const tiny = cubeOutward(0, 0, 0, 1).slice(0, 3);
    const out = cullInteriorPolygons(tiny);
    expect(out).toBe(tiny); // referential equality — short-circuit path
  });
});
