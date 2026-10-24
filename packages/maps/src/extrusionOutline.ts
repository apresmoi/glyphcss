import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "./layers";
import { glyphMapForeignOwned, glyphMapSurfaceOccludes, stampGlyphMapPolyline } from "./stroke";
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
interface BoundsNode {
  corners: Vec3[];
  faces?: number[];
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
  const coordinates = new Map<number, Map<number, Map<number, number>>>();
  const ids = new WeakMap<Vec3, number>();
  const vertices: Vec3[] = [], faces: number[][] = [];
  const vertexId = (v: Vec3): number => {
    const known = ids.get(v);
    if (known !== undefined) return known;
    let ys = coordinates.get(v[0]);
    if (!ys) coordinates.set(v[0], ys = new Map());
    let zs = ys.get(v[1]);
    if (!zs) ys.set(v[1], zs = new Map());
    let id = zs.get(v[2]);
    if (id === undefined) {
      id = vertices.length; vertices.push(v); faces.push([]); zs.set(v[2], id);
    }
    ids.set(v, id);
    return id;
  };
  const polygonVertices = polygons.map((p, face) => Int32Array.from(p.vertices, v => {
    const id = vertexId(v); faces[id]!.push(face); return id;
  }));
  const polygonIds = new WeakMap(polygons.map((p, i) => [p, i] as const));
  const bounds = polygons.map(p => {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of p.vertices) for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d]!, v[d]!); hi[d] = Math.max(hi[d]!, v[d]!);
    }
    return { lo, hi };
  });
  const node = (indices: number[]): BoundsNode => {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const i of indices) for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d]!, bounds[i]!.lo[d]!); hi[d] = Math.max(hi[d]!, bounds[i]!.hi[d]!);
    }
    const corners: Vec3[] = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
    if (indices.length <= 32) return { corners, faces: indices };
    let axis = 0;
    for (let d = 1; d < 3; d++) if (hi[d]! - lo[d]! > hi[axis]! - lo[axis]!) axis = d;
    indices.sort((a, b) => bounds[a]!.lo[axis]! + bounds[a]!.hi[axis]! - bounds[b]!.lo[axis]! - bounds[b]!.hi[axis]!);
    const middle = indices.length >>> 1;
    return { corners, children: [node(indices.slice(0, middle)), node(indices.slice(middle))] };
  };
  const root = node(polygons.map((_, i) => i));
  const incidentCache = new Map<number, Map<number, ReadonlySet<number>>>();
  const incidentIds = (a: number, b: number): ReadonlySet<number> => {
    let ends = incidentCache.get(a);
    if (!ends) incidentCache.set(a, ends = new Map());
    let incident = ends.get(b);
    if (!incident) {
      incident = new Set(faces[a]!.filter(face => polygonVertices[face]!.includes(b)));
      ends.set(b, incident);
    }
    return incident;
  };
  let maxVertices = 0;
  for (const p of polygons) maxVertices = Math.max(maxVertices, p.vertices.length);
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
      const edgeIds = new Map<number, Map<number, number>>();
      const endpoints: number[] = [], offsets = [0], incident: number[] = [];
      const edge = (a: Vec3, b: Vec3) => {
        const ia = vertexId(a), ib = vertexId(b);
        let ends = edgeIds.get(ia);
        if (!ends) edgeIds.set(ia, ends = new Map());
        let id = ends.get(ib);
        if (id === undefined) {
          id = endpoints.length / 2; ends.set(ib, id); endpoints.push(ia, ib);
          for (const face of incidentIds(ia, ib)) incident.push(face);
          offsets.push(incident.length);
        }
        return id;
      };
      topology.own.fill(0);
      topology.outlines = groups.map(geometry => {
        const ids = Int32Array.from(geometry.polygons, p => polygonIds.get(p) ?? -1);
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
        return { geometry, faces: ids, footprint: Int32Array.from(geometry.base[0] ?? [], vertexId),
          edges: Int32Array.from(edges), vertical: Uint8Array.from(vertical) };
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
  };
  topology.prepare(geometries);
  return topology;
}
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
) {
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
  const visit = (node: BoundsNode) => {
    let front = true;
    for (const v of node.corners) if (!(eyeDepth(v) > 0)) { front = false; break; }
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
      const error = Number.EPSILON * 256 * coord * coord * (Math.abs(t[k + 2]!) + Math.abs(t[k + 5]!) + Math.abs(t[k + 8]!)) / Math.abs(area);
      const upper = Math.max(t[k + 2]!, t[k + 5]!, t[k + 8]!) + error;
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
  const query = (col: number, row: number, depth: number, incident: Int32Array, tag: number): boolean => {
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
    if (maxDepth[idx]! > depth) for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
      const t = bins[i]!;
      if (incident[triangleFaces[t]!] === tag) continue;
      const d = depthAt(triangles, t * 10, col, row);
      if (d - depth > roundoff(d, depth)) return true;
    }
    const frozen = grid.depth[idx]!;
    if (Number.isFinite(buildingAtInteger) && frozen <= buildingAtInteger + roundoff(frozen, buildingAtInteger)) return false;
    return glyphMapSurfaceOccludes(grid, ci, ri, col - ci, row - ri, depth, 0, 0);
  };
  const previousOutput = topology.stampCache?.output;
  const surface = {
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
      for (let idx = 0; idx < g.depth.length; idx++) {
        if (offsets[idx] === offsets[idx + 1]) continue;
        const col = idx % g.cols, row = Math.floor(idx / g.cols);
        let nearest = -Infinity;
        for (let i = offsets[idx]!; i < offsets[idx + 1]!; i++) {
          const t = bins[i]!;
          if (topology.blanked[triangleFaces[t]!]) nearest = Math.max(nearest, depthAt(triangles, t * 10, col, row));
        }
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
      const pa = { col: 0, row: 0, depth: 0 }, pb = { ...pa }, points = [pa, pb];
      let tag = 0;
      const occludes = (col: number, row: number, depth: number) => query(col, row, depth, s.incident, tag);
      const options = { color: undefined as string | undefined, experimentalGlyphStrategy: "braille" as const, occludes };
      const setPoint = (p: typeof pa, id: number) => {
        const k = projectId(id); p.col = s.projected[k]!; p.row = s.projected[k + 1]!; p.depth = s.projected[k + 2]!;
      };
      for (const outline of topology.outlines) {
        let visible = false;
        for (const face of outline.faces) if (face === -1 || candidates[face]) { visible = true; break; }
        if (!visible) continue;
        let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
        for (const id of outline.footprint) {
          const k = projectId(id), col = s.projected[k]!, row = s.projected[k + 1]!;
          minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col); minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
        }
        if (Math.max(maxCol - minCol, maxRow - minRow) < 2) continue;
        options.color = outline.geometry.color;
        for (let i = 0; i < outline.edges.length; i++) {
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
          if (Math.max(pa.col, pb.col) < 0 || Math.min(pa.col, pb.col) >= g.cols || Math.max(pa.row, pb.row) < 0 || Math.min(pa.row, pb.row) >= g.rows) continue;
          // The sampler consumes this callback synchronously. Tags avoid a Set
          // and a new closure for every directed edge, without clearing the mask.
          if (s.incidentTag === 2147483647) { s.incident.fill(0); s.incidentTag = 0; }
          tag = ++s.incidentTag; visible = false;
          for (let j = topology.edgeOffsets[edge]!; j < topology.edgeOffsets[edge + 1]!; j++) {
            const face = topology.edgeFaces[j]!; s.incident[face] = tag; if (accepted[face]) visible = true;
          }
          if (!visible) continue;
          stampGlyphMapPolyline(g, points, options);
        }
      }
    },
  };
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
