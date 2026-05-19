/**
 * Geometry for a torus (donut) centred at `center`, lying in the XZ plane
 * with the tube axis parallel to Y. Parameterised by:
 *
 *   θ = 2π * u / segments  (around the donut ring)
 *   φ = 2π * v / sides     (around the tube cross-section)
 *
 *   x = (majorRadius + minorRadius * cos φ) * cos θ
 *   y =  minorRadius * sin φ
 *   z = (majorRadius + minorRadius * cos φ) * sin θ
 *
 * Output: `segments × sides` quads, one per (u, v) cell, with modular
 * index wrap and CCW-from-outside winding.
 * Default segments=24, sides=12 → 288 quads.
 */
import type { Polygon, Vec3 } from "../types";

export interface TorusPolygonsOptions {
  /** Center of the torus in world space. */
  center: Vec3;
  /** Distance from the torus center to the center of the tube. */
  majorRadius: number;
  /** Radius of the tube cross-section. */
  minorRadius: number;
  /** Number of divisions around the donut ring. Defaults to 24. */
  segments?: number;
  /** Number of divisions around the tube cross-section. Defaults to 12. */
  sides?: number;
  /** Fill color applied to all quads. */
  color?: string;
}

export function torusPolygons(options: TorusPolygonsOptions): Polygon[] {
  const { center, majorRadius, minorRadius, segments = 24, sides = 12, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Pre-compute all (u, v) vertices
  const verts: Vec3[][] = [];
  for (let u = 0; u < segments; u++) {
    const theta = (2 * Math.PI * u) / segments;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const row: Vec3[] = [];
    for (let v = 0; v < sides; v++) {
      const phi = (2 * Math.PI * v) / sides;
      const r = majorRadius + minorRadius * Math.cos(phi);
      row.push([
        cx + r * cosT,
        cy + minorRadius * Math.sin(phi),
        cz + r * sinT,
      ]);
    }
    verts.push(row);
  }

  const polygons: Polygon[] = [];
  for (let u = 0; u < segments; u++) {
    const u1 = (u + 1) % segments;
    for (let v = 0; v < sides; v++) {
      const v1 = (v + 1) % sides;
      // Quad: (u,v) → (u+1,v) → (u+1,v+1) → (u,v+1) — CCW from outside
      polygons.push({
        vertices: [verts[u][v], verts[u1][v], verts[u1][v1], verts[u][v1]],
        color,
      });
    }
  }

  return polygons;
}
