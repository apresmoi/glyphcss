import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import type { GlyphMapStrokeVertex } from "../stroke";

/** Separate depth-only sweep, sharing the outline pass's vertex projections. */
export function blankGlyphMapExtrusionDepthPrototype(
  grid: CellGrid,
  polygons: readonly Polygon[],
  project: (v: Vec3) => GlyphMapStrokeVertex,
  eyeDepth: (v: Vec3) => number,
): void {
  const depth = new Float64Array(grid.depth.length).fill(-Infinity);
  for (const polygon of polygons) {
    if (polygon.hidden) continue;
    let vertices = polygon.vertices;
    if (vertices.some(v => eyeDepth(v) <= 0)) {
      vertices = [];
      for (let i = 0; i < polygon.vertices.length; i++) {
        const a = polygon.vertices[i]!, b = polygon.vertices[(i + 1) % polygon.vertices.length]!;
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
      const area = (b.col-a.col)*(c.row-a.row)-(b.row-a.row)*(c.col-a.col);
      if (!Number.isFinite(area) || area >= 0) continue;
      for (let row = Math.max(0, Math.ceil(Math.min(a.row,b.row,c.row))); row <= Math.min(grid.rows-1, Math.floor(Math.max(a.row,b.row,c.row))); row++) {
        for (let col = Math.max(0, Math.ceil(Math.min(a.col,b.col,c.col))); col <= Math.min(grid.cols-1, Math.floor(Math.max(a.col,b.col,c.col))); col++) {
          const wa = (b.col-col)*(c.row-row)-(b.row-row)*(c.col-col);
          const wb = (c.col-col)*(a.row-row)-(c.row-row)*(a.col-col);
          const wc = (a.col-col)*(b.row-row)-(a.row-row)*(b.col-col);
          if (wa > 0 || wb > 0 || wc > 0) continue;
          const idx = row*grid.cols+col;
          depth[idx] = Math.max(depth[idx]!, (wa*a.depth+wb*b.depth+wc*c.depth)/area);
        }
      }
    }
  }
  for (let idx = 0; idx < depth.length; idx++) if (depth[idx]! > grid.depth[idx]!) {
    grid.char[idx] = " "; grid.color[idx] = null; grid.depth[idx] = depth[idx]!;
  }
}
