// Frozen packet-11 implementation (2c24cd41), kept as an independent byte-equivalence oracle.
import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapExtrusionGeometry } from "../layers";
import { glyphMapForeignOwned, glyphMapSurfaceOccludes, stampGlyphMapPolyline } from "../stroke";
import type { GlyphMapStrokeVertex } from "../stroke";

interface Triangle {
  readonly polygon: Polygon;
  readonly a: GlyphMapStrokeVertex;
  readonly b: GlyphMapStrokeVertex;
  readonly c: GlyphMapStrokeVertex;
  readonly area: number;
}

const same = (a: Vec3, b: Vec3) => a.every((v, i) => v === b[i]);
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

/** Frame-local, exact building planes, binned at cell pitch (including sub-cell edge coverage). */
export function createGlyphMapExtrusionSurface(
  grid: CellGrid,
  polygons: readonly Polygon[],
  project: (v: Vec3) => GlyphMapStrokeVertex,
  eyeDepth: (v: Vec3) => number,
) {
  const bins = new Map<number, Triangle[]>();
  const atVertex = new Map<string, Set<Polygon>>();
  for (const polygon of polygons) {
    if (polygon.hidden) continue;
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
    const p = vertices.map(project);
    for (let i = 1; i + 1 < p.length; i++) {
      const a = p[0]!, b = p[i]!, c = p[i + 1]!;
      const area = (b.col - a.col) * (c.row - a.row) - (b.row - a.row) * (c.col - a.col);
      if (!Number.isFinite(area) || area >= 0) continue;
      for (const v of polygon.vertices) {
        const key = v.join(",");
        let faces = atVertex.get(key);
        if (!faces) { faces = new Set(); atVertex.set(key, faces); }
        faces.add(polygon);
      }
      const t = { polygon, a, b, c, area };
      const left = Math.max(0, Math.floor(Math.min(a.col, b.col, c.col)));
      const right = Math.min(grid.cols - 1, Math.floor(Math.max(a.col, b.col, c.col)));
      const top = Math.max(0, Math.floor(Math.min(a.row, b.row, c.row)));
      const bottom = Math.min(grid.rows - 1, Math.floor(Math.max(a.row, b.row, c.row)));
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        const idx = row * grid.cols + col;
        const bin = bins.get(idx);
        if (bin) bin.push(t); else bins.set(idx, [t]);
      }
    }
  }
  return {
    owns(idx: number, own: ReadonlySet<Polygon>): boolean {
      const depth = grid.depth[idx]!;
      if (!Number.isFinite(depth) || glyphMapForeignOwned(grid, idx)) return false;
      const col = idx % grid.cols, row = Math.floor(idx / grid.cols);
      return (bins.get(idx) ?? []).some(t => {
        if (!own.has(t.polygon)) return false;
        const d = depthAt(t, col, row);
        return Number.isFinite(d) && Math.abs(d - depth) <= roundoff(d, depth);
      });
    },
    occludes(a: Vec3, b: Vec3) {
      // Incident faces contain this edge by construction. Ignoring those faces
      // accepts coplanar roof ink without forgiving a nearer, unrelated surface.
      const incident = new Set([...(atVertex.get(a.join(",")) ?? [])].filter(p => p.vertices.some(v => same(v, b))));
      if (incident.size === 0) return () => true;
      return (col: number, row: number, depth: number): boolean => {
        const ci = Math.floor(col), ri = Math.floor(row), idx = ri * grid.cols + ci;
        const bin = bins.get(idx) ?? [];
        let buildingAtInteger = -Infinity;
        for (const t of bin) {
          buildingAtInteger = Math.max(buildingAtInteger, depthAt(t, ci, ri));
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
  const own = new Set(geometries.flatMap(g => [...g.polygons]));
  for (let idx = 0; idx < grid.char.length; idx++) {
    if (grid.char[idx] !== " " && surface.owns(idx, own)) grid.char[idx] = ".";
  }
  for (const geometry of geometries) {
    const footprint = geometry.base[0]?.map(project) ?? [];
    // Roof height must not make an otherwise tiny footprint pass the cutoff.
    const width = Math.max(...footprint.map(p => p.col)) - Math.min(...footprint.map(p => p.col));
    const height = Math.max(...footprint.map(p => p.row)) - Math.min(...footprint.map(p => p.row));
    if (Math.max(width, height) < 2) continue;
    const stamp = (a: Vec3, b: Vec3) => {
      const da = eyeDepth(a), db = eyeDepth(b);
      if (da <= 0 && db <= 0) return;
      const occludes = surface.occludes(a, b);
      if ((da > 0) !== (db > 0)) {
        const u = da / (da - db);
        const cut = a.map((v, j) => v + (b[j]! - v) * u) as Vec3;
        if (da <= 0) a = cut; else b = cut;
      }
      stampGlyphMapPolyline(grid, [project(a), project(b)], {
        color: geometry.color, experimentalGlyphStrategy: "braille", occludes,
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
}
