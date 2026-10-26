// Frozen d9a9c976 compiler: keep independent of the production implementation.
import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "../layers";
import type { GlyphMapStrokeVertex } from "../stroke";

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
interface ExtrusionSurface {
  project(v: Vec3): GlyphMapStrokeVertex;
  owns(idx: number, own?: ReadonlySet<Polygon>): boolean;
  occludes(a: Vec3, b: Vec3): (col: number, row: number, depth: number) => boolean;
  draw(g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean): void;
  blank?: (g: CellGrid) => void;
  replay?: (g: CellGrid, geometries: readonly GlyphMapExtrusionGeometry[], tilted: boolean) => boolean;
  remember?: (g: CellGrid) => void;
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
      topology.surfaceCache = undefined;
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
    surfaceCache: undefined as SurfaceCache | undefined,
  };
  topology.prepare(geometries);
  return topology;
}
