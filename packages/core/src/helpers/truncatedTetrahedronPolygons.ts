/**
 * Geometry for a truncated tetrahedron — 4 triangular faces + 4 hexagonal faces
 * (8 faces total, 12 vertices). Constructed by cutting each corner of a regular
 * tetrahedron at 1/3 of the edge length from the vertex.
 * Scaled so the circumradius equals `size`.
 *
 * Vertex ordering (12 total):
 *   For each of the 4 tetrahedron vertices v[i], 3 truncation points are produced
 *   at p_ij = (2/3)v[i] + (1/3)v[j] for each of the 3 incident edges.
 *
 * Face decomposition:
 *   4 triangles — one per original tetrahedron vertex (corner caps).
 *   4 hexagons  — one per original tetrahedron face (expanded from triangle to hexagon).
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface TruncatedTetrahedronPolygonsOptions {
  /** Center of the truncated tetrahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all eight faces. */
  color?: string;
}

export function truncatedTetrahedronPolygons(options: TruncatedTetrahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Base tetrahedron vertices — alternating cube corners at (±1,±1,±1).
  // Raw circumradius of this form is √3.
  const icoScale = 1 / Math.sqrt(3);
  const tetraRaw: [number, number, number][] = [
    [ 1,  1,  1],   // 0
    [-1, -1,  1],   // 1
    [-1,  1, -1],   // 2
    [ 1, -1, -1],   // 3
  ];

  // Build 12 truncation points: for each vertex v[i] and each of its 3 neighbours v[j],
  // p_ij = (2/3)v[i] + (1/3)v[j].
  // All 4 tetrahedron vertices are fully connected (complete graph K4), so every
  // (i,j) pair where i≠j defines a truncation point from i toward j.
  // We index them as: midIdx[i][j] = index of p_ij.
  const midRaw: [number, number, number][][] = Array.from({ length: 4 }, () => new Array(4));
  const allMidRaw: [number, number, number][] = [];

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (i === j) continue;
      const [ax, ay, az] = tetraRaw[i];
      const [bx, by, bz] = tetraRaw[j];
      const pt: [number, number, number] = [
        (2 / 3) * ax + (1 / 3) * bx,
        (2 / 3) * ay + (1 / 3) * by,
        (2 / 3) * az + (1 / 3) * bz,
      ];
      midRaw[i][j] = pt;
      allMidRaw.push(pt);
    }
  }

  // Compute the actual circumradius of the truncation points and scale.
  // The maximum distance from origin among all truncation points is the circumradius.
  let rawCircumradius = 0;
  for (const [x, y, z] of allMidRaw) {
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d > rawCircumradius) rawCircumradius = d;
  }
  const s = size / rawCircumradius;
  void icoScale; // tetraRaw coordinates are already correct ratios; icoScale not needed separately.

  // Build scaled vertex lookup: midIdx[i][j] → Vec3 in world space.
  const mid = (i: number, j: number): Vec3 => {
    const [x, y, z] = midRaw[i][j];
    return [cx + x * s, cy + y * s, cz + z * s];
  };

  // ── 4 triangular corner faces ──────────────────────────────────────────────
  // Corner at v[i] connects p_ij, p_ik, p_il (the 3 outgoing truncation points).
  // The neighbours of v[i] are the other 3 vertices.
  // Winding: CCW when viewed from v[i] direction (outward from center).
  // Since v[i] is known, we need the outward-facing winding.
  // We determine the correct winding by checking the cross-product sign.
  function makeTriangle(i: number): Vec3[] {
    const others = [0, 1, 2, 3].filter((x) => x !== i);
    const [j, k, l] = others;
    const a = mid(i, j);
    const b = mid(i, k);
    const c = mid(i, l);
    // Outward normal should point away from the solid center (≈ in direction of tetraRaw[i]).
    const [ox, oy, oz] = tetraRaw[i];
    // Compute cross product (b-a) × (c-a).
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    // If cross product points inward (dot with outward direction < 0), reverse.
    if (nx * ox + ny * oy + nz * oz < 0) return [a, c, b];
    return [a, b, c];
  }

  // ── 4 hexagonal faces ──────────────────────────────────────────────────────
  // The hexagon at original face (a,b,c) uses 6 truncation points in order:
  // p_ab, p_ba, p_bc, p_cb, p_ca, p_ac (going around the triangle edge-by-edge,
  // taking the point closer to the leading vertex first, then closer to the trailing).
  function makeHexagon(a: number, b: number, c: number): Vec3[] {
    // Go around face a→b→c→a; for each edge take the point from the leading vertex,
    // then the point from the trailing vertex.
    const verts: Vec3[] = [
      mid(a, b), mid(b, a),
      mid(b, c), mid(c, b),
      mid(c, a), mid(a, c),
    ];
    // Outward normal direction = centroid of the original face vertices (in raw coords).
    const [ax, ay, az] = tetraRaw[a];
    const [bx, by, bz] = tetraRaw[b];
    const [ccx, ccy, ccz] = tetraRaw[c];
    const ox = (ax + bx + ccx) / 3;
    const oy = (ay + by + ccy) / 3;
    const oz = (az + bz + ccz) / 3;
    // Check winding: cross of (verts[1]-verts[0]) × (verts[2]-verts[0]).
    const p0 = verts[0], p1 = verts[1], p2 = verts[2];
    const e0x = p1[0] - p0[0], e0y = p1[1] - p0[1], e0z = p1[2] - p0[2];
    const e1x = p2[0] - p0[0], e1y = p2[1] - p0[1], e1z = p2[2] - p0[2];
    const nx = e0y * e1z - e0z * e1y;
    const ny = e0z * e1x - e0x * e1z;
    const nz = e0x * e1y - e0y * e1x;
    if (nx * ox + ny * oy + nz * oz < 0) verts.reverse();
    return verts;
  }

  const triangles: Polygon[] = [0, 1, 2, 3].map((i) => ({
    vertices: makeTriangle(i),
    color,
  }));

  // The 4 tetrahedron faces (CCW from outside, consistent with tetrahedronPolygons.ts):
  // [0,2,1], [0,1,3], [0,3,2], [1,2,3] — but here we just need the 3 vertex indices.
  const tetraFaces: [number, number, number][] = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];

  const hexagons: Polygon[] = tetraFaces.map(([a, b, c]) => ({
    vertices: makeHexagon(a, b, c),
    color,
  }));

  return [...triangles, ...hexagons];
}
