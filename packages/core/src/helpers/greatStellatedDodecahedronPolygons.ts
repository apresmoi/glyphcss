/**
 * Geometry for a great stellated dodecahedron — Schläfli symbol {5/2, 3}.
 * 12 pentagram faces on the 20 dodecahedron vertices; each pentagram uses
 * the same 5-vertex grouping as the dodecahedron faces but reordered into
 * pentagram (every-other-vertex) skip order before being decomposed into
 * 5 triangles fanned from the face centroid (60 triangles total).
 *
 * Vertices: the 20 standard dodecahedron vertices (circumradius = `size`).
 * Face groups: same 12 pentagonal groupings as dodecahedronPolygons.ts;
 * the [0,2,4,1,3] permutation of the convex-pentagon order produces the
 * pentagram skip that makes each face a 5-pointed star.
 */
import type { Polygon, Vec3 } from "../types";

export interface GreatStellatedDodecahedronPolygonsOptions {
  /** Center of the polyhedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function greatStellatedDodecahedronPolygons(
  options: GreatStellatedDodecahedronPolygonsOptions
): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;
  const s = size / Math.sqrt(3);

  // 20 dodecahedron vertices (same ordering as dodecahedronPolygons.ts).
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

  // The same 12 pentagonal faces as dodecahedronPolygons.ts (CCW convex order).
  const dodecFaces: [number, number, number, number, number][] = [
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

  // Pentagram skip order: [0,2,4,1,3] of the convex-pentagon vertex order.
  const STAR_PERM = [0, 2, 4, 1, 3] as const;

  const polygons: Polygon[] = [];

  for (const face of dodecFaces) {
    // Reorder to pentagram (every-other-vertex) skip order.
    const outerIdx = STAR_PERM.map((i) => face[i]);

    // Centroid of the 5 outer points (world space).
    let gcx = 0, gcy = 0, gcz = 0;
    for (const i of outerIdx) {
      gcx += v[i][0]; gcy += v[i][1]; gcz += v[i][2];
    }
    const centroid: Vec3 = [gcx / 5, gcy / 5, gcz / 5];

    // 5 triangles: [centroid, outer_i, outer_{(i+2)%5}].
    for (let i = 0; i < 5; i++) {
      const a = v[outerIdx[i]];
      const b = v[outerIdx[(i + 2) % 5]];

      // Orient normal away from polyhedron centroid.
      const ea: Vec3 = [a[0] - centroid[0], a[1] - centroid[1], a[2] - centroid[2]];
      const eb: Vec3 = [b[0] - centroid[0], b[1] - centroid[1], b[2] - centroid[2]];
      const nx = ea[1] * eb[2] - ea[2] * eb[1];
      const ny = ea[2] * eb[0] - ea[0] * eb[2];
      const nz = ea[0] * eb[1] - ea[1] * eb[0];
      const outX = centroid[0] - cx;
      const outY = centroid[1] - cy;
      const outZ = centroid[2] - cz;
      const flip = nx * outX + ny * outY + nz * outZ < 0;

      polygons.push({
        vertices: flip ? [centroid, b, a] : [centroid, a, b],
        color,
      });
    }
  }

  return polygons;
}
