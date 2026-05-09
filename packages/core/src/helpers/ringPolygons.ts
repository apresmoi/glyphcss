/**
 * Geometry for a flat ring (annulus) lying in the plane perpendicular
 * to a chosen axis. Used as the rotation handle in
 * `<TransformControls mode="rotate">` — three rings, one per axis,
 * each draggable to rotate the target around that axis.
 *
 * The ring is a sequence of quad segments around a circle. We don't
 * model a true torus (tube) — a flat annulus reads cleanly as a
 * "rotation circle" and keeps the polygon count proportional to the
 * `segments` knob.
 *
 * Returned polygons are in standard polycss world space and intended
 * to be wrapped in the framework's PolyMesh equivalent for rendering.
 */
import type { Polygon, Vec3 } from "../types";

export interface RingPolygonsOptions {
  /** World axis the ring is perpendicular to: 0=X, 1=Y, 2=Z. The ring
   *  itself lies in the plane spanned by the other two axes. */
  axis: 0 | 1 | 2;
  /** Mid-radius of the ring (distance from center to the middle of
   *  the annulus band). */
  radius: number;
  /** Half-width of the annulus band — the ring spans `radius - half`
   *  to `radius + half`. */
  halfThickness?: number;
  /** Number of quad segments around the circle. Higher = smoother. */
  segments?: number;
  /** Fill color. */
  color?: string;
}

/** Point on a circle of radius `r` at `angle` radians, in the plane
 *  perpendicular to `perpAxis` (centered at origin). */
function pointOnRing(perpAxis: 0 | 1 | 2, r: number, angle: number): Vec3 {
  const v: Vec3 = [0, 0, 0];
  const a1 = ((perpAxis + 1) % 3) as 0 | 1 | 2;
  const a2 = ((perpAxis + 2) % 3) as 0 | 1 | 2;
  v[a1] = Math.cos(angle) * r;
  v[a2] = Math.sin(angle) * r;
  return v;
}

/** Build the polygons for a flat ring (annulus). */
export function ringPolygons(options: RingPolygonsOptions): Polygon[] {
  const axis = options.axis;
  const radius = options.radius;
  const halfThickness = options.halfThickness ?? Math.max(0.05, radius * 0.04);
  const segments = options.segments ?? 32;
  const color = options.color ?? "#ffffff";

  const innerR = radius - halfThickness;
  const outerR = radius + halfThickness;
  const polygons: Polygon[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const innerA = pointOnRing(axis, innerR, a0);
    const innerB = pointOnRing(axis, innerR, a1);
    const outerA = pointOnRing(axis, outerR, a0);
    const outerB = pointOnRing(axis, outerR, a1);
    polygons.push({
      vertices: [innerA, outerA, outerB, innerB],
      color,
    });
  }
  return polygons;
}
