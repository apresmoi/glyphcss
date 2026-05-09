import type { Polygon } from "@layoutit/polycss-react";
// Decimation works on polygon arrays; Voxel is aliased for internal use.
type Voxel = Polygon & { x?: number; y?: number; z?: number; x2?: number; y2?: number; z2?: number; shape?: string; vertices?: [number,number,number][] };

type Vec3 = [number, number, number];

interface Mesh {
  verts: Vec3[];
  faces: { v: [number, number, number]; color: string }[];
}

/* ─────────────────── voxel ↔ mesh conversion ─────────────────── */

function voxelsToMesh(voxels: Voxel[]): Mesh {
  const verts: Vec3[] = [];
  const map = new Map<string, number>();
  const faces: { v: [number, number, number]; color: string }[] = [];
  const getOrAdd = (v: Vec3): number => {
    const key = `${v[0]},${v[1]},${v[2]}`;
    const cached = map.get(key);
    if (cached !== undefined) return cached;
    const idx = verts.length;
    verts.push([v[0], v[1], v[2]]);
    map.set(key, idx);
    return idx;
  };
  for (const vox of voxels) {
    if (vox.shape !== "triangle" || !vox.vertices) continue;
    const a = getOrAdd(vox.vertices[0]);
    const b = getOrAdd(vox.vertices[1]);
    const c = getOrAdd(vox.vertices[2]);
    if (a === b || b === c || a === c) continue;
    faces.push({ v: [a, b, c], color: vox.color ?? "#888888" });
  }
  return { verts, faces };
}

function meshToVoxels(mesh: Mesh, faceAlive: boolean[]): Voxel[] {
  const out: Voxel[] = [];
  for (let i = 0; i < mesh.faces.length; i++) {
    if (!faceAlive[i]) continue;
    const f = mesh.faces[i];
    const v0 = mesh.verts[f.v[0]];
    const v1 = mesh.verts[f.v[1]];
    const v2 = mesh.verts[f.v[2]];
    const xs = [v0[0], v1[0], v2[0]];
    const ys = [v0[1], v1[1], v2[1]];
    const zs = [v0[2], v1[2], v2[2]];
    out.push({
      x: Math.floor(Math.min(...xs)),
      y: Math.floor(Math.min(...ys)),
      z: Math.floor(Math.min(...zs)),
      x2: Math.ceil(Math.max(...xs)),
      y2: Math.ceil(Math.max(...ys)),
      z2: Math.ceil(Math.max(...zs)),
      shape: "triangle",
      vertices: [[...v0], [...v1], [...v2]],
      color: f.color,
    });
  }
  return out;
}

/* ─────────────────── method 1: vertex clustering ─────────────────── */

export function decimateClustering(voxels: Voxel[], snap: number): Voxel[] {
  if (snap <= 0) return voxels;
  const round = (n: number) => Math.round(n / snap) * snap;
  const out: Voxel[] = [];
  for (const vox of voxels) {
    if (vox.shape !== "triangle" || !vox.vertices) {
      out.push(vox);
      continue;
    }
    const v0: Vec3 = [round(vox.vertices[0][0]), round(vox.vertices[0][1]), round(vox.vertices[0][2])];
    const v1: Vec3 = [round(vox.vertices[1][0]), round(vox.vertices[1][1]), round(vox.vertices[1][2])];
    const v2: Vec3 = [round(vox.vertices[2][0]), round(vox.vertices[2][1]), round(vox.vertices[2][2])];
    if (
      (v0[0] === v1[0] && v0[1] === v1[1] && v0[2] === v1[2]) ||
      (v0[0] === v2[0] && v0[1] === v2[1] && v0[2] === v2[2]) ||
      (v1[0] === v2[0] && v1[1] === v2[1] && v1[2] === v2[2])
    ) continue;
    const xs = [v0[0], v1[0], v2[0]];
    const ys = [v0[1], v1[1], v2[1]];
    const zs = [v0[2], v1[2], v2[2]];
    out.push({
      ...vox,
      x: Math.floor(Math.min(...xs)),
      y: Math.floor(Math.min(...ys)),
      z: Math.floor(Math.min(...zs)),
      x2: Math.ceil(Math.max(...xs)),
      y2: Math.ceil(Math.max(...ys)),
      z2: Math.ceil(Math.max(...zs)),
      vertices: [v0, v1, v2],
    });
  }
  return out;
}

/* ─────────────────── min-heap for collapse cost ─────────────────── */

interface HeapItem<T> { key: number; value: T; }

class MinHeap<T> {
  private items: HeapItem<T>[] = [];
  size(): number { return this.items.length; }
  push(key: number, value: T): void {
    this.items.push({ key, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].key <= this.items[i].key) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      i = p;
    }
  }
  pop(): T | null {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.items[l].key < this.items[smallest].key) smallest = l;
        if (r < n && this.items[r].key < this.items[smallest].key) smallest = r;
        if (smallest === i) break;
        [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
        i = smallest;
      }
    }
    return top.value;
  }
}

/* ─────────────────── shared edge collapse engine ─────────────────── */

interface CollapseStrategy {
  /** Position the merged vertex should land at. */
  target(mesh: Mesh, u: number, v: number): Vec3;
  /** Cost of doing this collapse — lower = collapse first. */
  cost(mesh: Mesh, u: number, v: number, target: Vec3): number;
  /** Optional per-vertex state to update after each collapse. */
  onCollapse?: (u: number, v: number) => void;
}

function collapseDecimate(
  voxels: Voxel[],
  ratio: number,
  strategy: CollapseStrategy,
): Voxel[] {
  const mesh = voxelsToMesh(voxels);
  const targetFaces = Math.max(4, Math.floor(mesh.faces.length * ratio));
  const N = mesh.verts.length;
  const F = mesh.faces.length;

  const alive = new Array(N).fill(true);
  const faceAlive = new Array(F).fill(true);
  let faceCount = F;

  // Vertex → set of incident face indices (kept in sync as we collapse).
  const vertFaces: Set<number>[] = Array.from({ length: N }, () => new Set());
  for (let fi = 0; fi < F; fi++) {
    for (const v of mesh.faces[fi].v) vertFaces[v].add(fi);
  }

  // Initial edges (each unique once).
  const heap = new MinHeap<[number, number]>();
  const seen = new Set<string>();
  const edgeKey = (u: number, v: number) => u < v ? `${u},${v}` : `${v},${u}`;
  for (const f of mesh.faces) {
    for (const [a, b] of [[f.v[0], f.v[1]], [f.v[1], f.v[2]], [f.v[2], f.v[0]]]) {
      const k = edgeKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = strategy.target(mesh, a, b);
      heap.push(strategy.cost(mesh, a, b, t), [a, b]);
    }
  }

  while (faceCount > targetFaces) {
    const popped = heap.pop();
    if (!popped) break;
    const [u, v] = popped;
    // Lazy deletion: stale entries get skipped here.
    if (!alive[u] || !alive[v]) continue;
    if (u === v) continue;

    const t = strategy.target(mesh, u, v);
    mesh.verts[u] = t;
    alive[v] = false;
    strategy.onCollapse?.(u, v);

    // Migrate v's face references to u; drop degenerate faces.
    for (const fi of vertFaces[v]) {
      if (!faceAlive[fi]) continue;
      const f = mesh.faces[fi];
      f.v = [
        f.v[0] === v ? u : f.v[0],
        f.v[1] === v ? u : f.v[1],
        f.v[2] === v ? u : f.v[2],
      ];
      if (f.v[0] === f.v[1] || f.v[1] === f.v[2] || f.v[0] === f.v[2]) {
        faceAlive[fi] = false;
        faceCount--;
        for (const w of f.v) vertFaces[w]?.delete(fi);
      } else {
        vertFaces[u].add(fi);
      }
    }
    vertFaces[v].clear();

    // Push updated edges from u to its current neighbors.
    const neighbors = new Set<number>();
    for (const fi of vertFaces[u]) {
      if (!faceAlive[fi]) continue;
      for (const w of mesh.faces[fi].v) {
        if (w !== u && alive[w]) neighbors.add(w);
      }
    }
    for (const w of neighbors) {
      const t2 = strategy.target(mesh, u, w);
      heap.push(strategy.cost(mesh, u, w, t2), [u, w]);
    }
  }

  return meshToVoxels(mesh, faceAlive);
}

/* ─────────────────── method 2: shortest-edge collapse ─────────────────── */

const midpoint = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export function decimateEdgeLength(voxels: Voxel[], ratio: number): Voxel[] {
  if (ratio >= 1) return voxels;
  return collapseDecimate(voxels, ratio, {
    target: (m, u, v) => midpoint(m.verts[u], m.verts[v]),
    cost: (m, u, v) => {
      const a = m.verts[u], b = m.verts[v];
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return dx * dx + dy * dy + dz * dz;
    },
  });
}

/* ─────────────────── method 3: quadric edge collapse (QEM) ─────────────────── */

// 4×4 symmetric quadric matrix stored as 10 values (upper triangle).
//   indices: 0:xx 1:xy 2:xz 3:xw 4:yy 5:yz 6:yw 7:zz 8:zw 9:ww
type Q = Float64Array;

const zeroQ = (): Q => new Float64Array(10);

function addQ(a: Q, b: Q): Q {
  const o = new Float64Array(10);
  for (let i = 0; i < 10; i++) o[i] = a[i] + b[i];
  return o;
}

function planeQuadric(a: Vec3, b: Vec3, c: Vec3): Q {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return zeroQ();
  nx /= len; ny /= len; nz /= len;
  const d = -(nx * a[0] + ny * a[1] + nz * a[2]);
  const o = new Float64Array(10);
  o[0] = nx * nx;  o[1] = nx * ny;  o[2] = nx * nz;  o[3] = nx * d;
                   o[4] = ny * ny;  o[5] = ny * nz;  o[6] = ny * d;
                                    o[7] = nz * nz;  o[8] = nz * d;
                                                     o[9] = d * d;
  return o;
}

function quadricCost(q: Q, p: Vec3): number {
  const x = p[0], y = p[1], z = p[2];
  return (
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z +
    q[9]
  );
}

export function decimateQEM(voxels: Voxel[], ratio: number): Voxel[] {
  if (ratio >= 1) return voxels;
  const mesh = voxelsToMesh(voxels);
  // Per-vertex quadric, summed from incident face plane quadrics.
  const Qv: Q[] = mesh.verts.map(() => zeroQ());
  for (const f of mesh.faces) {
    const q = planeQuadric(mesh.verts[f.v[0]], mesh.verts[f.v[1]], mesh.verts[f.v[2]]);
    for (const vi of f.v) Qv[vi] = addQ(Qv[vi], q);
  }
  return collapseDecimate(voxels, ratio, {
    target: (m, u, v) => midpoint(m.verts[u], m.verts[v]),
    cost: (_m, u, v, t) => quadricCost(addQ(Qv[u], Qv[v]), t),
    onCollapse: (u, v) => { Qv[u] = addQ(Qv[u], Qv[v]); },
  });
}
