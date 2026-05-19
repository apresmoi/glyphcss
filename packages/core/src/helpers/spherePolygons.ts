/**
 * Icosphere geometry — a sphere approximated by subdividing an icosahedron's
 * 20 triangles. At each subdivision level every triangle is split into 4 by
 * inserting edge midpoints, and every midpoint is projected back onto the
 * circumscribed sphere of radius `size`. Shared edge midpoints are deduped
 * with a `Map` keyed on sorted endpoint indices so no seam doubles occur.
 *
 * `subdivisions=0` → 20 triangles (bare icosahedron).
 * `subdivisions=1` → 80 triangles (default).
 * `subdivisions=2` → 320 triangles.
 *
 * Base vertices are the golden-ratio (0, ±1, ±φ) form and cyclic permutations,
 * matching `icosahedronPolygons.ts`, scaled so circumradius equals `size`.
 */
import type { Polygon, Vec3 } from "../types";

export interface SpherePolygonsOptions {
  /** Center of the sphere in world space. */
  center: Vec3;
  /** Circumradius — distance from center to every surface vertex. */
  size: number;
  /** Subdivision level. 0 = icosahedron (20 tri), 1 = 80 tri (default). */
  subdivisions?: number;
  /** Fill color applied to all faces. */
  color?: string;
}

function normalize(v: Vec3, radius: number): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / len * radius, v[1] / len * radius, v[2] / len * radius];
}

export function spherePolygons(options: SpherePolygonsOptions): Polygon[] {
  const { center, size, subdivisions = 1, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // φ (golden ratio)
  const phi = (1 + Math.sqrt(5)) / 2;
  // Raw circumradius of the (0, ±1, ±φ) form is √(1 + φ²).
  const s = size / Math.sqrt(1 + phi * phi);

  // 12 base icosahedron vertices (origin-centered, on the sphere)
  const baseRaw: [number, number, number][] = [
    [ 0, -1, -phi],  //  0
    [ 0, -1,  phi],  //  1
    [ 0,  1, -phi],  //  2
    [ 0,  1,  phi],  //  3
    [-1, -phi,  0],  //  4
    [-1,  phi,  0],  //  5
    [ 1, -phi,  0],  //  6
    [ 1,  phi,  0],  //  7
    [-phi,  0, -1],  //  8
    [ phi,  0, -1],  //  9
    [-phi,  0,  1],  // 10
    [ phi,  0,  1],  // 11
  ];

  // Start with vertices on the unit sphere (size=1 circumradius), add center later.
  let verts: Vec3[] = baseRaw.map(([x, y, z]) => normalize([x * s, y * s, z * s], size));

  // 20 base faces matching icosahedronPolygons.ts
  let faces: [number, number, number][] = [
    [ 0,  2,  9], [ 0,  4,  8], [ 0,  6,  4], [ 0,  8,  2], [ 0,  9,  6],
    [ 1,  3, 10], [ 1,  4,  6], [ 1,  6, 11], [ 1, 10,  4], [ 1, 11,  3],
    [ 2,  5,  7], [ 2,  7,  9], [ 2,  8,  5], [ 3,  5, 10], [ 3,  7,  5],
    [ 3, 11,  7], [ 4, 10,  8], [ 5,  8, 10], [ 6,  9, 11], [ 7, 11,  9],
  ];

  // Subdivide
  for (let d = 0; d < subdivisions; d++) {
    const midCache = new Map<string, number>();
    const newFaces: [number, number, number][] = [];

    const getMid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const va = verts[a];
      const vb = verts[b];
      const mid: Vec3 = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
      const idx = verts.length;
      verts.push(normalize(mid, size));
      midCache.set(key, idx);
      return idx;
    };

    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = newFaces;
  }

  // Apply center offset and emit polygons
  return faces.map(([a, b, c]) => ({
    vertices: [
      [verts[a][0] + cx, verts[a][1] + cy, verts[a][2] + cz],
      [verts[b][0] + cx, verts[b][1] + cy, verts[b][2] + cz],
      [verts[c][0] + cx, verts[c][1] + cy, verts[c][2] + cz],
    ] as Vec3[],
    color,
  }));
}
