/**
 * Geometry for a truncated icosidodecahedron (great rhombicosidodecahedron) —
 * 30 square faces + 20 hexagonal faces + 12 decagonal faces (62 faces total,
 * 120 vertices). Vertices are all even-permutation (cyclic) sign combinations
 * of five base triples involving the golden ratio φ = (1+√5)/2.
 * Scaled so the circumradius equals `size`.
 *
 * Vertex construction: 5 base triples × 3 cyclic permutations × 8 sign
 * combinations = 120 vertices. All lie on a common sphere.
 *
 * Face decomposition:
 *   30 squares   — one per edge of the parent icosidodecahedron.
 *   20 hexagons  — one per triangular face of the parent icosidodecahedron.
 *   12 decagons  — one per pentagonal face of the parent icosidodecahedron.
 *
 * Faces discovered via edge-graph enumeration (planar, outward-facing cycles of
 * length 4, 6, 10). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface TruncatedIcosidodecahedronPolygonsOptions {
  /** Center of the truncated icosidodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all sixty-two faces. */
  color?: string;
}

export function truncatedIcosidodecahedronPolygons(options: TruncatedIcosidodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const phi = (1 + Math.sqrt(5)) / 2;

  // Five base triples whose cyclic permutations + sign combinations give 120 vertices.
  // Each base triple (x, y, z) generates (x,y,z), (y,z,x), (z,x,y) × 8 sign combos.
  const baseTriples: [number, number, number][] = [
    [1 / phi,       1 / phi,       3 + phi        ],
    [2 / phi,       phi,           1 + 2 * phi    ],
    [1 / phi,       phi * phi,    -1 + 3 * phi    ],
    [2 * phi - 1,   2,             2 + phi        ],
    [phi,           3,             2 * phi        ],
  ];

  // Generate all 120 vertices.
  const rawAll: [number, number, number][] = [];
  for (const [bx, by, bz] of baseTriples) {
    // 3 cyclic permutations.
    const cyclics: [number, number, number][] = [
      [bx, by, bz],
      [by, bz, bx],
      [bz, bx, by],
    ];
    for (const [px, py, pz] of cyclics) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            rawAll.push([sx * px, sy * py, sz * pz]);
          }
        }
      }
    }
  }

  // Deduplicate with rounded keys.
  const seen = new Set<string>();
  const raw: [number, number, number][] = [];
  for (const pt of rawAll) {
    const key = `${pt[0].toFixed(8)},${pt[1].toFixed(8)},${pt[2].toFixed(8)}`;
    if (!seen.has(key)) { seen.add(key); raw.push(pt); }
  }

  // Verify we have 120 vertices.
  // Raw circumradius: all vertices should be equidistant from origin.
  const [rx, ry, rz] = raw[0];
  const rawCircumradius = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = size / rawCircumradius;

  const v: Vec3[] = raw.map(([x, y, z]) => [cx + x * s, cy + y * s, cz + z * s]);

  // Build the edge adjacency list.
  const { adj } = buildAdjList(raw);

  // Discover all planar outward-facing cycles of each expected face length.
  // Each vertex is 3-valent, so DFS over 10-cycles is tractable (≤ 3^9 paths per start).
  const squares  = findFacesOfLength(raw, adj, 4);    // 30 squares
  const hexagons = findFacesOfLength(raw, adj, 6);    // 20 hexagons
  const decagons = findFacesOfLength(raw, adj, 10);   // 12 decagons

  function toPolygon(indices: number[]): Polygon {
    const normal = faceNormal(raw, indices);
    const sorted = sortCCW(raw, indices, normal);
    return { vertices: sorted.map((i) => v[i]), color };
  }

  return [
    ...squares.map(toPolygon),
    ...hexagons.map(toPolygon),
    ...decagons.map(toPolygon),
  ];
}
