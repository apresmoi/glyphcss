/**
 * Geometry for a regular icosidodecahedron — 20 triangular faces + 12 pentagonal
 * faces (32 faces total, 30 vertices). Constructed via the edge-midpoint method
 * from the icosahedron: the 30 vertices are the midpoints of the icosahedron's 30
 * edges. Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   20 triangles — one per icosahedron face (3 edge midpoints per face).
 *   12 pentagons — one per icosahedron vertex (5 incident-edge midpoints per vertex).
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface IcosidodecahedronPolygonsOptions {
  /** Center of the icosidodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all thirty-two faces. */
  color?: string;
}

export function icosidodecahedronPolygons(options: IcosidodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // ── Icosahedron base vertices (raw, unscaled) ──────────────────────────────
  // Standard (0, ±1, ±φ) form and even permutations; 12 vertices total.
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

  // ── Build 30 edge midpoints ────────────────────────────────────────────────
  // Each edge is shared by exactly 2 faces; we deduplicate by always storing
  // edges with lower index first.
  const edgeMap = new Map<string, number>();
  const midpointsRaw: [number, number, number][] = [];

  function edgeKey(a: number, b: number): string {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  function getOrAddMidpoint(a: number, b: number): number {
    const key = edgeKey(a, b);
    if (edgeMap.has(key)) return edgeMap.get(key)!;
    const [ax, ay, az] = icoRaw[a];
    const [bx, by, bz] = icoRaw[b];
    const idx = midpointsRaw.length;
    midpointsRaw.push([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]);
    edgeMap.set(key, idx);
    return idx;
  }

  // Build midpoint indices for all icosahedron faces.
  // Also record the adjacency between each icosahedron vertex and its edge-midpoint indices.
  const vertexEdgeMids: number[][] = Array.from({ length: 12 }, () => []);

  const triMidIndices: [number, number, number][] = icoFaces.map(([a, b, c]) => {
    const mab = getOrAddMidpoint(a, b);
    const mbc = getOrAddMidpoint(b, c);
    const mca = getOrAddMidpoint(c, a);
    // Record which vertices own which midpoints (for pentagon construction).
    if (!vertexEdgeMids[a].includes(mab)) vertexEdgeMids[a].push(mab);
    if (!vertexEdgeMids[a].includes(mca)) vertexEdgeMids[a].push(mca);
    if (!vertexEdgeMids[b].includes(mab)) vertexEdgeMids[b].push(mab);
    if (!vertexEdgeMids[b].includes(mbc)) vertexEdgeMids[b].push(mbc);
    if (!vertexEdgeMids[c].includes(mbc)) vertexEdgeMids[c].push(mbc);
    if (!vertexEdgeMids[c].includes(mca)) vertexEdgeMids[c].push(mca);
    return [mab, mbc, mca];
  });

  // ── Compute circumradius of the raw midpoints and scale ────────────────────
  // All midpoints are equidistant from origin (icosidodecahedron property).
  const [mx, my, mz] = midpointsRaw[0];
  const rawCircumradius = Math.sqrt(mx * mx + my * my + mz * mz);
  const s = size / rawCircumradius;

  const v: Vec3[] = midpointsRaw.map(([x, y, z]) => [
    cx + x * s,
    cy + y * s,
    cz + z * s,
  ]);

  // ── Helper: sort a ring of vertex indices CCW around their centroid ────────
  // given the outward normal direction (away from origin).
  function sortCCW(indices: number[], normal: [number, number, number]): number[] {
    // Centroid of the raw midpoints for these vertices.
    let gcx = 0, gcy = 0, gcz = 0;
    for (const i of indices) {
      gcx += midpointsRaw[i][0];
      gcy += midpointsRaw[i][1];
      gcz += midpointsRaw[i][2];
    }
    const n = indices.length;
    gcx /= n; gcy /= n; gcz /= n;

    // Build a local 2D basis in the face plane (Gram-Schmidt against normal).
    const [nx, ny, nz] = normal;
    // First basis: direction from centroid to first vertex, projected perpendicular to normal.
    const [p0x, p0y, p0z] = midpointsRaw[indices[0]];
    let e0x = p0x - gcx, e0y = p0y - gcy, e0z = p0z - gcz;
    const dot0 = e0x * nx + e0y * ny + e0z * nz;
    e0x -= dot0 * nx; e0y -= dot0 * ny; e0z -= dot0 * nz;
    const len0 = Math.sqrt(e0x * e0x + e0y * e0y + e0z * e0z);
    e0x /= len0; e0y /= len0; e0z /= len0;
    // Second basis: cross(normal, e0).
    const e1x = ny * e0z - nz * e0y;
    const e1y = nz * e0x - nx * e0z;
    const e1z = nx * e0y - ny * e0x;

    const angles = indices.map((i) => {
      const [px, py, pz] = midpointsRaw[i];
      const dx = px - gcx, dy = py - gcy, dz = pz - gcz;
      const u = dx * e0x + dy * e0y + dz * e0z;
      const w = dx * e1x + dy * e1y + dz * e1z;
      return { i, angle: Math.atan2(w, u) };
    });

    angles.sort((a, b) => a.angle - b.angle);
    return angles.map((a) => a.i);
  }

  // ── 20 triangular faces ────────────────────────────────────────────────────
  // For each icosahedron face, the 3 edge midpoints form a triangle.
  // We need CCW winding from outside — sort by centroid normal.
  const trianglePolygons: Polygon[] = triMidIndices.map(([ma, mb, mc]) => {
    const [ax, ay, az] = midpointsRaw[ma];
    const [bx, by, bz] = midpointsRaw[mb];
    const [ccx, ccy, ccz] = midpointsRaw[mc];
    // Face normal direction = centroid of face (since solid is centered at origin).
    const normal: [number, number, number] = [
      (ax + bx + ccx) / 3,
      (ay + by + ccy) / 3,
      (az + bz + ccz) / 3,
    ];
    const sorted = sortCCW([ma, mb, mc], normal);
    return { vertices: sorted.map((i) => v[i]), color };
  });

  // ── 12 pentagonal faces ────────────────────────────────────────────────────
  // For each icosahedron vertex, its 5 incident-edge midpoints form a pentagon.
  const pentagonPolygons: Polygon[] = icoRaw.map((vRaw, vi) => {
    const mids = vertexEdgeMids[vi];
    // Normal direction = the icosahedron vertex itself (which is the centroid direction).
    const normal = vRaw as [number, number, number];
    const sorted = sortCCW(mids, normal);
    return { vertices: sorted.map((i) => v[i]), color };
  });

  return [...trianglePolygons, ...pentagonPolygons];
}
