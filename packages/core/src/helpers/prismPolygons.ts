/**
 * Geometry for a right N-gonal prism aligned to the Y axis. The prism is
 * centered at `center`, with the bottom cap at `y - height/2` and the top
 * cap at `y + height/2`. The N-gon cross-section has circumradius `radius`.
 *
 * Output (sides + 2 polygons):
 *   - `sides` side quads — each `[top_i, top_(i+1), bottom_(i+1), bottom_i]` (CCW from outside).
 *   - 1 top cap N-gon — CCW when viewed from +Y.
 *   - 1 bottom cap N-gon — CCW when viewed from −Y (reversed ring order).
 */
import type { Polygon, Vec3 } from "../types";

export interface PrismPolygonsOptions {
  /** Center of the prism in world space. */
  center: Vec3;
  /** Circumradius of the N-gon cross-section. */
  radius: number;
  /** Total height along the Y axis. */
  height: number;
  /** Number of sides on the N-gon cross-section. Defaults to 6. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function prismPolygons(options: PrismPolygonsOptions): Polygon[] {
  const { center, radius, height, sides = 6, color = "#ffffff" } = options;
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

  // Top cap: CCW from +Y → indices 0, 1, …, sides-1
  polygons.push({
    vertices: [...top] as Vec3[],
    color,
  });

  // Bottom cap: CCW from −Y → reverse ring order
  polygons.push({
    vertices: [...bottom].reverse() as Vec3[],
    color,
  });

  return polygons;
}
