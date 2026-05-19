/**
 * Geometry for a small stellated dodecahedron — Schläfli symbol {5/2, 5}.
 * 12 pentagram faces on the 12 icosahedron vertices; each pentagram is
 * decomposed into 5 triangles fanned from the face centroid (60 triangles
 * total). Using star-polygon faces directly would fan-triangulate into a
 * convex pentagon; the fan-from-centroid approach produces the correct
 * 5-pointed-star silhouette.
 *
 * Vertices: the 12 standard icosahedron vertices (circumradius = `size`).
 * Each pentagram face: centroid + 5 outer points picked from the icosahedron
 * vertex set and ordered angularly in the plane perpendicular to the face
 * axis; the [0,2,4,1,3] permutation of that angular order produces the
 * every-other-vertex (pentagram) skip that makes a star.
 */
import type { Polygon, Vec3 } from "../types";

export interface SmallStellatedDodecahedronPolygonsOptions {
  /** Center of the polyhedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function smallStellatedDodecahedronPolygons(
  options: SmallStellatedDodecahedronPolygonsOptions
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

  // For each icosahedron vertex c (0..11):
  //   1. Find its antipode (the vertex with dot product closest to -|c|²).
  //   2. Exclude c itself and its antipode; the remaining 10 vertices split
  //      into two pentagons around c and its antipode.
  //   3. Sort all 10 by dot product with raw[c] descending — the top 5 are
  //      the pentagon closest to c.
  //   4. Sort those 5 by angle in the plane perpendicular to raw[c] to get a
  //      consistent angular order.
  //   5. Apply [0,2,4,1,3] permutation for pentagram (every-other) skip order.
  //   6. Emit 5 triangles: [centroid, star_i, star_{(i+2)%5}].

  function dot3(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  // Build a local 2-D basis in the plane perpendicular to `axis`.
  function perpBasis(axis: [number, number, number]): {
    u: [number, number, number];
    w: [number, number, number];
  } {
    // Pick a vector not parallel to axis.
    const ref: [number, number, number] =
      Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    // u = normalize(ref − (ref·axis)axis)
    const d = dot3(ref, axis);
    const ux = ref[0] - d * axis[0];
    const uy = ref[1] - d * axis[1];
    const uz = ref[2] - d * axis[2];
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const u: [number, number, number] = [ux / ul, uy / ul, uz / ul];
    // w = axis × u
    const w: [number, number, number] = [
      axis[1] * u[2] - axis[2] * u[1],
      axis[2] * u[0] - axis[0] * u[2],
      axis[0] * u[1] - axis[1] * u[0],
    ];
    return { u, w };
  }

  const polygons: Polygon[] = [];

  for (let c = 0; c < 12; c++) {
    const axis = raw[c];
    const axisLenSq = dot3(axis, axis);

    // Find antipode: most negative dot product with axis.
    let antipode = -1;
    let minDot = Infinity;
    for (let i = 0; i < 12; i++) {
      if (i === c) continue;
      const d = dot3(raw[i], axis);
      if (d < minDot) { minDot = d; antipode = i; }
    }

    // Collect the other 10 vertices; sort descending by dot with axis to find
    // the 5 nearest to c.
    const others: { idx: number; d: number }[] = [];
    for (let i = 0; i < 12; i++) {
      if (i === c || i === antipode) continue;
      others.push({ idx: i, d: dot3(raw[i], axis) });
    }
    others.sort((a, b) => b.d - a.d);
    const nearFive = others.slice(0, 5).map((o) => o.idx);

    // Sort by angle in the plane perpendicular to axis.
    const normAxis: [number, number, number] = [
      axis[0] / Math.sqrt(axisLenSq),
      axis[1] / Math.sqrt(axisLenSq),
      axis[2] / Math.sqrt(axisLenSq),
    ];
    const { u, w } = perpBasis(normAxis);
    nearFive.sort((a, b) => {
      const ra = raw[a];
      const rb = raw[b];
      const angA = Math.atan2(dot3(ra, w), dot3(ra, u));
      const angB = Math.atan2(dot3(rb, w), dot3(rb, u));
      return angA - angB;
    });

    // Pentagram skip order: [0,2,4,1,3] of the angularly-sorted pentagon.
    const starOrder = [0, 2, 4, 1, 3];
    const outerIdx = starOrder.map((i) => nearFive[i]);

    // Centroid of the 5 outer points (in world space).
    let gcx = 0, gcy = 0, gcz = 0;
    for (const i of outerIdx) {
      gcx += v[i][0]; gcy += v[i][1]; gcz += v[i][2];
    }
    const centroid: Vec3 = [gcx / 5, gcy / 5, gcz / 5];

    // 5 triangles: [centroid, outer_i, outer_{(i+2)%5}].
    for (let i = 0; i < 5; i++) {
      const a = v[outerIdx[i]];
      const b = v[outerIdx[(i + 2) % 5]];

      // Orient normal away from polyhedron centroid (origin in local coords).
      // Cross product (a-centroid) × (b-centroid) should point away from origin.
      const ea: Vec3 = [a[0] - centroid[0], a[1] - centroid[1], a[2] - centroid[2]];
      const eb: Vec3 = [b[0] - centroid[0], b[1] - centroid[1], b[2] - centroid[2]];
      const nx = ea[1] * eb[2] - ea[2] * eb[1];
      const ny = ea[2] * eb[0] - ea[0] * eb[2];
      const nz = ea[0] * eb[1] - ea[1] * eb[0];
      // The "outward" direction is from polyhedron center (cx,cy,cz) toward centroid.
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
