/**
 * One square quad covering the bounding box of a ring (annulus) in the
 * plane perpendicular to a chosen axis. Used by `<PolyTransformControls
 * mode="rotate">` together with a CSS `mask: radial-gradient(...)` to
 * render the visible donut, replacing the segmented quad-strip approach
 * of `ringPolygons` with a single DOM element per ring.
 *
 * The caller is responsible for applying the mask CSS and using a donut-
 * shaped hit-test (the quad's bounding rect alone would over-hit the
 * inner hole). The recommended setup is to set the CSS custom property
 * `--ring-inner-ratio` on the mesh element so the mask scales with the
 * caller's chosen thickness ratio.
 */
import type { Polygon, Vec3 } from "../types";

export interface RingQuadPolygonsOptions {
  /** World axis the ring is perpendicular to: 0=X, 1=Y, 2=Z. The quad
   *  lies in the plane spanned by the other two axes. */
  axis: 0 | 1 | 2;
  /** Outer radius of the ring. The quad spans ±outerRadius in both
   *  in-plane axes. */
  outerRadius: number;
  /** Fill color. */
  color?: string;
}

/** Build a single 4-vertex polygon (a square) bounding the ring's outer
 *  circle. CSS `mask` is expected to clip this to the donut shape at
 *  render time. */
export function ringQuadPolygons(options: RingQuadPolygonsOptions): Polygon[] {
  const axis = options.axis;
  const r = options.outerRadius;
  const color = options.color ?? "#ffffff";
  const a = (axis + 1) % 3;
  const b = (axis + 2) % 3;
  const make = (sa: number, sb: number): Vec3 => {
    const v: Vec3 = [0, 0, 0];
    v[axis] = 0;
    v[a] = sa;
    v[b] = sb;
    return v;
  };
  return [
    {
      vertices: [make(-r, -r), make(r, -r), make(r, r), make(-r, r)],
      color,
    },
  ];
}
