/**
 * Geometry for a truncated icosahedron (soccer ball / Buckminster fullerene) —
 * 12 pentagonal faces + 20 hexagonal faces (32 faces total, 60 vertices).
 * Constructed by truncating each vertex of a regular icosahedron at t = 1/3
 * (the unique rational truncation fraction for Archimedean solids — makes the
 * hexagons regular). Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   12 pentagons — one per icosahedron vertex (5 truncation points on incident edges).
 *   20 hexagons  — one per icosahedron face (6 truncation points around each triangle).
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface TruncatedIcosahedronPolygonsOptions {
  /** Center of the truncated icosahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all thirty-two faces. */
  color?: string;
}

export function truncatedIcosahedronPolygons(options: TruncatedIcosahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Icosahedron base vertices (raw, unscaled) — same as icosahedronPolygons.ts.
  const phi = (1 + Math.sqrt(5)) / 2;

  const icoRaw: [number, number, number][] = [
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

  // Icosahedron face table (same as icosahedronPolygons.ts).
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

  // Build the deduplicated edge list.
  const edgeSet = new Set<string>();
  const edges: [number, number][] = [];

  for (const [a, b, c] of icoFaces) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([u, v]);
      }
    }
  }
  // 30 edges for an icosahedron.

  // Truncation parameter: t = 1/3 exactly — unique rational value giving regular hexagons.
  const t = 1 / 3;

  // For each directed edge (from → to), emit the truncation point at fraction t from `from`.
  const truncMap = new Map<string, [number, number, number]>();

  function truncPt(from: number, to: number): [number, number, number] {
    const key = `${from},${to}`;
    if (truncMap.has(key)) return truncMap.get(key)!;
    const [ax, ay, az] = icoRaw[from];
    const [bx, by, bz] = icoRaw[to];
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

  // Build the icosahedron vertex adjacency list (5 edges per vertex).
  const icoAdj: number[][] = Array.from({ length: 12 }, () => []);
  for (const [a, b] of edges) {
    icoAdj[a].push(b);
    icoAdj[b].push(a);
  }

  // ── Helper: check and fix winding ──────────────────────────────────────────
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

  // ── 12 pentagonal faces ────────────────────────────────────────────────────
  // One pentagon per icosahedron vertex. Each vertex has 5 incident edges;
  // the pentagon visits the 5 truncation points closest to this vertex.
  const pentagons: Polygon[] = icoRaw.map(([ox, oy, oz], vi) => {
    const pts: [number, number, number][] = icoAdj[vi].map((nb) => truncPt(vi, nb));
    const sortedPts = sortCCWRaw(pts, [ox, oy, oz]);
    const verts: Vec3[] = sortedPts.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);
    return { vertices: fixWinding(verts, [ox, oy, oz]), color };
  });

  // ── 20 hexagonal faces ─────────────────────────────────────────────────────
  // One hexagon per icosahedron face. For each triangular face (a → b → c → a),
  // the hexagon visits the 6 truncation points around the triangle:
  // p(a,b), p(b,a), p(b,c), p(c,b), p(c,a), p(a,c)
  const hexagons: Polygon[] = icoFaces.map(([a, b, c]) => {
    const pts: [number, number, number][] = [
      truncPt(a, b), truncPt(b, a),
      truncPt(b, c), truncPt(c, b),
      truncPt(c, a), truncPt(a, c),
    ];
    // Outward normal = centroid of original triangle face vertices.
    const d0 = icoRaw[a], d1 = icoRaw[b], d2 = icoRaw[c];
    const normal: [number, number, number] = [
      (d0[0] + d1[0] + d2[0]) / 3,
      (d0[1] + d1[1] + d2[1]) / 3,
      (d0[2] + d1[2] + d2[2]) / 3,
    ];
    const sortedPts = sortCCWRaw(pts, normal);
    const verts: Vec3[] = sortedPts.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);
    return { vertices: fixWinding(verts, normal), color };
  });

  // Pentagons first (12), then hexagons (20) = 32 polygons total.
  return [...pentagons, ...hexagons];
}
