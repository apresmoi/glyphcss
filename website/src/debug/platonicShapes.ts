import type { Voxel } from "@layoutit/voxcss/react";

export type Vec3 = [number, number, number];

/**
 * Raw triangle: three vertices in voxel-grid coords plus a color.
 * No grid-shift, no bbox — those are applied by `triangleToVoxel`.
 *
 * All gen* functions emit triangles with CCW-from-outside winding so
 * voxcss's backface-visibility hides the back side correctly.
 */
export interface RawTriangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  color: string;
}

export const PLATONIC_PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#eab308",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

/**
 * Convert a raw triangle to a voxcss Voxel. `gridShift` shifts every vertex
 * +N on x and y to avoid CSS Grid line "0" (which the spec treats as
 * auto-placement). Use 1 in interactive editors that allow user-entered 0.
 */
export function triangleToVoxel(t: RawTriangle, gridShift = 0): Voxel {
  const xs = [t.v0[0], t.v1[0], t.v2[0]];
  const ys = [t.v0[1], t.v1[1], t.v2[1]];
  const zs = [t.v0[2], t.v1[2], t.v2[2]];
  const sv = (v: Vec3): Vec3 => [v[0] + gridShift, v[1] + gridShift, v[2]];
  return {
    x: Math.min(...xs) + gridShift, y: Math.min(...ys) + gridShift, z: Math.min(...zs),
    x2: Math.max(...xs) + gridShift, y2: Math.max(...ys) + gridShift, z2: Math.max(...zs),
    shape: "triangle",
    vertices: [sv(t.v0), sv(t.v1), sv(t.v2)],
    color: t.color,
  };
}

/**
 * Same idea as RawTriangle but with N vertices (≥3). Renders as a single
 * polygon — the Triangle renderer projects all vertices onto the polygon's
 * plane and emits one SVG <path>. Vertices must be coplanar.
 */
export interface RawPolygon {
  vertices: Vec3[];
  color: string;
}

export function polygonToVoxel(p: RawPolygon, gridShift = 0): Voxel {
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (const v of p.vertices) {
    if (v[0] < xMin) xMin = v[0]; if (v[0] > xMax) xMax = v[0];
    if (v[1] < yMin) yMin = v[1]; if (v[1] > yMax) yMax = v[1];
    if (v[2] < zMin) zMin = v[2]; if (v[2] > zMax) zMax = v[2];
  }
  const sv = (v: Vec3): Vec3 => [v[0] + gridShift, v[1] + gridShift, v[2]];
  return {
    x: xMin + gridShift, y: yMin + gridShift, z: zMin,
    x2: xMax + gridShift, y2: yMax + gridShift, z2: zMax,
    shape: "triangle", // same renderer — handles N-vertex polygons too
    vertices: p.vertices.map(sv),
    color: p.color,
  };
}

export function genTetrahedron(): RawTriangle[] {
  const s = 4;
  // 4 vertices at alternating cube corners → all 6 edges = s·√2 → equilateral.
  const v: Vec3[] = [
    [0, 0, 0],
    [s, s, 0],
    [s, 0, s],
    [0, s, s],
  ];
  // CCW from outside (cross product points away from centroid). The "obvious"
  // orderings [0,2,1] etc. are CW from outside, which would be hidden by
  // backface-visibility — you'd see through to the back side of the opposite
  // face, making rotation appear inverted.
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  return faces.map((f, i) => ({
    v0: v[f[0]], v1: v[f[1]], v2: v[f[2]],
    color: PLATONIC_PALETTE[i % PLATONIC_PALETTE.length],
  }));
}

/**
 * Cube as 6 native quad polygons (4 vertices each) instead of 12 fan-
 * triangulated triangles. Half the DOM cost for the same shape.
 */
export function genCubePolygons(): RawPolygon[] {
  const s = 4;
  const c: Vec3[] = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  // 6 faces as CCW-from-outside quads, matching the fan-triangulation order
  // in genCube so colors line up.
  const quads: number[][] = [
    [0, 3, 2, 1], // -Z
    [4, 5, 6, 7], // +Z
    [0, 1, 5, 4], // -Y
    [2, 3, 7, 6], // +Y
    [0, 4, 7, 3], // -X
    [1, 2, 6, 5], // +X
  ];
  return quads.map((q, i) => ({
    vertices: q.map((idx) => c[idx]),
    color: PLATONIC_PALETTE[i % PLATONIC_PALETTE.length],
  }));
}

export function genCube(): RawTriangle[] {
  const s = 4;
  const c: Vec3[] = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  const faces: { tris: [number, number, number][]; color: string }[] = [
    { tris: [[0, 3, 2], [0, 2, 1]], color: PLATONIC_PALETTE[0] },
    { tris: [[4, 5, 6], [4, 6, 7]], color: PLATONIC_PALETTE[1] },
    { tris: [[0, 1, 5], [0, 5, 4]], color: PLATONIC_PALETTE[2] },
    { tris: [[2, 3, 7], [2, 7, 6]], color: PLATONIC_PALETTE[3] },
    { tris: [[0, 4, 7], [0, 7, 3]], color: PLATONIC_PALETTE[4] },
    { tris: [[1, 2, 6], [1, 6, 5]], color: PLATONIC_PALETTE[5] },
  ];
  const out: RawTriangle[] = [];
  for (const f of faces) for (const tri of f.tris) {
    out.push({ v0: c[tri[0]], v1: c[tri[1]], v2: c[tri[2]], color: f.color });
  }
  return out;
}

export function genOctahedron(): RawTriangle[] {
  const s = 4;
  const cx = s, cy = s, cz = s;
  const v: Vec3[] = [
    [cx + s, cy, cz], [cx - s, cy, cz],
    [cx, cy + s, cz], [cx, cy - s, cz],
    [cx, cy, cz + s], [cx, cy, cz - s],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  return faces.map((f, i) => ({
    v0: v[f[0]], v1: v[f[1]], v2: v[f[2]],
    color: PLATONIC_PALETTE[i % PLATONIC_PALETTE.length],
  }));
}

export function genIcosahedron(): RawTriangle[] {
  // Fibonacci approx of φ: 21/13 ≈ 1.6154 vs φ ≈ 1.6180 (~0.16% error).
  const a = 13, b = 21;
  const cx = b, cy = b, cz = b;
  const v: Vec3[] = [
    [cx - a, cy + b, cz], [cx + a, cy + b, cz], [cx - a, cy - b, cz], [cx + a, cy - b, cz],
    [cx, cy - a, cz + b], [cx, cy + a, cz + b], [cx, cy - a, cz - b], [cx, cy + a, cz - b],
    [cx + b, cy, cz - a], [cx + b, cy, cz + a], [cx - b, cy, cz - a], [cx - b, cy, cz + a],
  ];
  const faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return faces.map((f, i) => ({
    v0: v[f[0]], v1: v[f[1]], v2: v[f[2]],
    color: PLATONIC_PALETTE[i % PLATONIC_PALETTE.length],
  }));
}

export function genDodecahedron(): RawTriangle[] {
  // Fibonacci triple (s=13, a=8, b=21) gives ratios 1:0.615:1.615 ≈ 1:1/φ:φ.
  // Vertex ordering matches Wikipedia's standard dodecahedron with golden
  // vertices in the (0, ±φ, ±1/φ) family.
  const s = 13, a = 8, b = 21;
  const cx = b, cy = b, cz = b;
  const v: Vec3[] = [
    // 8 cube corners.
    [cx - s, cy - s, cz - s], [cx - s, cy - s, cz + s],
    [cx - s, cy + s, cz - s], [cx - s, cy + s, cz + s],
    [cx + s, cy - s, cz - s], [cx + s, cy - s, cz + s],
    [cx + s, cy + s, cz - s], [cx + s, cy + s, cz + s],
    // 12 golden-ratio vertices, in the (0, ±φ, ±1/φ) family.
    [cx, cy - b, cz - a], [cx, cy - b, cz + a],
    [cx, cy + b, cz - a], [cx, cy + b, cz + a],
    [cx - a, cy, cz - b], [cx - a, cy, cz + b],
    [cx + a, cy, cz - b], [cx + a, cy, cz + b],
    [cx - b, cy - a, cz], [cx - b, cy + a, cz],
    [cx + b, cy - a, cz], [cx + b, cy + a, cz],
  ];
  // 12 pentagons, all CCW from outside.
  const pentagons: number[][] = [
    [7, 11, 3, 13, 15], //  F1  +Z  top-front
    [7, 15, 5, 18, 19], //  F2  +X+Z front-right
    [7, 19, 6, 10, 11], //  F3  +X+Y top-right
    [6, 19, 18, 4, 14], //  F4  +X-Z back-right
    [6, 14, 12, 2, 10], //  F5  +Y-Z top-back
    [5, 15, 13, 1, 9],  //  F6  -X+Z front-bottom
    [5, 9, 8, 4, 18],   //  F7  -Y+X bottom-right
    [4, 8, 0, 12, 14],  //  F8  -Y-Z back-bottom
    [3, 17, 16, 1, 13], //  F9  -X+Y front-left
    [3, 11, 10, 2, 17], //  F10 +Y-X top-left
    [2, 12, 0, 16, 17], //  F11 -X-Y back-left
    [1, 16, 0, 8, 9],   //  F12 -X-Z bottom-left
  ];
  const out: RawTriangle[] = [];
  for (let pi = 0; pi < pentagons.length; pi++) {
    const p = pentagons[pi];
    const color = PLATONIC_PALETTE[pi % PLATONIC_PALETTE.length];
    // Fan triangulation: pentagon (p0..p4) → (p0,p1,p2), (p0,p2,p3), (p0,p3,p4).
    for (let i = 1; i < p.length - 1; i++) {
      out.push({ v0: v[p[0]], v1: v[p[i]], v2: v[p[i + 1]], color });
    }
  }
  return out;
}

/**
 * Same dodecahedron but emitted as 12 native pentagons instead of 36
 * fan-triangulated triangles. Demonstrates voxcss's polygon renderer (the
 * "triangle" shape with N-vertex `vertices` array). 3× DOM reduction.
 */
export function genDodecahedronPentagons(): RawPolygon[] {
  const s = 13, a = 8, b = 21;
  const cx = b, cy = b, cz = b;
  const v: Vec3[] = [
    [cx - s, cy - s, cz - s], [cx - s, cy - s, cz + s],
    [cx - s, cy + s, cz - s], [cx - s, cy + s, cz + s],
    [cx + s, cy - s, cz - s], [cx + s, cy - s, cz + s],
    [cx + s, cy + s, cz - s], [cx + s, cy + s, cz + s],
    [cx, cy - b, cz - a], [cx, cy - b, cz + a],
    [cx, cy + b, cz - a], [cx, cy + b, cz + a],
    [cx - a, cy, cz - b], [cx - a, cy, cz + b],
    [cx + a, cy, cz - b], [cx + a, cy, cz + b],
    [cx - b, cy - a, cz], [cx - b, cy + a, cz],
    [cx + b, cy - a, cz], [cx + b, cy + a, cz],
  ];
  const pentagons: number[][] = [
    [7, 11, 3, 13, 15],
    [7, 15, 5, 18, 19],
    [7, 19, 6, 10, 11],
    [6, 19, 18, 4, 14],
    [6, 14, 12, 2, 10],
    [5, 15, 13, 1, 9],
    [5, 9, 8, 4, 18],
    [4, 8, 0, 12, 14],
    [3, 17, 16, 1, 13],
    [3, 11, 10, 2, 17],
    [2, 12, 0, 16, 17],
    [1, 16, 0, 8, 9],
  ];
  return pentagons.map((p, i) => ({
    vertices: p.map((idx) => v[idx]),
    color: PLATONIC_PALETTE[i % PLATONIC_PALETTE.length],
  }));
}

/**
 * Cuboctahedron as 14 native polygons (6 quads + 8 triangles) instead of
 * 20 fan-triangulated triangles. Each face is a single DOM element.
 */
export function genCuboctahedronPolygons(): RawPolygon[] {
  const s = 4;
  const cx = s, cy = s, cz = s;
  const v: Vec3[] = [
    [cx,     cy + s, cz + s], [cx,     cy + s, cz - s],
    [cx,     cy - s, cz + s], [cx,     cy - s, cz - s],
    [cx + s, cy,     cz + s], [cx + s, cy,     cz - s],
    [cx - s, cy,     cz + s], [cx - s, cy,     cz - s],
    [cx + s, cy + s, cz],     [cx + s, cy - s, cz],
    [cx - s, cy + s, cz],     [cx - s, cy - s, cz],
  ];
  const squares: number[][] = [
    [8, 4, 9, 5], [10, 7, 11, 6], [8, 1, 10, 0],
    [9, 2, 11, 3], [4, 0, 6, 2], [5, 3, 7, 1],
  ];
  const triangles: number[][] = [
    [4, 8, 0], [8, 5, 1], [9, 4, 2], [5, 9, 3],
    [0, 10, 6], [10, 1, 7], [11, 2, 6], [11, 7, 3],
  ];
  const out: RawPolygon[] = [];
  let pi = 0;
  for (const sq of squares) {
    out.push({ vertices: sq.map((i) => v[i]), color: PLATONIC_PALETTE[pi++ % PLATONIC_PALETTE.length] });
  }
  for (const tri of triangles) {
    out.push({ vertices: tri.map((i) => v[i]), color: PLATONIC_PALETTE[pi++ % PLATONIC_PALETTE.length] });
  }
  return out;
}

/**
 * Cuboctahedron — first Archimedean solid. 12 vertices at cube-edge midpoints,
 * 14 faces: 6 squares (one per cube face) + 8 triangles (one per cube vertex).
 */
export function genCuboctahedron(): RawTriangle[] {
  const s = 4;
  const cx = s, cy = s, cz = s;
  const v: Vec3[] = [
    [cx,     cy + s, cz + s], [cx,     cy + s, cz - s],
    [cx,     cy - s, cz + s], [cx,     cy - s, cz - s],
    [cx + s, cy,     cz + s], [cx + s, cy,     cz - s],
    [cx - s, cy,     cz + s], [cx - s, cy,     cz - s],
    [cx + s, cy + s, cz],     [cx + s, cy - s, cz],
    [cx - s, cy + s, cz],     [cx - s, cy - s, cz],
  ];
  const squares: number[][] = [
    [8, 4, 9, 5],
    [10, 7, 11, 6],
    [8, 1, 10, 0],
    [9, 2, 11, 3],
    [4, 0, 6, 2],
    [5, 3, 7, 1],
  ];
  const triangles: number[][] = [
    [4, 8, 0], [8, 5, 1], [9, 4, 2], [5, 9, 3],
    [0, 10, 6], [10, 1, 7], [11, 2, 6], [11, 7, 3],
  ];
  const out: RawTriangle[] = [];
  let pi = 0;
  for (const sq of squares) {
    const color = PLATONIC_PALETTE[pi++ % PLATONIC_PALETTE.length];
    out.push({ v0: v[sq[0]], v1: v[sq[1]], v2: v[sq[2]], color });
    out.push({ v0: v[sq[0]], v1: v[sq[2]], v2: v[sq[3]], color });
  }
  for (const tri of triangles) {
    const color = PLATONIC_PALETTE[pi++ % PLATONIC_PALETTE.length];
    out.push({ v0: v[tri[0]], v1: v[tri[1]], v2: v[tri[2]], color });
  }
  return out;
}

export type ShapeName =
  | "tetrahedron"
  | "cube"
  | "octahedron"
  | "dodecahedron"
  | "icosahedron"
  | "cuboctahedron";

export const SHAPE_GENERATORS: Record<ShapeName, () => RawTriangle[]> = {
  tetrahedron: genTetrahedron,
  cube: genCube,
  octahedron: genOctahedron,
  icosahedron: genIcosahedron,
  dodecahedron: genDodecahedron,
  cuboctahedron: genCuboctahedron,
};

// Helper: lift a RawTriangle to a RawPolygon (3 vertices). Used when a
// solid has only triangle faces, so polygon mode is a no-op.
const triangleAsPolygon = (t: RawTriangle): RawPolygon => ({
  vertices: [t.v0, t.v1, t.v2],
  color: t.color,
});

/**
 * Polygon variants. Tet/oct/icos are all-triangles, so polygon mode emits
 * the same triangles (each lifted to a 3-vertex polygon — same DOM cost).
 * Cube/dodec/cuboct have non-triangle faces and benefit from polygon mode.
 */
export const POLYGON_GENERATORS: Record<ShapeName, () => RawPolygon[]> = {
  tetrahedron: () => genTetrahedron().map(triangleAsPolygon),
  cube: genCubePolygons,
  octahedron: () => genOctahedron().map(triangleAsPolygon),
  icosahedron: () => genIcosahedron().map(triangleAsPolygon),
  dodecahedron: genDodecahedronPentagons,
  cuboctahedron: genCuboctahedronPolygons,
};
