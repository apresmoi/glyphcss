/**
 * Geometry for the three.js-style debug axes gizmo: three thin colored
 * cuboids stretching along world-X, world-Y and world-Z. Mirrors the
 * convention `red=X, green=Y, blue=Z`.
 *
 * Returned polygons are in the standard polycss world-space convention
 * (`+X right, +Y forward, +Z up`). Wrap with the framework's PolyMesh /
 * PolyScene equivalent to render.
 */
import type { Polygon, Vec3 } from "../types";

export interface AxesHelperOptions {
  /** Length of each axis bar in world units. */
  size?: number;
  /** Bar cross-section width as a fraction of `size`. */
  thickness?: number;
  /** When true, also draws bars in the −X / −Y / −Z direction. */
  negative?: boolean;
  /** X-axis bar color. */
  xColor?: string;
  /** Y-axis bar color. */
  yColor?: string;
  /** Z-axis bar color. */
  zColor?: string;
}

/**
 * Axis-aligned cuboid as 6 CCW-from-outside quads. `axis` picks the long
 * dimension; `from`/`to` define the span along that axis (with `from < to`);
 * the other two axes carry the bar's cross-section.
 */
function axisBox(
  axis: 0 | 1 | 2,
  from: number,
  to: number,
  half: number,
  color: string,
): Polygon[] {
  const make = (along: number, sideA: number, sideB: number): Vec3 => {
    const v: Vec3 = [0, 0, 0];
    v[axis] = along;
    v[(axis + 1) % 3] = sideA;
    v[(axis + 2) % 3] = sideB;
    return v;
  };
  const c0 = make(from, -half, -half);
  const c1 = make(from,  half, -half);
  const c2 = make(from,  half,  half);
  const c3 = make(from, -half,  half);
  const c4 = make(to, -half, -half);
  const c5 = make(to,  half, -half);
  const c6 = make(to,  half,  half);
  const c7 = make(to, -half,  half);
  return [
    { vertices: [c0, c1, c2, c3], color },
    { vertices: [c4, c5, c6, c7], color },
    { vertices: [c0, c1, c5, c4], color },
    { vertices: [c1, c2, c6, c5], color },
    { vertices: [c2, c3, c7, c6], color },
    { vertices: [c3, c0, c4, c7], color },
  ];
}

/**
 * Build the polygons for an AxesHelper-style gizmo. Three thin cuboids,
 * one per world axis. Defaults match `<PolyAxesHelper>` in the framework
 * packages.
 */
export function axesHelperPolygons(options: AxesHelperOptions = {}): Polygon[] {
  const size = options.size ?? 5;
  const thickness = options.thickness ?? 0.025;
  const negative = options.negative ?? false;
  const xColor = options.xColor ?? "#ff3a3a";
  const yColor = options.yColor ?? "#3aff3a";
  const zColor = options.zColor ?? "#3a8aff";
  const half = (size * thickness) / 2;
  const from = negative ? -size : 0;
  return [
    ...axisBox(0, from, size, half, xColor),
    ...axisBox(1, from, size, half, yColor),
    ...axisBox(2, from, size, half, zColor),
  ];
}
