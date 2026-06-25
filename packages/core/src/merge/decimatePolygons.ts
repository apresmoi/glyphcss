/**
 * decimatePolygons — resolution-target mesh simplification via vertex clustering.
 *
 * glyphcss renders to a coarse character grid, so geometry finer than a cell is
 * invisible. This collapses the mesh to a target spatial resolution: partition
 * the bounding box into a `grid × grid × grid` lattice (along the longest axis),
 * snap every vertex to its cell's representative, then drop polygons that
 * collapse (fewer than 3 distinct cells) and dedupe identical survivors.
 *
 * Unlike `optimizeMeshPolygons` (coplanar merge), this is **lossy and
 * view-resolution-aware** — it removes sub-cell detail a heavy `.vox`/scan
 * carries. The result still re-projects (orbit/FPV stay interactive); it's just
 * far lighter. `grid` is the cell count along the model's longest axis — tie it
 * to the largest grid × max zoom you intend to render at.
 */
import type { Polygon, Vec3 } from "../types";

export interface DecimateOptions {
  /** Lattice resolution along the longest bbox axis. Default 64. Lower = coarser. */
  grid?: number;
}

function bbox(polygons: Polygon[]): { min: Vec3; max: Vec3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function decimatePolygons(polygons: Polygon[], options: DecimateOptions = {}): Polygon[] {
  if (!polygons || polygons.length === 0) return polygons;
  const grid = Math.max(2, Math.floor(options.grid ?? 64));
  const { min, max } = bbox(polygons);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!(extent > 0)) return polygons;
  const cell = extent / grid;

  // Cluster key for a vertex → integer lattice coordinate.
  const keyOf = (v: Vec3): string => {
    const ix = Math.round((v[0] - min[0]) / cell);
    const iy = Math.round((v[1] - min[1]) / cell);
    const iz = Math.round((v[2] - min[2]) / cell);
    return `${ix},${iy},${iz}`;
  };

  // Accumulate each cluster's centroid (average of vertices that landed in it)
  // so snapped geometry hugs the surface rather than the lattice corners.
  const acc = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (const p of polygons) for (const v of p.vertices) {
    const k = keyOf(v);
    const a = acc.get(k);
    if (a) { a.x += v[0]; a.y += v[1]; a.z += v[2]; a.n++; }
    else acc.set(k, { x: v[0], y: v[1], z: v[2], n: 1 });
  }
  const rep = new Map<string, Vec3>();
  for (const [k, a] of acc) rep.set(k, [a.x / a.n, a.y / a.n, a.z / a.n]);

  const out: Polygon[] = [];
  const seen = new Set<string>();
  for (const p of polygons) {
    const keys = p.vertices.map(keyOf);
    const distinct = new Set(keys);
    if (distinct.size < 3) continue; // collapsed to a point/edge → drop
    // Dedupe identical snapped polygons (orientation-insensitive set of cells).
    const sig = [...distinct].sort().join("|") + (p.color ?? "");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ...p, vertices: keys.map((k) => rep.get(k)!) as Polygon["vertices"], uvs: undefined });
  }
  return out;
}
