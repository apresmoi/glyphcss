import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "../types";
import { dedupeOverlappingPolygons } from "./dedupeOverlappingPolygons";

function quad(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  color = "#ff0000",
): Polygon {
  return {
    vertices: [
      origin,
      [origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]],
      [origin[0] + u[0] + v[0], origin[1] + u[1] + v[1], origin[2] + u[2] + v[2]],
      [origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]],
    ],
    color,
  };
}

function triangle(verts: Vec3[], color = "#ff0000"): Polygon {
  return { vertices: verts, color };
}

describe("dedupeOverlappingPolygons", () => {
  it("returns the input unchanged when nothing overlaps", () => {
    const polygons: Polygon[] = [
      quad([0, 0, 0], [1, 0, 0], [0, 1, 0]),  // XY plane at z=0
      quad([0, 0, 5], [1, 0, 0], [0, 1, 0]),  // XY plane at z=5
      quad([10, 0, 0], [1, 0, 0], [0, 1, 0]), // far away on XY plane
    ];
    const out = dedupeOverlappingPolygons(polygons);
    expect(out.length).toBe(3);
  });

  it("returns the input unchanged for an empty or single-poly input", () => {
    expect(dedupeOverlappingPolygons([])).toEqual([]);
    const one = [quad([0, 0, 0], [1, 0, 0], [0, 1, 0])];
    expect(dedupeOverlappingPolygons(one)).toBe(one);
  });

  it("drops an exact duplicate polygon (same vertices, same orientation)", () => {
    const a = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const b = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const out = dedupeOverlappingPolygons([a, b]);
    expect(out.length).toBe(1);
  });

  it("drops a back-to-back duplicate (same vertices, flipped winding)", () => {
    // Two quads at z=0, one CCW (normal +Z) and one CW (normal -Z) — the
    // inner-shell artifact. Should dedup to one.
    const front = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const back: Polygon = {
      vertices: [...front.vertices].reverse(), // reverse winding flips normal
      color: front.color,
    };
    const out = dedupeOverlappingPolygons([front, back]);
    expect(out.length).toBe(1);
  });

  it("keeps both polygons when they're coplanar but their 2D outlines don't overlap", () => {
    // Two quads on the same z=0 plane, side by side, no overlap.
    const a = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const b = quad([10, 0, 0], [1, 0, 0], [0, 1, 0]);
    const out = dedupeOverlappingPolygons([a, b]);
    expect(out.length).toBe(2);
  });

  it("drops a polygon nested inside another (one fully contains the other)", () => {
    // Big outer quad and a small inner quad on the same plane. The small
    // one is entirely inside the big one — modeller likely doubled up.
    const outer = quad([-10, -10, 0], [20, 0, 0], [0, 20, 0]);
    const inner = quad([-1, -1, 0], [2, 0, 0], [0, 2, 0]);
    const out = dedupeOverlappingPolygons([outer, inner]);
    expect(out.length).toBe(1);
  });

  it("does not dedup polygons on different planes even if their projections overlap", () => {
    // One quad on z=0, another quad on z=5. Their projections to XY
    // overlap, but they're not coincident — distinct surfaces.
    const a = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const b = quad([0, 0, 5], [1, 0, 0], [0, 1, 0]);
    const out = dedupeOverlappingPolygons([a, b]);
    expect(out.length).toBe(2);
  });

  it("dedup respects independent overlap groups (drops one per group)", () => {
    const aFront = quad([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const aBack: Polygon = { vertices: [...aFront.vertices].reverse(), color: aFront.color };
    const bFront = quad([10, 0, 0], [1, 0, 0], [0, 1, 0]);
    const bBack: Polygon = { vertices: [...bFront.vertices].reverse(), color: bFront.color };
    const out = dedupeOverlappingPolygons([aFront, aBack, bFront, bBack]);
    expect(out.length).toBe(2);
  });

  it("handles triangles (not just quads)", () => {
    const a = triangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const b = triangle([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    const out = dedupeOverlappingPolygons([a, b]);
    expect(out.length).toBe(1);
  });

  it("prefers keeping the outward-facing polygon when a pair is back-to-back", () => {
    // A "cube wall" at x=1 with an outward normal (+X) and an inward
    // duplicate (-X). Mesh centroid is at origin. The outward one
    // points away from the centroid; the inward one points toward it.
    // We should keep the outward one.
    const outward = quad([1, -1, -1], [0, 2, 0], [0, 0, 2]); // normal +X
    const inward: Polygon = { vertices: [...outward.vertices].reverse(), color: outward.color };
    // Add a couple of distractor polys so the mesh centroid isn't at the wall.
    const floor = quad([-2, -2, -2], [4, 0, 0], [0, 4, 0], "#00ff00");
    const ceiling = quad([-2, -2, 2], [4, 0, 0], [0, 4, 0], "#0000ff");
    const out = dedupeOverlappingPolygons([outward, inward, floor, ceiling]);
    expect(out.length).toBe(3);
    // Verify we kept the outward-facing one by checking the surviving
    // wall polygon has its first vertex matching outward[0] (not reversed).
    const wall = out.find((p) => p.color === outward.color);
    expect(wall).toBeDefined();
    expect(wall!.vertices[0]).toEqual(outward.vertices[0]);
  });

  it("handles a large input without crashing (smoke test)", () => {
    // Build a 10x10 grid of unique quads + one duplicate of a random one.
    const polygons: Polygon[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        polygons.push(quad([i, j, 0], [1, 0, 0], [0, 1, 0]));
      }
    }
    // Duplicate of (3, 4)
    polygons.push(quad([3, 4, 0], [1, 0, 0], [0, 1, 0]));
    const out = dedupeOverlappingPolygons(polygons);
    expect(out.length).toBe(100); // one duplicate dropped
  });
});
