/**
 * Geometry for a regular dodecahedron — 12 pentagonal faces. Vertices are
 * the standard golden-ratio form: (±1, ±1, ±1) and the three even
 * permutations of (0, ±φ, ±1/φ). Scaled so the circumradius equals `size`.
 *
 * Vertex ordering (20 total):
 *   Indices 0–7:  cube corners (±1, ±1, ±1)
 *   Indices 8–11: (0, ±φ, ±1/φ)
 *   Indices 12–15: (±1/φ, 0, ±φ)
 *   Indices 16–19: (±φ, ±1/φ, 0)
 *
 * Face table derived from the adjacency graph of the above vertices;
 * each face is a CCW-from-outside pentagon.
 */
import type { Polygon, Vec3 } from "../types";

export interface DodecahedronPolygonsOptions {
  /** Center of the dodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all twelve faces. */
  color?: string;
}

export function dodecahedronPolygons(options: DodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // φ and 1/φ
  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;

  // Raw circumradius of the (±1,±1,±1)+(0,±φ,±1/φ) form is √3.
  // Scale so circumradius equals `size`.
  const s = size / Math.sqrt(3);

  // 20 vertices.
  const raw: [number, number, number][] = [
    [-1, -1, -1],            //  0
    [-1, -1,  1],            //  1
    [-1,  1, -1],            //  2
    [-1,  1,  1],            //  3
    [ 1, -1, -1],            //  4
    [ 1, -1,  1],            //  5
    [ 1,  1, -1],            //  6
    [ 1,  1,  1],            //  7
    [ 0, -phi, -invPhi],     //  8
    [ 0, -phi,  invPhi],     //  9
    [ 0,  phi, -invPhi],     // 10
    [ 0,  phi,  invPhi],     // 11
    [-invPhi,  0, -phi],     // 12
    [ invPhi,  0, -phi],     // 13
    [-invPhi,  0,  phi],     // 14
    [ invPhi,  0,  phi],     // 15
    [-phi, -invPhi,  0],     // 16
    [-phi,  invPhi,  0],     // 17
    [ phi, -invPhi,  0],     // 18
    [ phi,  invPhi,  0],     // 19
  ];

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // 12 pentagonal faces — CCW winding from outside. Each face is a planar
  // convex pentagon; planarity and outward winding are verified against the
  // vertex set above.
  const faces: [number, number, number, number, number][] = [
    [ 0,  8,  9,  1, 16],
    [ 0, 12, 13,  4,  8],
    [ 0, 16, 17,  2, 12],
    [ 1,  9,  5, 15, 14],
    [ 1, 14,  3, 17, 16],
    [ 2, 10,  6, 13, 12],
    [ 2, 17,  3, 11, 10],
    [ 3, 14, 15,  7, 11],
    [ 4, 13,  6, 19, 18],
    [ 4, 18,  5,  9,  8],
    [ 5, 18, 19,  7, 15],
    [ 6, 10, 11,  7, 19],
  ];

  return faces.map((f) => ({
    vertices: f.map((i) => v[i]) as Vec3[],
    color,
  }));
}
