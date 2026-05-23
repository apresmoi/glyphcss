/**
 * Geometry for a truncated cube — 8 triangular faces + 6 octagonal faces
 * (14 faces total, 24 vertices). Constructed by cutting each corner of a unit
 * cube at depth t = (2 − √2)/2 along each of its 3 incident edges.
 * This truncation depth produces regular octagons on the original square faces.
 * Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   8 triangles — one per original cube vertex (corner caps).
 *   6 octagons  — one per original cube face (expanded from square to octagon).
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface TruncatedCubePolygonsOptions {
  /** Center of the truncated cube in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all fourteen faces. */
  color?: string;
}

export function truncatedCubePolygons(options: TruncatedCubePolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Cube base: vertices at (±1, ±1, ±1), edge length = 2.
  // Truncation parameter t = (2 − √2)/2 gives regular octagons.
  const t = (2 - Math.sqrt(2)) / 2;

  const cubeRaw: [number, number, number][] = [
    [-1, -1, -1],  //  0  ---
    [ 1, -1, -1],  //  1  +--
    [ 1,  1, -1],  //  2  ++-
    [-1,  1, -1],  //  3  -+-
    [-1, -1,  1],  //  4  --+
    [ 1, -1,  1],  //  5  +-+
    [ 1,  1,  1],  //  6  +++
    [-1,  1,  1],  //  7  -++
  ];

  // Cube edges (12 total).
  const cubeEdges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],  // -z face ring
    [4, 5], [5, 6], [6, 7], [7, 4],  // +z face ring
    [0, 4], [1, 5], [2, 6], [3, 7],  // vertical edges
  ];

  // Build 24 truncation points: for each edge (a,b), two points p_ab and p_ba.
  // p_ab = (1-t)*a + t*b   (point on edge from a toward b, at distance t from a)
  // p_ba = t*a + (1-t)*b   (point on edge from b toward a, at distance t from b)
  const midMap = new Map<string, [number, number, number]>();

  function truncPt(from: number, to: number): [number, number, number] {
    const key = `${from},${to}`;
    if (midMap.has(key)) return midMap.get(key)!;
    const [ax, ay, az] = cubeRaw[from];
    const [bx, by, bz] = cubeRaw[to];
    const pt: [number, number, number] = [
      (1 - t) * ax + t * bx,
      (1 - t) * ay + t * by,
      (1 - t) * az + t * bz,
    ];
    midMap.set(key, pt);
    return pt;
  }

  // Register all truncation points.
  for (const [a, b] of cubeEdges) {
    truncPt(a, b);
    truncPt(b, a);
  }

  // Compute raw circumradius and scale factor.
  let rawCircumradius = 0;
  for (const pt of midMap.values()) {
    const [x, y, z] = pt;
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d > rawCircumradius) rawCircumradius = d;
  }
  const s = size / rawCircumradius;

  const scaleVec = (pt: [number, number, number]): Vec3 => [
    cx + pt[0] * s,
    cy + pt[1] * s,
    cz + pt[2] * s,
  ];

  function scaleTP(from: number, to: number): Vec3 {
    return scaleVec(truncPt(from, to));
  }

  // ── Helper: check and fix winding ─────────────────────────────────────────
  function fixWinding(verts: Vec3[], outward: [number, number, number]): Vec3[] {
    const [ox, oy, oz] = outward;
    const p0 = verts[0], p1 = verts[1], p2 = verts[2];
    const e0x = p1[0] - p0[0], e0y = p1[1] - p0[1], e0z = p1[2] - p0[2];
    const e1x = p2[0] - p0[0], e1y = p2[1] - p0[1], e1z = p2[2] - p0[2];
    const nx = e0y * e1z - e0z * e1y;
    const ny = e0z * e1x - e0x * e1z;
    const nz = e0x * e1y - e0y * e1x;
    if (nx * ox + ny * oy + nz * oz < 0) return [...verts].reverse();
    return verts;
  }

  // ── 8 triangular corner faces ──────────────────────────────────────────────
  // Cube vertex adjacencies (each vertex connects to 3 others via edges):
  const cubeAdj: [number, number, number][] = [
    [1, 3, 4],   // 0 ---  → +-- , -+- , --+
    [0, 2, 5],   // 1 +--  → --- , ++- , +-+
    [1, 3, 6],   // 2 ++-  → +-- , -+- , +++
    [0, 2, 7],   // 3 -+-  → --- , ++- , -++
    [0, 5, 7],   // 4 --+  → --- , +-+ , -++
    [1, 4, 6],   // 5 +-+  → +-- , --+ , +++
    [2, 5, 7],   // 6 +++  → ++- , +-+ , -++
    [3, 4, 6],   // 7 -++  → -+- , --+ , +++
  ];

  const triangles: Polygon[] = cubeRaw.map(([ox, oy, oz], i) => {
    const [j, k, l] = cubeAdj[i];
    const verts: Vec3[] = [scaleTP(i, j), scaleTP(i, k), scaleTP(i, l)];
    return { vertices: fixWinding(verts, [ox, oy, oz]), color };
  });

  // ── 6 octagonal faces ──────────────────────────────────────────────────────
  // Each cube face becomes an octagon — 8 vertices interleaving two truncation
  // points per original edge.
  // Original cube faces (CCW from outside):
  //   +Z: 4,5,6,7  (normal +z)
  //   -Z: 1,0,3,2  (normal -z)
  //   +X: 5,1,2,6  (normal +x)
  //   -X: 0,4,7,3  (normal -x)
  //   +Y: 7,6,2,3  (normal +y)
  //   -Y: 0,1,5,4  (normal -y)
  const cubeFaces: { corners: [number, number, number, number]; normal: [number, number, number] }[] = [
    { corners: [4, 5, 6, 7], normal: [ 0,  0,  1] },
    { corners: [1, 0, 3, 2], normal: [ 0,  0, -1] },
    { corners: [5, 1, 2, 6], normal: [ 1,  0,  0] },
    { corners: [0, 4, 7, 3], normal: [-1,  0,  0] },
    { corners: [7, 6, 2, 3], normal: [ 0,  1,  0] },
    { corners: [0, 1, 5, 4], normal: [ 0, -1,  0] },
  ];

  const octagons: Polygon[] = cubeFaces.map(({ corners, normal }) => {
    const [a, b, c, d] = corners;
    // For each consecutive edge pair in the face ring, insert two truncation points:
    // the one from the leading vertex toward the trailing, then from the trailing toward the leading.
    const verts: Vec3[] = [
      scaleTP(a, b), scaleTP(b, a),
      scaleTP(b, c), scaleTP(c, b),
      scaleTP(c, d), scaleTP(d, c),
      scaleTP(d, a), scaleTP(a, d),
    ];
    return { vertices: fixWinding(verts, normal), color };
  });

  return [...triangles, ...octagons];
}
