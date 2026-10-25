import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "./layers";
import { glyphMapForeignOwned, glyphMapStampBrailleDot, glyphMapSurfaceOccludes, stampGlyphMapPolyline } from "./stroke";
import type { GlyphMapStrokeVertex } from "./stroke";

interface StampCache {
  filledFaces?: ReadonlySet<Polygon>;
  blankFaces?: ReadonlySet<Polygon>;
  key: readonly unknown[];
  accepted: Uint8Array;
  geometries: readonly GlyphMapExtrusionGeometry[];
  tilted: boolean;
  input: Pick<CellGrid, "char" | "color" | "depth" | "occluded">;
  frozen: Pick<CellGrid, "depth" | "occluded">;
  output?: Pick<CellGrid, "char" | "color" | "depth">;
}
/**
 * The camera-only half of `draw`, resolved ahead of the frame it is for: every
 * braille sample the outline edges visit, in stamp order, that no building
 * plane occludes outright. What is left to the render is what reads the grid
 * being stamped: foreign ownership, the frozen-depth tests and the ink merge.
 * `data` holds {@link PLAN_STRIDE} numbers per sample.
 */
interface OutlinePlan {
  readonly geometries: readonly GlyphMapExtrusionGeometry[];
  readonly tilted: boolean;
  readonly data: Float64Array;
  /** Colour of each outline and the `data` offset its samples end at. */
  readonly runs: readonly { readonly color: string | undefined; readonly end: number }[];
}
const PLAN_STRIDE = 5;
const planFits = (plan: OutlinePlan, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean): boolean =>
  plan.tilted === tilted && plan.geometries.length === geometries.length && geometries.every((x, i) => x === plan.geometries[i]);
/** Edges examined per resumption of a prepared walk: the slice granularity. */
const PLAN_EDGES_PER_STEP = 24;
const NO_DEPTH = new Float64Array(0);
interface EdgeCursor { o: number; entered: boolean; e: number }

interface ExtrusionSurface {
  /** Set once {@link ExtrusionSurface.prepareSamples} has finished; `draw` consumes it when geometries and tilt match. */
  plan?: OutlinePlan;
  /** Per cell, the nearest blanked face's depth (`-Infinity` where none): the camera-only half of `blank`, set with `plan`. */
  blankDepth?: Float64Array;
  /** `slot`: the job the finished plan is kept for beyond this surface (see {@link StashedPlan}). */
  prepareSamples?(geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean, slot?: string): Generator<void, void>;
  project(v: Vec3): GlyphMapStrokeVertex;
  owns(idx: number, own?: ReadonlySet<Polygon>): boolean;
  occludes(a: Vec3, b: Vec3): (col: number, row: number, depth: number) => boolean;
  draw(g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean): void;
  blank?: (g: CellGrid) => void;
  replay?: (g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean) => boolean;
  remember?: (g: CellGrid) => void;
}
/**
 * A finished sample plan kept past the surface that built it. The surface's
 * planes and bins live in the topology's shared scratch, so only one surface is
 * ever current; a plan is plain data and is attached to the next surface built
 * for exactly the same inputs, whichever job prepared it.
 */
interface StashedPlan {
  slot: string;
  key: readonly unknown[];
  hidden: Uint8Array;
  filledFaces?: ReadonlySet<Polygon>;
  blankFaces?: ReadonlySet<Polygon>;
  polygons: readonly Polygon[];
  cols: number; rows: number; cullBehind: boolean;
  plan: OutlinePlan;
  blankDepth?: Float64Array;
}
interface SurfaceCache {
  surface: ExtrusionSurface;
  bindGrid(g: CellGrid): void;
  key: readonly unknown[];
  hidden: Uint8Array;
  filledFaces?: ReadonlySet<Polygon>;
  blankFaces?: ReadonlySet<Polygon>;
  polygons: readonly Polygon[];
  cols: number; rows: number; cullBehind: boolean;
}
interface BoundsNode {
  corners: Vec3[];
  faces?: Int32Array;
  children?: [BoundsNode, BoundsNode];
}
interface OutlineGeometry {
  geometry: GlyphMapExtrusionGeometry;
  faces: Int32Array;
  footprint: Int32Array;
  // Directed edge ids, with a parallel flag for vertical, tilt-only edges.
  edges: Int32Array;
  vertical: Uint8Array;
}

const equal = <T>(a: ArrayLike<T>, b: ArrayLike<T>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const grow64 = (a: Float64Array<ArrayBuffer>, n: number) => {
  if (a.length >= n) return a;
  const b = new Float64Array(Math.max(n, a.length * 2, 64)); b.set(a); return b;
};
const grow32 = (a: Int32Array<ArrayBuffer>, n: number) => {
  if (a.length >= n) return a;
  const b = new Int32Array(Math.max(n, a.length * 2, 64)); b.set(a); return b;
};

/** Coordinate and identity lookups belong to compilation, never the numeric frame walk. */
export function createGlyphMapExtrusionTopology(polygons: readonly Polygon[], geometries: readonly GlyphMapExtrusionGeometry[] = []) {
  let capacity = 64;
  let vertexCount = 0;
  for (const p of polygons) vertexCount += p.vertices.length;
  while (capacity < vertexCount * 2) capacity *= 2;
  let slots = new Int32Array(capacity), mask = capacity - 1;
  const bits = new Float64Array(3), words = new Uint32Array(bits.buffer);
  const vertices: Vec3[] = [], faces: number[][] = [];
  // Map's SameValueZero semantics include NaN and collapse signed zero.
  const same = (a: number, b: number) => a === b || (a !== a && b !== b);
  const hash = (v: Vec3) => {
    bits[0] = v[0] || 0; bits[1] = v[1] || 0; bits[2] = v[2] || 0;
    let h = 0;
    for (let i = 0; i < 6; i++) h = Math.imul(h ^ words[i]!, 0x9e3779b1);
    return h ^ (h >>> 16);
  };
  const vertexId = (v: Vec3): number => {
    let slot = hash(v) & mask;
    while (slots[slot]) {
      const id = slots[slot]! - 1, known = vertices[id]!;
      if (same(v[0], known[0]) && same(v[1], known[1]) && same(v[2], known[2])) return id;
      slot = (slot + 1) & mask;
    }
    const id = vertices.length; vertices.push(v); faces.push([]); slots[slot] = id + 1;
    if (vertices.length * 2 > slots.length) {
      slots = new Int32Array(slots.length * 2); mask = slots.length - 1;
      for (let i = 0; i < vertices.length; i++) {
        let next = hash(vertices[i]!) & mask;
        while (slots[next]) next = (next + 1) & mask;
        slots[next] = i + 1;
      }
    }
    return id;
  };
  const polygonVertices: Int32Array[] = new Array(polygons.length);
  const polygonIds = new WeakMap<Polygon, number>();
  const n = polygons.length;
  const minX = new Float64Array(n), minY = new Float64Array(n), minZ = new Float64Array(n);
  const maxX = new Float64Array(n), maxY = new Float64Array(n), maxZ = new Float64Array(n);
  const sumX = new Float64Array(n), sumY = new Float64Array(n), sumZ = new Float64Array(n);
  let maxVertices = 0;
  for (let face = 0; face < polygons.length; face++) {
    const p = polygons[face]!, ids = polygonVertices[face] = new Int32Array(p.vertices.length);
    polygonIds.set(p, face); maxVertices = Math.max(maxVertices, ids.length);
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let i = 0; i < ids.length; i++) {
      const v = p.vertices[i]!, id = vertexId(v); ids[i] = id; faces[id]!.push(face);
      lx = Math.min(lx, v[0]); ly = Math.min(ly, v[1]); lz = Math.min(lz, v[2]);
      hx = Math.max(hx, v[0]); hy = Math.max(hy, v[1]); hz = Math.max(hz, v[2]);
    }
    minX[face] = lx; minY[face] = ly; minZ[face] = lz;
    maxX[face] = hx; maxY[face] = hy; maxZ[face] = hz;
    sumX[face] = lx + hx; sumY[face] = ly + hy; sumZ[face] = lz + hz;
  }
  // The tree only CULLS: a face it drops lies wholly off-grid or behind the
  // eye, where it can neither own a cell nor make a drawn edge visible. So any
  // conservative partition draws the same bytes, and a linear median select
  // replaces the comparator sort that was most of every compile.
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const select = (key: Float64Array, lo: number, hi: number, k: number) => {
    let l = lo, r = hi - 1;
    while (r > l) {
      const pivot = key[order[(l + r) >>> 1]!]!;
      let i = l, j = r;
      while (i <= j) {
        while (key[order[i]!]! < pivot) i++;
        while (key[order[j]!]! > pivot) j--;
        if (i <= j) { const t = order[i]!; order[i] = order[j]!; order[j] = t; i++; j--; }
      }
      if (k <= j) r = j; else if (k >= i) l = i; else break;
    }
  };
  const node = (lo: number, hi: number): BoundsNode => {
    let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
    for (let j = lo; j < hi; j++) {
      const k = order[j]!;
      lx = Math.min(lx, minX[k]!); ly = Math.min(ly, minY[k]!); lz = Math.min(lz, minZ[k]!);
      hx = Math.max(hx, maxX[k]!); hy = Math.max(hy, maxY[k]!); hz = Math.max(hz, maxZ[k]!);
    }
    const corners: Vec3[] = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? hx : lx, i & 2 ? hy : ly, i & 4 ? hz : lz]);
    if (hi - lo <= 32) return { corners, faces: order.subarray(lo, hi) };
    const ex = hx - lx, ey = hy - ly, ez = hz - lz;
    const middle = lo + ((hi - lo) >>> 1);
    select(ey > ex && ey >= ez ? sumY : ez > ex && ez > ey ? sumZ : sumX, lo, hi, middle);
    return { corners, children: [node(lo, middle), node(middle, hi)] };
  };
  const root = node(0, n);
  let pairSlots = new Int32Array(capacity), pairMask = capacity - 1;
  const pairA: number[] = [], pairB: number[] = [], incidents: (ReadonlySet<number> | undefined)[] = [];
  const pairHash = (a: number, b: number) => Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b);
  const pairId = (a: number, b: number) => {
    let slot = pairHash(a, b) & pairMask;
    while (pairSlots[slot]) {
      const id = pairSlots[slot]! - 1;
      if (pairA[id] === a && pairB[id] === b) return id;
      slot = (slot + 1) & pairMask;
    }
    const id = pairA.length; pairA.push(a); pairB.push(b); pairSlots[slot] = id + 1;
    if (pairA.length * 2 > pairSlots.length) {
      pairSlots = new Int32Array(pairSlots.length * 2); pairMask = pairSlots.length - 1;
      for (let i = 0; i < pairA.length; i++) {
        let next = pairHash(pairA[i]!, pairB[i]!) & pairMask;
        while (pairSlots[next]) next = (next + 1) & pairMask;
        pairSlots[next] = i + 1;
      }
    }
    return id;
  };
  const incidentIds = (a: number, b: number): ReadonlySet<number> => {
    const id = pairId(a, b);
    let incident = incidents[id];
    if (!incident) {
      incident = new Set<number>();
      // Both incident lists are in face order, including repeated vertices.
      const as = faces[a]!, bs = faces[b]!;
      let i = 0, j = 0;
      while (i < as.length && j < bs.length) {
        const x = as[i]!, y = bs[j]!;
        if (x === y) { incident.add(x); i++; j++; }
        else if (x < y) i++;
        else j++;
      }
      incidents[id] = incident;
    }
    return incident;
  };
  const topology = {
    polygons, vertices, polygonVertices, root, vertexId,
    incidentFaces: (a: Vec3, b: Vec3) => incidentIds(vertexId(a), vertexId(b)),
    outlines: [] as OutlineGeometry[],
    edgeVertices: new Int32Array(0), edgeOffsets: new Int32Array(0), edgeFaces: new Int32Array(0),
    own: new Uint8Array(polygons.length), filled: new Uint8Array(polygons.length), blanked: new Uint8Array(polygons.length),
    filledSource: undefined as ReadonlySet<Polygon> | undefined, blankSource: undefined as ReadonlySet<Polygon> | undefined,
    flagsReady: false,
    prepare(groups: readonly GlyphMapExtrusionGeometry[]) {
      if (groups.length === topology.outlines.length && groups.every((g, i) => g === topology.outlines[i]!.geometry)) return;
      topology.surfaceCache = undefined;
      planStashes.delete(topology);
      const edgeIds: (number | undefined)[] = [];
      const endpoints: number[] = [], offsets = [0], incident: number[] = [];
      const edge = (a: Vec3, b: Vec3) => {
        const ia = vertexId(a), ib = vertexId(b);
        const pair = pairId(ia, ib);
        let id = edgeIds[pair];
        if (id === undefined) {
          id = endpoints.length / 2; edgeIds[pair] = id; endpoints.push(ia, ib);
          // Keep direct queries' incident sets compiled alongside numeric runs.
          for (const face of incidentIds(ia, ib)) incident.push(face);
          offsets.push(incident.length);
        }
        return id;
      };
      topology.own.fill(0);
      topology.outlines = groups.map(geometry => {
        const ids = new Int32Array(geometry.polygons.length);
        for (let i = 0; i < ids.length; i++) ids[i] = polygonIds.get(geometry.polygons[i]!) ?? -1;
        for (const id of ids) if (id >= 0) topology.own[id] = 1;
        const edges: number[] = [], vertical: number[] = [];
        for (const [a, b] of geometry.roofEdges) { edges.push(edge(a, b)); vertical.push(0); }
        for (let r = 0; r < geometry.roof.length; r++) {
          const roof = geometry.roof[r]!, base = geometry.base[r]!;
          for (let i = 0; i < roof.length; i++) {
            if (geometry.roofEdges.length === 0) { edges.push(edge(roof[i]!, roof[(i + 1) % roof.length]!)); vertical.push(0); }
            edges.push(edge(roof[i]!, base[i]!)); vertical.push(1);
          }
        }
        const base = geometry.base[0] ?? [], footprint = new Int32Array(base.length);
        for (let i = 0; i < base.length; i++) footprint[i] = vertexId(base[i]!);
        return { geometry, faces: ids, footprint, edges: Int32Array.from(edges), vertical: Uint8Array.from(vertical) };
      });
      topology.edgeVertices = Int32Array.from(endpoints); topology.edgeOffsets = Int32Array.from(offsets); topology.edgeFaces = Int32Array.from(incident);
    },
    scratch: {
      projected: new Float64Array(0), eyes: new Float64Array(0), projectedValid: new Uint8Array(0), eyeValid: new Uint8Array(0),
      candidates: new Uint8Array(polygons.length), accepted: new Uint8Array(polygons.length),
      incident: new Int32Array(polygons.length), incidentTag: 0,
      triangles: new Float64Array(0), triangleFaces: new Int32Array(0), triangleBounds: new Int32Array(0),
      spans: new Int32Array(0), spanOffsets: new Int32Array(0),
      counts: new Uint32Array(0), offsets: new Uint32Array(0), bins: new Int32Array(0),
      integerDepth: new Float64Array(0), maxDepth: new Float64Array(0),
      faceProjection: new Float64Array(maxVertices * 6),
    },
    stampCache: undefined as StampCache | undefined,
    surfaceCache: undefined as SurfaceCache | undefined,
  };
  topology.prepare(geometries);
  return topology;
}
// Beside the topology like the next map, for the same reason: a stashed plan is not part of what the compiler produces.
const planStashes = new WeakMap<object, StashedPlan[]>();
/** Releases the plan kept for `slot`, or all of them. */
export function discardGlyphMapExtrusionPlans(topology: object, slot?: string): void {
  const kept = planStashes.get(topology);
  if (kept) planStashes.set(topology, slot ? kept.filter(held => held.slot !== slot) : []);
}
/** How many plans are kept beyond their surfaces (for `slot`, or all). */
export function stashedGlyphMapExtrusionPlans(topology: object, slot?: string): number {
  return (planStashes.get(topology) ?? []).filter(held => !slot || held.slot === slot).length;
}
// Beside the topology, not in its scratch: the topology reference tests compare
// every scratch field with a frozen compiler that has no such buffer.
const triangleUppers = new WeakMap<object, Float64Array<ArrayBuffer>>();
// This bounds floating point evaluation error, not a world-space depth bias.
const roundoff = (a: number, b: number) => Number.EPSILON * 32 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);

// Packed doubles retain the original association and division (no reciprocal).
function depthAt(t: Float64Array, k: number, col: number, row: number): number {
  const wa = (t[k + 3]! - col) * (t[k + 7]! - row) - (t[k + 4]! - row) * (t[k + 6]! - col);
  const wb = (t[k + 6]! - col) * (t[k + 1]! - row) - (t[k + 7]! - row) * (t[k]! - col);
  const wc = (t[k]! - col) * (t[k + 4]! - row) - (t[k + 1]! - row) * (t[k + 3]! - col);
  if (wa > 0 || wb > 0 || wc > 0) return -Infinity;
  return (wa * t[k + 2]! + wb * t[k + 5]! + wc * t[k + 8]!) / t[k + 9]!;
}

/** Frame-local planes in reusable buffers; topology outlives all output grids. */
export function createGlyphMapExtrusionSurface(
  grid: CellGrid,
  polygons: readonly Polygon[],
  project: (v: Vec3) => GlyphMapStrokeVertex,
  eyeDepth: (v: Vec3) => number,
  topology = createGlyphMapExtrusionTopology(polygons),
  frameKey?: readonly unknown[],
  filledFaces?: ReadonlySet<Polygon>,
  blankFaces?: ReadonlySet<Polygon>,
  cullBehind = false,
): ExtrusionSurface {
  const cached = topology.surfaceCache;
  if (frameKey && cached && cached.polygons === polygons && cached.cols === grid.cols && cached.rows === grid.rows
    && cached.cullBehind === cullBehind && cached.filledFaces === filledFaces && cached.blankFaces === blankFaces
    && equal(frameKey, cached.key) && polygons.every((p, i) => Number(!!p.hidden) === cached.hidden[i])) {
    // Planes, bins and projected vertices depend on camera/topology/visibility,
    // not on the frozen depth field. Queries bind this frame's actual surface;
    // replay still checks every input field before reusing stamped output.
    cached.bindGrid(grid);
    return cached.surface;
  }
  topology.surfaceCache = undefined;
  const s = topology.scratch, size = grid.cols * grid.rows;
  const { candidates, accepted } = s;
  candidates.fill(0); accepted.fill(0);
  const reserveVertices = () => {
    if (s.eyes.length < topology.vertices.length) {
      s.eyes = grow64(s.eyes, topology.vertices.length);
      s.projected = grow64(s.projected, s.eyes.length * 3);
      const eyes = new Uint8Array(s.eyes.length), projected = new Uint8Array(s.eyes.length);
      eyes.set(s.eyeValid); projected.set(s.projectedValid); s.eyeValid = eyes; s.projectedValid = projected;
    }
  };
  reserveVertices(); s.eyeValid.fill(0); s.projectedValid.fill(0);
  const eye = (id: number) => {
    if (!s.eyeValid[id]) { s.eyes[id] = eyeDepth(topology.vertices[id]!); s.eyeValid[id] = 1; }
    return s.eyes[id]!;
  };
  const projectId = (id: number) => {
    const k = id * 3;
    if (!s.projectedValid[id]) {
      const p = project(topology.vertices[id]!);
      s.projected[k] = p.col; s.projected[k + 1] = p.row; s.projected[k + 2] = p.depth; s.projectedValid[id] = 1;
    }
    return k;
  };
  if (s.counts.length < size) {
    s.counts = new Uint32Array(size); s.offsets = new Uint32Array(size + 1);
    s.integerDepth = new Float64Array(size); s.maxDepth = new Float64Array(size);
  }
  const { counts, offsets, integerDepth, maxDepth } = s;
  counts.fill(0); maxDepth.fill(-Infinity);
  integerDepth.fill(filledFaces?.size === 0 ? -Infinity : NaN);
  if (!topology.flagsReady || topology.filledSource !== filledFaces || topology.blankSource !== blankFaces) {
    for (let i = 0; i < polygons.length; i++) {
      topology.filled[i] = !filledFaces || filledFaces.has(polygons[i]!) ? 1 : 0;
      topology.blanked[i] = blankFaces?.has(polygons[i]!) ? 1 : 0;
    }
    topology.filledSource = filledFaces; topology.blankSource = blankFaces; topology.flagsReady = true;
  }
  const eyeOrigin = cullBehind ? eyeDepth([0, 0, 0]) : 0;
  const eyeNorm = cullBehind ? Math.abs(eyeDepth([1, 0, 0]) - eyeOrigin)
    + Math.abs(eyeDepth([0, 1, 0]) - eyeOrigin) + Math.abs(eyeDepth([0, 0, 1]) - eyeOrigin) : 0;
  const visit = (node: BoundsNode) => {
    let front = true, behind = cullBehind;
    for (const v of node.corners) {
      const d = eyeDepth(v);
      front &&= d > 0;
      // Affine eye depth attains extrema at box corners. A 4096-ulp world
      // margin retains uncertain near-plane boxes for ordinary clipping.
      const margin = Number.EPSILON * 4096 * (Math.abs(eyeOrigin) + eyeNorm * Math.max(1, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])));
      behind &&= d < -margin;
      if (!front && !behind) break;
    }
    if (behind) return;
    if (front) {
      let left = true, right = true, top = true, bottom = true;
      for (const v of node.corners) {
        const p = project(v);
        left &&= p.col < -1; right &&= p.col > grid.cols + 1;
        top &&= p.row < -1; bottom &&= p.row > grid.rows + 1;
      }
      if (left || right || top || bottom) return;
    }
    if (node.faces) for (const face of node.faces) candidates[face] = 1;
    else { visit(node.children![0]); visit(node.children![1]); }
  };
  visit(topology.root);
  const cut: Vec3 = [0, 0, 0];
  let upperBounds = triangleUppers.get(topology) ?? new Float64Array(0);
  let triangleCount = 0, spanCount = 0;
  for (let face = 0; face < polygons.length; face++) {
    if (!candidates[face] || polygons[face]!.hidden) continue;
    const ids = topology.polygonVertices[face]!, p = s.faceProjection;
    let clipped = false, length = 0;
    for (const id of ids) if (eye(id) <= 0) { clipped = true; break; }
    const append = (id: number) => {
      const k = projectId(id); p[length++] = s.projected[k]!; p[length++] = s.projected[k + 1]!; p[length++] = s.projected[k + 2]!;
    };
    if (!clipped) for (const id of ids) append(id);
    else for (let i = 0; i < ids.length; i++) {
      const ia = ids[i]!, ib = ids[(i + 1) % ids.length]!, da = eye(ia), db = eye(ib);
      if (da > 0) append(ia);
      if ((da > 0) !== (db > 0)) {
        const a = topology.vertices[ia]!, b = topology.vertices[ib]!, u = da / (da - db);
        for (let j = 0; j < 3; j++) cut[j] = a[j]! + (b[j]! - a[j]!) * u;
        const v = project(cut); p[length++] = v.col; p[length++] = v.row; p[length++] = v.depth;
      }
    }
    // All vertices on one exterior side imply every clipped triangle is
    // outside too. Non-finite or near-plane crossings take the normal path.
    if (cullBehind && !clipped && length > 0) {
      let left = true, right = true, top = true, bottom = true;
      for (let i = 0; i < length; i += 3) {
        left &&= p[i]! < -1; right &&= p[i]! > grid.cols + 1;
        top &&= p[i + 1]! < -1; bottom &&= p[i + 1]! > grid.rows + 1;
      }
      if (left || right || top || bottom) continue;
    }
    for (let i = 3; i + 5 < length; i += 3) {
      const area = (p[i]! - p[0]!) * (p[i + 4]! - p[1]!) - (p[i + 1]! - p[1]!) * (p[i + 3]! - p[0]!);
      if (!Number.isFinite(area) || area >= 0) continue;
      accepted[face] = 1;
      const left = Math.max(0, Math.floor(Math.min(p[0]!, p[i]!, p[i + 3]!)));
      const right = Math.min(grid.cols - 1, Math.floor(Math.max(p[0]!, p[i]!, p[i + 3]!)));
      const top = Math.max(0, Math.floor(Math.min(p[1]!, p[i + 1]!, p[i + 4]!)));
      const bottom = Math.min(grid.rows - 1, Math.floor(Math.max(p[1]!, p[i + 1]!, p[i + 4]!)));
      if (left > right || top > bottom) continue;
      s.triangles = grow64(s.triangles, (triangleCount + 1) * 10);
      upperBounds = grow64(upperBounds, triangleCount + 1);
      s.triangleFaces = grow32(s.triangleFaces, triangleCount + 1);
      s.triangleBounds = grow32(s.triangleBounds, (triangleCount + 1) * 2);
      s.spanOffsets = grow32(s.spanOffsets, triangleCount + 2);
      const k = triangleCount * 10, t = s.triangles;
      for (let j = 0; j < 3; j++) { t[k + j] = p[j]!; t[k + 3 + j] = p[i + j]!; t[k + 6 + j] = p[i + 3 + j]!; }
      t[k + 9] = area; s.triangleFaces[triangleCount] = face;
      s.triangleBounds[triangleCount * 2] = top; s.triangleBounds[triangleCount * 2 + 1] = bottom;
      s.spanOffsets[triangleCount] = spanCount;
      s.spans = grow32(s.spans, (spanCount + bottom - top + 1) * 2);
      // At extreme projections cancellation can consume the one-cell margin.
      // Such near-plane slivers retain the original bbox as a conservative fallback.
      const extreme = Math.max(Math.abs(t[k]!), Math.abs(t[k + 1]!), Math.abs(t[k + 3]!), Math.abs(t[k + 4]!), Math.abs(t[k + 6]!), Math.abs(t[k + 7]!)) > 2 ** 40;
      const coord = Math.max(grid.cols, grid.rows, Math.abs(t[k]!), Math.abs(t[k + 1]!), Math.abs(t[k + 3]!), Math.abs(t[k + 4]!), Math.abs(t[k + 6]!), Math.abs(t[k + 7]!));
      // Bound cancellation in both weights and area before skipping any depthAt.
      const error = Number.EPSILON * 256 * coord * coord * (Math.abs(t[k + 2]!) + Math.abs(t[k + 5]!) + Math.abs(t[k + 8]!)) / Math.abs(area)
        // Products and the quotient round to a subnormal's absolute spacing, which the relative term above loses: at most a few MIN_VALUE per product, magnified by the division.
        + Number.MIN_VALUE * 8 * (1 + 1 / Math.abs(area));
      const upper = Math.max(t[k + 2]!, t[k + 5]!, t[k + 8]!) + error;
      upperBounds[triangleCount] = Number.isNaN(upper) ? Infinity : upper;
      for (let y = top; y <= bottom; y++) {
        let lo = Infinity, hi = -Infinity;
        if (!extreme) for (let e = 0; e < 3; e++) {
          const a = k + e * 3, b = k + ((e + 1) % 3) * 3;
          const ax = t[a]!, ay = t[a + 1]!, bx = t[b]!, by = t[b + 1]!;
          if (ay >= y && ay <= y + 1) { lo = Math.min(lo, ax); hi = Math.max(hi, ax); }
          for (let boundary = y; boundary <= y + 1; boundary++) {
            if ((ay < boundary && by > boundary) || (ay > boundary && by < boundary)) {
              const x = ax + (bx - ax) * ((boundary - ay) / (by - ay));
              lo = Math.min(lo, x); hi = Math.max(hi, x);
            }
          }
        }
        const l = extreme ? left : Math.max(left, Math.floor(lo) - 1);
        const r = extreme ? right : Math.min(right, Math.floor(hi) + 1);
        s.spans[spanCount * 2] = l; s.spans[spanCount * 2 + 1] = r; spanCount++;
        for (let x = l; x <= r; x++) { const bin = y * grid.cols + x; counts[bin]++; maxDepth[bin] = Math.max(maxDepth[bin]!, Number.isNaN(upper) ? Infinity : upper); }
      }
      triangleCount++;
    }
  }
  s.spanOffsets[triangleCount] = spanCount;
  offsets[0] = 0;
  for (let i = 0; i < size; i++) offsets[i + 1] = offsets[i]! + counts[i]!;
  s.bins = grow32(s.bins, offsets[size]!);
  const { triangles, triangleFaces, bins } = s;
  const triangleUpper = upperBounds;
  triangleUppers.set(topology, upperBounds);
  counts.fill(0);
  for (let i = 0; i < triangleCount; i++) {
    const top = s.triangleBounds[i * 2]!, bottom = s.triangleBounds[i * 2 + 1]!;
    let span = s.spanOffsets[i]!;
    for (let y = top; y <= bottom; y++, span++) {
      for (let x = s.spans[span * 2]!; x <= s.spans[span * 2 + 1]!; x++) {
        const bin = y * grid.cols + x; bins[offsets[bin]! + counts[bin]!] = i; counts[bin]++;
      }
    }
  }
  const copy = (g: CellGrid, into?: Pick<CellGrid, "char" | "color" | "depth">) => {
    if (!into) return { char: g.char.slice(), color: g.color.slice(), depth: g.depth.slice() };
    into.char.length = g.char.length; into.color.length = g.color.length;
    for (let i = 0; i < g.char.length; i++) { into.char[i] = g.char[i]!; into.color[i] = g.color[i]!; }
    into.depth = copyDepth(g.depth, into.depth); return into;
  };
  const copyDepth = (depth: Float64Array, into?: Float64Array) => {
    if (!into || into.buffer.byteLength < depth.byteLength) return depth.slice();
    if (into.length !== depth.length) into = new Float64Array(into.buffer, 0, depth.length);
    into.set(depth); return into;
  };
  const copyOcclusion = (occluded: CellGrid["occluded"], into?: Uint8Array) => {
    if (!occluded) return undefined;
    if (!into || into.buffer.byteLength < occluded.byteLength) return occluded.slice();
    if (into.length !== occluded.length) into = new Uint8Array(into.buffer, 0, occluded.length);
    into.set(occluded); return into;
  };
  const equalOcclusion = (a: CellGrid["occluded"], b: CellGrid["occluded"]) => a === undefined ? b === undefined : b !== undefined && equal(a, b);
  const owns = (idx: number, own?: ReadonlySet<Polygon>): boolean => {
    if (filledFaces?.size === 0) return false;
    const depth = grid.depth[idx]!;
    if (!Number.isFinite(depth) || glyphMapForeignOwned(grid, idx)) return false;
    const col = idx % grid.cols, row = Math.floor(idx / grid.cols);
    for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
      const t = bins[i]!, face = triangleFaces[t]!;
      if (!topology.filled[face] || !(own ? own.has(polygons[face]!) : topology.own[face])) continue;
      const d = depthAt(triangles, t * 10, col, row);
      if (Number.isFinite(d) && Math.abs(d - depth) <= roundoff(d, depth)) return true;
    }
    return false;
  };
  // The cell's integer-position building depth, as the last `planes` call resolved it.
  let building = -Infinity;
  /** Whether a building plane occludes the sample outright. Camera-only: reads no grid. */
  const planes = (col: number, row: number, depth: number, incident: Int32Array, tag: number): boolean => {
    const ci = Math.floor(col), ri = Math.floor(row), idx = ri * grid.cols + ci;
    let buildingAtInteger = integerDepth[idx]!;
    if (Number.isNaN(buildingAtInteger)) {
      buildingAtInteger = -Infinity;
      for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
        const t = bins[i]!;
        if (topology.filled[triangleFaces[t]!]) buildingAtInteger = Math.max(buildingAtInteger, depthAt(triangles, t * 10, ci, ri));
      }
      integerDepth[idx] = buildingAtInteger;
    }
    building = buildingAtInteger;
    if (maxDepth[idx]! > depth) for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
      const t = bins[i]!;
      // The same bound `maxDepth` gates the bin with, per triangle: a plane
      // cannot reach past its own highest vertex plus the evaluation error.
      if (incident[triangleFaces[t]!] === tag || !(triangleUpper[t]! > depth)) continue;
      const d = depthAt(triangles, t * 10, col, row);
      const rise = d - depth;
      if (rise > 0 && rise > roundoff(d, depth)) return true;
    }
    return false;
  };
  /** The grid-dependent rest of a depth verdict: the frozen surface against the cell's building depth. */
  const surfaceOccludes = (ci: number, ri: number, subCol: number, subRow: number, depth: number, buildingAtInteger: number): boolean => {
    const frozen = grid.depth[ri * grid.cols + ci]!;
    if (Number.isFinite(buildingAtInteger) && frozen <= buildingAtInteger + roundoff(frozen, buildingAtInteger)) return false;
    return glyphMapSurfaceOccludes(grid, ci, ri, subCol, subRow, depth, 0, 0);
  };
  const query = (col: number, row: number, depth: number, incident: Int32Array, tag: number): boolean => {
    if (planes(col, row, depth, incident, tag)) return true;
    const ci = Math.floor(col), ri = Math.floor(row);
    return surfaceOccludes(ci, ri, col - ci, row - ri, depth, building);
  };
  const pa = { col: 0, row: 0, depth: 0 }, pb = { ...pa }, points = [pa, pb];
  let tag = 0;
  const setPoint = (p: typeof pa, id: number) => {
    const k = projectId(id); p.col = s.projected[k]!; p.row = s.projected[k + 1]!; p.depth = s.projected[k + 2]!;
  };
  /**
   * Advances `cursor` over the outline edges that can be seen, up to `budget`
   * edges examined, projecting each into `points` and tagging its incident
   * faces before `emit`. The one walk both the render and its preparation take,
   * so they cannot visit different edges. True once every edge has been walked.
   */
  const walkEdges = (cursor: EdgeCursor, cols: number, rows: number, tilted: boolean, budget: number, emit: (color: string | undefined) => void): boolean => {
    while (cursor.o < topology.outlines.length) {
      const outline = topology.outlines[cursor.o]!;
      if (!cursor.entered) {
        let visible = false;
        for (const face of outline.faces) if (face === -1 || candidates[face]) { visible = true; break; }
        let small = true;
        if (visible) {
          let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
          for (const id of outline.footprint) {
            const k = projectId(id), col = s.projected[k]!, row = s.projected[k + 1]!;
            minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col); minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
          }
          small = Math.max(maxCol - minCol, maxRow - minRow) < 2;
        }
        if (!visible || small) { cursor.o++; continue; }
        cursor.entered = true; cursor.e = 0;
      }
      while (cursor.e < outline.edges.length) {
        if (budget-- <= 0) return false;
        const i = cursor.e++;
        if (outline.vertical[i] && !tilted) continue;
        const edge = outline.edges[i]!, ia = topology.edgeVertices[edge * 2]!, ib = topology.edgeVertices[edge * 2 + 1]!;
        const da = eye(ia), db = eye(ib);
        if (da <= 0 && db <= 0) continue;
        setPoint(pa, ia); setPoint(pb, ib);
        if ((da > 0) !== (db > 0)) {
          const a = topology.vertices[ia]!, b = topology.vertices[ib]!, u = da / (da - db);
          for (let j = 0; j < 3; j++) cut[j] = a[j]! + (b[j]! - a[j]!) * u;
          const p = project(cut), target = da <= 0 ? pa : pb;
          target.col = p.col; target.row = p.row; target.depth = p.depth;
        }
        if (Math.max(pa.col, pb.col) < 0 || Math.min(pa.col, pb.col) >= cols || Math.max(pa.row, pb.row) < 0 || Math.min(pa.row, pb.row) >= rows) continue;
        // The sampler consumes the occlusion callback synchronously. Tags avoid a Set
        // and a new closure for every directed edge, without clearing the mask.
        if (s.incidentTag === 2147483647) { s.incident.fill(0); s.incidentTag = 0; }
        tag = ++s.incidentTag;
        let seen = false;
        for (let j = topology.edgeOffsets[edge]!; j < topology.edgeOffsets[edge + 1]!; j++) {
          const face = topology.edgeFaces[j]!; s.incident[face] = tag; if (accepted[face]) seen = true;
        }
        if (!seen) continue;
        emit(outline.geometry.color);
      }
      cursor.o++; cursor.entered = false;
    }
    return true;
  };
  /** The render's share of a prepared walk: every verdict that reads the grid being stamped, then the same ink merge `stampGlyphMapPolyline` makes. */
  const stampPlan = (g: CellGrid, plan: OutlinePlan): void => {
    const d = plan.data, cols = grid.cols;
    let at = 0;
    for (const run of plan.runs) {
      const color = run.color ?? null;
      for (; at < run.end; at += PLAN_STRIDE) {
        const idx = d[at]!;
        if (glyphMapForeignOwned(g, idx)) continue;
        const ci = idx % cols;
        if (surfaceOccludes(ci, (idx - ci) / cols, d[at + 2]!, d[at + 3]!, d[at + 1]!, d[at + 4]!)) continue;
        glyphMapStampBrailleDot(g, idx, d[at + 2]!, d[at + 3]!, color, d[at + 1]!);
      }
    }
  };
  const nearestBlanked = (idx: number, cols: number): number => {
    const col = idx % cols, row = Math.floor(idx / cols);
    let nearest = -Infinity;
    for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
      const t = bins[i]!;
      if (topology.blanked[triangleFaces[t]!]) nearest = Math.max(nearest, depthAt(triangles, t * 10, col, row));
    }
    return nearest;
  };
  const previousOutput = topology.stampCache?.output;
  /** Stashes the surface's plan for `slot` (replacing that slot's earlier one), against the inputs this surface was built for. */
  const keep = (slot?: string): void => {
    const live = topology.surfaceCache;
    if (!slot || live?.surface !== surface || !surface.plan) return;
    const kept = (planStashes.get(topology) ?? []).filter(held => held.slot !== slot);
    planStashes.set(topology, kept);
    kept.push({ slot, key: live.key, hidden: live.hidden.slice(), filledFaces, blankFaces, polygons, cols: live.cols, rows: live.rows,
      cullBehind, plan: surface.plan, blankDepth: surface.blankDepth });
  };
  const surface: ExtrusionSurface = {
    replay: frameKey ? (g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean) => {
      const cache = topology.stampCache;
      if (cache?.output && cache.filledFaces === filledFaces && cache.blankFaces === blankFaces && cache.tilted === tilted && equal(frameKey, cache.key) &&
          equal(accepted, cache.accepted) && equal(geometries, cache.geometries) &&
          equal(grid.depth, cache.frozen.depth) && equalOcclusion(grid.occluded, cache.frozen.occluded) &&
          equal(g.char, cache.input.char) && equal(g.color, cache.input.color) && equal(g.depth, cache.input.depth) &&
          equalOcclusion(g.occluded, cache.input.occluded)) {
        for (let i = 0; i < g.char.length; i++) { g.char[i] = cache.output.char[i]!; g.color[i] = cache.output.color[i]!; }
        g.depth.set(cache.output.depth); return true;
      }
      // Accepted is scratch storage; replay needs an independent visibility snapshot.
      const snapshot = cache?.accepted ?? accepted.slice(); snapshot.set(accepted);
      topology.stampCache = { filledFaces, blankFaces, key: frameKey, accepted: snapshot, geometries, tilted,
        input: { ...copy(g, cache?.input), occluded: copyOcclusion(g.occluded, cache?.input.occluded) },
        frozen: { depth: copyDepth(grid.depth, cache?.frozen.depth), occluded: copyOcclusion(grid.occluded, cache?.frozen.occluded) } };
      return false;
    } : undefined,
    remember: frameKey ? (g: CellGrid) => { topology.stampCache!.output = copy(g, previousOutput); } : undefined,
    blank: blankFaces?.size ? (g: CellGrid) => {
      const prepared = surface.blankDepth;
      for (let idx = 0; idx < g.depth.length; idx++) {
        if (offsets[idx] === offsets[idx + 1]) continue;
        const nearest = prepared ? prepared[idx]! : nearestBlanked(idx, g.cols);
        if (nearest > g.depth[idx]!) { g.char[idx] = " "; g.color[idx] = null; g.depth[idx] = nearest; }
      }
    } : undefined,
    // Kept for direct surface consumers; the frame stamper uses compiled ids.
    project(v: Vec3): GlyphMapStrokeVertex {
      const id = topology.vertexId(v); reserveVertices(); const k = projectId(id);
      return { col: s.projected[k]!, row: s.projected[k + 1]!, depth: s.projected[k + 2]! };
    },
    owns,
    occludes(a: Vec3, b: Vec3) {
      const incident = new Int32Array(polygons.length);
      let visible = false;
      for (const face of topology.incidentFaces(a, b)) { incident[face] = 1; if (accepted[face]) visible = true; }
      return visible ? (col: number, row: number, depth: number) => query(col, row, depth, incident, 1) : () => true;
    },
    draw(g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean) {
      topology.prepare(geometries); reserveVertices();
      for (let idx = 0; idx < g.char.length; idx++) if (g.char[idx] !== " " && owns(idx)) g.char[idx] = ".";
      const plan = surface.plan;
      if (plan && planFits(plan, geometries, tilted)) {
        stampPlan(g, plan);
        return;
      }
      const options = { color: undefined as string | undefined, experimentalGlyphStrategy: "braille" as const, occludes: (col: number, row: number, depth: number) => query(col, row, depth, s.incident, tag) };
      const cursor: EdgeCursor = { o: 0, entered: false, e: 0 };
      walkEdges(cursor, g.cols, g.rows, tilted, Infinity, color => {
        options.color = color;
        stampGlyphMapPolyline(g, points, options);
      });
    },
    *prepareSamples(geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean, slot?: string): Generator<void, void> {
      // Only the walk this surface would take: anything else is the render's to rebuild.
      if (!frameKey || geometries.length !== topology.outlines.length || !geometries.every((x, i) => x === topology.outlines[i]!.geometry)) return;
      // A cached surface keeps its plan: a job redone for another reason (terrain landing) skips this half.
      if (surface.plan && planFits(surface.plan, geometries, tilted)) { keep(slot); return; }
      reserveVertices();
      const cols = grid.cols, rows = grid.rows, gridless = { cols, rows, depth: NO_DEPTH } as unknown as CellGrid;
      let data = new Float64Array(PLAN_STRIDE * 256), at = 0;
      const runs: { color: string | undefined; end: number }[] = [];
      // `occludes` never says no, so the walk stamps nothing: it only reports each sample it would visit, in order.
      const options = { color: undefined as string | undefined, experimentalGlyphStrategy: "braille" as const, occludes: (col: number, row: number, depth: number) => {
        if (planes(col, row, depth, s.incident, tag)) return true;
        if (at + PLAN_STRIDE > data.length) data = grow64(data, at + PLAN_STRIDE);
        const ci = Math.floor(col), ri = Math.floor(row);
        data[at] = ri * cols + ci; data[at + 1] = depth; data[at + 2] = col - ci; data[at + 3] = row - ri; data[at + 4] = building;
        at += PLAN_STRIDE;
        return true;
      } };
      const cursor: EdgeCursor = { o: 0, entered: false, e: 0 };
      for (;;) {
        // The planes, bins and scratch belong to this surface only while it is the cached one.
        if (topology.surfaceCache?.surface !== surface) return;
        const done = walkEdges(cursor, cols, rows, tilted, PLAN_EDGES_PER_STEP, color => {
          options.color = color;
          stampGlyphMapPolyline(gridless, points, options);
          const last = runs[runs.length - 1];
          if (last && last.color === color) last.end = at; else runs.push({ color, end: at });
        });
        if (done) break;
        yield;
      }
      if (blankFaces?.size && !surface.blankDepth) {
        const nearest = new Float64Array(cols * rows).fill(-Infinity);
        for (let idx = 0; idx < nearest.length; idx++) if (offsets[idx] !== offsets[idx + 1]) nearest[idx] = nearestBlanked(idx, cols);
        surface.blankDepth = nearest;
      }
      surface.plan = { geometries, tilted, data: data.slice(0, at), runs };
      keep(slot);
    },
  };
  if (frameKey) {
    const hidden = cached?.hidden.length === polygons.length ? cached.hidden : new Uint8Array(polygons.length);
    for (let i = 0; i < polygons.length; i++) hidden[i] = Number(!!polygons[i]!.hidden);
    topology.surfaceCache = {
      surface, bindGrid: next => { grid = next; }, key: frameKey.slice(), hidden,
      filledFaces, blankFaces, polygons, cols: grid.cols, rows: grid.rows, cullBehind,
    };
    // A plan prepared for exactly these inputs while another surface was current.
    const held = planStashes.get(topology)?.find(e => e.polygons === polygons && e.cols === grid.cols && e.rows === grid.rows && e.cullBehind === cullBehind &&
      e.filledFaces === filledFaces && e.blankFaces === blankFaces && equal(e.key, frameKey) && equal(e.hidden, hidden));
    if (held) { surface.plan = held.plan; surface.blankDepth = held.blankDepth; }
  }
  return surface;
}

export function stampGlyphMapExtrusionOutlines(
  grid: CellGrid,
  geometries: readonly GlyphMapExtrusionGeometry[],
  surface: ReturnType<typeof createGlyphMapExtrusionSurface>,
  _project: (v: Vec3) => GlyphMapStrokeVertex,
  _eyeDepth: (v: Vec3) => number,
  tilted: boolean,
): void {
  if (surface.replay?.(grid, geometries, tilted)) return;
  surface.blank?.(grid);
  surface.draw(grid, geometries, tilted);
  surface.remember?.(grid);
}
