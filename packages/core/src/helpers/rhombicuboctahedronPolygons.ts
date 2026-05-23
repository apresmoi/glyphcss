/**
 * Geometry for a rhombicuboctahedron — 8 triangular faces + 18 square faces
 * (26 faces total, 24 vertices). Vertices are all permutations of
 * (±1, ±1, ±(1+√2)) — 3 axis choices × 8 sign combinations = 24 vertices.
 * Scaled so the circumradius equals `size`.
 *
 * Face decomposition:
 *    8 triangles — the 8 corner faces (one per octant).
 *   18 squares   — 6 axial squares + 12 edge squares.
 *
 * Faces discovered via edge-graph enumeration (planar, outward-facing cycles of
 * length 3 and 4). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface RhombicuboctahedronPolygonsOptions {
  /** Center of the rhombicuboctahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all twenty-six faces. */
  color?: string;
}

export function rhombicuboctahedronPolygons(options: RhombicuboctahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const q = 1 + Math.sqrt(2);

  // Generate all 24 vertices: 3 axis choices for the `q` coordinate × 8 sign combos.
  // The 3 axis choices give: (±1, ±1, ±q), (±1, ±q, ±1), (±q, ±1, ±1).
  const raw: [number, number, number][] = [];
  const axes: [number, number, number][] = [
    [1, 1, q], [1, q, 1], [q, 1, 1],
  ];
  for (const [px, py, pz] of axes) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          raw.push([sx * px, sy * py, sz * pz]);
        }
      }
    }
  }

  // Raw circumradius: √(1 + 1 + q²) = √(2 + (1+√2)²) = √(5 + 2√2).
  const [rx, ry, rz] = raw[0];
  const rawCircumradius = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = size / rawCircumradius;

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Build the edge adjacency list.
  const { adj } = buildAdjList(raw);

  // Discover all planar outward-facing cycles of each expected face length.
  const triangles = findFacesOfLength(raw, adj, 3);   // 8 triangles
  const squares   = findFacesOfLength(raw, adj, 4);   // 18 squares

  function toPolygon(indices: number[]): Polygon {
    const normal = faceNormal(raw, indices);
    const sorted = sortCCW(raw, indices, normal);
    return { vertices: sorted.map((i) => v[i]), color };
  }

  return [
    ...triangles.map(toPolygon),
    ...squares.map(toPolygon),
  ];
}
