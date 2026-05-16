/**
 * dedupeOverlappingPolygons — drop polygons whose 3D footprint coincides
 * with another polygon's, within an epsilon tolerance.
 *
 * Why this exists: modelers (and importers) often emit redundant geometry
 * for the same visible surface — a doubled face on a wall, an inner shell
 * coincident with an outer shell, or two N-gons that fan-triangulate the
 * same region. Each duplicate is a real `<i>` element at render time:
 * it costs DOM, Lambert math, atlas budget, AND it produces stacked
 * shadow leaves that visibly multiply on the receiver (overlapping dark
 * patches on the ground).
 *
 * This is a separate concern from `cullInteriorPolygons` (which removes
 * polygons fully *enclosed* by other geometry, conservative against
 * false positives) and from `mergePolygons` (which joins same-color
 * coplanar polygons that share an edge). A polygon's exact twin
 * doesn't share an edge with itself and isn't enclosed by anything —
 * it slips through both passes.
 *
 * Algorithm:
 *   1. Compute each polygon's plane (normal + signed offset along
 *      normal) and centroid.
 *   2. Bucket polygons by quantized plane key (rounded normal direction
 *      with sign-folding so anti-parallel faces share a bucket, and
 *      rounded distance from origin along the unsigned normal axis).
 *      Polygons in different buckets cannot overlap.
 *   3. Within each bucket, do an O(K²) pairwise check on at most K
 *      polygons. Two polygons overlap if their 2D projections onto
 *      the shared plane share a significant area fraction.
 *   4. When a pair overlaps, drop one: prefer keeping the one whose
 *      normal points *away* from the mesh centroid (the "outward"
 *      face). For ties (truly identical orientation), keep the one
 *      with greater 2D area.
 *
 * Runs once at parse time in the same pipeline as mergePolygons. Zero
 * cost at runtime — once it returns the polygon array is final and the
 * dedup logic never executes again.
 */

import type { Polygon, Vec2, Vec3 } from "../types";

/** Tunable thresholds. Default values are conservative — only catch
 *  duplicates that are visually identical surfaces (exact twins,
 *  back-to-back winding flips, nested polys on the same plane).
 *  Looser values are appropriate for shadow-casting purposes, where
 *  any polygons whose projections land in the same place can share a
 *  shadow without affecting the rendered model. */
export interface DedupeOverlappingPolygonsOptions {
  /** Maximum 1 - |dot(n_a, n_b)| for normals to count as "parallel".
   *  Default 1e-3 (strict — must be near-identical orientation).
   *  Looser values (~5e-2 ≈ 18° off) treat near-parallel normals as
   *  duplicates, useful for shadow dedup where small orientation
   *  differences project to nearly the same shadow shape. */
  normalTolerance?: number;
  /** Maximum signed-distance difference between two polygons' plane
   *  offsets (along their shared normal) to count as coplanar.
   *  Default 0.05 (world units). Looser values treat distinct
   *  parallel shells (e.g. an inner cavity wall behind an outer
   *  wall) as shadow-duplicates. */
  distanceTolerance?: number;
  /** Minimum overlap fraction (max of A-in-B and B-in-A vertex
   *  containment ratios) for a pair to count as a duplicate.
   *  Default 0.7. Lower (~0.4) is liberal; higher (~0.9) is strict. */
  overlapFraction?: number;
}

const DEFAULT_NORMAL_TOLERANCE = 1e-3;
const DEFAULT_DISTANCE_TOLERANCE = 0.05;
const DEFAULT_OVERLAP_FRACTION = 0.7;

/** Quantization step for normal-direction buckets. With step 0.05 the
 *  unit sphere splits into ~1200 cells, plenty for typical meshes
 *  without ballooning bucket count for low-poly scenes. */
const BUCKET_NORMAL_STEP = 0.05;

interface PolyMeta {
  index: number;
  polygon: Polygon;
  normal: Vec3;
  /** Signed distance from origin along the polygon's own normal. */
  d: number;
  centroid: Vec3;
  area: number;
  /** Polygon vertices projected to the plane's 2D basis. Lazy — only
   *  populated when the polygon enters the overlap test. */
  local2D: Vec2[] | null;
  /** 2D bbox in the plane basis. Lazy alongside local2D. */
  bbox2D: { min: Vec2; max: Vec2 } | null;
  /** Plane basis vectors. Lazy alongside local2D. */
  basis: { u: Vec3; v: Vec3 } | null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function computeMeta(polygon: Polygon, index: number): PolyMeta | null {
  const v = polygon.vertices;
  if (!v || v.length < 3) return null;
  // Best-fit plane normal from Newell's method (robust to non-planar input).
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return null;
  const normal: Vec3 = [nx / nLen, ny / nLen, nz / nLen];
  // Centroid.
  let cx = 0, cy = 0, cz = 0;
  for (const p of v) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const inv = 1 / v.length;
  const centroid: Vec3 = [cx * inv, cy * inv, cz * inv];
  const d = dot(normal, centroid);
  // Area = nLen / 2 (Newell's vector magnitude is twice the polygon area).
  const area = nLen * 0.5;
  return {
    index,
    polygon,
    normal,
    d,
    centroid,
    area,
    local2D: null,
    bbox2D: null,
    basis: null,
  };
}

/** Pick a deterministic 2D basis (u, v) orthogonal to the plane normal.
 *  Used to project vertices to 2D for the overlap test. */
function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  // Pick any axis not parallel to normal; orthogonalize.
  const axis: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = axis[0] - normal[0] * dot(axis, normal);
  let uy = axis[1] - normal[1] * dot(axis, normal);
  let uz = axis[2] - normal[2] * dot(axis, normal);
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen; uy /= uLen; uz /= uLen;
  const u: Vec3 = [ux, uy, uz];
  const v: Vec3 = cross(normal, u);
  return { u, v };
}

function ensure2D(meta: PolyMeta): void {
  if (meta.local2D) return;
  const basis = planeBasis(meta.normal);
  const local2D: Vec2[] = [];
  let minU = Infinity, minV = Infinity;
  let maxU = -Infinity, maxV = -Infinity;
  for (const p of meta.polygon.vertices) {
    const u = dot(p, basis.u);
    const v = dot(p, basis.v);
    local2D.push([u, v]);
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  meta.local2D = local2D;
  meta.bbox2D = { min: [minU, minV], max: [maxU, maxV] };
  meta.basis = basis;
}

/** Project a polygon's world vertices into an arbitrary 2D basis (not
 *  necessarily its own — used to test overlap against another polygon
 *  whose basis we treat as canonical). */
function projectInto(
  polygon: Polygon,
  basis: { u: Vec3; v: Vec3 },
): { local2D: Vec2[]; bbox2D: { min: Vec2; max: Vec2 } } {
  const local2D: Vec2[] = [];
  let minU = Infinity, minV = Infinity;
  let maxU = -Infinity, maxV = -Infinity;
  for (const p of polygon.vertices) {
    const u = dot(p, basis.u);
    const v = dot(p, basis.v);
    local2D.push([u, v]);
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  return { local2D, bbox2D: { min: [minU, minV], max: [maxU, maxV] } };
}

function bboxOverlap2D(
  a: { min: Vec2; max: Vec2 },
  b: { min: Vec2; max: Vec2 },
): boolean {
  return a.max[0] >= b.min[0] && a.min[0] <= b.max[0]
      && a.max[1] >= b.min[1] && a.min[1] <= b.max[1];
}

function pointInPolygon2D(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const intersect = ((a[1] > p[1]) !== (b[1] > p[1]))
      && (p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] + 1e-30) + a[0]);
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroid2D(poly: Vec2[]): Vec2 {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  return [cx / poly.length, cy / poly.length];
}

/** Overlap score between two 2D polygons via vertex containment sampling.
 *  Exact polygon intersection (Weiler–Atherton, Greiner–Hormann) is
 *  overkill for the dedup decision: we only need "is one mostly inside
 *  the other?", not the precise area.
 *
 *  Each test point is shifted a tiny step toward its polygon's centroid
 *  before the inside check — exact duplicates and shared-edge configs
 *  would otherwise test their vertices exactly on the other polygon's
 *  boundary, where the even-odd rule is undefined.
 *
 *  Returns max(fraction of A inside B, fraction of B inside A). This
 *  catches BOTH the "exact duplicate" case (both fractions = 1.0) AND
 *  the "nested" case (one polygon entirely inside the other → at least
 *  one fraction = 1.0). Partial overlaps score below 1.0 in both
 *  directions and are rejected by the threshold. */
function overlapScore2D(a: Vec2[], b: Vec2[]): number {
  const aC = centroid2D(a);
  const bC = centroid2D(b);
  const inset = 1e-4;
  let hitsAinB = 0;
  for (const p of a) {
    const testP: Vec2 = [
      p[0] + (aC[0] - p[0]) * inset,
      p[1] + (aC[1] - p[1]) * inset,
    ];
    if (pointInPolygon2D(testP, b)) hitsAinB++;
  }
  let hitsBinA = 0;
  for (const p of b) {
    const testP: Vec2 = [
      p[0] + (bC[0] - p[0]) * inset,
      p[1] + (bC[1] - p[1]) * inset,
    ];
    if (pointInPolygon2D(testP, a)) hitsBinA++;
  }
  const aIn = hitsAinB / a.length;
  const bIn = hitsBinA / b.length;
  return Math.max(aIn, bIn);
}

/** Bucket key folds normal sign (so back-to-back faces share a bucket)
 *  and quantizes the plane components. The distance bucket step is
 *  derived from the caller's distance tolerance — keep it ~2× the
 *  tolerance so near-miss pairs still meet in adjacent buckets. */
function bucketKey(meta: PolyMeta, distanceTolerance: number): string {
  // Fold sign so anti-parallel normals share a bucket. We pick the
  // representative whose largest-magnitude component is non-negative.
  let nx = meta.normal[0], ny = meta.normal[1], nz = meta.normal[2];
  const absX = Math.abs(nx), absY = Math.abs(ny), absZ = Math.abs(nz);
  let dominant = nx;
  if (absY > absX && absY > absZ) dominant = ny;
  else if (absZ > absX && absZ > absY) dominant = nz;
  if (dominant < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const qx = Math.round(nx / BUCKET_NORMAL_STEP);
  const qy = Math.round(ny / BUCKET_NORMAL_STEP);
  const qz = Math.round(nz / BUCKET_NORMAL_STEP);
  // Plane offset along the unsigned normal — also sign-folded so two
  // back-to-back polygons (d and -d under flipped normals) match.
  const dAbs = meta.d * (meta.normal[0] === nx && meta.normal[1] === ny && meta.normal[2] === nz ? 1 : -1);
  const qd = Math.round(dAbs / (distanceTolerance * 2));
  return `${qx},${qy},${qz}|${qd}`;
}

/** Are two polygons close enough on the same plane to even consider
 *  the (more expensive) 2D overlap test? */
function coplanar(a: PolyMeta, b: PolyMeta, normalTolerance: number, distanceTolerance: number): boolean {
  const d = dot(a.normal, b.normal);
  // Allow parallel OR anti-parallel within tolerance.
  if (Math.abs(d) < 1 - normalTolerance) return false;
  // Signed offsets must match (with the normal flip if anti-parallel).
  const sign = d > 0 ? 1 : -1;
  return Math.abs(a.d - sign * b.d) < distanceTolerance;
}

/** True if polygon `inner` is "facing inward" relative to the mesh's
 *  centroid — i.e., its normal points roughly toward the model's bulk.
 *  Used to prefer keeping outward-facing duplicates of a pair. */
function facesInward(meta: PolyMeta, meshCentroid: Vec3): boolean {
  const toCenter = sub(meshCentroid, meta.centroid);
  return dot(meta.normal, toCenter) > 0;
}

/** Identify polygons that are duplicates within tolerance. Returns the
 *  set of indices into the input array that should be dropped (the
 *  losers of duplicate pairs). The "winner" of a pair is the polygon
 *  whose normal faces away from the mesh centroid (outward), with
 *  larger area as a tiebreaker.
 *
 *  Exposed for callers that want to act on the index set directly —
 *  e.g. shadow casting can use a looser tolerance to skip shadow leaves
 *  for redundant casters without removing them from the renderable
 *  polygon set. */
export function findOverlappingPolygonDuplicates(
  input: Polygon[],
  options?: DedupeOverlappingPolygonsOptions,
): Set<number> {
  if (!input || input.length < 2) return new Set();
  const normalTolerance = options?.normalTolerance ?? DEFAULT_NORMAL_TOLERANCE;
  const distanceTolerance = options?.distanceTolerance ?? DEFAULT_DISTANCE_TOLERANCE;
  const overlapFraction = options?.overlapFraction ?? DEFAULT_OVERLAP_FRACTION;

  const metas: PolyMeta[] = [];
  for (let i = 0; i < input.length; i++) {
    const m = computeMeta(input[i], i);
    if (m) metas.push(m);
  }
  if (metas.length < 2) return new Set();

  // Mesh centroid: average of polygon centroids weighted by area. Used
  // to decide which side of a duplicate pair "faces outward."
  let mcx = 0, mcy = 0, mcz = 0, totalArea = 0;
  for (const m of metas) {
    mcx += m.centroid[0] * m.area;
    mcy += m.centroid[1] * m.area;
    mcz += m.centroid[2] * m.area;
    totalArea += m.area;
  }
  const meshCentroid: Vec3 = totalArea > 0
    ? [mcx / totalArea, mcy / totalArea, mcz / totalArea]
    : [0, 0, 0];

  // Bucket polygons by quantized plane.
  const buckets = new Map<string, PolyMeta[]>();
  for (const m of metas) {
    const key = bucketKey(m, distanceTolerance);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(m);
  }

  const dropped = new Set<number>();
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (dropped.has(a.index)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (dropped.has(b.index)) continue;
        if (!coplanar(a, b, normalTolerance, distanceTolerance)) continue;
        // Both polygons project into A's basis — using each polygon's own
        // basis breaks for back-to-back faces (anti-parallel normals
        // produce mirrored basis vectors and the bboxes don't overlap).
        ensure2D(a);
        const bProj = projectInto(b.polygon, a.basis!);
        if (!bboxOverlap2D(a.bbox2D!, bProj.bbox2D)) continue;
        const score = overlapScore2D(a.local2D!, bProj.local2D);
        if (score < overlapFraction) continue;
        // Pick the loser. Outward-facing beats inward; ties go to larger area.
        const aInward = facesInward(a, meshCentroid);
        const bInward = facesInward(b, meshCentroid);
        let drop: PolyMeta;
        if (aInward && !bInward) drop = a;
        else if (bInward && !aInward) drop = b;
        else drop = a.area < b.area ? a : b;
        dropped.add(drop.index);
        if (drop === a) break; // a is gone, move to next i
      }
    }
  }

  return dropped;
}

export function dedupeOverlappingPolygons(
  input: Polygon[],
  options?: DedupeOverlappingPolygonsOptions,
): Polygon[] {
  if (!input || input.length < 2) return input ?? [];
  const dropped = findOverlappingPolygonDuplicates(input, options);
  if (dropped.size === 0) return input;
  const out: Polygon[] = [];
  for (let i = 0; i < input.length; i++) {
    if (!dropped.has(i)) out.push(input[i]);
  }
  return out;
}
