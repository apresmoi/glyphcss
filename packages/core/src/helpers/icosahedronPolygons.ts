/**
 * Geometry for a regular icosahedron — 20 triangular faces. Vertices are
 * the standard golden-ratio form: (0, ±1, ±φ) and even permutations.
 * Scaled so the circumradius equals `size`.
 *
 * Vertex ordering (12 total):
 *   Indices 0–3:  (0, ±1, ±φ)
 *   Indices 4–7:  (±1, ±φ, 0)
 *   Indices 8–11: (±φ, 0, ±1)
 *
 * Face table derived from the adjacency graph of the above vertices;
 * each face is a CCW-from-outside triangle.
 */
import type { Polygon, Vec3 } from "../types";

export interface IcosahedronPolygonsOptions {
  /** Center of the icosahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all twenty faces. */
  color?: string;
}

export function icosahedronPolygons(options: IcosahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // φ (golden ratio)
  const phi = (1 + Math.sqrt(5)) / 2;

  // Raw circumradius of the (0, ±1, ±φ) form is √(1 + φ²).
  // Scale so circumradius equals `size`.
  const s = size / Math.sqrt(1 + phi * phi);

  // 12 vertices.
  const raw: [number, number, number][] = [
    [ 0, -1, -phi],   //  0
    [ 0, -1,  phi],   //  1
    [ 0,  1, -phi],   //  2
    [ 0,  1,  phi],   //  3
    [-1, -phi,  0],   //  4
    [-1,  phi,  0],   //  5
    [ 1, -phi,  0],   //  6
    [ 1,  phi,  0],   //  7
    [-phi,  0, -1],   //  8
    [ phi,  0, -1],   //  9
    [-phi,  0,  1],   // 10
    [ phi,  0,  1],   // 11
  ];

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // 20 triangular faces — CCW winding from outside. Each face is a common-
  // neighbour triangle with outward-facing normal; the table was derived from
  // the adjacency graph of the vertex set above.
  const faces: [number, number, number][] = [
    [ 0,  2,  9],
    [ 0,  4,  8],
    [ 0,  6,  4],
    [ 0,  8,  2],
    [ 0,  9,  6],
    [ 1,  3, 10],
    [ 1,  4,  6],
    [ 1,  6, 11],
    [ 1, 10,  4],
    [ 1, 11,  3],
    [ 2,  5,  7],
    [ 2,  7,  9],
    [ 2,  8,  5],
    [ 3,  5, 10],
    [ 3,  7,  5],
    [ 3, 11,  7],
    [ 4, 10,  8],
    [ 5,  8, 10],
    [ 6,  9, 11],
    [ 7, 11,  9],
  ];

  return faces.map((f) => ({
    vertices: [v[f[0]], v[f[1]], v[f[2]]],
    color,
  }));
}
