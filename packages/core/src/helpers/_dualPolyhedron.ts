/**
 * Compute the geometric dual of a convex polyhedron.
 *
 * Strategy: polar-reciprocal dual vertices + angular sort around each input vertex.
 *
 *   1. For each input face F with outward unit normal n̂ and a vertex v on F,
 *      the dual vertex is placed at the polar reciprocal of F's supporting plane
 *      with respect to the input's circumsphere (radius R):
 *
 *          d_F = (R² / (n̂ · v)) * n̂
 *
 *      This gives an exact Catalan solid for every Archimedean primal (the
 *      faces produced this way are provably planar).
 *
 *   2. For each input vertex V, collect all input faces that contain V.
 *      Sort their dual vertices by angle around V in V's tangent plane (CCW
 *      when viewed from the outward direction +V). This gives the dual face.
 *
 * The angular-sort strategy handles all Archimedean solids (including snub
 * polyhedra) without requiring an explicit half-edge structure.
 *
 * Note on the snub duals: the pentagonal faces of the pentagonal icosi-
 * tetrahedron and pentagonal hexecontahedron are NOT flat — the polar-
 * reciprocal construction still places each face's vertex pair on the correct
 * plane, but the 5 dual vertices of a snub vertex do not lie on a common
 * plane (this is a known property of these particular Catalan solids).
 */
import type { Polygon, Vec3 } from "../types";

/** Squared distance between two Vec3 points. */
function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** L2 norm of a Vec3. */
function norm(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Normalize a Vec3 to unit length. */
function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Centroid of an array of Vec3 points. */
function centroid(pts: readonly Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const [px, py, pz] of pts) { x += px; y += py; z += pz; }
  const n = pts.length;
  return [x / n, y / n, z / n];
}

/** Outward unit face normal via the first cross-product of the polygon edges. */
function faceNormal(verts: readonly Vec3[]): Vec3 {
  const [ax, ay, az] = verts[0];
  const [bx, by, bz] = verts[1];
  const [cx, cy, cz] = verts[2];
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az;
  const e1x = cx - ax, e1y = cy - ay, e1z = cz - az;
  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const centx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const centy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const centz = verts.reduce((s, v) => s + v[2], 0) / verts.length;
  // Flip if pointing inward (centroid dot normal < 0 when centroid faces away from origin).
  const sign = (nx * centx + ny * centy + nz * centz) > 0 ? 1 : -1;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [(sign * nx) / len, (sign * ny) / len, (sign * nz) / len];
}

/**
 * Compute the geometric dual of a convex polyhedron given as an array of Polygon.
 *
 * Dual vertices are computed as polar reciprocals of the input faces w.r.t.
 * the input's circumsphere, which produces exact planar Catalan-solid faces
 * for all Archimedean primals.
 *
 * The returned Polygon[] has `color` set to "#ffffff" — callers override it.
 */
export function polyhedronDual(input: Polygon[]): Polygon[] {
  // ── Step 1: deduplicate input vertices and build per-face index arrays ──
  const EPS2 = 1e-10;
  const uniqueVerts: Vec3[] = [];
  const faceVertIdx: number[][] = [];

  function findOrAdd(v: Vec3): number {
    for (let i = 0; i < uniqueVerts.length; i++) {
      if (dist2(uniqueVerts[i], v) < EPS2) return i;
    }
    uniqueVerts.push(v);
    return uniqueVerts.length - 1;
  }

  for (const poly of input) {
    faceVertIdx.push(poly.vertices.map((v) => findOrAdd(v as Vec3)));
  }

  const nFaces = input.length;
  const nVerts = uniqueVerts.length;

  // ── Step 2: polar-reciprocal dual vertices ──────────────────────────────
  // For each primal face F with outward unit normal n̂ and a vertex p on F:
  //   d_F = (R² / (n̂ · p)) * n̂
  // where R = circumradius of the primal.
  const R2 = Math.max(...uniqueVerts.map((v) => v[0]*v[0] + v[1]*v[1] + v[2]*v[2]));

  const dualVerts: Vec3[] = input.map((poly, fi) => {
    const verts = poly.vertices as Vec3[];
    const n = faceNormal(verts);
    // Use the first vertex of this face (any vertex on the supporting plane).
    const p = verts[0];
    const h = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
    // h should be > 0 for outward-facing faces of a convex body centred at origin.
    const scale = R2 / h;
    return [n[0] * scale, n[1] * scale, n[2] * scale] as Vec3;
  });

  // ── Step 3: for each input vertex, collect the surrounding face indices ──
  const vertToFaces: number[][] = Array.from({ length: nVerts }, () => []);
  for (let fi = 0; fi < nFaces; fi++) {
    for (const vi of faceVertIdx[fi]) {
      vertToFaces[vi].push(fi);
    }
  }

  // ── Step 4: sort dual vertices around each input vertex (CCW from outside) ──
  const dualFaces: number[][] = [];

  for (let vi = 0; vi < nVerts; vi++) {
    const surrounding = vertToFaces[vi];
    if (surrounding.length < 3) continue;

    const vPos = uniqueVerts[vi];
    const outward = normalize(vPos);

    // Build tangent frame (e0, e1) perpendicular to `outward`.
    // e0 = projection of (firstDualVert - vPos) onto tangent plane.
    const anyDualVert = dualVerts[surrounding[0]];
    let t0x = anyDualVert[0] - vPos[0];
    let t0y = anyDualVert[1] - vPos[1];
    let t0z = anyDualVert[2] - vPos[2];
    const proj0 = t0x * outward[0] + t0y * outward[1] + t0z * outward[2];
    t0x -= proj0 * outward[0];
    t0y -= proj0 * outward[1];
    t0z -= proj0 * outward[2];
    const t0len = Math.sqrt(t0x * t0x + t0y * t0y + t0z * t0z);
    if (t0len < 1e-12) continue;
    const e0: Vec3 = [t0x / t0len, t0y / t0len, t0z / t0len];
    // e1 = outward × e0  (CCW on tangent plane when viewed from +outward).
    const e1: Vec3 = [
      outward[1] * e0[2] - outward[2] * e0[1],
      outward[2] * e0[0] - outward[0] * e0[2],
      outward[0] * e0[1] - outward[1] * e0[0],
    ];

    const withAngle = surrounding.map((fi) => {
      const dv = dualVerts[fi];
      const dx = dv[0] - vPos[0], dy = dv[1] - vPos[1], dz = dv[2] - vPos[2];
      const u = dx * e0[0] + dy * e0[1] + dz * e0[2];
      const w = dx * e1[0] + dy * e1[1] + dz * e1[2];
      return { fi, angle: Math.atan2(w, u) };
    });
    withAngle.sort((a, b) => a.angle - b.angle);
    dualFaces.push(withAngle.map((x) => x.fi));
  }

  // ── Step 5: build output Polygon[] ──────────────────────────────────────
  return dualFaces.map((faceIndices) => ({
    vertices: faceIndices.map((fi) => dualVerts[fi]),
    color: "#ffffff",
  }));
}
