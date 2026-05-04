/**
 * Polygon geometry helpers — pure math operating on Polygon vertices.
 *
 * After cube removal in Phase 2, this module only carries `polygonFaces` —
 * the trivial pass-through that surfaces a polygon as a single face for
 * downstream consumers (lighting, normal computation, etc.). The cube /
 * ramp / wedge / spike face emitters lived here in voxcss; they're gone.
 */
import type { Polygon, Vec3 } from "../types";

export interface PolygonFace {
  /** Vertices in CCW-from-outside order. Same as Polygon.vertices. */
  v: Vec3[];
  /** Original polygon's color, if any (for lighting helpers). */
  color?: string;
}

/**
 * Surface a polygon as a single face. The returned array always has length 1;
 * the indirection exists so callers that historically iterated faces (e.g.
 * the manifold check, the canvas validator) can keep their loop shape.
 *
 * Returns an empty array for degenerate polygons (< 3 vertices).
 */
export function polygonFaces(p: Polygon): PolygonFace[] {
  if (!p.vertices || p.vertices.length < 3) return [];
  return [{
    v: p.vertices.map((vert) => [vert[0], vert[1], vert[2]] as Vec3),
    color: p.color,
  }];
}
