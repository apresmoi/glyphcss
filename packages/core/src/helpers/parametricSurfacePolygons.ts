/**
 * A quad mesh from three matching `(row, col)` position grids — the general
 * form `gridSurfacePolygons` deliberately isn't: a height field's `x`/`y`
 * are each a function of ONE index alone (`x[col]`, `y[row]`), which cannot
 * express a sphere or torus, where every one of `x`, `y`, `z` varies with
 * BOTH `(u, v)` at once. `@glyphcss/charts/3d`'s `glyphChartParametric3d`
 * is the reference consumer — a chart's own `(u, v)` sampling resolves the
 * parametrization into these three grids; this module knows nothing about
 * domains, colour scales, or chart semantics, exactly like
 * `gridSurfacePolygons`'s own split.
 *
 * `wrapCols`/`wrapRows` close the mesh into a cylinder/torus by connecting
 * the last sampled line back to the first — the caller supplies `u`/`v`
 * samples spanning a HALF-OPEN period (e.g. azimuth `[0, 2*PI)`, never
 * including the duplicate endpoint) when wrapping, so the closing quads
 * are genuine new geometry rather than degenerate zero-width ones. Winding
 * follows the grid's own `(row, col)` traversal order (`nw -> ne -> se ->
 * sw`, `gridSurfacePolygons`'s own convention) with NO attempt to orient it
 * outward for an arbitrary parametrization — sound for a caller whose own
 * `(u, v)` growth direction already matches (a sphere/torus swept the usual
 * way does), and harmless even when it doesn't: glyphcss scenes render
 * `doubleSided: true` by default (AGENTS.md's "Rendering model" reads on a
 * scene's own `doubleSided` option; `rasterize.ts`'s own default), so a
 * reversed local winding only flips that quad's own Lambert term, never
 * its visibility.
 */
import type { Polygon, Vec3 } from "../types";

export interface ParametricSurfaceField {
  /** Row-major position grids — `x[row][col]`, `y[row][col]`, `z[row][col]`, every row the same length, at least 2x2 (or 1-row/1-col with the matching axis wrapped). */
  readonly x: readonly (readonly number[])[];
  readonly y: readonly (readonly number[])[];
  readonly z: readonly (readonly number[])[];
  /** Connect the last column back to column 0 (an azimuthal loop). Default `false`. */
  readonly wrapCols?: boolean;
  /** Connect the last row back to row 0. Default `false`. */
  readonly wrapRows?: boolean;
}

export interface ParametricSurfacePolygonsOptions {
  /** Per-quad colour, keyed by the quad's own `(rowIndex, colIndex)` (its `nw` corner). Returning `undefined` leaves the quad uncoloured. */
  readonly color?: (rowIndex: number, colIndex: number) => string | undefined;
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function parametricSurfacePolygons(field: ParametricSurfaceField, options: ParametricSurfacePolygonsOptions = {}): Polygon[] {
  const rows = field.z.length;
  const cols = rows > 0 ? field.z[0]!.length : 0;
  if (rows < 2 && !field.wrapRows) throw new RangeError("parametricSurfacePolygons: field needs at least 2 rows (or wrapRows over a single ring).");
  if (cols < 2 && !field.wrapCols) throw new RangeError("parametricSurfacePolygons: field needs at least 2 columns (or wrapCols over a single ring).");
  for (const row of [field.x, field.y, field.z]) {
    if (row.length !== rows) throw new RangeError("parametricSurfacePolygons: field.x/y/z must have the same number of rows.");
    for (const r of row) {
      if (r.length !== cols) throw new RangeError("parametricSurfacePolygons: every row of field.x/y/z must have the same length.");
    }
  }

  const vertexAt = (r: number, c: number): Vec3 => [field.x[r]![c]!, field.y[r]![c]!, field.z[r]![c]!];
  const rowSteps = field.wrapRows ? rows : rows - 1;
  const colSteps = field.wrapCols ? cols : cols - 1;

  const polygons: Polygon[] = [];
  for (let ri = 0; ri < rowSteps; ri++) {
    const ri1 = (ri + 1) % rows;
    for (let ci = 0; ci < colSteps; ci++) {
      const ci1 = (ci + 1) % cols;
      const nw = vertexAt(ri, ci);
      const ne = vertexAt(ri, ci1);
      const se = vertexAt(ri1, ci1);
      const sw = vertexAt(ri1, ci);
      const splitNwSe = distance3(nw, se) <= distance3(ne, sw);
      const tris: readonly [Vec3, Vec3, Vec3][] = splitNwSe
        ? [[nw, ne, se], [nw, se, sw]]
        : [[nw, ne, sw], [ne, se, sw]];
      const color = options.color?.(ri, ci);
      for (const vertices of tris) {
        polygons.push(color !== undefined ? { vertices: [...vertices], color } : { vertices: [...vertices] });
      }
    }
  }
  return polygons;
}
