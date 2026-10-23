import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "./layers";
import { glyphMapForeignOwned, glyphMapSurfaceOccludes, stampGlyphMapPolyline } from "./stroke";
import type { GlyphMapStrokeVertex } from "./stroke";

interface Triangle {
  readonly polygon: Polygon;
  readonly a: GlyphMapStrokeVertex;
  readonly b: GlyphMapStrokeVertex;
  readonly c: GlyphMapStrokeVertex;
  readonly area: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface ExtrusionSurface {
  owns(idx: number, own: ReadonlySet<Polygon>): boolean;
  occludes(a: Vec3, b: Vec3): (col: number, row: number, depth: number) => boolean;
  project?: (v: Vec3) => GlyphMapStrokeVertex;
  mayTouch?: (polygons: readonly Polygon[]) => boolean;
  replay?: (grid: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean) => boolean;
  remember?: (grid: CellGrid) => void;
}

interface StampCache {
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

const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Mesh vertices are immutable; visibility and projected winding remain frame-local. */
export function createGlyphMapExtrusionTopology(polygons: readonly Polygon[]) {
  const coordinates = new Map<number, Map<number, Map<number, number>>>();
  const ids = new WeakMap<Vec3, number>();
  const vertices: Vec3[] = [], faces: number[][] = [];
  const vertexId = (v: Vec3, add = false): number | undefined => {
    const known = ids.get(v);
    if (known !== undefined) return known;
    let ys = coordinates.get(v[0]);
    if (!ys && add) coordinates.set(v[0], ys = new Map());
    let zs = ys?.get(v[1]);
    if (!zs && add) ys!.set(v[1], zs = new Map());
    let id = zs?.get(v[2]);
    if (id === undefined && add) {
      id = vertices.length; vertices.push(v); faces.push([]); zs!.set(v[2], id);
    }
    if (id !== undefined) ids.set(v, id);
    return id;
  };
  for (let i = 0; i < polygons.length; i++) for (const v of polygons[i]!.vertices) {
    const id = vertexId(v, true)!;
    faces[id]!.push(i);
  }
  const polygonIds = new WeakMap(polygons.map((p, i) => [p, i] as const));
  const groupIds = new WeakMap<readonly Polygon[], number[]>();
  const faceIds = (group: readonly Polygon[]) => {
    let ids = groupIds.get(group);
    if (!ids) { ids = group.map(p => polygonIds.get(p) ?? -1); groupIds.set(group, ids); }
    return ids;
  };
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
  return { polygons, vertices, faces, vertexId, faceIds, root, stampCache: undefined as StampCache | undefined };
}
// This bounds floating point evaluation error, not a world-space depth bias.
const roundoff = (a: number, b: number) => Number.EPSILON * 32 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);

function depthAt(t: Triangle, col: number, row: number): number {
  const { a, b, c, area } = t;
  const wa = (b.col - col) * (c.row - row) - (b.row - row) * (c.col - col);
  const wb = (c.col - col) * (a.row - row) - (c.row - row) * (a.col - col);
  const wc = (a.col - col) * (b.row - row) - (a.row - row) * (b.col - col);
  if (wa > 0 || wb > 0 || wc > 0) return -Infinity;
  return (wa * a.depth + wb * b.depth + wc * c.depth) / area;
}

/** Frame-local exact planes in a flat cell-bin index, including sub-cell coverage. */
export function createGlyphMapExtrusionSurface(
  grid: CellGrid,
  polygons: readonly Polygon[],
  project: (v: Vec3) => GlyphMapStrokeVertex,
  eyeDepth: (v: Vec3) => number,
  topology = createGlyphMapExtrusionTopology(polygons),
  frameKey?: readonly unknown[],
): ExtrusionSurface {
  const counts = new Uint32Array(grid.cols * grid.rows);
  const triangles: Triangle[] = [];
  const accepted = new Uint8Array(polygons.length);
  const candidates = new Uint8Array(polygons.length);
  const visit = (node: BoundsNode) => {
    // Perspective extrema lie at the box corners only when the entire box
    // is in front of the eye plane. Straddling boxes must descend unculled.
    if (node.corners.every(v => eyeDepth(v) > 0)) {
      const corners = node.corners.map(project);
      if (corners.every(p => p.col < -1) || corners.every(p => p.col > grid.cols + 1) ||
          corners.every(p => p.row < -1) || corners.every(p => p.row > grid.rows + 1)) return;
    }
    if (node.faces) for (const face of node.faces) candidates[face] = 1;
    else for (const child of node.children!) visit(child);
  };
  visit(topology.root);
  const projected: (GlyphMapStrokeVertex | undefined)[] = new Array(topology.vertices.length);
  const projectOnce = (v: Vec3) => {
    const id = topology.vertexId(v);
    if (id === undefined) return project(v); // Near-plane intersection, local to this frame.
    let p = projected[id];
    if (!p) projected[id] = p = project(v);
    return p;
  };
  for (let face = 0; face < polygons.length; face++) {
    const polygon = polygons[face]!;
    if (!candidates[face] || polygon.hidden) continue;
    // Clip in world space, as the renderer does, before projecting a perspective face.
    let vertices = polygon.vertices;
    if (vertices.some(v => eyeDepth(v) <= 0)) {
      vertices = [];
      const input = polygon.vertices;
      for (let i = 0; i < input.length; i++) {
        const a = input[i]!, b = input[(i + 1) % input.length]!;
        const da = eyeDepth(a), db = eyeDepth(b);
        if (da > 0) vertices.push(a);
        if ((da > 0) !== (db > 0)) {
          const u = da / (da - db);
          vertices.push(a.map((v, j) => v + (b[j]! - v) * u) as Vec3);
        }
      }
    }
    const p = vertices.map(projectOnce);
    for (let i = 1; i + 1 < p.length; i++) {
      const a = p[0]!, b = p[i]!, c = p[i + 1]!;
      const area = (b.col - a.col) * (c.row - a.row) - (b.row - a.row) * (c.col - a.col);
      if (!Number.isFinite(area) || area >= 0) continue;
      accepted[face] = 1;
      const left = Math.max(0, Math.floor(Math.min(a.col, b.col, c.col)));
      const right = Math.min(grid.cols - 1, Math.floor(Math.max(a.col, b.col, c.col)));
      const top = Math.max(0, Math.floor(Math.min(a.row, b.row, c.row)));
      const bottom = Math.min(grid.rows - 1, Math.floor(Math.max(a.row, b.row, c.row)));
      if (left > right || top > bottom) continue;
      triangles.push({ polygon, a, b, c, area, left, right, top, bottom });
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) counts[y * grid.cols + x]++;
      }
    }
  }
  const offsets = new Uint32Array(counts.length + 1);
  for (let i = 0; i < counts.length; i++) offsets[i + 1] = offsets[i]! + counts[i]!;
  const bins = new Uint32Array(offsets[counts.length]!);
  counts.fill(0);
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]!;
    for (let y = t.top; y <= t.bottom; y++) {
      for (let x = t.left; x <= t.right; x++) {
        const bin = y * grid.cols + x;
        bins[offsets[bin]! + counts[bin]!] = i;
        counts[bin]++;
      }
    }
  }
  const integerDepth = new Float64Array(grid.depth.length).fill(NaN);
  const equal = <T>(a: ArrayLike<T>, b: ArrayLike<T>) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const copy = (g: CellGrid) => ({ char: g.char.slice(), color: g.color.slice(), depth: g.depth.slice() });
  const equalOcclusion = (a: CellGrid["occluded"], b: CellGrid["occluded"]) => a === undefined ? b === undefined : b !== undefined && equal(a, b);
  return {
    replay: frameKey ? (g, geometries, tilted) => {
      const cache = topology.stampCache;
      // A repeat render can reuse ink only after exact camera, mesh visibility,
      // geometry order and complete pre-outline surface equality. No hashes.
      if (cache?.output && cache.tilted === tilted && equal(frameKey, cache.key) &&
          equal(accepted, cache.accepted) && equal(geometries, cache.geometries) &&
          equal(grid.depth, cache.frozen.depth) && equalOcclusion(grid.occluded, cache.frozen.occluded) &&
          equal(g.char, cache.input.char) && equal(g.color, cache.input.color) && equal(g.depth, cache.input.depth) &&
          equalOcclusion(g.occluded, cache.input.occluded)) {
        for (let i = 0; i < g.char.length; i++) { g.char[i] = cache.output.char[i]!; g.color[i] = cache.output.color[i]!; }
        g.depth.set(cache.output.depth);
        return true;
      }
      topology.stampCache = { key: frameKey, accepted, geometries, tilted, input: { ...copy(g), occluded: g.occluded?.slice() }, frozen: { depth: grid.depth.slice(), occluded: grid.occluded?.slice() } };
      return false;
    } : undefined,
    remember: frameKey ? g => { topology.stampCache!.output = copy(g); } : undefined,
    project: projectOnce,
    mayTouch: polygons => {
      for (const id of topology.faceIds(polygons)) if (id === -1 || candidates[id] !== 0) return true;
      return false;
    },
    owns(idx: number, own: ReadonlySet<Polygon>): boolean {
      const depth = grid.depth[idx]!;
      if (!Number.isFinite(depth) || glyphMapForeignOwned(grid, idx)) return false;
      const col = idx % grid.cols, row = Math.floor(idx / grid.cols);
      const bin = idx;
      for (let i = offsets[bin]!; i < offsets[bin + 1]!; i++) {
        const t = triangles[bins[i]!]!;
        if (!own.has(t.polygon)) continue;
        const d = depthAt(t, col, row);
        if (Number.isFinite(d) && Math.abs(d - depth) <= roundoff(d, depth)) return true;
      }
      return false;
    },
    occludes(a: Vec3, b: Vec3) {
      // Incident faces contain this edge by construction. Ignoring those faces
      // accepts coplanar roof ink without forgiving a nearer, unrelated surface.
      const id = topology.vertexId(a);
      const incident = new Set<Polygon>();
      if (id !== undefined) for (const face of topology.faces[id]!) {
        const p = polygons[face]!;
        if (accepted[face] && p.vertices.some(v => same(v, b))) incident.add(p);
      }
      if (incident.size === 0) return () => true;
      return (col: number, row: number, depth: number): boolean => {
        const ci = Math.floor(col), ri = Math.floor(row), idx = ri * grid.cols + ci;
        const bin = idx;
        let buildingAtInteger = integerDepth[idx]!;
        if (Number.isNaN(buildingAtInteger)) {
          buildingAtInteger = -Infinity;
          for (let i = offsets[bin]!; i < offsets[bin + 1]!; i++) {
            const t = triangles[bins[i]!]!;
            buildingAtInteger = Math.max(buildingAtInteger, depthAt(t, ci, ri));
          }
          integerDepth[idx] = buildingAtInteger;
        }
        for (let i = offsets[bin]!; i < offsets[bin + 1]!; i++) {
          const t = triangles[bins[i]!]!;
          if (incident.has(t.polygon)) continue;
          const d = depthAt(t, col, row);
          if (d - depth > roundoff(d, depth)) return true;
        }
        // When the frozen integer sample is a building, evaluate its actual
        // planes above; neighbouring samples may be on opposite sides of a roof.
        const frozen = grid.depth[idx]!;
        if (Number.isFinite(buildingAtInteger) && frozen <= buildingAtInteger + roundoff(frozen, buildingAtInteger)) return false;
        return glyphMapSurfaceOccludes(grid, ci, ri, col - ci, row - ri, depth, 0, 0);
      };
    },
  };
}

export function stampGlyphMapExtrusionOutlines(
  grid: CellGrid,
  geometries: readonly GlyphMapExtrusionGeometry[],
  surface: ReturnType<typeof createGlyphMapExtrusionSurface>,
  project: (v: Vec3) => GlyphMapStrokeVertex,
  eyeDepth: (v: Vec3) => number,
  tilted: boolean,
): void {
  if (surface.replay?.(grid, geometries, tilted)) return;
  project = surface.project ?? project;
  const visible = surface.mayTouch ? geometries.filter(g => surface.mayTouch!(g.polygons)) : geometries;
  const own = new Set<Polygon>();
  for (const geometry of visible) for (const p of geometry.polygons) own.add(p);
  for (let idx = 0; idx < grid.char.length; idx++) {
    if (grid.char[idx] !== " " && surface.owns(idx, own)) grid.char[idx] = ".";
  }
  for (const geometry of visible) {
    let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
    for (const v of geometry.base[0] ?? []) {
      const p = project(v);
      minCol = Math.min(minCol, p.col); maxCol = Math.max(maxCol, p.col);
      minRow = Math.min(minRow, p.row); maxRow = Math.max(maxRow, p.row);
    }
    // Roof height must not make an otherwise tiny footprint pass the cutoff.
    const width = maxCol - minCol, height = maxRow - minRow;
    if (Math.max(width, height) < 2) continue;
    const stamp = (a: Vec3, b: Vec3) => {
      const da = eyeDepth(a), db = eyeDepth(b);
      if (da <= 0 && db <= 0) return;
      const originalA = a, originalB = b;
      if ((da > 0) !== (db > 0)) {
        const u = da / (da - db);
        const cut = a.map((v, j) => v + (b[j]! - v) * u) as Vec3;
        if (da <= 0) a = cut; else b = cut;
      }
      const pa = project(a), pb = project(b);
      // The sampler rejects every point of an edge outside any one grid side.
      // Keep the original endpoints and parameterization for all remaining edges.
      if (Math.max(pa.col, pb.col) < 0 || Math.min(pa.col, pb.col) >= grid.cols ||
          Math.max(pa.row, pb.row) < 0 || Math.min(pa.row, pb.row) >= grid.rows) return;
      stampGlyphMapPolyline(grid, [pa, pb], {
        color: geometry.color, experimentalGlyphStrategy: "braille", occludes: surface.occludes(originalA, originalB),
      });
    };
    for (const [a, b] of geometry.roofEdges) stamp(a, b);
    for (let r = 0; r < geometry.roof.length; r++) {
      const roof = geometry.roof[r]!, base = geometry.base[r]!;
      for (let i = 0; i < roof.length; i++) {
        if (geometry.roofEdges.length === 0) stamp(roof[i]!, roof[(i + 1) % roof.length]!);
        if (tilted) stamp(roof[i]!, base[i]!);
      }
    }
  }
  surface.remember?.(grid);
}
