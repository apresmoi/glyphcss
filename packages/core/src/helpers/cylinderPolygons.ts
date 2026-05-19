/**
 * Geometry for a closed cylinder aligned to the Y axis. The cylinder is
 * centered at `center`, with the bottom ring at `y - height/2` and the top
 * ring at `y + height/2`. The circumference is approximated by `sides`
 * evenly-spaced vertices.
 *
 * Output (sides + 2 polygons):
 *   - `sides` side quads — each connecting bottom_i → bottom_(i+1) → top_(i+1) → top_i (CCW from outside).
 *   - 1 top cap N-gon — CCW when viewed from +Y (vertices 0 … sides-1).
 *   - 1 bottom cap N-gon — CCW when viewed from −Y (vertices reversed).
 */
import type { Polygon, Vec3 } from "../types";

export interface CylinderPolygonsOptions {
  /** Center of the cylinder in world space. */
  center: Vec3;
  /** Radius of the circular cross-section. */
  radius: number;
  /** Total height along the Y axis. */
  height: number;
  /** Number of circumference divisions. Defaults to 16. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function cylinderPolygons(options: CylinderPolygonsOptions): Polygon[] {
  const { center, radius, height, sides = 16, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const hy = height / 2;
  const polygons: Polygon[] = [];

  // Generate bottom and top ring vertices
  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const theta = (2 * Math.PI * i) / sides;
    const x = cx + radius * Math.cos(theta);
    const z = cz + radius * Math.sin(theta);
    bottom.push([x, cy - hy, z]);
    top.push([x, cy + hy, z]);
  }

  // Side quads: [bottom_i, bottom_(i+1), top_(i+1), top_i] — CCW from outside
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [bottom[i], bottom[next], top[next], top[i]],
      color,
    });
  }

  // Top cap: CCW from +Y → indices 0, 1, …, sides-1
  polygons.push({
    vertices: [...top] as Vec3[],
    color,
  });

  // Bottom cap: CCW from −Y → reverse of top order
  polygons.push({
    vertices: [...bottom].reverse() as Vec3[],
    color,
  });

  return polygons;
}
