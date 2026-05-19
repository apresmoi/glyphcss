/**
 * Geometry for a truncated dodecahedron — 20 triangular faces + 12 decagonal
 * faces (32 faces total, 60 vertices). Constructed by truncating each vertex of
 * a regular dodecahedron at parameter t = (3 − √5)/4 ≈ 0.191, the fraction along
 * each incident edge that produces regular decagons on the original pentagonal faces.
 * Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   20 triangles — one per truncated dodecahedron vertex (corner caps).
 *   12 decagons  — one per original dodecahedron face (expanded pentagon → decagon).
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface TruncatedDodecahedronPolygonsOptions {
  /** Center of the truncated dodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all thirty-two faces. */
  color?: string;
}

export function truncatedDodecahedronPolygons(options: TruncatedDodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Dodecahedron base vertices (raw, unscaled) — same as dodecahedronPolygons.ts.
  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;

  const dodRaw: [number, number, number][] = [
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

  // Dodecahedron face table (12 pentagons, CCW from outside).
  const dodFaces: [number, number, number, number, number][] = [
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

  // Build the deduplicated edge list from the face table.
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];

  for (const face of dodFaces) {
    for (let i = 0; i < 5; i++) {
      const a = face[i];
      const b = face[(i + 1) % 5];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([a, b]);
      }
    }
  }
  // 30 edges for a dodecahedron.

  // Truncation parameter: t = (3 − √5)/4 ≈ 0.191.
  // At this value each resulting decagon is a regular decagon.
  const t = (3 - Math.sqrt(5)) / 4;

  // For each directed edge (from → to), emit the truncation point at distance t
  // from `from`. p_ab = (1-t)*a + t*b (point on edge from a, at fraction t toward b).
  const truncMap = new Map<string, [number, number, number]>();

  function truncPt(from: number, to: number): [number, number, number] {
    const key = `${from},${to}`;
    if (truncMap.has(key)) return truncMap.get(key)!;
    const [ax, ay, az] = dodRaw[from];
    const [bx, by, bz] = dodRaw[to];
    const pt: [number, number, number] = [
      (1 - t) * ax + t * bx,
      (1 - t) * ay + t * by,
      (1 - t) * az + t * bz,
    ];
    truncMap.set(key, pt);
    return pt;
  }

  // Register all 60 truncation points.
  for (const [a, b] of edges) {
    truncPt(a, b);
    truncPt(b, a);
  }

  // Compute raw circumradius and scale factor.
  let rawCircumradius = 0;
  for (const pt of truncMap.values()) {
    const [x, y, z] = pt;
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d > rawCircumradius) rawCircumradius = d;
  }
  const s = size / rawCircumradius;

  // Build the adjacency list for the dodecahedron vertex graph (3 edges per vertex).
  const dodAdj: number[][] = Array.from({ length: 20 }, () => []);
  for (const [a, b] of edges) {
    dodAdj[a].push(b);
    dodAdj[b].push(a);
  }

  function scaleTP(from: number, to: number): Vec3 {
    const [x, y, z] = truncPt(from, to);
    return [cx + x * s, cy + y * s, cz + z * s];
  }

  // ── Helper: check and fix winding ──────────────────────────────────────────
  // Ensures the cross-product of the first two edges points in the given outward direction.
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

  // ── Helper: sort a list of raw points CCW around their centroid ───────────
  function sortCCWRaw(pts: [number, number, number][], normal: [number, number, number]): [number, number, number][] {
    let gcx = 0, gcy = 0, gcz = 0;
    for (const [x, y, z] of pts) { gcx += x; gcy += y; gcz += z; }
    const n = pts.length;
    gcx /= n; gcy /= n; gcz /= n;

    const [nx, ny, nz] = normal;
    const [p0x, p0y, p0z] = pts[0];
    let e0x = p0x - gcx, e0y = p0y - gcy, e0z = p0z - gcz;
    const dot0 = e0x * nx + e0y * ny + e0z * nz;
    e0x -= dot0 * nx; e0y -= dot0 * ny; e0z -= dot0 * nz;
    const len0 = Math.sqrt(e0x * e0x + e0y * e0y + e0z * e0z);
    e0x /= len0; e0y /= len0; e0z /= len0;
    const e1x = ny * e0z - nz * e0y;
    const e1y = nz * e0x - nx * e0z;
    const e1z = nx * e0y - ny * e0x;

    const indexed = pts.map((pt) => {
      const dx = pt[0] - gcx, dy = pt[1] - gcy, dz = pt[2] - gcz;
      const u = dx * e0x + dy * e0y + dz * e0z;
      const w = dx * e1x + dy * e1y + dz * e1z;
      return { pt, angle: Math.atan2(w, u) };
    });
    indexed.sort((a, b) => a.angle - b.angle);
    return indexed.map((a) => a.pt);
  }

  // ── 20 triangular faces ────────────────────────────────────────────────────
  // One triangle per dodecahedron vertex. Each dodecahedron vertex has degree 3;
  // its triangle connects the 3 truncation points on its incident edges.
  const triangles: Polygon[] = dodRaw.map(([ox, oy, oz], i) => {
    const [j, k, l] = dodAdj[i];
    const pts = [truncPt(i, j), truncPt(i, k), truncPt(i, l)];
    // Sort CCW around the outward direction (= the raw vertex itself as a direction).
    const sortedPts = sortCCWRaw(pts, [ox, oy, oz]);
    const verts: Vec3[] = sortedPts.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);
    return { vertices: fixWinding(verts, [ox, oy, oz]), color };
  });

  // ── 12 decagonal faces ─────────────────────────────────────────────────────
  // One decagon per original dodecahedron face. For each pentagonal face
  // (a0 → a1 → a2 → a3 → a4 → a0), the decagon visits:
  // p(a0,a1), p(a1,a0), p(a1,a2), p(a2,a1), p(a2,a3), p(a3,a2),
  // p(a3,a4), p(a4,a3), p(a4,a0), p(a0,a4)
  // These 10 points lie in the original face plane — outward normal = centroid
  // direction of the original face vertices.
  const decagons: Polygon[] = dodFaces.map((face) => {
    const [a0, a1, a2, a3, a4] = face;
    const pts: [number, number, number][] = [
      truncPt(a0, a1), truncPt(a1, a0),
      truncPt(a1, a2), truncPt(a2, a1),
      truncPt(a2, a3), truncPt(a3, a2),
      truncPt(a3, a4), truncPt(a4, a3),
      truncPt(a4, a0), truncPt(a0, a4),
    ];
    // Outward normal = centroid of original face vertices (the dodecahedron is
    // centered at origin, so centroid direction = outward normal).
    const [d0, d1, d2, d3, d4] = face.map((vi) => dodRaw[vi]);
    const nx = (d0[0] + d1[0] + d2[0] + d3[0] + d4[0]) / 5;
    const ny = (d0[1] + d1[1] + d2[1] + d3[1] + d4[1]) / 5;
    const nz = (d0[2] + d1[2] + d2[2] + d3[2] + d4[2]) / 5;
    const normal: [number, number, number] = [nx, ny, nz];
    const sortedPts = sortCCWRaw(pts, normal);
    const verts: Vec3[] = sortedPts.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);
    return { vertices: fixWinding(verts, normal), color };
  });

  // Triangles come first (20), then decagons (12) = 32 polygons total.
  return [...triangles, ...decagons];
}
