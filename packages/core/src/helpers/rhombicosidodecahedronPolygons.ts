/**
 * Geometry for a rhombicosidodecahedron — 20 triangular faces + 30 square faces
 * + 12 pentagonal faces (62 faces total, 60 vertices). Vertices fall into three
 * families of cyclic-permutation + sign-combination groups:
 *
 *   (±1, ±1, ±φ³)              — 3 cyclic perms × 8 signs = 24 vertices
 *   (±φ², ±φ, ±2φ)             — 3 cyclic perms × 8 signs = 24 vertices
 *   (±(2+φ), 0, ±φ²)           — 3 cyclic perms × 4 signs = 12 vertices
 *
 * where φ = (1+√5)/2. Total: 60 vertices. Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   20 triangles — corner faces (one per icosahedron vertex).
 *   30 squares   — edge faces (one per icosahedron edge).
 *   12 pentagons — cap faces (one per dodecahedron face).
 *
 * Faces discovered via edge-graph enumeration (planar, outward-facing cycles of
 * length 3, 4, 5). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface RhombicosidodecahedronPolygonsOptions {
  /** Center of the rhombicosidodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all sixty-two faces. */
  color?: string;
}

export function rhombicosidodecahedronPolygons(options: RhombicosidodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const phi = (1 + Math.sqrt(5)) / 2;
  const phi2 = phi * phi;
  const phi3 = phi2 * phi;

  // Family A: (±1, ±1, ±φ³) and cyclic permutations — 24 vertices.
  const rawAll: [number, number, number][] = [];
  for (const [px, py, pz] of [[1, 1, phi3], [1, phi3, 1], [phi3, 1, 1]] as [number,number,number][]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      rawAll.push([sx * px, sy * py, sz * pz]);
    }
  }

  // Family B: (±φ², ±φ, ±2φ) and cyclic permutations — 24 vertices.
  for (const [px, py, pz] of [[phi2, phi, 2 * phi], [phi, 2 * phi, phi2], [2 * phi, phi2, phi]] as [number,number,number][]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      rawAll.push([sx * px, sy * py, sz * pz]);
    }
  }

  // Family C: (±(2+φ), 0, ±φ²) and cyclic permutations — 12 vertices.
  // Each cyclic permutation has the zero in a different position. Using all 8
  // sign combinations and deduplicating handles the zero-sign invariance.
  for (const [px, py, pz] of [[2 + phi, 0, phi2], [0, phi2, 2 + phi], [phi2, 2 + phi, 0]] as [number,number,number][]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      rawAll.push([sx * px, sy * py, sz * pz]);
    }
  }

  // Deduplicate.
  const seen = new Set<string>();
  const raw: [number, number, number][] = [];
  for (const pt of rawAll) {
    const key = `${pt[0].toFixed(8)},${pt[1].toFixed(8)},${pt[2].toFixed(8)}`;
    if (!seen.has(key)) { seen.add(key); raw.push(pt); }
  }

  // Raw circumradius.
  const [rx, ry, rz] = raw[0];
  const rawCircumradius = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = size / rawCircumradius;

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Build the edge adjacency list.
  const { adj } = buildAdjList(raw);

  // Discover all planar outward-facing cycles.
  const triangles = findFacesOfLength(raw, adj, 3);   // 20 triangles
  const squares   = findFacesOfLength(raw, adj, 4);   // 30 squares
  const pentagons = findFacesOfLength(raw, adj, 5);   // 12 pentagons

  function toPolygon(indices: number[]): Polygon {
    const normal = faceNormal(raw, indices);
    const sorted = sortCCW(raw, indices, normal);
    return { vertices: sorted.map((i) => v[i]), color };
  }

  return [
    ...triangles.map(toPolygon),
    ...squares.map(toPolygon),
    ...pentagons.map(toPolygon),
  ];
}
