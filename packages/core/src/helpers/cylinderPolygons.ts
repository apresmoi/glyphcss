/**
 * Geometry for a closed cylinder aligned to the Y axis. The cylinder is
 * centered at `center`, with the bottom ring at `y - height/2` and the top
 * ring at `y + height/2`. The circumference is approximated by `sides`
 * evenly-spaced vertices.
 *
 * Output (sides + 2 polygons):
 *   - `sides` side quads — each connecting top_i → top_(i+1) → bottom_(i+1) → bottom_i (CCW from outside).
 *   - 1 top cap N-gon — CCW from +Y. Because the ring is generated going
 *     counter-clockwise in XZ (increasing θ winds X→+Z), the +Y-outward
 *     normal requires the REVERSED order.
 *   - 1 bottom cap N-gon — CCW from −Y. The same generation order (CCW in
 *     XZ) already produces a −Y-outward normal, so the bottom cap keeps the
 *     natural ring order.
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

  // Side quads: [top_i, top_(i+1), bottom_(i+1), bottom_i] — CCW from outside
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [top[i], top[next], bottom[next], bottom[i]],
      color,
    });
  }

  // Top cap: CCW from +Y → reversed ring order
  polygons.push({
    vertices: [...top].reverse() as Vec3[],
    color,
  });

  // Bottom cap: CCW from −Y → natural ring order
  polygons.push({
    vertices: [...bottom] as Vec3[],
    color,
  });

  return polygons;
}
