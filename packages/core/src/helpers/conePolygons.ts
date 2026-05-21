/**
 * Geometry for a closed cone along the Y axis. The apex sits at
 * `y + height/2` and the base ring sits at `y - height/2`, relative to
 * `center`. The base is a regular N-gon with circumradius `radius`.
 *
 * Output (sides + 1 polygons):
 *   - `sides` side triangles — each `[apex, base_(i+1), base_i]` (CCW from outside).
 *   - 1 base cap N-gon — CCW when viewed from −Y (reversed ring order).
 */
import type { Polygon, Vec3 } from "../types";

export interface ConePolygonsOptions {
  /** Center of the cone in world space. */
  center: Vec3;
  /** Circumradius of the base circle. */
  radius: number;
  /** Total height along the Y axis. */
  height: number;
  /** Number of base polygon sides. Defaults to 16. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function conePolygons(options: ConePolygonsOptions): Polygon[] {
  const { center, radius, height, sides = 16, color = "#ffffff" } = options;
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
