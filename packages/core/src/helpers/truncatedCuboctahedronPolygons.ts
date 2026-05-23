/**
 * Geometry for a truncated cuboctahedron (great rhombicuboctahedron) —
 * 12 square faces + 8 hexagonal faces + 6 octagonal faces (26 faces total,
 * 48 vertices). Vertices are all distinct ordered permutations of
 * (±1, ±(1+√2), ±(1+2√2)) — 3! orderings × 2³ sign combinations = 48 vertices.
 * Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *   12 squares  — one per edge of the parent cuboctahedron.
 *    8 hexagons — one per triangular face of the parent cuboctahedron.
 *    6 octagons — one per square face of the parent cuboctahedron.
 *
 * Faces discovered via edge-graph enumeration (all planar, outward-facing
 * cycles of length 4, 6, 8). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface TruncatedCuboctahedronPolygonsOptions {
  /** Center of the truncated cuboctahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all twenty-six faces. */
  color?: string;
}

export function truncatedCuboctahedronPolygons(options: TruncatedCuboctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // The 3 distinct coordinate values.
  const a = 1;
  const b = 1 + Math.sqrt(2);
  const c = 1 + 2 * Math.sqrt(2);

  // Generate all 48 vertices: all 6 orderings of (a, b, c) × all 8 sign combos.
  const perms: [number, number, number][] = [
    [a, b, c], [a, c, b],
    [b, a, c], [b, c, a],
    [c, a, b], [c, b, a],
  ];
  const rawAll: [number, number, number][] = [];
  for (const [px, py, pz] of perms) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          rawAll.push([sx * px, sy * py, sz * pz]);
        }
      }
    }
  }
  // Deduplicate with rounded keys (the 6 orderings are all distinct, but be safe).
  const seen = new Set<string>();
  const raw: [number, number, number][] = [];
  for (const pt of rawAll) {
    const key = `${pt[0].toFixed(9)},${pt[1].toFixed(9)},${pt[2].toFixed(9)}`;
    if (!seen.has(key)) { seen.add(key); raw.push(pt); }
  }

  // Raw circumradius and scale factor.
  const [rx, ry, rz] = raw[0];
  const rawCircumradius = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = size / rawCircumradius;

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Build the edge adjacency list (edge length in raw coords = 2).
  const { adj } = buildAdjList(raw);

  // Discover all planar outward-facing cycles of each expected face length.
  const squares  = findFacesOfLength(raw, adj, 4);   // 12 squares
  const hexagons = findFacesOfLength(raw, adj, 6);   // 8 hexagons
  const octagons = findFacesOfLength(raw, adj, 8);   // 6 octagons

  function toPolygon(indices: number[]): Polygon {
    const normal = faceNormal(raw, indices);
    const sorted = sortCCW(raw, indices, normal);
    return { vertices: sorted.map((i) => v[i]), color };
  }

  return [
    ...squares.map(toPolygon),
    ...hexagons.map(toPolygon),
    ...octagons.map(toPolygon),
  ];
}
