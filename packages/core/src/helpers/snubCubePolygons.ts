/**
 * Geometry for a snub cube — 32 triangular faces + 6 square faces (38 faces
 * total, 24 vertices). This is a chiral Archimedean solid; the right-handed
 * enantiomorph is produced here (see chirality note below).
 *
 * The 24 vertices involve the tribonacci constant t ≈ 1.83929, the real root of
 * t³ = t² + t + 1. The vertex set is:
 *   - even cyclic permutations of (±1, ±1/t, ±t) with an even number of minuses, AND
 *   - odd (anti-cyclic) permutations of (±1, ±1/t, ±t) with an odd number of minuses.
 *
 * Chirality: the right-handed convention is fixed by the choice of
 * "even-perm × even-sign + odd-perm × odd-sign" — the alternative pairing
 * produces the left-handed mirror image.
 *
 * Face decomposition:
 *   32 triangles — 8 sets of 4 snub triangles (filling the gaps between squares).
 *    6 squares   — one per face of the parent cube.
 *
 * Faces discovered via edge-graph enumeration (planar, outward-facing cycles of
 * length 3 and 4). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface SnubCubePolygonsOptions {
  /** Center of the snub cube in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all thirty-eight faces. */
  color?: string;
}

export function snubCubePolygons(options: SnubCubePolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  // Tribonacci constant: real root of t³ - t² - t - 1 = 0.
  // Computed as: t = (1 + cbrt(19 + 3√33) + cbrt(19 - 3√33)) / 3.
  const t = (1 + Math.cbrt(19 + 3 * Math.sqrt(33)) + Math.cbrt(19 - 3 * Math.sqrt(33))) / 3;
  const a = 1;
  const b = 1 / t;
  const c = t;

  // Even cyclic permutations (same handedness as the identity permutation).
  const evenPerms: [number, number, number][] = [[a, b, c], [b, c, a], [c, a, b]];
  // Odd (anti-cyclic) permutations.
  const oddPerms: [number, number, number][] = [[c, b, a], [b, a, c], [a, c, b]];

  const raw: [number, number, number][] = [];

  // Even perm + even number of minus signs (0 or 2 minuses → parity 0).
  for (const [px, py, pz] of evenPerms) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const minuses = (sx === -1 ? 1 : 0) + (sy === -1 ? 1 : 0) + (sz === -1 ? 1 : 0);
          if (minuses % 2 === 0) raw.push([sx * px, sy * py, sz * pz]);
        }
      }
    }
  }

  // Odd perm + odd number of minus signs (1 or 3 minuses → parity 1).
  for (const [px, py, pz] of oddPerms) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const minuses = (sx === -1 ? 1 : 0) + (sy === -1 ? 1 : 0) + (sz === -1 ? 1 : 0);
          if (minuses % 2 === 1) raw.push([sx * px, sy * py, sz * pz]);
        }
      }
    }
  }
  // raw now has 3×4 + 3×4 = 24 vertices.

  // Raw circumradius: √(a² + b² + c²) = √(1 + 1/t² + t²).
  const [rx, ry, rz] = raw[0];
  const rawCircumradius = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = size / rawCircumradius;

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Build the edge adjacency list.
  const { adj } = buildAdjList(raw);

  // Discover all planar outward-facing cycles.
  const triangles = findFacesOfLength(raw, adj, 3);   // 32 triangles
  const squares   = findFacesOfLength(raw, adj, 4);   // 6 squares

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
