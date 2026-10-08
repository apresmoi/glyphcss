/**
 * The generic overlay stamp (PLAN-3d.md §2.3) — the one write primitive a
 * `GlyphSceneOverlay` (axes, gridlines, edges, node boxes…) reaches for
 * instead of poking `CellGrid` arrays by hand. It is deliberately dumb: no
 * camera, no scene, no knowledge of "object" — every rule it enforces is
 * about being a well-behaved SHARED-GRID writer, the same rules
 * `@glyphcss/maps`' `line`/`contour` stamps hand-derived per call site:
 *
 *  - out-of-bounds is a no-op, never a throw (an overlay projects freely and
 *    lets the grid crop it);
 *  - a cell CROSS-LAYER-occluded by a different output (`CellGrid.occluded`)
 *    is never painted — the layer that owns it paints it;
 *  - an optional depth test against `CellGrid.depth` (larger = nearer,
 *    AGENTS.md's numeric convention) so an overlay can stand IN the scene
 *    instead of always floating on top of it.
 */
import type { CellGrid } from "../cells";

export interface GlyphOverlayCellWrite {
  readonly col: number;
  readonly row: number;
  readonly char: string;
  /** Canonical `#rrggbb`, or omitted to leave the cell's existing colour untouched. */
  readonly color?: string;
  /** When given, the write only wins if nearer than (or equal to, for coplanar overlay-on-geometry) the cell's current depth. Omitted = always wins (subject only to bounds/occlusion). */
  readonly depth?: number;
}

/** Writes one cell. Returns whether it was actually painted. */
export function stampGlyphOverlayCell(grid: CellGrid, write: GlyphOverlayCellWrite): boolean {
  const { cols, rows, col, row } = { cols: grid.cols, rows: grid.rows, col: write.col, row: write.row };
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= cols || row < 0 || row >= rows) return false;
  const idx = row * cols + col;
  if (grid.occluded && grid.occluded[idx] === 1) return false;
  if (write.depth !== undefined && grid.depth) {
    const existing = grid.depth[idx];
    if (Number.isFinite(existing) && existing > write.depth) return false;
  }
  grid.char[idx] = write.char;
  if (write.color !== undefined) grid.color[idx] = write.color;
  if (write.depth !== undefined && grid.depth) grid.depth[idx] = write.depth;
  return true;
}

export interface GlyphOverlayLinePoint {
  readonly col: number;
  readonly row: number;
  readonly depth?: number;
}

/**
 * A depth-tested Bresenham polyline stamp — the generic building block for
 * an overlay's axes/edges/gridlines. `depth` at each endpoint is linearly
 * interpolated along the walk (a straight-enough approximation for a single
 * cell-space segment; a caller wanting exact per-cell world depth densifies
 * its own segment into shorter ones before calling, the same discipline
 * `@glyphcss/maps`' stroke stamp uses at screen scale).
 */
export function stampGlyphOverlayLine(
  grid: CellGrid,
  from: GlyphOverlayLinePoint,
  to: GlyphOverlayLinePoint,
  char: string,
  color?: string,
): void {
  const x0 = Math.round(from.col), y0 = Math.round(from.row);
  const x1 = Math.round(to.col), y1 = Math.round(to.row);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  const steps = Math.max(dx, -dy) + 1;
  const hasDepth = from.depth !== undefined && to.depth !== undefined;
  let step = 0;
  for (;;) {
    const t = steps > 1 ? step / (steps - 1) : 0;
    stampGlyphOverlayCell(grid, {
      col: x,
      row: y,
      char,
      color,
      ...(hasDepth ? { depth: from.depth! + (to.depth! - from.depth!) * t } : {}),
    });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    step++;
  }
}
