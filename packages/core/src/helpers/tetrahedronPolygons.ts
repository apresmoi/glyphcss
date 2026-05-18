/**
 * Geometry for a regular tetrahedron — 4 triangular faces. Vertices are
 * placed at alternating corners of a unit cube so the edge length is uniform.
 * Scaled so the solid fits inside a sphere of radius `size` (i.e. the
 * circumradius equals `size`), centered on `center`.
 */
import type { Polygon, Vec3 } from "../types";

export interface TetrahedronPolygonsOptions {
  /** Center of the tetrahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all four faces. */
  color?: string;
}

export function tetrahedronPolygons(options: TetrahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Standard "alternated cube corners" tetrahedron.
  // Raw vertices sit on the unit cube (±1, ±1, ±1) at corners
  // (+1,+1,+1), (-1,-1,+1), (-1,+1,-1), (+1,-1,-1).
  // The circumradius of the unit-cube form is √3, so we normalise
  // by √3 and then scale by `size` so the circumradius equals `size`.
  const s = size / Math.sqrt(3);
  const v: Vec3[] = [
    [cx + s,  cy + s,  cz + s],  // 0
    [cx - s,  cy - s,  cz + s],  // 1
    [cx - s,  cy + s,  cz - s],  // 2
    [cx + s,  cy - s,  cz - s],  // 3
  ];

  // Four CCW-from-outside triangular faces.
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];

  return faces.map((f) => ({
    vertices: [v[f[0]], v[f[1]], v[f[2]]],
    color,
  }));
}
