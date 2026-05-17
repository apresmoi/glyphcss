import type { Vec3 } from "../types";

/**
 * Perspective projection identical to RadiantHero's: `persp = 4 / (z + 3)`.
 * Returns `[col, row, depth]` in grid space. `cellAspect` corrects for the
 * non-square character cell (height / width).
 */
export function project(
  v: Vec3,
  cols: number,
  rows: number,
  cellAspect: number,
  cx = 0.5,
  cy = 0.5,
  scale = 0.4,
): [number, number, number] {
  const persp = 4 / (v[2] + 3);
  const r = Math.min(cols, rows) * scale;
  const col = cols * cx + v[0] * r * cellAspect * persp;
  const row = rows * cy - v[1] * r * persp;
  return [col, row, v[2]];
}
