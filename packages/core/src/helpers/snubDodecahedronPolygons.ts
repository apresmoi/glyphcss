/**
 * Geometry for a snub dodecahedron — 80 triangular faces + 12 pentagonal faces
 * (92 faces total, 60 vertices). This is a chiral Archimedean solid; the
 * right-handed enantiomorph is produced here.
 *
 * Construction (numerical snub operation on the icosahedron):
 * For each of the 60 directed icosahedron edges (i→j), one snub vertex is placed at:
 *
 *   v_ij = normalise((1−t)·ico[i] + t·ico[j] + s·normalise(ico[i] × ico[j]))
 *
 * where t ≈ 0.3554 and s ≈ 0.1342 are the unique snub parameters satisfying two
 * simultaneous conditions:
 *   (a) inner-triangle edge length = cross-edge length (v_ij to v_ji)
 *   (b) inner-triangle edge length = pentagon edge length (v_ij to v_ik for adjacent k)
 *
 * These parameters are solved numerically via Newton's method to machine precision.
 * All 60 vertices lie exactly on the unit sphere before scaling.
 *
 * Chirality: the right-handed enantiomorph is produced. The chirality is fixed
 * by the sign of the s component: positive s causes the snub vertices to be
 * displaced in the direction of ico[i] × ico[j] (the right-hand cross product).
 * The opposite sign produces the left-handed mirror image.
 *
 * Face decomposition:
 *   80 triangles — inner snub triangles (one per icosahedron face) plus outer
 *                  snub triangles connecting adjacent face pairs.
 *   12 pentagons — one per icosahedron vertex (5 snub vertices surrounding each).
 *
 * Faces discovered via edge-graph enumeration (planar, outward-facing cycles of
 * length 3 and 5). Each face is CCW-from-outside.
 */
import type { Polygon, Vec3 } from "../types";
import { buildAdjList, findFacesOfLength, sortCCW, faceNormal } from "./_facesFromEdgeGraph";

export interface SnubDodecahedronPolygonsOptions {
  /** Center of the snub dodecahedron in world space. */
  center: Vec3;
  /** Circumradius — distance from center to each vertex. */
  size: number;
  /** Fill color applied to all ninety-two faces. */
  color?: string;
}

export function snubDodecahedronPolygons(options: SnubDodecahedronPolygonsOptions): Polygon[] {
  const { center, size, color = "#ffffff" } = options;
  const [cx, cy, cz] = center;

  const phi = (1 + Math.sqrt(5)) / 2;

  // ── Icosahedron base (unit sphere) ─────────────────────────────────────────
  // Same vertex set as icosahedronPolygons.ts but normalised to unit circumradius.
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
  const icoR = Math.sqrt(1 + phi * phi);
  const ico: [number, number, number][] = icoRaw.map(([x, y, z]) => [x / icoR, y / icoR, z / icoR]);

  const icoFaces: [number, number, number][] = [
    [ 0,  2,  9], [ 0,  4,  8], [ 0,  6,  4], [ 0,  8,  2], [ 0,  9,  6],
    [ 1,  3, 10], [ 1,  4,  6], [ 1,  6, 11], [ 1, 10,  4], [ 1, 11,  3],
    [ 2,  5,  7], [ 2,  7,  9], [ 2,  8,  5], [ 3,  5, 10], [ 3,  7,  5],
    [ 3, 11,  7], [ 4, 10,  8], [ 5,  8, 10], [ 6,  9, 11], [ 7, 11,  9],
  ];

  // ── Helper math ───────────────────────────────────────────────────────────
  function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm3(v: [number, number, number]): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }
  function normalise3(v: [number, number, number]): [number, number, number] {
    const l = norm3(v);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function dist3(a: [number, number, number], b: [number, number, number]): number {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }

  // Compute a snub vertex for directed edge i→j with parameters t and s.
  function snubVertex(i: number, j: number, t: number, s: number): [number, number, number] {
    const [ax, ay, az] = ico[i];
    const [bx, by, bz] = ico[j];
    const raw: [number, number, number] = [
      (1 - t) * ax + t * bx,
      (1 - t) * ay + t * by,
      (1 - t) * az + t * bz,
    ];
    const c = normalise3(cross3(ico[i], ico[j]));
    return normalise3([raw[0] + s * c[0], raw[1] + s * c[1], raw[2] + s * c[2]]);
  }

  // ── Solve for the snub parameters t, s ────────────────────────────────────
  // Two conditions on the face [0, 2, 9] and the pentagon around vertex 0:
  //   c1: triangle-edge = cross-edge     dist(v_02, v_29) = dist(v_02, v_20)
  //   c2: triangle-edge = pentagon-edge  dist(v_02, v_29) = dist(v_02, v_09)
  function c1(t: number, s: number): number {
    const v02 = snubVertex(0, 2, t, s);
    const v29 = snubVertex(2, 9, t, s);
    const v20 = snubVertex(2, 0, t, s);
    return dist3(v02, v29) - dist3(v02, v20);
  }
  function c2(t: number, s: number): number {
    const v02 = snubVertex(0, 2, t, s);
    const v29 = snubVertex(2, 9, t, s);
    const v09 = snubVertex(0, 9, t, s);
    return dist3(v02, v29) - dist3(v02, v09);
  }

  // Newton's method for 2×2 system.
  let snubT = 0.35, snubS = 0.13;
  const eps = 1e-7;
  for (let iter = 0; iter < 80; iter++) {
    const f1 = c1(snubT, snubS);
    const f2 = c2(snubT, snubS);
    if (Math.abs(f1) < 1e-13 && Math.abs(f2) < 1e-13) break;
    const df1dt = (c1(snubT + eps, snubS) - c1(snubT - eps, snubS)) / (2 * eps);
    const df1ds = (c1(snubT, snubS + eps) - c1(snubT, snubS - eps)) / (2 * eps);
    const df2dt = (c2(snubT + eps, snubS) - c2(snubT - eps, snubS)) / (2 * eps);
    const df2ds = (c2(snubT, snubS + eps) - c2(snubT, snubS - eps)) / (2 * eps);
    const det = df1dt * df2ds - df1ds * df2dt;
    if (Math.abs(det) < 1e-12) break;
    snubT -= (f1 * df2ds - f2 * df1ds) / det;
    snubS -= (f2 * df1dt - f1 * df2dt) / det;
  }

  // ── Generate all 60 snub vertices ─────────────────────────────────────────
  // Each directed icosahedron edge (i→j) gives one snub vertex.
  // The 60 directed edges come from 20 faces × 3 edges × 2 directions = 120,
  // but deduplicated to 60.
  const dirEdgeSet = new Set<string>();
  const snubVerts: [number, number, number][] = [];

  for (const [a, b, c] of icoFaces) {
    for (const [u, v] of [[a, b], [b, c], [c, a], [b, a], [c, b], [a, c]] as [number, number][]) {
      const key = `${u},${v}`;
      if (!dirEdgeSet.has(key)) {
        dirEdgeSet.add(key);
        snubVerts.push(snubVertex(u, v, snubT, snubS));
      }
    }
  }
  // All 60 vertices are on the unit sphere. Scale to circumradius `size`.
  const raw = snubVerts; // on unit sphere
  const scaled: Vec3[] = raw.map(([x, y, z]) => [cx + x * size, cy + y * size, cz + z * size]);

  // ── Build edge graph and discover faces ───────────────────────────────────
  const { adj } = buildAdjList(raw);
  const triangles = findFacesOfLength(raw, adj, 3);   // 80 triangles
  const pentagons = findFacesOfLength(raw, adj, 5);   // 12 pentagons

  function toPolygon(indices: number[]): Polygon {
    const normal = faceNormal(raw, indices);
    const sorted = sortCCW(raw, indices, normal);
    return { vertices: sorted.map((i) => scaled[i]), color };
  }

  return [
    ...triangles.map(toPolygon),
    ...pentagons.map(toPolygon),
  ];
}
