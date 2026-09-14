/**
 * A height-field mesh from a `z(x, y)` grid — the geometry primitive
 * behind `@glyphcss/charts/3d`'s `surface` mark (PLAN-3d.md §5). Pure
 * geometry: the caller supplies already-scaled `x`/`y`/`z` values (a
 * chart's own d3 scales resolve the data domain into whatever range it
 * wants, including its own `aspect` compression on `z`) — this module
 * knows nothing about colour scales, ticks, or data domains.
 *
 * Does NOT generalize `@glyphcss/maps`' `glyphMapPolygons`: projection,
 * elevation windows, and local-up winding are map semantics with no
 * analogue here. Only the IDEA of an area-median colour statistic is
 * shared, via `../math/surfaceMedian` (which both this module's callers
 * and `@glyphcss/maps` can use with no cross-package dependency).
 */
import type { Polygon, Vec3 } from "../types";

/** A row-major `z` grid: `z[row][col]`, every row the same length, at least 2x2. */
export interface GridSurfaceField {
  readonly z: readonly (readonly number[])[];
  /** Column positions, length `z[0].length`. Default: uniform `c / (cols - 1)`. */
  readonly x?: readonly number[];
  /** Row positions, length `z.length`. Default: uniform `r / (rows - 1)`. */
  readonly y?: readonly number[];
}

export interface GridSurfaceQuadBlock {
  /** Index into the DECIMATED row/col arrays this quad occupies. */
  readonly rowIndex: number;
  readonly colIndex: number;
  /** The ORIGINAL (pre-decimation) grid indices this quad's block spans, `[row0, row1]`/`[col0, col1]` inclusive of both edges — the block a colour statistic (e.g. `surfaceMedianOfBlock`) reads. */
  readonly row0: number;
  readonly row1: number;
  readonly col0: number;
  readonly col1: number;
}

export interface GridSurfacePolygonsOptions {
  /** Maximum QUADS along the x axis (vertices kept = this + 1). Omit for no decimation. */
  readonly maxQuadsX?: number;
  readonly maxQuadsY?: number;
  /** Per-quad colour. Returning `undefined` leaves the quad uncoloured (glyphcss's default gray). */
  readonly color?: (block: GridSurfaceQuadBlock) => string | undefined;
}

/** Which ORIGINAL grid lines decimation kept, ascending, always including both ends and the argmax/argmin row and column. */
export interface GridSurfaceDecimation {
  readonly rowIndices: readonly number[];
  readonly colIndices: readonly number[];
  /** `true` iff either axis actually dropped a line. */
  readonly decimated: boolean;
}

export interface GridSurfacePolygonsResult {
  readonly polygons: Polygon[];
  readonly decimation: GridSurfaceDecimation;
  /** The grid indices `[row, col]` of the global max and min `z`, in ORIGINAL (pre-decimation) coordinates — always present in `decimation.rowIndices`/`colIndices`. */
  readonly argmax: { readonly row: number; readonly col: number };
  readonly argmin: { readonly row: number; readonly col: number };
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Uniform point-sample of `n` line indices down to `keep` (>= 2, <= n),
 * then nudge the nearest kept sample onto each `required` index that
 * isn't already kept — so `keep` never grows past its budget (a required
 * index REPLACES its nearest neighbour rather than being added on top),
 * which is what "always keeps the argmax/argmin line" means without
 * changing the decimation ratio.
 */
function decimateIndices(n: number, keep: number, required: readonly number[]): number[] {
  if (n <= keep) return Array.from({ length: n }, (_, i) => i);
  const stride = (n - 1) / (keep - 1);
  const kept = Array.from({ length: keep }, (_, i) => Math.round(i * stride));
  const keptSet = new Set(kept);
  // A slot a PREVIOUS required index has already claimed is FORCED —
  // ineligible for a later required index's own nearest-neighbour search.
  // Without this, two required indices equidistant from the same slot (the
  // common case: two symmetric extrema) alternately evict each other out
  // of that slot, and the SECOND one silently loses (measured: an
  // argmax/argmin pair 2 cells either side of index 0 on a [0,4,8] lattice
  // both wanted slot 0, and the second one processed walked slot 0 right
  // back to its own original value, dropping the first one).
  const forced = new Array<boolean>(keep).fill(false);
  for (const req of required) {
    const already = kept.indexOf(req);
    if (already >= 0) { forced[already] = true; continue; }
    let bestI = -1, bestDist = Infinity;
    for (let i = 0; i < kept.length; i++) {
      if (forced[i]) continue;
      const d = Math.abs(kept[i]! - req);
      if (d < bestDist) { bestDist = d; bestI = i; }
    }
    // Callers only ever pass at most 2 required indices with `keep >= 2`,
    // so a free slot always exists for the second one.
    if (bestI === -1) continue;
    keptSet.delete(kept[bestI]!);
    kept[bestI] = req;
    forced[bestI] = true;
    keptSet.add(req);
  }
  return [...keptSet].sort((a, b) => a - b);
}

/**
 * Builds a height-field mesh as quads (each split into 2 triangles along
 * its own shorter 3D diagonal — the common heightfield-meshing rule that
 * avoids biasing every quad toward the same fold direction), CCW winding
 * from `+z` when `x` increases rightward and `y` increases "forward"
 * (`nw -> ne -> se -> sw` walks the quad boundary CCW as seen from `+z`;
 * a triangle is a 3-vertex SUBSEQUENCE of that cyclic order, which stays
 * CCW regardless of the quad's own `z` heights because the `x`/`y`
 * projection of every quad is always the same axis-aligned rectangle).
 *
 * Decimation (when `maxQuadsX`/`maxQuadsY` is given and the grid is
 * larger) point-samples grid LINES, mirroring `@glyphcss/maps`'
 * `gridLineIndices` — but ALWAYS keeps the row and column of the grid's
 * own global max and min `z` (a chart may not drop its own peak or
 * trough), by nudging the nearest sampled line onto each.
 */
export function gridSurfacePolygons(field: GridSurfaceField, options: GridSurfacePolygonsOptions = {}): GridSurfacePolygonsResult {
  const zRows = field.z;
  const rows = zRows.length;
  const cols = rows > 0 ? zRows[0]!.length : 0;
  if (rows < 2 || cols < 2) throw new RangeError("gridSurfacePolygons: field.z must be at least 2x2.");
  for (const row of zRows) {
    if (row.length !== cols) throw new RangeError("gridSurfacePolygons: every row of field.z must have the same length.");
  }
  const xs = field.x ?? Array.from({ length: cols }, (_, c) => (cols === 1 ? 0 : c / (cols - 1)));
  const ys = field.y ?? Array.from({ length: rows }, (_, r) => (rows === 1 ? 0 : r / (rows - 1)));
  if (xs.length !== cols) throw new RangeError("gridSurfacePolygons: field.x must have field.z[0].length entries.");
  if (ys.length !== rows) throw new RangeError("gridSurfacePolygons: field.y must have field.z.length entries.");

  let argmaxRow = 0, argmaxCol = 0, argminRow = 0, argminCol = 0;
  let maxV = -Infinity, minV = Infinity;
  for (let r = 0; r < rows; r++) {
    const zr = zRows[r]!;
    for (let c = 0; c < cols; c++) {
      const v = zr[c]!;
      if (!Number.isFinite(v)) throw new RangeError(`gridSurfacePolygons: field.z[${r}][${c}] is not finite.`);
      if (v > maxV) { maxV = v; argmaxRow = r; argmaxCol = c; }
      if (v < minV) { minV = v; argminRow = r; argminCol = c; }
    }
  }

  const keepRows = options.maxQuadsY !== undefined ? Math.max(2, Math.min(rows, options.maxQuadsY + 1)) : rows;
  const keepCols = options.maxQuadsX !== undefined ? Math.max(2, Math.min(cols, options.maxQuadsX + 1)) : cols;
  const rowIndices = decimateIndices(rows, keepRows, [argmaxRow, argminRow]);
  const colIndices = decimateIndices(cols, keepCols, [argmaxCol, argminCol]);

  const vertexAt = (ri: number, ci: number): Vec3 => {
    const r = rowIndices[ri]!, c = colIndices[ci]!;
    return [xs[c]!, ys[r]!, zRows[r]![c]!];
  };

  const polygons: Polygon[] = [];
  for (let ri = 0; ri < rowIndices.length - 1; ri++) {
    for (let ci = 0; ci < colIndices.length - 1; ci++) {
      const nw = vertexAt(ri, ci);
      const ne = vertexAt(ri, ci + 1);
      const se = vertexAt(ri + 1, ci + 1);
      const sw = vertexAt(ri + 1, ci);
      const splitNwSe = distance3(nw, se) <= distance3(ne, sw);
      const tris: readonly [Vec3, Vec3, Vec3][] = splitNwSe
        ? [[nw, ne, se], [nw, se, sw]]
        : [[nw, ne, sw], [ne, se, sw]];
      const color = options.color?.({
        rowIndex: ri,
        colIndex: ci,
        row0: rowIndices[ri]!,
        row1: rowIndices[ri + 1]!,
        col0: colIndices[ci]!,
        col1: colIndices[ci + 1]!,
      });
      for (const vertices of tris) {
        polygons.push(color !== undefined ? { vertices: [...vertices], color } : { vertices: [...vertices] });
      }
    }
  }

  return {
    polygons,
    decimation: {
      rowIndices,
      colIndices,
      decimated: rowIndices.length !== rows || colIndices.length !== cols,
    },
    argmax: { row: argmaxRow, col: argmaxCol },
    argmin: { row: argminRow, col: argminCol },
  };
}
