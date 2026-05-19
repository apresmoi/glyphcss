/**
 * Geometry for a great icosahedron — Schläfli symbol {3, 5/2}.
 * 20 triangular faces on the 12 icosahedron vertices in a non-convex
 * configuration. Each face is derived from the corresponding icosahedron face
 * by replacing every vertex with its antipode (the diametrically opposite
 * vertex on the circumscribed sphere), then reversing the winding to restore
 * CCW orientation (antipode-flipping mirrors the original CCW winding to CW).
 *
 * Vertices: the 12 standard icosahedron vertices (circumradius = `size`).
 * Face table: antipode-flipped icosahedron faces with winding reversed —
 * yields 20 distinct, non-degenerate triangles with correct outward normals.
 */
import type { Polygon, Vec3 } from "../types";

export interface GreatIcosahedronPolygonsOptions {
  /** Center of the polyhedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function greatIcosahedronPolygons(
  options: GreatIcosahedronPolygonsOptions
): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const phi = (1 + Math.sqrt(5)) / 2;
  const s = size / Math.sqrt(1 + phi * phi);

  // 12 icosahedron vertices (same ordering as icosahedronPolygons.ts).
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

  // The 20 icosahedron faces (same table as icosahedronPolygons.ts, CCW from outside).
  const icoFaces: [number, number, number][] = [
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

  // Build antipode map: for each vertex, find the index with the most-negative
  // dot product (i.e. the diametrically opposite vertex).
  const antipode: number[] = Array(12).fill(-1);
  for (let i = 0; i < 12; i++) {
    let minDot = Infinity;
    for (let j = 0; j < 12; j++) {
      if (j === i) continue;
      const d = raw[i][0] * raw[j][0] + raw[i][1] * raw[j][1] + raw[i][2] * raw[j][2];
      if (d < minDot) { minDot = d; antipode[i] = j; }
    }
  }

  // For each icosahedron face (a,b,c), the great-icosahedron face is
  // (antipode(a), antipode(c), antipode(b)) — reversed winding to compensate
  // for the reflection inherent in antipode-flipping.
  return icoFaces.map(([a, b, c]) => ({
    vertices: [v[antipode[a]], v[antipode[c]], v[antipode[b]]],
    color,
  }));
}
