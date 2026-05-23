/**
 * Geometry for a truncated octahedron (permutohedron) — 6 square faces + 8 hexagonal
 * faces (14 faces total, 24 vertices). Vertices are all permutations of (0, ±1, ±2).
 * Scaled so the circumradius equals `size`.
 *
 * Vertex ordering (24 total):
 *   All ordered triples using one 0, one ±1, one ±2 (3! × 4 = 24 vertices).
 *
 * Face decomposition:
 *   6 squares  — one per axis direction ±x/±y/±z, lying in the plane where one
 *                coordinate equals ±2.
 *   8 hexagons — one per octant normal (±1,±1,±1); vertices satisfy x+y+z = ±3
 *                (for all-positive/all-negative octants) or mixed-sign combinations.
 *
 * Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";

export interface TruncatedOctahedronPolygonsOptions {
  /** Center of the truncated octahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all fourteen faces. */
  color?: string;
}

export function truncatedOctahedronPolygons(options: TruncatedOctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Raw circumradius: √(0² + 1² + 2²) = √5.
  const s = size / Math.sqrt(5);

  // Generate all 24 vertices: each is a permutation of (0, ±1, ±2).
  // One coordinate is 0 (3 choices of axis), one is ±1 (2 signs), one is ±2 (2 signs),
  // and the ±1 and ±2 values can be assigned to either of the two non-zero axes (2 ways).
  // 3 × 2 × 2 × 2 = 24 total.
  const seen = new Set<string>();
  const uniqueRaw: [number, number, number][] = [];

  for (let zeroAxis = 0; zeroAxis < 3; zeroAxis++) {
    const other1 = (zeroAxis + 1) % 3;
    const other2 = (zeroAxis + 2) % 3;
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        for (const swap of [false, true]) {
          const pt: [number, number, number] = [0, 0, 0];
          // zeroAxis coordinate stays 0.
          pt[other1] = swap ? s1 * 2 : s1 * 1;
          pt[other2] = swap ? s2 * 1 : s2 * 2;
          const key = `${pt[0]},${pt[1]},${pt[2]}`;
          if (!seen.has(key)) { seen.add(key); uniqueRaw.push(pt); }
        }
      }
    }
  }

  const v: Vec3[] = uniqueRaw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Index lookup: raw coord → vertex index.
  const vertIdx = new Map<string, number>();
  for (let i = 0; i < uniqueRaw.length; i++) {
    const [x, y, z] = uniqueRaw[i];
    vertIdx.set(`${x},${y},${z}`, i);
  }

  function idx(x: number, y: number, z: number): number {
    const key = `${x},${y},${z}`;
    const i = vertIdx.get(key);
    if (i === undefined) throw new Error(`Vertex not found: (${x},${y},${z})`);
    return i;
  }

  // ── Helper: sort vertices CCW around a face normal ─────────────────────────
  function sortCCW(indices: number[], normal: [number, number, number]): number[] {
    let gcx = 0, gcy = 0, gcz = 0;
    for (const i of indices) {
      gcx += uniqueRaw[i][0]; gcy += uniqueRaw[i][1]; gcz += uniqueRaw[i][2];
    }
    const n = indices.length;
    gcx /= n; gcy /= n; gcz /= n;

    const [nx, ny, nz] = normal;
    const [p0x, p0y, p0z] = uniqueRaw[indices[0]];
    let e0x = p0x - gcx, e0y = p0y - gcy, e0z = p0z - gcz;
    const dot0 = e0x * nx + e0y * ny + e0z * nz;
    e0x -= dot0 * nx; e0y -= dot0 * ny; e0z -= dot0 * nz;
    const len0 = Math.sqrt(e0x * e0x + e0y * e0y + e0z * e0z);
    e0x /= len0; e0y /= len0; e0z /= len0;
    const e1x = ny * e0z - nz * e0y;
    const e1y = nz * e0x - nx * e0z;
    const e1z = nx * e0y - ny * e0x;

    const angles = indices.map((i) => {
      const [px, py, pz] = uniqueRaw[i];
      const dx = px - gcx, dy = py - gcy, dz = pz - gcz;
      const u = dx * e0x + dy * e0y + dz * e0z;
      const w = dx * e1x + dy * e1y + dz * e1z;
      return { i, angle: Math.atan2(w, u) };
    });
    angles.sort((a, b) => a.angle - b.angle);
    return angles.map((a) => a.i);
  }

  // ── 6 square faces ─────────────────────────────────────────────────────────
  // Each square lies in a plane where one coordinate equals ±2.
  // The 4 vertices in the x=+2 plane: (2,0,±1),(2,±1,0) → (2,0,1),(2,1,0),(2,0,-1),(2,-1,0).
  const squareFaceSpecs: { indices: number[]; normal: [number, number, number] }[] = [
    { indices: [idx(2,0,1), idx(2,1,0), idx(2,0,-1), idx(2,-1,0)], normal: [1,0,0] },
    { indices: [idx(-2,0,1), idx(-2,1,0), idx(-2,0,-1), idx(-2,-1,0)], normal: [-1,0,0] },
    { indices: [idx(0,2,1), idx(1,2,0), idx(0,2,-1), idx(-1,2,0)], normal: [0,1,0] },
    { indices: [idx(0,-2,1), idx(1,-2,0), idx(0,-2,-1), idx(-1,-2,0)], normal: [0,-1,0] },
    { indices: [idx(1,0,2), idx(0,1,2), idx(-1,0,2), idx(0,-1,2)], normal: [0,0,1] },
    { indices: [idx(1,0,-2), idx(0,1,-2), idx(-1,0,-2), idx(0,-1,-2)], normal: [0,0,-1] },
  ];

  const squares: Polygon[] = squareFaceSpecs.map(({ indices, normal }) => ({
    vertices: sortCCW(indices, normal).map((i) => v[i]),
    color,
  }));

  // ── 8 hexagonal faces ──────────────────────────────────────────────────────
  // Each hexagon lies on a plane with normal (±1,±1,±1)/√3.
  // For normal (1,1,1), the plane equation is x+y+z = constant.
  // We need x+y+z = 3 (max value achievable: 2+1+0=3, 2+0+1=3, 0+2+1=3, etc.).
  // Vertices with x+y+z=3: (2,1,0),(2,0,1),(1,2,0),(0,2,1),(1,0,2),(0,1,2) — 6 vertices.
  // Similarly for the other 7 octant normals.
  const hexNormals: [number, number, number][] = [
    [ 1,  1,  1],
    [ 1,  1, -1],
    [ 1, -1,  1],
    [ 1, -1, -1],
    [-1,  1,  1],
    [-1,  1, -1],
    [-1, -1,  1],
    [-1, -1, -1],
  ];

  // For a normal (sx,sy,sz), the hexagon plane sum is sx*x + sy*y + sz*z = 3.
  const hexagons: Polygon[] = hexNormals.map(([sx, sy, sz]) => {
    // Find the 6 vertices satisfying sx*x + sy*y + sz*z = 3 (all have absolute value |x|+|y|+|z|=3).
    const indices: number[] = [];
    for (let i = 0; i < uniqueRaw.length; i++) {
      const [x, y, z] = uniqueRaw[i];
      if (Math.abs(sx * x + sy * y + sz * z - 3) < 1e-9) indices.push(i);
    }
    const normal: [number, number, number] = [sx / Math.sqrt(3), sy / Math.sqrt(3), sz / Math.sqrt(3)];
    return { vertices: sortCCW(indices, normal).map((i) => v[i]), color };
  });

  return [...squares, ...hexagons];
}
