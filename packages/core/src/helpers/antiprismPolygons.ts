/**
 * Geometry for an N-gonal antiprism aligned to the Y axis. The antiprism is
 * centered at `center`, with the bottom cap at `y - height/2` and the top
 * cap at `y + height/2`. The top N-gon is rotated by π/sides relative to the
 * bottom, and the side strip consists of 2·sides alternating triangles.
 *
 * Output (2·sides + 2 polygons):
 *   - `2 * sides` side triangles — alternating "up" and "down" triangles (CCW from outside).
 *   - 1 top cap N-gon — CCW when viewed from +Y.
 *   - 1 bottom cap N-gon — CCW when viewed from −Y (reversed ring order).
 */
import type { Polygon, Vec3 } from "../types";

export interface AntiprismPolygonsOptions {
  /** Center of the antiprism in world space. */
  center: Vec3;
  /** Circumradius of the N-gon cross-sections. */
  radius: number;
  /** Total height along the Y axis. */
  height: number;
  /** Number of sides on each N-gon cap. Defaults to 6. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function antiprismPolygons(options: AntiprismPolygonsOptions): Polygon[] {
  const { center, radius, height, sides = 6, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  const hy = height / 2;
  const polygons: Polygon[] = [];

  // Bottom ring at y - hy, top ring at y + hy rotated by π/sides
  const bottom: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const thetaBot = (2 * Math.PI * i) / sides;
    const thetaTop = thetaBot + Math.PI / sides;
    bottom.push([cx + radius * Math.cos(thetaBot), cy - hy, cz + radius * Math.sin(thetaBot)]);
    top.push([cx + radius * Math.cos(thetaTop), cy + hy, cz + radius * Math.sin(thetaTop)]);
  }

  // Side triangles: alternating up/down around the belt
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    // "Up" triangle — faces outward with CCW winding from outside
    polygons.push({
      vertices: [bottom[i], bottom[next], top[i]],
      color,
    });
    // "Down" triangle — faces outward with CCW winding from outside
    polygons.push({
      vertices: [bottom[next], top[next], top[i]],
      color,
    });
  }

  // Top cap: CCW from +Y
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
