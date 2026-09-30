import type { GlyphCamera, TextureTriangle } from "glyphcss";

// ── Selection helpers ─────────────────────────────────────────────────────

function pointInTriangle2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const v0x = cx - ax,
    v0y = cy - ay;
  const v1x = bx - ax,
    v1y = by - ay;
  const v2x = px - ax,
    v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-10) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

export function pickTriangle(
  triangles: TextureTriangle[],
  cam: GlyphCamera,
  cols: number,
  rows: number,
  cellAspect: number,
  pointerCol: number,
  pointerRow: number,
): number {
  let bestIdx = -1;
  let bestDepth = Infinity;
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]!;
    const pa = cam.project(t.vertices[0], cols, rows, cellAspect);
    const pb = cam.project(t.vertices[1], cols, rows, cellAspect);
    const pc = cam.project(t.vertices[2], cols, rows, cellAspect);
    const minC = Math.min(pa[0], pb[0], pc[0]) - 1;
    const maxC = Math.max(pa[0], pb[0], pc[0]) + 1;
    const minR = Math.min(pa[1], pb[1], pc[1]) - 1;
    const maxR = Math.max(pa[1], pb[1], pc[1]) + 1;
    if (pointerCol < minC || pointerCol > maxC || pointerRow < minR || pointerRow > maxR) continue;
    if (!pointInTriangle2D(pointerCol, pointerRow, pa[0], pa[1], pb[0], pb[1], pc[0], pc[1])) continue;
    const depth = (pa[2] + pb[2] + pc[2]) / 3;
    if (depth < bestDepth) {
      bestDepth = depth;
      bestIdx = i;
    }
  }
  return bestIdx;
}
