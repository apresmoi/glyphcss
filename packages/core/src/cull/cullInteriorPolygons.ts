/**
 * cullInteriorPolygons — remove polygons that are fully enclosed by other
 * polygons of the same mesh and therefore never visible from any external
 * camera direction.
 *
 * Algorithm: for each polygon p,
 *   1. Sample K unit directions on the hemisphere above p's normal.
 *   2. Cast a ray from a point just above p's centroid in each direction.
 *   3. If at least one ray escapes without hitting any other polygon → p
 *      is potentially visible from some external camera → keep it.
 *   4. If every ray hits another polygon → p is fully surrounded → cull it.
 *
 * Acceleration: flat-array SAH-built binary BVH with slab-test AABB traversal.
 * All BVH data is stored in typed Float64Array / Int32Array for cache efficiency.
 * Ray traversal visits only the subtrees whose AABBs the ray intersects.
 *
 * Runs once at parse time inside `loadMesh`, before `mergePolygons`. Zero
 * runtime cost. Conservative by design — false negatives (failing to cull
 * a truly hidden poly) are safe; false positives would be a visual bug.
 */
import type { Polygon, Vec3 } from "../types";

const DEFAULT_HEMISPHERE_SAMPLES = 8;
const RAY_ORIGIN_OFFSET = 1e-3;
const MIN_HIT_T = 1e-3;
const PARALLEL_EPS = 1e-9;

interface PolyMeta {
  centroid: Vec3;
  normal: Vec3;
  vertices: Vec3[];
  /** Flat triangle data: [ax,ay,az, bx,by,bz, cx,cy,cz, ...] per triangle */
  triFlat: Float64Array;
  /** Bounding sphere center + radius² */
  bcx: number; bcy: number; bcz: number; br2: number;
  /** AABB */
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

const ORIGIN_INSET = 0.08;

function precompute(p: Polygon): PolyMeta | null {
  const verts = p.vertices;
  if (!verts || verts.length < 3) return null;

  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of verts) { cx += x; cy += y; cz += z; }
  const inv = 1 / verts.length;
  cx *= inv; cy *= inv; cz *= inv;

  const v0 = verts[0], v1 = verts[1], v2 = verts[2];
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < PARALLEL_EPS) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;

  const nTri = verts.length - 2;
  const triFlat = new Float64Array(nTri * 9);
  let ti = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0], b = verts[i], c = verts[i + 1];
    triFlat[ti++] = a[0]; triFlat[ti++] = a[1]; triFlat[ti++] = a[2];
    triFlat[ti++] = b[0]; triFlat[ti++] = b[1]; triFlat[ti++] = b[2];
    triFlat[ti++] = c[0]; triFlat[ti++] = c[1]; triFlat[ti++] = c[2];
  }

  let br2 = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    const ddx = x - cx, ddy = y - cy, ddz = z - cz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > br2) br2 = d2;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return {
    centroid: [cx, cy, cz],
    normal: [nx, ny, nz],
    vertices: verts,
    triFlat,
    bcx: cx, bcy: cy, bcz: cz, br2,
    minX, minY, minZ, maxX, maxY, maxZ,
  };
}

/**
 * Möller–Trumbore ray-triangle intersection (flat array variant).
 * Returns true if the ray hits the triangle at t > MIN_HIT_T.
 */
function rayTriFlat(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tf: Float64Array, base: number,
): boolean {
  const ax = tf[base], ay = tf[base + 1], az = tf[base + 2];
  const e1x = tf[base + 3] - ax, e1y = tf[base + 4] - ay, e1z = tf[base + 5] - az;
  const e2x = tf[base + 6] - ax, e2y = tf[base + 7] - ay, e2z = tf[base + 8] - az;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (det > -PARALLEL_EPS && det < PARALLEL_EPS) return false;
  const invDet = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = invDet * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = invDet * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return false;
  return invDet * (e2x * qx + e2y * qy + e2z * qz) > MIN_HIT_T;
}

/**
 * Test if ray hits any triangle in polygon q.
 * Bounding-sphere pre-reject for non-BVH callers; BVH has already done AABB culling.
 */
function rayHitsPolygon(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  q: PolyMeta,
): boolean {
  // Bounding-sphere reject (keeps leaf testing fast for non-hitting rays).
  const vx = q.bcx - ox, vy = q.bcy - oy, vz = q.bcz - oz;
  const proj = vx * dx + vy * dy + vz * dz;
  const perpX = vx - proj * dx;
  const perpY = vy - proj * dy;
  const perpZ = vz - proj * dz;
  if (perpX * perpX + perpY * perpY + perpZ * perpZ > q.br2) return false;
  const tf = q.triFlat;
  const n = tf.length;
  for (let b = 0; b < n; b += 9) {
    if (rayTriFlat(ox, oy, oz, dx, dy, dz, tf, b)) return true;
  }
  return false;
}

// ─── Flat-array SAH BVH ──────────────────────────────────────────────────────
// Node layout (BVH_STRIDE Float64 values per node):
//   [0..5] AABB: minX minY minZ maxX maxY maxZ
//   [6]    isLeaf: 1 = leaf, 0 = internal
//   Internal: [7] leftIdx  [8] rightIdx
//   Leaf:     [7] start    [8] end      (into polyIndices)

const BVH_STRIDE = 9;
const BVH_LEAF_SIZE = 6;
const SAH_BUCKETS = 12;

interface BVH {
  data: Float64Array;
  nodeCount: number;
  polyIndices: Int32Array;
  meta: Array<PolyMeta | null>;
}

/** Half-surface-area of an AABB (factor 2 cancels in SAH ratios). */
function aabbSA(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return dx * dy + dy * dz + dz * dx;
}

function buildBVH(meta: Array<PolyMeta | null>): BVH {
  const valid: number[] = [];
  for (let i = 0; i < meta.length; i++) { if (meta[i]) valid.push(i); }
  const n = valid.length;
  const polyIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) polyIndices[i] = valid[i];

  // Precompute centroid per reordered index slot.
  const centX = new Float64Array(n);
  const centY = new Float64Array(n);
  const centZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = meta[polyIndices[i]]!;
    centX[i] = (m.minX + m.maxX) * 0.5;
    centY[i] = (m.minY + m.maxY) * 0.5;
    centZ[i] = (m.minZ + m.maxZ) * 0.5;
  }

  // Worst case: 2*N nodes for a balanced tree; +1 for safety.
  const maxNodes = 2 * Math.max(1, n) + 1;
  const data = new Float64Array(maxNodes * BVH_STRIDE);
  let nodeCount = 0;

  // Reusable bucket arrays to avoid alloc in the hot build loop.
  const bMinX = new Float64Array(SAH_BUCKETS);
  const bMinY = new Float64Array(SAH_BUCKETS);
  const bMinZ = new Float64Array(SAH_BUCKETS);
  const bMaxX = new Float64Array(SAH_BUCKETS);
  const bMaxY = new Float64Array(SAH_BUCKETS);
  const bMaxZ = new Float64Array(SAH_BUCKETS);
  const bCnt  = new Int32Array(SAH_BUCKETS);
  const lSA   = new Float64Array(SAH_BUCKETS - 1);
  const lCnt  = new Int32Array(SAH_BUCKETS - 1);
  const rSA   = new Float64Array(SAH_BUCKETS - 1);
  const rCnt  = new Int32Array(SAH_BUCKETS - 1);

  function buildNode(start: number, end: number): number {
    const ni = nodeCount++;
    const base = ni * BVH_STRIDE;
    const count = end - start;

    // Compute AABB for this range and write to node.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const m = meta[polyIndices[i]]!;
      if (m.minX < minX) minX = m.minX; if (m.maxX > maxX) maxX = m.maxX;
      if (m.minY < minY) minY = m.minY; if (m.maxY > maxY) maxY = m.maxY;
      if (m.minZ < minZ) minZ = m.minZ; if (m.maxZ > maxZ) maxZ = m.maxZ;
    }
    data[base] = minX; data[base + 1] = minY; data[base + 2] = minZ;
    data[base + 3] = maxX; data[base + 4] = maxY; data[base + 5] = maxZ;

    if (count <= BVH_LEAF_SIZE) {
      data[base + 6] = 1; data[base + 7] = start; data[base + 8] = end;
      return ni;
    }

    // Centroid AABB for SAH axis selection.
    let cxMin = Infinity, cyMin = Infinity, czMin = Infinity;
    let cxMax = -Infinity, cyMax = -Infinity, czMax = -Infinity;
    for (let i = start; i < end; i++) {
      if (centX[i] < cxMin) cxMin = centX[i]; if (centX[i] > cxMax) cxMax = centX[i];
      if (centY[i] < cyMin) cyMin = centY[i]; if (centY[i] > cyMax) cyMax = centY[i];
      if (centZ[i] < czMin) czMin = centZ[i]; if (centZ[i] > czMax) czMax = centZ[i];
    }
    const extX = cxMax - cxMin, extY = cyMax - cyMin, extZ = czMax - czMin;

    if (extX === 0 && extY === 0 && extZ === 0) {
      data[base + 6] = 1; data[base + 7] = start; data[base + 8] = end;
      return ni;
    }

    const nodeSA = aabbSA(minX, minY, minZ, maxX, maxY, maxZ);
    const invSA = nodeSA > 0 ? 1 / nodeSA : 0;
    let bestCost = count + 1;
    let bestAxis = 0, bestSplitVal = 0;

    // Evaluate SAH on all three axes.
    for (let axis = 0; axis < 3; axis++) {
      const cMin = axis === 0 ? cxMin : (axis === 1 ? cyMin : czMin);
      const ext  = axis === 0 ? extX  : (axis === 1 ? extY  : extZ);
      if (ext === 0) continue;
      const centArr = axis === 0 ? centX : (axis === 1 ? centY : centZ);
      const scale = SAH_BUCKETS / ext;

      bMinX.fill(Infinity); bMinY.fill(Infinity); bMinZ.fill(Infinity);
      bMaxX.fill(-Infinity); bMaxY.fill(-Infinity); bMaxZ.fill(-Infinity);
      bCnt.fill(0);

      for (let i = start; i < end; i++) {
        let b = (centArr[i] - cMin) * scale | 0;
        if (b >= SAH_BUCKETS) b = SAH_BUCKETS - 1;
        const m = meta[polyIndices[i]]!;
        if (m.minX < bMinX[b]) bMinX[b] = m.minX; if (m.maxX > bMaxX[b]) bMaxX[b] = m.maxX;
        if (m.minY < bMinY[b]) bMinY[b] = m.minY; if (m.maxY > bMaxY[b]) bMaxY[b] = m.maxY;
        if (m.minZ < bMinZ[b]) bMinZ[b] = m.minZ; if (m.maxZ > bMaxZ[b]) bMaxZ[b] = m.maxZ;
        bCnt[b]++;
      }

      // Left sweep.
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity;
      let lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
      let lc = 0;
      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (bMinX[k] < lx0) lx0 = bMinX[k]; if (bMaxX[k] > lx1) lx1 = bMaxX[k];
        if (bMinY[k] < ly0) ly0 = bMinY[k]; if (bMaxY[k] > ly1) ly1 = bMaxY[k];
        if (bMinZ[k] < lz0) lz0 = bMinZ[k]; if (bMaxZ[k] > lz1) lz1 = bMaxZ[k];
        lc += bCnt[k];
        lSA[k] = aabbSA(lx0, ly0, lz0, lx1, ly1, lz1);
        lCnt[k] = lc;
      }
      // Right sweep.
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity;
      let rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
      let rc = 0;
      for (let k = SAH_BUCKETS - 2; k >= 0; k--) {
        const kb = k + 1;
        if (bMinX[kb] < rx0) rx0 = bMinX[kb]; if (bMaxX[kb] > rx1) rx1 = bMaxX[kb];
        if (bMinY[kb] < ry0) ry0 = bMinY[kb]; if (bMaxY[kb] > ry1) ry1 = bMaxY[kb];
        if (bMinZ[kb] < rz0) rz0 = bMinZ[kb]; if (bMaxZ[kb] > rz1) rz1 = bMaxZ[kb];
        rc += bCnt[kb];
        rSA[k] = aabbSA(rx0, ry0, rz0, rx1, ry1, rz1);
        rCnt[k] = rc;
      }

      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (lCnt[k] === 0 || rCnt[k] === 0) continue;
        const cost = 0.125 + (lSA[k] * lCnt[k] + rSA[k] * rCnt[k]) * invSA;
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestSplitVal = cMin + (k + 1) / scale;
        }
      }
    }

    // Partition around bestSplitVal on bestAxis.
    const centArr2 = bestAxis === 0 ? centX : (bestAxis === 1 ? centY : centZ);
    let lo = start, hi = end - 1;
    while (lo <= hi) {
      if (centArr2[lo] < bestSplitVal) {
        lo++;
      } else {
        // Swap polyIndices and centroids.
        const tmp = polyIndices[lo]; polyIndices[lo] = polyIndices[hi]; polyIndices[hi] = tmp;
        const t0 = centX[lo]; centX[lo] = centX[hi]; centX[hi] = t0;
        const t1 = centY[lo]; centY[lo] = centY[hi]; centY[hi] = t1;
        const t2 = centZ[lo]; centZ[lo] = centZ[hi]; centZ[hi] = t2;
        hi--;
      }
    }
    let mid = lo;
    if (mid === start || mid === end) mid = (start + end) >> 1;

    // Internal node: recurse. Must write children after recursion since
    // nodeCount advances during recursion.
    data[base + 6] = 0;
    const left = buildNode(start, mid);
    const right = buildNode(mid, end);
    // Re-compute base since nodeCount changed (data buffer is fixed-size).
    data[ni * BVH_STRIDE + 7] = left;
    data[ni * BVH_STRIDE + 8] = right;

    return ni;
  }

  if (n > 0) buildNode(0, n);

  return { data, nodeCount, polyIndices, meta };
}

/**
 * Any-hit ray traversal over the BVH. Returns true immediately on first hit
 * (perfect for occlusion queries). Uses an explicit stack for speed.
 */
function rayHitsAnyInBVH(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  selfIdx: number,
  bvh: BVH,
  stack: Int32Array,
): boolean {
  if (bvh.nodeCount === 0) return false;
  const { data, polyIndices, meta } = bvh;

  const invDx = dx !== 0 ? 1 / dx : (dx >= 0 ? Infinity : -Infinity);
  const invDy = dy !== 0 ? 1 / dy : (dy >= 0 ? Infinity : -Infinity);
  const invDz = dz !== 0 ? 1 / dz : (dz >= 0 ? Infinity : -Infinity);

  let top = 0;
  stack[top++] = 0;

  while (top > 0) {
    const ni = stack[--top];
    const base = ni * BVH_STRIDE;

    // AABB slab test.
    const tx1 = (data[base]     - ox) * invDx;
    const tx2 = (data[base + 3] - ox) * invDx;
    let tMin = tx1 < tx2 ? tx1 : tx2;
    let tMax = tx1 < tx2 ? tx2 : tx1;

    const ty1 = (data[base + 1] - oy) * invDy;
    const ty2 = (data[base + 4] - oy) * invDy;
    const tyMin = ty1 < ty2 ? ty1 : ty2;
    const tyMax = ty1 < ty2 ? ty2 : ty1;
    if (tMin > tyMax || tyMin > tMax) continue;
    if (tyMin > tMin) tMin = tyMin;
    if (tyMax < tMax) tMax = tyMax;

    const tz1 = (data[base + 2] - oz) * invDz;
    const tz2 = (data[base + 5] - oz) * invDz;
    const tzMin = tz1 < tz2 ? tz1 : tz2;
    const tzMax = tz1 < tz2 ? tz2 : tz1;
    if (tMin > tzMax || tzMin > tMax) continue;
    if (tzMax < tMax) tMax = tzMax;

    if (tMax < MIN_HIT_T) continue; // AABB entirely behind origin

    if (data[base + 6] === 1) {
      // Leaf node.
      const start = data[base + 7] | 0;
      const end   = data[base + 8] | 0;
      for (let k = start; k < end; k++) {
        const j = polyIndices[k];
        if (j === selfIdx) continue;
        const q = meta[j];
        if (q && rayHitsPolygon(ox, oy, oz, dx, dy, dz, q)) return true;
      }
    } else {
      // Push both children; order doesn't matter for any-hit.
      stack[top++] = data[base + 7] | 0;
      stack[top++] = data[base + 8] | 0;
    }
  }
  return false;
}

/**
 * Precompute K Fibonacci-spiral hemisphere samples as a flat Float64Array.
 * Layout: [lx0, ly0, lz0, lx1, ly1, lz1, ...]
 */
function hemisphereSamplesFlat(k: number): Float64Array {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out = new Float64Array(k * 3);
  for (let i = 0; i < k; i++) {
    const z = (i + 0.5) / k;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = 2 * Math.PI * (i / phi);
    out[i * 3]     = r * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(theta);
    out[i * 3 + 2] = z;
  }
  return out;
}

function basis(n: Vec3): { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number } {
  const ax = Math.abs(n[0]) > 0.9 ? 0 : 1;
  const ay = Math.abs(n[0]) > 0.9 ? 1 : 0;
  let ux = ay * n[2];
  let uy = -ax * n[2];
  let uz = ax * n[1] - ay * n[0];
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen; uy /= uLen; uz /= uLen;
  const vx = n[1] * uz - n[2] * uy;
  const vy = n[2] * ux - n[0] * uz;
  const vz = n[0] * uy - n[1] * ux;
  return { ux, uy, uz, vx, vy, vz };
}

export interface CullInteriorOptions {
  /** Hemisphere ray samples per polygon. Higher = fewer false positives, slower. Default 12. */
  samples?: number;
}

export function cullInteriorPolygons(
  polygons: Polygon[],
  options?: CullInteriorOptions,
): Polygon[] {
  const k = options?.samples ?? DEFAULT_HEMISPHERE_SAMPLES;
  if (polygons.length < 4 || k < 1) return polygons;

  const meta: Array<PolyMeta | null> = polygons.map(precompute);
  const samplesFlat = hemisphereSamplesFlat(k);
  const kept: Polygon[] = [];
  const bvh = buildBVH(meta);
  // BVH traversal stack — depth bounded by log2(N). Pre-allocate generously.
  const stack = new Int32Array(Math.max(64, bvh.nodeCount));

  // Reusable fixed-size origins buffer (1 centroid + maxVerts vertices + maxVerts edge-mids).
  // Polygons from parsed OBJ rarely exceed 8 vertices; 64 origins is a safe upper bound.
  const MAX_ORIGINS = 64 * 3;
  const origBuf = new Float64Array(MAX_ORIGINS);

  for (let i = 0; i < polygons.length; i++) {
    const p = meta[i];
    if (!p) { kept.push(polygons[i]); continue; }

    const nx = p.normal[0], ny = p.normal[1], nz = p.normal[2];
    const offX = RAY_ORIGIN_OFFSET * nx;
    const offY = RAY_ORIGIN_OFFSET * ny;
    const offZ = RAY_ORIGIN_OFFSET * nz;

    // Phase 1 — cheap pre-test: cast a single ray along +normal.
    {
      const ox1 = p.centroid[0] + offX;
      const oy1 = p.centroid[1] + offY;
      const oz1 = p.centroid[2] + offZ;
      if (!rayHitsAnyInBVH(ox1, oy1, oz1, nx, ny, nz, i, bvh, stack)) {
        kept.push(polygons[i]); continue;
      }
    }

    // Phase 2 — multi-origin K-sample hemisphere test.
    const { ux, uy, uz, vx, vy, vz } = basis(p.normal);
    const cx0 = p.centroid[0], cy0 = p.centroid[1], cz0 = p.centroid[2];
    const verts = p.vertices;
    const vCount = verts.length;

    // Build origins into origBuf (flat: ox,oy,oz, ...).
    let oCnt = 0;
    // 1× centroid.
    origBuf[oCnt++] = cx0 + offX;
    origBuf[oCnt++] = cy0 + offY;
    origBuf[oCnt++] = cz0 + offZ;
    // N× vertex insets.
    for (let vi = 0; vi < vCount; vi++) {
      const v = verts[vi];
      origBuf[oCnt++] = v[0] + (cx0 - v[0]) * ORIGIN_INSET + offX;
      origBuf[oCnt++] = v[1] + (cy0 - v[1]) * ORIGIN_INSET + offY;
      origBuf[oCnt++] = v[2] + (cz0 - v[2]) * ORIGIN_INSET + offZ;
    }
    // N× edge-midpoint insets.
    for (let vi = 0; vi < vCount; vi++) {
      const a = verts[vi];
      const b = verts[(vi + 1) % vCount];
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      const mz = (a[2] + b[2]) * 0.5;
      origBuf[oCnt++] = mx + (cx0 - mx) * ORIGIN_INSET + offX;
      origBuf[oCnt++] = my + (cy0 - my) * ORIGIN_INSET + offY;
      origBuf[oCnt++] = mz + (cz0 - mz) * ORIGIN_INSET + offZ;
    }

    // Transpose the origin×sample loop: iterate samples in the outer loop,
    // origins in the inner. For polygons that escape through a specific sample
    // direction (regardless of origin), this finds the escape in at most
    // nOrigins steps for that sample, rather than nSamples steps per origin.
    let escaped = false;
    outer: for (let si = 0; si < samplesFlat.length; si += 3) {
      const lx = samplesFlat[si], ly = samplesFlat[si + 1], lz = samplesFlat[si + 2];
      const rdx = lx * ux + ly * vx + lz * nx;
      const rdy = lx * uy + ly * vy + lz * ny;
      const rdz = lx * uz + ly * vz + lz * nz;
      for (let oi = 0; oi < oCnt; oi += 3) {
        const rox = origBuf[oi], roy = origBuf[oi + 1], roz = origBuf[oi + 2];
        if (!rayHitsAnyInBVH(rox, roy, roz, rdx, rdy, rdz, i, bvh, stack)) {
          escaped = true; break outer;
        }
      }
    }

    if (escaped) kept.push(polygons[i]);
  }

  return kept;
}
