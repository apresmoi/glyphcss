/**
 * Geometry for a regular cuboctahedron — 8 triangular faces + 6 square faces
 * (14 faces total, 12 vertices). Vertices are all permutations of (±1, ±1, 0).
 * Scaled so the circumradius equals `size`.
 *
 * Vertex ordering (12 total):
 *   Indices 0–3:  (±1, ±1, 0)
 *   Indices 4–7:  (±1, 0, ±1)
 *   Indices 8–11: (0, ±1, ±1)
 *
 * Face decomposition: 8 equilateral triangles (one per octant) + 6 squares
 * (one per cube face — edge midpoints of a cube). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface CuboctahedronPolygonsOptions {
  /** Center of the cuboctahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all fourteen faces. */
  color?: string;
}

export function cuboctahedronPolygons(options: CuboctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Raw circumradius of the (±1, ±1, 0) form is √2.
  // Scale so circumradius equals `size`.
  const s = size / Math.sqrt(2);

  // 12 vertices — all permutations of (±1, ±1, 0).
  const raw: [number, number, number][] = [
    [ 1,  1,  0],   //  0
    [ 1, -1,  0],   //  1
    [-1,  1,  0],   //  2
    [-1, -1,  0],   //  3
    [ 1,  0,  1],   //  4
    [ 1,  0, -1],   //  5
    [-1,  0,  1],   //  6
    [-1,  0, -1],   //  7
    [ 0,  1,  1],   //  8
    [ 0,  1, -1],   //  9
    [ 0, -1,  1],   // 10
    [ 0, -1, -1],   // 11
  ];

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // 8 triangular faces — one per octant (±,±,±).
  // For octant (sx,sy,sz): triangle connects (sx,sy,0), (sx,0,sz), (0,sy,sz).
  // Winding is CCW when viewed from the outward octant direction.
  const triangleFaces: [number, number, number][] = [
    [ 0,  4,  8],   // (+,+,+)
    [ 0,  9,  5],   // (+,+,-)
    [ 1, 10,  4],   // (+,-,+)
    [ 1,  5, 11],   // (+,-,-)
    [ 2,  8,  6],   // (-,+,+)
    [ 2,  7,  9],   // (-,+,-)
    [ 3,  6, 10],   // (-,-,+)
    [ 3, 11,  7],   // (-,-,-)
  ];

  // 6 square faces — each corresponds to one face of the parent cube.
  // Vertices are the midpoints of that cube face's 4 edges, ordered CCW from outside.
  // +z face: (0,1,1),(−1,0,1),(0,−1,1),(1,0,1)
  // -z face: (0,1,−1),(1,0,−1),(0,−1,−1),(−1,0,−1)
  // +x face: (1,1,0),(1,0,1),(1,−1,0),(1,0,−1)
  // -x face: (−1,1,0),(−1,0,−1),(−1,−1,0),(−1,0,1)
  // +y face: (1,1,0),(0,1,1),(−1,1,0),(0,1,−1)
  // -y face: (1,−1,0),(0,−1,−1),(−1,−1,0),(0,−1,1)
  const squareFaces: [number, number, number, number][] = [
    [ 8,  6, 10,  4],   // +Z
    [ 9,  5, 11,  7],   // -Z
    [ 0,  4,  1,  5],   // +X
    [ 2,  7,  3,  6],   // -X
    [ 0,  8,  2,  9],   // +Y
    [ 1, 11,  3, 10],   // -Y
  ];

  return [
    ...triangleFaces.map((f) => ({
      vertices: [v[f[0]], v[f[1]], v[f[2]]],
      color,
    })),
    ...squareFaces.map((f) => ({
      vertices: [v[f[0]], v[f[1]], v[f[2]], v[f[3]]],
      color,
    })),
  ];
}
