import type { Polygon } from "@polycss/react";

export type Vec3 = [number, number, number];

/**
 * Raw triangle: three vertices in voxel-grid coords plus a color.
 * No grid-shift — applied by `triangleToVoxel`.
 *
 * All gen* functions emit triangles with CCW-from-outside winding so
 * polycss's backface-visibility hides the back side correctly.
 */
export interface RawTriangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  color: string;
  /** Optional texture URL — stamped across the triangle's local 2D plane. */
  texture?: string;
}

export const PLATONIC_PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#eab308",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

export function triangleToVoxel(t: RawTriangle): Polygon {
  return {
    vertices: [t.v0, t.v1, t.v2],
    color: t.color,
    ...(t.texture ? { texture: t.texture } : {}),
  };
}

/**
 * Same idea as RawTriangle but with N vertices (≥3). Renders as a single
 * polygon — the Poly renderer projects all vertices onto the polygon's
 * plane and emits one SVG <path>. Vertices must be coplanar.
 */
export interface RawPolygon {
  vertices: Vec3[];
  color: string;
}

export function polygonToVoxel(p: RawPolygon): Polygon {
  return {
    vertices: p.vertices,
    color: p.color,
  };
}

export function genTetrahedron(): RawTriangle[] {
  const s = 2;
  // 4 vertices at alternating cube corners (cube spans [-s..+s]) →
  // all 6 edges = 2s·√2, equilateral, centroid at origin.
  const v: Vec3[] = [
    [-s, -s, -s],
    [ s,  s, -s],
    [ s, -s,  s],
    [-s,  s,  s],
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
  const s = 2;
  const c: Vec3[] = [
    [-s, -s, -s], [ s, -s, -s], [ s,  s, -s], [-s,  s, -s],
    [-s, -s,  s], [ s, -s,  s], [ s,  s,  s], [-s,  s,  s],
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
  const s = 2;
  const c: Vec3[] = [
    [-s, -s, -s], [ s, -s, -s], [ s,  s, -s], [-s,  s, -s],
    [-s, -s,  s], [ s, -s,  s], [ s,  s,  s], [-s,  s,  s],
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
  const v: Vec3[] = [
    [ s,  0,  0], [-s,  0,  0],
    [ 0,  s,  0], [ 0, -s,  0],
    [ 0,  0,  s], [ 0,  0, -s],
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
  // All 12 vertices in the (0, ±1, ±φ) family — already centered at origin.
  const a = 13, b = 21;
  const v: Vec3[] = [
    [-a,  b,  0], [ a,  b,  0], [-a, -b,  0], [ a, -b,  0],
    [ 0, -a,  b], [ 0,  a,  b], [ 0, -a, -b], [ 0,  a, -b],
    [ b,  0, -a], [ b,  0,  a], [-b,  0, -a], [-b,  0,  a],
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
  const v: Vec3[] = [
    // 8 cube corners — centered at origin.
    [-s, -s, -s], [-s, -s,  s],
    [-s,  s, -s], [-s,  s,  s],
    [ s, -s, -s], [ s, -s,  s],
    [ s,  s, -s], [ s,  s,  s],
    // 12 golden-ratio vertices, in the (0, ±φ, ±1/φ) family.
    [ 0, -b, -a], [ 0, -b,  a],
    [ 0,  b, -a], [ 0,  b,  a],
    [-a,  0, -b], [-a,  0,  b],
    [ a,  0, -b], [ a,  0,  b],
    [-b, -a,  0], [-b,  a,  0],
    [ b, -a,  0], [ b,  a,  0],
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
  const v: Vec3[] = [
    [-s, -s, -s], [-s, -s,  s],
    [-s,  s, -s], [-s,  s,  s],
    [ s, -s, -s], [ s, -s,  s],
    [ s,  s, -s], [ s,  s,  s],
    [ 0, -b, -a], [ 0, -b,  a],
    [ 0,  b, -a], [ 0,  b,  a],
    [-a,  0, -b], [-a,  0,  b],
    [ a,  0, -b], [ a,  0,  b],
    [-b, -a,  0], [-b,  a,  0],
    [ b, -a,  0], [ b,  a,  0],
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
  const v: Vec3[] = [
    [ 0,  s,  s], [ 0,  s, -s],
    [ 0, -s,  s], [ 0, -s, -s],
    [ s,  0,  s], [ s,  0, -s],
    [-s,  0,  s], [-s,  0, -s],
    [ s,  s,  0], [ s, -s,  0],
    [-s,  s,  0], [-s, -s,  0],
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
  const v: Vec3[] = [
    [ 0,  s,  s], [ 0,  s, -s],
    [ 0, -s,  s], [ 0, -s, -s],
    [ s,  0,  s], [ s,  0, -s],
    [-s,  0,  s], [-s,  0, -s],
    [ s,  s,  0], [ s, -s,  0],
    [-s,  s,  0], [-s, -s,  0],
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
