/**
 * A flat quad on one of the three axis-aligned planes, offset diagonally
 * along the two in-plane axes. Used as a planar drag handle in
 * `<PolyTransformControls>` — clicking and dragging this handle moves the
 * attached mesh along two axes simultaneously (XY, XZ, or YZ), instead of
 * the single-axis motion the arrow shafts provide.
 *
 * The polygon lives in standard glyphcss world space; wrap it in the
 * framework's PolyMesh equivalent for rendering.
 */
import type { Polygon, Vec3 } from "../types";

export interface PlanePolygonsOptions {
  /** Axis perpendicular to the plane: 0 = YZ plane, 1 = XZ plane,
   *  2 = XY plane. The quad lies on the OTHER two axes. */
  axis: 0 | 1 | 2;
  /** Half-extent of the quad along each in-plane axis. Default `0.4`. */
  size?: number;
  /** Center of the quad along the two in-plane axes. Pass a single number
   *  to use the same offset on both (positive places the handle in the
   *  +A/+B corner). Pass `[offsetA, offsetB]` to control each
   *  independently — sign flips move the handle to a different octant.
   *  `A = (axis+1)%3`, `B = (axis+2)%3`. Default `size * 2`. */
  offset?: number | [number, number];
  /** Position along the perpendicular axis. Default `0` (on the plane). */
  along?: number;
  /** Fill color. */
  color?: string;
}

/** Build the polygons for one axis-aligned planar drag handle. */
export function planePolygons(options: PlanePolygonsOptions): Polygon[] {
  const axis = options.axis;
  const size = options.size ?? 0.4;
  const offsetIn = options.offset ?? size * 2;
  const offsetA = typeof offsetIn === "number" ? offsetIn : offsetIn[0];
  const offsetB = typeof offsetIn === "number" ? offsetIn : offsetIn[1];
  const along = options.along ?? 0;
  const color = options.color ?? "#ffffff";

  const a = (axis + 1) % 3;
  const b = (axis + 2) % 3;
  const make = (sideA: number, sideB: number): Vec3 => {
    const v: Vec3 = [0, 0, 0];
    v[axis] = along;
    v[a] = offsetA + sideA;
    v[b] = offsetB + sideB;
    return v;
  };
  // CCW when viewed from the +axis side. The quad is double-sided in CSS
  // (no back-face cull when rendered through .glyphcss-mesh), so winding is
  // primarily a documentation aid here.
  return [
    {
      vertices: [
        make(-size, -size),
        make( size, -size),
        make( size,  size),
        make(-size,  size),
      ],
      color,
    },
  ];
}
