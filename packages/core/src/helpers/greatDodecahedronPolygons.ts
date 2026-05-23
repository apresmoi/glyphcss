/**
 * Geometry for a great dodecahedron — Schläfli symbol {5, 5/2}.
 * 12 convex pentagonal faces on the 12 icosahedron vertices; each face is the
 * convex pentagon formed by the 5 nearest vertices to one icosahedron vertex
 * (same vertex group as the small stellated dodecahedron, but the 5 outer
 * points are emitted in natural angular order rather than pentagram-skip
 * order). The rasterizer fan-triangulates convex pentagons correctly from
 * vertex 0 without any special decomposition.
 *
 * Vertices: the 12 standard icosahedron vertices (circumradius = `size`).
 */
import type { Polygon, Vec3 } from "../types";

export interface GreatDodecahedronPolygonsOptions {
  /** Center of the polyhedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all faces. */
  color?: string;
}

export function greatDodecahedronPolygons(
  options: GreatDodecahedronPolygonsOptions
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

  function dot3(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function perpBasis(axis: [number, number, number]): {
    u: [number, number, number];
    w: [number, number, number];
  } {
    const ref: [number, number, number] =
      Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = dot3(ref, axis);
    const ux = ref[0] - d * axis[0];
    const uy = ref[1] - d * axis[1];
    const uz = ref[2] - d * axis[2];
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    const u: [number, number, number] = [ux / ul, uy / ul, uz / ul];
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

    // Find antipode.
    let antipode = -1;
    let minDot = Infinity;
    for (let i = 0; i < 12; i++) {
      if (i === c) continue;
      const d = dot3(raw[i], axis);
      if (d < minDot) { minDot = d; antipode = i; }
    }

    // 5 nearest vertices to c (excluding c and its antipode).
    const others: { idx: number; d: number }[] = [];
    for (let i = 0; i < 12; i++) {
      if (i === c || i === antipode) continue;
      others.push({ idx: i, d: dot3(raw[i], axis) });
    }
    others.sort((a, b) => b.d - a.d);
    const nearFive = others.slice(0, 5).map((o) => o.idx);

    // Sort by angle for the convex pentagon winding (natural angular order).
    const normAxis: [number, number, number] = [
      axis[0] / Math.sqrt(axisLenSq),
      axis[1] / Math.sqrt(axisLenSq),
      axis[2] / Math.sqrt(axisLenSq),
    ];
    const { u, w } = perpBasis(normAxis);
    nearFive.sort((a, b) => {
      const ra = raw[a];
      const rb = raw[b];
      return Math.atan2(dot3(ra, w), dot3(ra, u)) - Math.atan2(dot3(rb, w), dot3(rb, u));
    });

    // Emit as a 5-vertex convex polygon. Check CCW winding from outside.
    // "Outside" = away from the polyhedron centroid (cx, cy, cz).
    // Pentagon centroid:
    let pcx = 0, pcy = 0, pcz = 0;
    for (const i of nearFive) { pcx += v[i][0]; pcy += v[i][1]; pcz += v[i][2]; }
    pcx /= 5; pcy /= 5; pcz /= 5;

    // Normal of the face (cross product of first two edges of the fan).
    const p0 = v[nearFive[0]];
    const p1 = v[nearFive[1]];
    const p2 = v[nearFive[2]];
    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const outX = pcx - cx, outY = pcy - cy, outZ = pcz - cz;
    const flip = nx * outX + ny * outY + nz * outZ < 0;

    const ordered = flip ? [...nearFive].reverse() : nearFive;
    polygons.push({
      vertices: ordered.map((i) => v[i]) as Vec3[],
      color,
    });
  }

  return polygons;
}
