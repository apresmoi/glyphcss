/**
 * Merge coplanar same-color adjacent triangles into N-vertex polygons.
 *
 * Each polygon is rendered as one DOM element (one matrix3d-transformed SVG
 * with a multi-point path) — so a mesh whose triangles came from quads or
 * pentagons collapses back into its original face count.
 *
 *   - Geodesic spheres: ~half the triangles came from quad subdivisions
 *   - OBJ imports: many were quads/n-gons fan-triangulated by the importer
 *   - Hand-built dodecahedra: 36 triangles → 12 pentagons
 *
 * Algorithm:
 *   1. For each input polygon, compute its plane (unit normal + signed
 *      distance from origin).
 *   2. Build an undirected edge graph: every edge of every polygon indexes
 *      the polygons it belongs to.
 *   3. Repeatedly walk shared edges and merge the two polygons sharing that
 *      edge if they pass the merge predicate (same color, near-coplanar,
 *      result is convex, edge is interior). Each merge replaces two
 *      polygons with one larger polygon and updates the edge index.
 *   4. Iterate until no more merges fire — the fixed point grows triangles
 *      → quads → pentagons → … as far as the geometry allows.
 *
 * Polygons with < 3 vertices are passed through unchanged (the caller is
 * expected to have run `normalizePolygons` first; this is a defensive copy).
 */

import type { Polygon, Vec2, Vec3 } from "../types";

const EPS_NORMAL = 1e-3;   // dot product tolerance for "same plane"
const EPS_DISTANCE = 0.05; // signed-distance tolerance (in scene-space units)
const EPS_UV = 1e-4;       // float UV tolerance (atlas coords are 0..1)

interface PolyState {
  vertices: Vec3[];
  /**
   * Per-vertex UV (paired with `vertices`) when the polygon is textured.
   * Null/undefined for untextured polys. Two polys merge across a shared
   * edge only if their UVs at both endpoints match — otherwise the seam
   * would visibly tear in the atlas.
   */
  uvs?: Vec2[];
  color: string;
  /** Texture URL — must match between two polys for them to merge. */
  texture?: string;
  normal: Vec3;
  /** Plane offset: distance from origin along the normal. */
  d: number;
  alive: boolean;
  /** Original Polygon's `data` field, preserved through the merge. */
  data?: Record<string, string | number | boolean>;
}

const eqUv = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a[0] - b[0]) < EPS_UV && Math.abs(a[1] - b[1]) < EPS_UV;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const eqVec = (a: Vec3, b: Vec3): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Canonical key for an undirected edge between two vertex positions. */
function edgeKey(a: Vec3, b: Vec3): string {
  const ka = `${a[0]},${a[1]},${a[2]}`;
  const kb = `${b[0]},${b[1]},${b[2]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function planeOf(vertices: Vec3[]): { normal: Vec3; d: number } | null {
  if (vertices.length < 3) return null;
  const e1 = sub(vertices[1], vertices[0]);
  const e2 = sub(vertices[2], vertices[0]);
  const n = cross(e1, e2);
  const len = norm(n);
  if (len < 1e-12) return null;
  const normal: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  const d = dot(normal, vertices[0]);
  return { normal, d };
}

function samePlane(a: PolyState, b: PolyState): boolean {
  // Normals must be parallel and pointing the same way (one shared face,
  // not two faces back-to-back), and offsets must match.
  const dotN = dot(a.normal, b.normal);
  if (dotN < 1 - EPS_NORMAL) return false;
  return Math.abs(a.d - b.d) < EPS_DISTANCE;
}

/**
 * Merge two polygons that share the edge (e0 → e1). Both polygons are
 * stored as cyclic vertex lists. The merged polygon visits A's vertices
 * up to e0, then walks B from e1 back to e0's mirror, then resumes A.
 *
 * For textured polys: UVs are walked in lockstep with vertices so the
 * merged polygon ends up with one UV per vertex. The caller has already
 * verified UVs at the shared edge endpoints match between A and B (so the
 * texture won't tear at the seam).
 */
function mergeAlongEdge(
  a: PolyState,
  b: PolyState,
  e0: Vec3,
  e1: Vec3,
): { vertices: Vec3[]; uvs?: Vec2[] } | null {
  const ai0 = a.vertices.findIndex((v) => eqVec(v, e0));
  const ai1 = a.vertices.findIndex((v) => eqVec(v, e1));
  const bi0 = b.vertices.findIndex((v) => eqVec(v, e0));
  const bi1 = b.vertices.findIndex((v) => eqVec(v, e1));
  if (ai0 < 0 || ai1 < 0 || bi0 < 0 || bi1 < 0) return null;

  // The shared edge must appear in opposite winding directions on the two
  // polygons (one goes e0→e1, the other goes e1→e0). If they go the same
  // way the merge would reverse winding for one of them.
  const an = a.vertices.length;
  const bn = b.vertices.length;
  const aGoesForward = (ai0 + 1) % an === ai1;
  const bGoesForward = (bi0 + 1) % bn === bi1;
  if (aGoesForward === bGoesForward) return null;

  // Walk A from e1 forward, around, back to e0 (skipping the e0→e1 edge),
  // then walk B from e0's match forward, around, back to e1's match.
  // Whichever polygon has the edge going "backwards" is the one whose
  // forward walk we use to reach the shared boundary.
  const aStart = aGoesForward ? ai1 : ai0;
  const aEnd = aGoesForward ? ai0 : ai1;
  const bStart = bGoesForward ? bi1 : bi0;
  const bEnd = bGoesForward ? bi0 : bi1;

  const trackUvs = !!(a.uvs && b.uvs);
  const merged: Vec3[] = [];
  const mergedUvs: Vec2[] | undefined = trackUvs ? [] : undefined;
  let i = aStart;
  while (true) {
    merged.push(a.vertices[i]);
    if (mergedUvs) mergedUvs.push(a.uvs![i]);
    if (i === aEnd) break;
    i = (i + 1) % an;
  }
  i = bStart;
  while (true) {
    merged.push(b.vertices[i]);
    if (mergedUvs) mergedUvs.push(b.uvs![i]);
    if (i === bEnd) break;
    i = (i + 1) % bn;
  }

  // The two walks each pushed the shared-edge endpoints, so the merged
  // ring contains a duplicate at the seam (e.g. ABC + ACD → A,B,C,C,D,A).
  // Strip consecutive duplicates AND the wraparound first/last duplicate
  // so the collinear-cleanup pass below doesn't see degenerate C→C edges
  // and accidentally drop the actual corner.
  const dedupV: Vec3[] = [];
  const dedupU: Vec2[] | undefined = mergedUvs ? [] : undefined;
  for (let k = 0; k < merged.length; k++) {
    if (dedupV.length === 0 || !eqVec(merged[k], dedupV[dedupV.length - 1])) {
      dedupV.push(merged[k]);
      if (dedupU && mergedUvs) dedupU.push(mergedUvs[k]);
    }
  }
  if (dedupV.length > 1 && eqVec(dedupV[0], dedupV[dedupV.length - 1])) {
    dedupV.pop();
    dedupU?.pop();
  }

  // Drop collinear vertices left behind by the merge. Three consecutive
  // vertices A, B, C are collinear if (B-A) × (C-A) ≈ 0; B contributes
  // nothing to the polygon outline and would just be a no-op corner.
  const cleaned: Vec3[] = [];
  const cleanedUvs: Vec2[] | undefined = dedupU ? [] : undefined;
  for (let k = 0; k < dedupV.length; k++) {
    const prev = dedupV[(k - 1 + dedupV.length) % dedupV.length];
    const cur = dedupV[k];
    const next = dedupV[(k + 1) % dedupV.length];
    const c = cross(sub(cur, prev), sub(next, prev));
    if (norm(c) > 1e-9) {
      cleaned.push(cur);
      if (cleanedUvs && dedupU) cleanedUvs.push(dedupU[k]);
    }
  }
  if (cleaned.length < 3) return null;
  return { vertices: cleaned, uvs: cleanedUvs };
}

/**
 * Convexity check: walking around the polygon, every consecutive edge
 * should turn the same way (sign of (edge_i × edge_{i+1}) projected onto
 * the plane normal stays consistent).
 */
function isConvex(vertices: Vec3[], normal: Vec3): boolean {
  const n = vertices.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const e1 = sub(b, a);
    const e2 = sub(c, b);
    const turn = dot(cross(e1, e2), normal);
    if (Math.abs(turn) < 1e-9) continue; // collinear, ignore
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function mergePolygons(input: Polygon[]): Polygon[] {
  const out: Polygon[] = [];
  const polys: PolyState[] = [];

  // Pass 1: collect each polygon, seed PolyState. Skip polygons without
  // a usable plane (degenerate; should have been removed by normalize).
  for (const polygon of input ?? []) {
    if (!polygon || !polygon.vertices || polygon.vertices.length < 3) {
      if (polygon) out.push(polygon);
      continue;
    }
    const verts = polygon.vertices.map((v) => [v[0], v[1], v[2]] as Vec3);
    const plane = planeOf(verts);
    if (!plane) {
      out.push(polygon);
      continue;
    }
    // Carry texture + per-vertex UVs through the merge so textured polys
    // can grow as long as their UVs match at the seam. UVs are skipped if
    // they don't match the vertex count (defensive — parsers/normalize
    // emit them in lockstep, but a hand-crafted polygon could be off).
    const uvs = (polygon.texture && polygon.uvs && polygon.uvs.length === verts.length)
      ? polygon.uvs.map((uv) => [uv[0], uv[1]] as Vec2)
      : undefined;
    polys.push({
      vertices: verts,
      uvs,
      color: polygon.color ?? "#cccccc",
      texture: polygon.texture,
      normal: plane.normal,
      d: plane.d,
      alive: true,
      data: polygon.data,
    });
  }

  // Pass 2: batch-merge to fixed point. Each call to `tryMergePass` rebuilds
  // the edge index ONCE, then iterates every shared-edge candidate. The
  // index is treated as a CANDIDATE list — we re-validate the shared edge
  // by scanning a's current vertices against b's at merge time, because
  // a previous merge in this pass may have mutated either polygon.
  //
  // Earlier this returned after a single merge → 12k full O(n) index
  // rebuilds for the bus mesh = ~150s. Earlier still, a `touched` set
  // skipped any poly that had been merged this pass — that prevented chain
  // merges (flat roof → alternating "stripes" because every other quad-pair
  // wouldn't merge). Re-validation per candidate gives both speed AND the
  // chain merging the original (slow) algo had.
  const tryMergePass = (): boolean => {
    const edgeIndex = new Map<string, number[]>();
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      if (!p.alive) continue;
      const n = p.vertices.length;
      for (let k = 0; k < n; k++) {
        const a = p.vertices[k];
        const b = p.vertices[(k + 1) % n];
        const key = edgeKey(a, b);
        let arr = edgeIndex.get(key);
        if (!arr) { arr = []; edgeIndex.set(key, arr); }
        arr.push(i);
      }
    }

    let mergedThisPass = false;

    // findSharedEdge returns the (e0, e1) endpoints of the edge a and b
    // currently share, or null if a's vertex list has been mutated since
    // edgeIndex was built and no longer touches b. Because polycss CCW
    // winding faces opposite directions on the two sides of a shared edge,
    // a's edge va→vb matches b's edge vb→va.
    const findSharedEdge = (a: PolyState, b: PolyState): [Vec3, Vec3] | null => {
      for (let k = 0; k < a.vertices.length; k++) {
        const va = a.vertices[k];
        const vb = a.vertices[(k + 1) % a.vertices.length];
        for (let j = 0; j < b.vertices.length; j++) {
          const ub = b.vertices[j];
          const uc = b.vertices[(j + 1) % b.vertices.length];
          if (eqVec(va, uc) && eqVec(vb, ub)) return [va, vb];
        }
      }
      return null;
    };

    for (const [, owners] of edgeIndex) {
      // owners can have >2 if a degenerate input had three+ polys sharing
      // an edge; we still try each pair below — but the simple dedupe
      // skips index entries where both polys were already merged away.
      if (owners.length < 2) continue;
      const [ai, bi] = owners;
      if (ai === bi) continue;
      const a = polys[ai];
      const b = polys[bi];
      if (!a.alive || !b.alive) continue;
      if (a.color !== b.color) continue;
      if (a.texture !== b.texture) continue;
      // Either both textured-with-uvs or both untextured — mismatched
      // states can't merge cleanly.
      if (!!a.uvs !== !!b.uvs) continue;
      if (!samePlane(a, b)) continue;

      // Re-validate the shared edge — a or b may have grown since the
      // edge index was built (chain merge within this pass).
      const shared = findSharedEdge(a, b);
      if (!shared) continue;
      const [e0, e1] = shared;

      // UV seam check: if both textured, the UVs at the shared edge must
      // match between A and B. Otherwise the merged polygon would tear at
      // the seam (the texture fills via a single affine, can't span two
      // disjoint atlas regions). This is what limits merging to within a
      // UV island and prevents merging across UV unwrap seams.
      if (a.uvs && b.uvs) {
        const ai0 = a.vertices.findIndex((v) => eqVec(v, e0));
        const ai1 = a.vertices.findIndex((v) => eqVec(v, e1));
        const bi0 = b.vertices.findIndex((v) => eqVec(v, e0));
        const bi1 = b.vertices.findIndex((v) => eqVec(v, e1));
        if (ai0 < 0 || ai1 < 0 || bi0 < 0 || bi1 < 0) continue;
        if (!eqUv(a.uvs[ai0], b.uvs[bi0])) continue;
        if (!eqUv(a.uvs[ai1], b.uvs[bi1])) continue;
      }

      const merged = mergeAlongEdge(a, b, e0, e1);
      if (!merged) continue;
      if (!isConvex(merged.vertices, a.normal)) continue;

      a.vertices = merged.vertices;
      a.uvs = merged.uvs;
      b.alive = false;
      mergedThisPass = true;
    }
    return mergedThisPass;
  };

  // Iterate to fixed point — each pass merges as much as it can while
  // working from a single snapshot of the edge index.
  while (tryMergePass()) { /* loop */ }

  // Pass 3: emit surviving polygons.
  for (const p of polys) {
    if (!p.alive) continue;
    const out_p: Polygon = {
      vertices: p.vertices,
      color: p.color,
    };
    if (p.texture) out_p.texture = p.texture;
    if (p.uvs) out_p.uvs = p.uvs;
    if (p.data) out_p.data = p.data;
    out.push(out_p);
  }
  return out;
}
