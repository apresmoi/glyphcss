/**
 * Bundled entry that re-exports the in-tree normalize and a small
 * "paint everything one color" helper. Used by the crack-finder bench
 * page (`bench/perf-cracks.html`) so it can import the same normalize
 * code the workbench uses, without bypassing the bench build pipeline.
 */
export { preprocessModelPolygons } from "../../website/src/debug/meshDomNormalize";
import type { Polygon, Vec3 } from "polycss";

/**
 * Replace every polygon's color with the given hex string and strip the
 * texture/uvs so the renderer falls back to the solid color path. Used
 * for crack detection: paint everything red, set a black background,
 * any black pixel inside the silhouette is a crack.
 */
export function paintPolygonsSolid(polygons: Polygon[], color: string): Polygon[] {
  return polygons.map((p) => ({
    ...p,
    color,
    texture: undefined,
    uvs: undefined,
    textureTriangles: undefined,
  }));
}

/**
 * Convert each polygon into N thin quads, one per edge — a wireframe
 * rendered through the same `<i>` machinery as a solid mesh. Each edge
 * quad lies in its parent polygon's plane (so it doesn't z-fight with
 * the original surface), with the given mesh-space line width.
 *
 * Useful for crack inspection: adjacent polygons that fail to share
 * an edge cleanly will show TWO parallel wireframe lines slightly
 * offset from each other — a visible crack indicator that doesn't
 * depend on pixel-perfect fill matching.
 *
 * Cost: 1 input polygon → N output quads (3 for a triangle, 4 for a
 * quad, etc.). Roughly 3–4× the DOM count of the source mesh.
 */
export function polygonsToWireframe(polygons: Polygon[], lineWidth: number, color: string): Polygon[] {
  const out: Polygon[] = [];
  for (const p of polygons) {
    const v = p.vertices;
    if (!v || v.length < 3) continue;
    const n = computePolygonNormal(v);
    if (!n) continue;
    const half = lineWidth / 2;
    for (let i = 0; i < v.length; i++) {
      const a = v[i];
      const b = v[(i + 1) % v.length];
      // Edge direction (normalized).
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-9) continue;
      const ex = dx / len, ey = dy / len, ez = dz / len;
      // In-plane perpendicular = polygonNormal × edgeDir.
      const px = n[1] * ez - n[2] * ey;
      const py = n[2] * ex - n[0] * ez;
      const pz = n[0] * ey - n[1] * ex;
      const plen = Math.hypot(px, py, pz) || 1;
      const ox = (px / plen) * half;
      const oy = (py / plen) * half;
      const oz = (pz / plen) * half;
      // CCW from outside (matches the source polygon winding via shared normal).
      out.push({
        vertices: [
          [a[0] + ox, a[1] + oy, a[2] + oz],
          [b[0] + ox, b[1] + oy, b[2] + oz],
          [b[0] - ox, b[1] - oy, b[2] - oz],
          [a[0] - ox, a[1] - oy, a[2] - oz],
        ],
        color,
      });
    }
  }
  return out;
}

function computePolygonNormal(vertices: Vec3[]): Vec3 | null {
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
