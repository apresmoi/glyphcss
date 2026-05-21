/**
 * Geometry for a regular N-gonal pyramid along the Y axis. The base polygon
 * is centred at `y - height/2` with circumradius `radius`; the apex is at
 * `y + height/2`, both relative to `center`.
 *
 * Output (sides + 1 polygons):
 *   - `sides` side triangles — each `[apex, base_(i+1), base_i]` (CCW from outside).
 *   - 1 base cap N-gon — CCW when viewed from −Y (reversed ring order).
 *
 * Default sides=4 → square pyramid (5 polygons total).
 */
import type { Polygon, Vec3 } from "../types";

export interface PyramidPolygonsOptions {
  /** Center of the pyramid in world space. */
  center: Vec3;
  /** Circumradius of the base polygon. */
  radius: number;
  /** Total height along the Y axis. */
  height: number;
  /** Number of base polygon sides. Defaults to 4 (square pyramid). */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function pyramidPolygons(options: PyramidPolygonsOptions): Polygon[] {
  const { center, radius, height, sides = 4, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const hy = height / 2;
  const polygons: Polygon[] = [];

  // Base ring vertices
  const base: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (2 * Math.PI * i) / sides;
    base.push([cx + radius * Math.cos(theta), cy - hy, cz + radius * Math.sin(theta)]);
  }

  const apex: Vec3 = [cx, cy + hy, cz];

  // Side triangles: [apex, base_(i+1), base_i] — CCW from outside
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [apex, base[next], base[i]],
      color,
    });
  }

  // Base cap: CCW from −Y → reverse ring order
  polygons.push({
    vertices: [...base].reverse() as Vec3[],
    color,
  });

  return polygons;
}
