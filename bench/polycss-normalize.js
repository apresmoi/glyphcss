// packages/core/src/merge/mergePolygons.ts
var EPS_NORMAL = 1e-3;
var EPS_DISTANCE = 0.05;
var EPS_TEXTURE_DISTANCE = 1e-3;
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var norm = (a) => Math.hypot(a[0], a[1], a[2]);
var eqVec = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
function edgeKey(a, b) {
  const ka = `${a[0]},${a[1]},${a[2]}`;
  const kb = `${b[0]},${b[1]},${b[2]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function planeOf(vertices) {
  if (vertices.length < 3) return null;
  const e1 = sub(vertices[1], vertices[0]);
  const e2 = sub(vertices[2], vertices[0]);
  const n = cross(e1, e2);
  const len = norm(n);
  if (len < 1e-12) return null;
  const normal = [n[0] / len, n[1] / len, n[2] / len];
  const d = dot(normal, vertices[0]);
  return { normal, d };
}
function samePlane(a, b) {
  const dotN = dot(a.normal, b.normal);
  if (dotN < 1 - EPS_NORMAL) return false;
  return Math.abs(a.d - b.d) < EPS_DISTANCE;
}
function sameTexturePlane(a, b) {
  const dotN = dot(a.normal, b.normal);
  if (dotN < 1 - EPS_NORMAL) return false;
  return Math.abs(a.d - b.d) < EPS_TEXTURE_DISTANCE;
}
function mergeAlongEdge(a, b, e0, e1) {
  const ai0 = a.vertices.findIndex((v) => eqVec(v, e0));
  const ai1 = a.vertices.findIndex((v) => eqVec(v, e1));
  const bi0 = b.vertices.findIndex((v) => eqVec(v, e0));
  const bi1 = b.vertices.findIndex((v) => eqVec(v, e1));
  if (ai0 < 0 || ai1 < 0 || bi0 < 0 || bi1 < 0) return null;
  const an = a.vertices.length;
  const bn = b.vertices.length;
  const aGoesForward = (ai0 + 1) % an === ai1;
  const bGoesForward = (bi0 + 1) % bn === bi1;
  if (aGoesForward === bGoesForward) return null;
  const aStart = aGoesForward ? ai1 : ai0;
  const aEnd = aGoesForward ? ai0 : ai1;
  const bStart = bGoesForward ? bi1 : bi0;
  const bEnd = bGoesForward ? bi0 : bi1;
  const trackUvs = !!(a.uvs && b.uvs);
  const merged = [];
  const mergedUvs = trackUvs ? [] : void 0;
  let i = aStart;
  while (true) {
    merged.push(a.vertices[i]);
    if (mergedUvs) mergedUvs.push(a.uvs[i]);
    if (i === aEnd) break;
    i = (i + 1) % an;
  }
  i = bStart;
  while (true) {
    merged.push(b.vertices[i]);
    if (mergedUvs) mergedUvs.push(b.uvs[i]);
    if (i === bEnd) break;
    i = (i + 1) % bn;
  }
  const dedupV = [];
  const dedupU = mergedUvs ? [] : void 0;
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
  if (trackUvs) return rotateToNonCollinearStart(dedupV, dedupU);
  const cleaned = [];
  const cleanedUvs = dedupU ? [] : void 0;
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
function isConvex(vertices, normal) {
  const n = vertices.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const e1 = sub(b, a);
    const e2 = sub(c, b);
    const turn = dot(cross(e1, e2), normal);
    if (Math.abs(turn) < 1e-9) continue;
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
function texturedMergeIsPlanar(vertices) {
  if (vertices.length < 3) return false;
  const plane = planeOf(vertices);
  if (!plane) return false;
  for (const vertex of vertices) {
    if (Math.abs(dot(plane.normal, vertex) - plane.d) > EPS_TEXTURE_DISTANCE) {
      return false;
    }
  }
  return true;
}
function cloneTextureTriangles(triangles) {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex]),
    uvs: triangle.uvs.map((uv) => [...uv])
  }));
}
function fanTextureTriangles(vertices, uvs) {
  const triangles = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]],
        [...vertices[i]],
        [...vertices[i + 1]]
      ],
      uvs: [
        [...uvs[0]],
        [...uvs[i]],
        [...uvs[i + 1]]
      ]
    });
  }
  return triangles;
}
function rotateToNonCollinearStart(vertices, uvs) {
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    if (norm(cross(sub(b, a), sub(c, a))) <= 1e-9) continue;
    if (i === 0) return { vertices, uvs };
    return {
      vertices: [...vertices.slice(i), ...vertices.slice(0, i)],
      uvs: uvs ? [...uvs.slice(i), ...uvs.slice(0, i)] : void 0
    };
  }
  return { vertices, uvs };
}
function mergePolygons(input) {
  const out = [];
  const polys = [];
  for (const polygon of input ?? []) {
    if (!polygon || !polygon.vertices || polygon.vertices.length < 3) {
      if (polygon) out.push(polygon);
      continue;
    }
    const verts = polygon.vertices.map((v) => [v[0], v[1], v[2]]);
    const plane = planeOf(verts);
    if (!plane) {
      out.push(polygon);
      continue;
    }
    const uvs = polygon.texture && polygon.uvs && polygon.uvs.length === verts.length ? polygon.uvs.map((uv) => [uv[0], uv[1]]) : void 0;
    const textureTriangles = polygon.texture && uvs ? polygon.textureTriangles?.length ? cloneTextureTriangles(polygon.textureTriangles) : fanTextureTriangles(verts, uvs) : void 0;
    polys.push({
      vertices: verts,
      uvs,
      color: polygon.color ?? "#cccccc",
      texture: polygon.texture,
      textureTriangles,
      normal: plane.normal,
      d: plane.d,
      alive: true,
      data: polygon.data
    });
  }
  const tryMergePass = () => {
    const edgeIndex = /* @__PURE__ */ new Map();
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      if (!p.alive) continue;
      const n = p.vertices.length;
      for (let k = 0; k < n; k++) {
        const a = p.vertices[k];
        const b = p.vertices[(k + 1) % n];
        const key = edgeKey(a, b);
        let arr = edgeIndex.get(key);
        if (!arr) {
          arr = [];
          edgeIndex.set(key, arr);
        }
        arr.push(i);
      }
    }
    let mergedThisPass = false;
    const findSharedEdge = (a, b) => {
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
      if (owners.length < 2) continue;
      const [ai, bi] = owners;
      if (ai === bi) continue;
      const a = polys[ai];
      const b = polys[bi];
      if (!a.alive || !b.alive) continue;
      if (a.color !== b.color) continue;
      if (a.texture !== b.texture) continue;
      const hasTexture = Boolean(a.texture || b.texture);
      if (hasTexture && (!a.textureTriangles || !b.textureTriangles)) continue;
      if (!!a.uvs !== !!b.uvs) continue;
      if (hasTexture ? !sameTexturePlane(a, b) : !samePlane(a, b)) continue;
      const shared = findSharedEdge(a, b);
      if (!shared) continue;
      const [e0, e1] = shared;
      const merged = mergeAlongEdge(a, b, e0, e1);
      if (!merged) continue;
      if (hasTexture && !texturedMergeIsPlanar(merged.vertices)) continue;
      if (!isConvex(merged.vertices, a.normal)) continue;
      a.vertices = merged.vertices;
      a.uvs = merged.uvs;
      a.textureTriangles = hasTexture ? [...a.textureTriangles ?? [], ...b.textureTriangles ?? []] : void 0;
      b.alive = false;
      mergedThisPass = true;
    }
    return mergedThisPass;
  };
  while (tryMergePass()) {
  }
  for (const p of polys) {
    if (!p.alive) continue;
    const out_p = {
      vertices: p.vertices,
      color: p.color
    };
    if (p.texture) out_p.texture = p.texture;
    if (p.uvs) out_p.uvs = p.uvs;
    if (p.textureTriangles?.length) out_p.textureTriangles = p.textureTriangles;
    if (p.data) out_p.data = p.data;
    out.push(out_p);
  }
  return out;
}

// packages/core/src/cull/cullInteriorPolygons.ts
var DEFAULT_HEMISPHERE_SAMPLES = 8;
var RAY_ORIGIN_OFFSET = 1e-3;
var MIN_HIT_T = 1e-3;
var PARALLEL_EPS = 1e-9;
var ORIGIN_INSET = 0.08;
function precompute(p) {
  const verts = p.vertices;
  if (!verts || verts.length < 3) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of verts) {
    cx += x;
    cy += y;
    cz += z;
  }
  const inv = 1 / verts.length;
  cx *= inv;
  cy *= inv;
  cz *= inv;
  const v0 = verts[0], v1 = verts[1], v2 = verts[2];
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < PARALLEL_EPS) return null;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const nTri = verts.length - 2;
  const triFlat = new Float64Array(nTri * 9);
  let ti = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0], b = verts[i], c = verts[i + 1];
    triFlat[ti++] = a[0];
    triFlat[ti++] = a[1];
    triFlat[ti++] = a[2];
    triFlat[ti++] = b[0];
    triFlat[ti++] = b[1];
    triFlat[ti++] = b[2];
    triFlat[ti++] = c[0];
    triFlat[ti++] = c[1];
    triFlat[ti++] = c[2];
  }
  let br2 = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    const ddx = x - cx, ddy = y - cy, ddz = z - cz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 > br2) br2 = d2;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    centroid: [cx, cy, cz],
    normal: [nx, ny, nz],
    vertices: verts,
    triFlat,
    bcx: cx,
    bcy: cy,
    bcz: cz,
    br2,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ
  };
}
function rayTriFlat(ox, oy, oz, dx, dy, dz, tf, base) {
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
function rayHitsPolygon(ox, oy, oz, dx, dy, dz, q) {
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
var BVH_STRIDE = 9;
var BVH_LEAF_SIZE = 6;
var SAH_BUCKETS = 12;
function aabbSA(minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return dx * dy + dy * dz + dz * dx;
}
function buildBVH(meta) {
  const valid = [];
  for (let i = 0; i < meta.length; i++) {
    if (meta[i]) valid.push(i);
  }
  const n = valid.length;
  const polyIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) polyIndices[i] = valid[i];
  const centX = new Float64Array(n);
  const centY = new Float64Array(n);
  const centZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = meta[polyIndices[i]];
    centX[i] = (m.minX + m.maxX) * 0.5;
    centY[i] = (m.minY + m.maxY) * 0.5;
    centZ[i] = (m.minZ + m.maxZ) * 0.5;
  }
  const maxNodes = 2 * Math.max(1, n) + 1;
  const data = new Float64Array(maxNodes * BVH_STRIDE);
  let nodeCount = 0;
  const bMinX = new Float64Array(SAH_BUCKETS);
  const bMinY = new Float64Array(SAH_BUCKETS);
  const bMinZ = new Float64Array(SAH_BUCKETS);
  const bMaxX = new Float64Array(SAH_BUCKETS);
  const bMaxY = new Float64Array(SAH_BUCKETS);
  const bMaxZ = new Float64Array(SAH_BUCKETS);
  const bCnt = new Int32Array(SAH_BUCKETS);
  const lSA = new Float64Array(SAH_BUCKETS - 1);
  const lCnt = new Int32Array(SAH_BUCKETS - 1);
  const rSA = new Float64Array(SAH_BUCKETS - 1);
  const rCnt = new Int32Array(SAH_BUCKETS - 1);
  function buildNode(start, end) {
    const ni = nodeCount++;
    const base = ni * BVH_STRIDE;
    const count = end - start;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const m = meta[polyIndices[i]];
      if (m.minX < minX) minX = m.minX;
      if (m.maxX > maxX) maxX = m.maxX;
      if (m.minY < minY) minY = m.minY;
      if (m.maxY > maxY) maxY = m.maxY;
      if (m.minZ < minZ) minZ = m.minZ;
      if (m.maxZ > maxZ) maxZ = m.maxZ;
    }
    data[base] = minX;
    data[base + 1] = minY;
    data[base + 2] = minZ;
    data[base + 3] = maxX;
    data[base + 4] = maxY;
    data[base + 5] = maxZ;
    if (count <= BVH_LEAF_SIZE) {
      data[base + 6] = 1;
      data[base + 7] = start;
      data[base + 8] = end;
      return ni;
    }
    let cxMin = Infinity, cyMin = Infinity, czMin = Infinity;
    let cxMax = -Infinity, cyMax = -Infinity, czMax = -Infinity;
    for (let i = start; i < end; i++) {
      if (centX[i] < cxMin) cxMin = centX[i];
      if (centX[i] > cxMax) cxMax = centX[i];
      if (centY[i] < cyMin) cyMin = centY[i];
      if (centY[i] > cyMax) cyMax = centY[i];
      if (centZ[i] < czMin) czMin = centZ[i];
      if (centZ[i] > czMax) czMax = centZ[i];
    }
    const extX = cxMax - cxMin, extY = cyMax - cyMin, extZ = czMax - czMin;
    if (extX === 0 && extY === 0 && extZ === 0) {
      data[base + 6] = 1;
      data[base + 7] = start;
      data[base + 8] = end;
      return ni;
    }
    const nodeSA = aabbSA(minX, minY, minZ, maxX, maxY, maxZ);
    const invSA = nodeSA > 0 ? 1 / nodeSA : 0;
    let bestCost = count + 1;
    let bestAxis = 0, bestSplitVal = 0;
    for (let axis = 0; axis < 3; axis++) {
      const cMin = axis === 0 ? cxMin : axis === 1 ? cyMin : czMin;
      const ext = axis === 0 ? extX : axis === 1 ? extY : extZ;
      if (ext === 0) continue;
      const centArr = axis === 0 ? centX : axis === 1 ? centY : centZ;
      const scale = SAH_BUCKETS / ext;
      bMinX.fill(Infinity);
      bMinY.fill(Infinity);
      bMinZ.fill(Infinity);
      bMaxX.fill(-Infinity);
      bMaxY.fill(-Infinity);
      bMaxZ.fill(-Infinity);
      bCnt.fill(0);
      for (let i = start; i < end; i++) {
        let b = (centArr[i] - cMin) * scale | 0;
        if (b >= SAH_BUCKETS) b = SAH_BUCKETS - 1;
        const m = meta[polyIndices[i]];
        if (m.minX < bMinX[b]) bMinX[b] = m.minX;
        if (m.maxX > bMaxX[b]) bMaxX[b] = m.maxX;
        if (m.minY < bMinY[b]) bMinY[b] = m.minY;
        if (m.maxY > bMaxY[b]) bMaxY[b] = m.maxY;
        if (m.minZ < bMinZ[b]) bMinZ[b] = m.minZ;
        if (m.maxZ > bMaxZ[b]) bMaxZ[b] = m.maxZ;
        bCnt[b]++;
      }
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity;
      let lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
      let lc = 0;
      for (let k = 0; k < SAH_BUCKETS - 1; k++) {
        if (bMinX[k] < lx0) lx0 = bMinX[k];
        if (bMaxX[k] > lx1) lx1 = bMaxX[k];
        if (bMinY[k] < ly0) ly0 = bMinY[k];
        if (bMaxY[k] > ly1) ly1 = bMaxY[k];
        if (bMinZ[k] < lz0) lz0 = bMinZ[k];
        if (bMaxZ[k] > lz1) lz1 = bMaxZ[k];
        lc += bCnt[k];
        lSA[k] = aabbSA(lx0, ly0, lz0, lx1, ly1, lz1);
        lCnt[k] = lc;
      }
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity;
      let rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
      let rc = 0;
      for (let k = SAH_BUCKETS - 2; k >= 0; k--) {
        const kb = k + 1;
        if (bMinX[kb] < rx0) rx0 = bMinX[kb];
        if (bMaxX[kb] > rx1) rx1 = bMaxX[kb];
        if (bMinY[kb] < ry0) ry0 = bMinY[kb];
        if (bMaxY[kb] > ry1) ry1 = bMaxY[kb];
        if (bMinZ[kb] < rz0) rz0 = bMinZ[kb];
        if (bMaxZ[kb] > rz1) rz1 = bMaxZ[kb];
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
    const centArr2 = bestAxis === 0 ? centX : bestAxis === 1 ? centY : centZ;
    let lo = start, hi = end - 1;
    while (lo <= hi) {
      if (centArr2[lo] < bestSplitVal) {
        lo++;
      } else {
        const tmp = polyIndices[lo];
        polyIndices[lo] = polyIndices[hi];
        polyIndices[hi] = tmp;
        const t0 = centX[lo];
        centX[lo] = centX[hi];
        centX[hi] = t0;
        const t1 = centY[lo];
        centY[lo] = centY[hi];
        centY[hi] = t1;
        const t2 = centZ[lo];
        centZ[lo] = centZ[hi];
        centZ[hi] = t2;
        hi--;
      }
    }
    let mid = lo;
    if (mid === start || mid === end) mid = start + end >> 1;
    data[base + 6] = 0;
    const left = buildNode(start, mid);
    const right = buildNode(mid, end);
    data[ni * BVH_STRIDE + 7] = left;
    data[ni * BVH_STRIDE + 8] = right;
    return ni;
  }
  if (n > 0) buildNode(0, n);
  return { data, nodeCount, polyIndices, meta };
}
function rayHitsAnyInBVH(ox, oy, oz, dx, dy, dz, selfIdx, bvh, stack) {
  if (bvh.nodeCount === 0) return false;
  const { data, polyIndices, meta } = bvh;
  const invDx = dx !== 0 ? 1 / dx : dx >= 0 ? Infinity : -Infinity;
  const invDy = dy !== 0 ? 1 / dy : dy >= 0 ? Infinity : -Infinity;
  const invDz = dz !== 0 ? 1 / dz : dz >= 0 ? Infinity : -Infinity;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const ni = stack[--top];
    const base = ni * BVH_STRIDE;
    const tx1 = (data[base] - ox) * invDx;
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
    if (tMax < MIN_HIT_T) continue;
    if (data[base + 6] === 1) {
      const start = data[base + 7] | 0;
      const end = data[base + 8] | 0;
      for (let k = start; k < end; k++) {
        const j = polyIndices[k];
        if (j === selfIdx) continue;
        const q = meta[j];
        if (q && rayHitsPolygon(ox, oy, oz, dx, dy, dz, q)) return true;
      }
    } else {
      stack[top++] = data[base + 7] | 0;
      stack[top++] = data[base + 8] | 0;
    }
  }
  return false;
}
function hemisphereSamplesFlat(k) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out = new Float64Array(k * 3);
  for (let i = 0; i < k; i++) {
    const z = (i + 0.5) / k;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const theta = 2 * Math.PI * (i / phi);
    out[i * 3] = r * Math.cos(theta);
    out[i * 3 + 1] = r * Math.sin(theta);
    out[i * 3 + 2] = z;
  }
  return out;
}
function basis(n) {
  const ax = Math.abs(n[0]) > 0.9 ? 0 : 1;
  const ay = Math.abs(n[0]) > 0.9 ? 1 : 0;
  let ux = ay * n[2];
  let uy = -ax * n[2];
  let uz = ax * n[1] - ay * n[0];
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  const vx = n[1] * uz - n[2] * uy;
  const vy = n[2] * ux - n[0] * uz;
  const vz = n[0] * uy - n[1] * ux;
  return { ux, uy, uz, vx, vy, vz };
}
function cullInteriorPolygons(polygons, options) {
  const k = options?.samples ?? DEFAULT_HEMISPHERE_SAMPLES;
  if (polygons.length < 4 || k < 1) return polygons;
  const meta = polygons.map(precompute);
  const samplesFlat = hemisphereSamplesFlat(k);
  const kept = [];
  const bvh = buildBVH(meta);
  const stack = new Int32Array(Math.max(64, bvh.nodeCount));
  const MAX_ORIGINS = 64 * 3;
  const origBuf = new Float64Array(MAX_ORIGINS);
  for (let i = 0; i < polygons.length; i++) {
    const p = meta[i];
    if (!p) {
      kept.push(polygons[i]);
      continue;
    }
    const nx = p.normal[0], ny = p.normal[1], nz = p.normal[2];
    const offX = RAY_ORIGIN_OFFSET * nx;
    const offY = RAY_ORIGIN_OFFSET * ny;
    const offZ = RAY_ORIGIN_OFFSET * nz;
    {
      const ox1 = p.centroid[0] + offX;
      const oy1 = p.centroid[1] + offY;
      const oz1 = p.centroid[2] + offZ;
      if (!rayHitsAnyInBVH(ox1, oy1, oz1, nx, ny, nz, i, bvh, stack)) {
        kept.push(polygons[i]);
        continue;
      }
    }
    const { ux, uy, uz, vx, vy, vz } = basis(p.normal);
    const cx0 = p.centroid[0], cy0 = p.centroid[1], cz0 = p.centroid[2];
    const verts = p.vertices;
    const vCount = verts.length;
    let oCnt = 0;
    origBuf[oCnt++] = cx0 + offX;
    origBuf[oCnt++] = cy0 + offY;
    origBuf[oCnt++] = cz0 + offZ;
    for (let vi = 0; vi < vCount; vi++) {
      const v = verts[vi];
      origBuf[oCnt++] = v[0] + (cx0 - v[0]) * ORIGIN_INSET + offX;
      origBuf[oCnt++] = v[1] + (cy0 - v[1]) * ORIGIN_INSET + offY;
      origBuf[oCnt++] = v[2] + (cz0 - v[2]) * ORIGIN_INSET + offZ;
    }
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
    let escaped = false;
    outer: for (let si = 0; si < samplesFlat.length; si += 3) {
      const lx = samplesFlat[si], ly = samplesFlat[si + 1], lz = samplesFlat[si + 2];
      const rdx = lx * ux + ly * vx + lz * nx;
      const rdy = lx * uy + ly * vy + lz * ny;
      const rdz = lx * uz + ly * vz + lz * nz;
      for (let oi = 0; oi < oCnt; oi += 3) {
        const rox = origBuf[oi], roy = origBuf[oi + 1], roz = origBuf[oi + 2];
        if (!rayHitsAnyInBVH(rox, roy, roz, rdx, rdy, rdz, i, bvh, stack)) {
          escaped = true;
          break outer;
        }
      }
    }
    if (escaped) kept.push(polygons[i]);
  }
  return kept;
}

// packages/polycss/src/render/textureAtlas.ts
var ATLAS_MAX_SIZE = 4096;
var AUTO_ATLAS_LOW_AREA = ATLAS_MAX_SIZE * ATLAS_MAX_SIZE;
var AUTO_ATLAS_MEDIUM_AREA = AUTO_ATLAS_LOW_AREA * 3;
var AUTO_ATLAS_MAX_DECODED_BYTES = 16 * 1024 * 1024;

// website/src/debug/meshDomNormalize.ts
var NORMALIZE_MAX_ANGLE_DEG = 3;
var NORMALIZE_MAX_PLANE_DISPLACEMENT = 0.03;
var NORMALIZE_MAX_BOUNDARY_DISPLACEMENT = 0.02;
function preprocessModelPolygons(polygons, normalizeGeometry) {
  const baseline = mergePolygons(cullInteriorPolygons(polygons));
  if (!normalizeGeometry) return baseline;
  const normalized = mergePolygons(cullInteriorPolygons(normalizeGeometryForMerge(polygons)));
  return normalized.length < baseline.length ? normalized : baseline;
}
function normalizeGeometryForMerge(polygons) {
  const snapped = snapGeometryForMerge(polygons);
  const planeEpsilon = planeFitEpsilon(snapped);
  if (planeEpsilon <= 0) return snapped;
  const metas = snapped.map((polygon) => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon)
    };
  });
  const adjacency = buildMergeAdjacency(snapped, metas);
  const assigned = /* @__PURE__ */ new Set();
  const output = Array(snapped.length);
  const writeOutput = (index, polygon) => {
    output[index] = polygon;
  };
  for (let i = 0; i < snapped.length; i++) {
    const meta = metas[i];
    if (assigned.has(i)) continue;
    if (!meta) {
      writeOutput(i, snapped[i]);
      continue;
    }
    const group = growPlaneGroup(i, metas, adjacency, assigned, planeEpsilon);
    for (const index of group) assigned.add(index);
    if (group.length < 2) {
      writeOutput(i, snapped[i]);
      continue;
    }
    const fit = fitPlaneForGroup(group, metas);
    if (!fit || !groupWithinPlaneBudget(group, metas, fit, planeEpsilon)) {
      for (const index of group) writeOutput(index, snapped[index]);
      continue;
    }
    const projected2 = group.map((index) => projectPolygonToPlane(snapped[index], fit));
    const source = group.map((index) => snapped[index]);
    const chosen = projectedGroupWins(source, projected2) ? projected2 : source;
    for (let groupIndex = 0; groupIndex < group.length; groupIndex++) {
      writeOutput(group[groupIndex], chosen[groupIndex]);
    }
  }
  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  return snapGeometryForMerge(projected);
}
function snapGeometryForMerge(polygons) {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;
  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);
  return polygons.map((polygon) => {
    const snappedVertices = polygon.vertices.map((vertex) => vertices.snap(vertex));
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length ? polygon.uvs.map((uv) => uvs.snap(uv)) : void 0;
    const snappedPolygon = {
      ...polygon,
      vertices: snappedVertices,
      ...snappedUvs ? { uvs: snappedUvs } : {}
    };
    return {
      ...snappedPolygon,
      ...snappedPolygon.texture ? { textureTriangles: textureTrianglesForPolygon(snappedPolygon) } : {}
    };
  });
}
function textureTrianglesForPolygon(polygon) {
  if (!polygon.texture) return void 0;
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles2(polygon.vertices, polygon.uvs);
  }
  if (polygon.textureTriangles?.length) return cloneTextureTriangles2(polygon.textureTriangles);
  return void 0;
}
function fanTextureTriangles2(vertices, uvs) {
  const triangles = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]],
        [...vertices[i]],
        [...vertices[i + 1]]
      ],
      uvs: [
        [...uvs[0]],
        [...uvs[i]],
        [...uvs[i + 1]]
      ]
    });
  }
  return triangles;
}
function cloneTextureTriangles2(triangles) {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex]),
    uvs: triangle.uvs.map((uv) => [...uv])
  }));
}
function projectedGroupWins(source, projected) {
  return mergePolygons(projected).length < mergePolygons(source).length;
}
function planeFitEpsilon(polygons) {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  if (geometryEpsilon <= 0) return 0;
  return Math.min(geometryEpsilon * 3, NORMALIZE_MAX_PLANE_DISPLACEMENT);
}
function geometrySnapEpsilon(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diagonal <= 0) return 0;
  return Math.min(0.025, Math.max(1e-4, diagonal * 25e-5));
}
function createVec3Snapper(epsilon) {
  const buckets = /* @__PURE__ */ new Map();
  const cell = (value) => Math.floor(value / epsilon);
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    snap(input) {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      const cz = cell(input[2]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket2 = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket2) continue;
            for (const candidate of bucket2) {
              if (distanceVec(input, candidate) <= epsilon) {
                return [candidate[0], candidate[1], candidate[2]];
              }
            }
          }
        }
      }
      const snapped = [input[0], input[1], input[2]];
      const bucketKey = key(cx, cy, cz);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    }
  };
}
function createVec2Snapper(epsilon) {
  const buckets = /* @__PURE__ */ new Map();
  const cell = (value) => Math.floor(value / epsilon);
  const key = (x, y) => `${x},${y}`;
  return {
    snap(input) {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket2 = buckets.get(key(cx + dx, cy + dy));
          if (!bucket2) continue;
          for (const candidate of bucket2) {
            if (Math.hypot(input[0] - candidate[0], input[1] - candidate[1]) <= epsilon) {
              return [candidate[0], candidate[1]];
            }
          }
        }
      }
      const snapped = [input[0], input[1]];
      const bucketKey = key(cx, cy);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    }
  };
}
function materialKeyForPolygon(polygon) {
  return `${polygon.color ?? "#cccccc"}|${polygon.texture ?? ""}|${polygon.uvs ? "uv" : "plain"}`;
}
function planeOfPolygon(polygon) {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = subVec(vertices[i], origin);
    const b = subVec(vertices[i + 1], origin);
    const cross2 = crossVec(a, b);
    nx += cross2[0];
    ny += cross2[1];
    nz += cross2[2];
  }
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-10) return null;
  return {
    normal: [nx / len, ny / len, nz / len],
    area: len / 2
  };
}
function buildMergeAdjacency(polygons, metas) {
  const edgeOwners = /* @__PURE__ */ new Map();
  const adjacency = /* @__PURE__ */ new Map();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey2(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }
  for (const owners of edgeOwners.values()) {
    for (let a = 0; a < owners.length; a++) {
      for (let b = a + 1; b < owners.length; b++) {
        const ai = owners[a];
        const bi = owners[b];
        if (canShareMergePatch(polygons[ai], polygons[bi], metas[ai], metas[bi])) {
          addAdjacency(adjacency, ai, bi);
          addAdjacency(adjacency, bi, ai);
        }
      }
    }
  }
  return adjacency;
}
function canShareMergePatch(a, b, aMeta, bMeta) {
  if (!aMeta || !bMeta) return false;
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (!!a.uvs !== !!b.uvs) return false;
  if (a.texture || b.texture) return !!a.uvs && !!b.uvs;
  if (!a.uvs || !b.uvs) return true;
  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}
function addAdjacency(adjacency, from, to) {
  const values = adjacency.get(from);
  if (values) values.add(to);
  else adjacency.set(from, /* @__PURE__ */ new Set([to]));
}
function growPlaneGroup(seed, metas, adjacency, assigned, planeEpsilon) {
  const group = [seed];
  const queued = /* @__PURE__ */ new Set([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (assigned.has(next) || queued.has(next)) continue;
      const nextMeta = metas[next];
      const seedMeta = metas[seed];
      if (!nextMeta || !seedMeta) continue;
      if (nextMeta.materialKey !== seedMeta.materialKey) continue;
      if (!canJoinPlaneGroup([...group, next], metas, planeEpsilon)) continue;
      group.push(next);
      queued.add(next);
      queue.push(next);
    }
  }
  return group;
}
function canJoinPlaneGroup(group, metas, planeEpsilon) {
  const fit = fitPlaneForGroup(group, metas);
  return !!fit && groupWithinPlaneBudget(group, metas, fit, planeEpsilon);
}
function fitPlaneForGroup(group, metas) {
  const seed = metas[group[0]];
  if (!seed) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let weightSum = 0;
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return null;
    const direction = dotVec(seed.normal, meta.normal) < 0 ? -1 : 1;
    const weight = Math.max(meta.area, 1e-6);
    nx += meta.normal[0] * direction * weight;
    ny += meta.normal[1] * direction * weight;
    nz += meta.normal[2] * direction * weight;
    for (const vertex of meta.polygon.vertices) {
      px += vertex[0];
      py += vertex[1];
      pz += vertex[2];
      weightSum += 1;
    }
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal || weightSum === 0) return null;
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  const boundaryD = planeOffsetRangeForVertices(group, metas, normal, boundaryVertices);
  if (boundaryD) {
    const d = (boundaryD.min + boundaryD.max) / 2;
    return {
      normal,
      point: [normal[0] * d, normal[1] * d, normal[2] * d]
    };
  }
  return {
    normal,
    point: [px / weightSum, py / weightSum, pz / weightSum]
  };
}
function planeOffsetRangeForVertices(group, metas, normal, vertexKeys) {
  let min = Infinity;
  let max = -Infinity;
  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    for (const vertex of meta.polygon.vertices) {
      if (!vertexKeys.has(vertexKey(vertex))) continue;
      const d = dotVec(vertex, normal);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
function groupWithinPlaneBudget(group, metas, fit, planeEpsilon) {
  const normalDotMin = Math.cos(NORMALIZE_MAX_ANGLE_DEG * Math.PI / 180);
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return false;
    if (Math.abs(dotVec(meta.normal, fit.normal)) < normalDotMin) return false;
    for (const vertex of meta.polygon.vertices) {
      const limit = boundaryVertices.has(vertexKey(vertex)) ? NORMALIZE_MAX_BOUNDARY_DISPLACEMENT : planeEpsilon;
      if (Math.abs(signedPlaneDistance(vertex, fit)) > limit) return false;
    }
  }
  return true;
}
function groupBoundaryVertexKeys(group, metas) {
  const edgeCounts = /* @__PURE__ */ new Map();
  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    const vertices = meta.polygon.vertices;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const key = edgeKey2(a, b);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { count: 1, a, b });
    }
  }
  const boundary = /* @__PURE__ */ new Set();
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundary.add(vertexKey(edge.a));
    boundary.add(vertexKey(edge.b));
  }
  return boundary;
}
function projectPolygonToPlane(polygon, fit) {
  return {
    ...polygon,
    vertices: polygon.vertices.map((vertex) => projectVecToPlane(vertex, fit))
  };
}
function sharedEdgeIndices(a, b) {
  for (let ai0 = 0; ai0 < a.vertices.length; ai0++) {
    const ai1 = (ai0 + 1) % a.vertices.length;
    for (let bi0 = 0; bi0 < b.vertices.length; bi0++) {
      const bi1 = (bi0 + 1) % b.vertices.length;
      if (eqVec2(a.vertices[ai0], b.vertices[bi0]) && eqVec2(a.vertices[ai1], b.vertices[bi1])) {
        return [ai0, ai1, bi0, bi1];
      }
      if (eqVec2(a.vertices[ai0], b.vertices[bi1]) && eqVec2(a.vertices[ai1], b.vertices[bi0])) {
        return [ai0, ai1, bi1, bi0];
      }
    }
  }
  return null;
}
function edgeKey2(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}
function vertexKey(vertex) {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}
function eqVec2(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
function eqUv(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-4 && Math.abs(a[1] - b[1]) <= 1e-4;
}
function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function crossVec(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function dotVec(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function distanceVec(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function normalizeVec(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-10) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}
function signedPlaneDistance(vertex, fit) {
  return dotVec(subVec(vertex, fit.point), fit.normal);
}
function projectVecToPlane(vertex, fit) {
  const distance = signedPlaneDistance(vertex, fit);
  return [
    vertex[0] - fit.normal[0] * distance,
    vertex[1] - fit.normal[1] * distance,
    vertex[2] - fit.normal[2] * distance
  ];
}

// bench/entries/normalize.ts
function paintPolygonsSolid(polygons, color) {
  return polygons.map((p) => ({
    ...p,
    color,
    texture: void 0,
    uvs: void 0,
    textureTriangles: void 0
  }));
}
function polygonsToWireframe(polygons, lineWidth, color) {
  const out = [];
  for (const p of polygons) {
    const v = p.vertices;
    if (!v || v.length < 3) continue;
    const n = computePolygonNormal(v);
    if (!n) continue;
    const half = lineWidth / 2;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const ex = dx / len, ey = dy / len, ez = dz / len;
      const px = n[1] * ez - n[2] * ey;
      const py = n[2] * ex - n[0] * ez;
      const pz = n[0] * ey - n[1] * ex;
      const plen = Math.hypot(px, py, pz) || 1;
      const ox = px / plen * half;
      const oy = py / plen * half;
      const oz = pz / plen * half;
      out.push({
        vertices: [
          [a[0] + ox, a[1] + oy, a[2] + oz],
          [b[0] + ox, b[1] + oy, b[2] + oz],
          [b[0] - ox, b[1] - oy, b[2] - oz],
          [a[0] - ox, a[1] - oy, a[2] - oz]
        ],
        color
      });
    }
  }
  return out;
}
function computePolygonNormal(vertices) {
  let nx = 0, ny = 0, nz = 0;
  const o = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2];
    const bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2];
    nx += ay * bz - az * by;
    ny += az * bx - ax * bz;
    nz += ax * by - ay * bx;
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return [nx / len, ny / len, nz / len];
}
export {
  paintPolygonsSolid,
  polygonsToWireframe,
  preprocessModelPolygons
};
