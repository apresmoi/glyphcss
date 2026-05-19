/**
 * Geometry for an N-gonal bipyramid (two pyramids glued base-to-base along Y).
 * The equatorial ring of `sides` vertices lies at y = `center.y`, the top apex
 * at y = `center.y + halfHeight`, and the bottom apex at y = `center.y - halfHeight`.
 * `radius` is the circumradius of the equatorial ring.
 *
 * Output (2·sides polygons):
 *   - `sides` upper triangles — each `[ring_i, ring_(i+1), topApex]` (CCW from outside).
 *   - `sides` lower triangles — each `[ring_(i+1), ring_i, bottomApex]` (CCW from outside).
 */
import type { Polygon, Vec3 } from "../types";

export interface BipyramidPolygonsOptions {
  /** Center of the bipyramid in world space. */
  center: Vec3;
  /** Circumradius of the equatorial N-gon ring. */
  radius: number;
  /** Half the total height — distance from equator to each apex. */
  halfHeight: number;
  /** Number of sides on the equatorial ring. Defaults to 6. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function bipyramidPolygons(options: BipyramidPolygonsOptions): Polygon[] {
  const { center, radius, halfHeight, sides = 6, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const polygons: Polygon[] = [];

  // Equatorial ring vertices
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (2 * Math.PI * i) / sides;
    ring.push([cx + radius * Math.cos(theta), cy, cz + radius * Math.sin(theta)]);
  }

  const topApex: Vec3 = [cx, cy + halfHeight, cz];
  const bottomApex: Vec3 = [cx, cy - halfHeight, cz];

  // Upper triangles: [ring_i, ring_(i+1), topApex] — CCW from outside (upper half)
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [ring[i], ring[next], topApex],
      color,
    });
  }

  // Lower triangles: [ring_(i+1), ring_i, bottomApex] — CCW from outside (lower half)
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [ring[next], ring[i], bottomApex],
      color,
    });
  }

  return polygons;
}
