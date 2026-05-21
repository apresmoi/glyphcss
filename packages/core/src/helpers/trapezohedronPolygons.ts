/**
 * Geometry for an N-gonal trapezohedron (kite-faced solid, dual of the N-gonal
 * antiprism). The solid has `2 * sides` kite (quadrilateral) faces, a top apex
 * at y = `+halfHeight`, a bottom apex at y = `−halfHeight`, and two interleaved
 * rings of `sides` vertices each at y = ±`zRing`.
 *
 * The belt ring elevation is derived analytically so that every kite face is
 * exactly planar. Setting zR = halfHeight × (1 − cos(π/sides)) / (1 + cos(π/sides))
 * is the unique value that places all four vertices of each kite in the same plane
 * (derived by requiring the fourth vertex to satisfy the plane equation of the
 * first three).
 *
 * The top ring sits at y = +zR; the bottom ring sits at y = −zR, rotated by
 * π/sides so the two rings interleave like an antiprism.
 *
 * Output (2·sides polygons):
 *   - `sides` upper kites around the top apex (CCW from outside).
 *   - `sides` lower kites around the bottom apex (CCW from outside).
 */
import type { Polygon, Vec3 } from "../types";

export interface TrapezohedronPolygonsOptions {
  /** Center of the trapezohedron in world space. */
  center: Vec3;
  /** Circumradius of each belt ring. */
  radius: number;
  /** Half the total height — distance from equator to each apex. */
  halfHeight: number;
  /** Number of kite faces per hemisphere (= number of antiprism sides). Defaults to 5. */
  sides?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function trapezohedronPolygons(options: TrapezohedronPolygonsOptions): Polygon[] {
  const { center, radius, halfHeight, sides = 5, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;
  // Analytically-derived belt ring elevation for exact kite planarity:
  // zRing = halfHeight * (1 - cos(π/sides)) / (1 + cos(π/sides))
  const cosPN = Math.cos(Math.PI / sides);
  const zRing = halfHeight * (1 - cosPN) / (1 + cosPN);
  const polygons: Polygon[] = [];

  // Top ring at y = cy + zRing, bottom ring at y = cy - zRing (rotated by π/sides)
  const topRing: Vec3[] = [];
  const botRing: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const thetaTop = (2 * Math.PI * i) / sides;
    const thetaBot = thetaTop + Math.PI / sides;
    topRing.push([cx + radius * Math.cos(thetaTop), cy + zRing, cz + radius * Math.sin(thetaTop)]);
    botRing.push([cx + radius * Math.cos(thetaBot), cy - zRing, cz + radius * Math.sin(thetaBot)]);
  }

  const topApex: Vec3 = [cx, cy + halfHeight, cz];
  const botApex: Vec3 = [cx, cy - halfHeight, cz];

  // Upper kites: [topApex, topRing[(i+1)%sides], botRing[i], topRing[i]]
  // — botRing[i] sits angularly between topRing[i] and topRing[i+1].
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [topApex, topRing[next], botRing[i], topRing[i]],
      color,
    });
  }

  // Lower kites: [botApex, botRing[i], topRing[(i+1)%sides], botRing[(i+1)%sides]]
  // — topRing[i+1] sits angularly between botRing[i] and botRing[i+1].
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    polygons.push({
      vertices: [botApex, botRing[i], topRing[next], botRing[next]],
      color,
    });
  }

  return polygons;
}
