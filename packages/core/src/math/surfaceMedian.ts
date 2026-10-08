/**
 * The area-median of a bilinearly-interpolated scalar field over a
 * rectangular vertex block — lifted out of `@glyphcss/maps`'
 * `mesh.ts`'s private `surfaceMedianElevation` (AGENTS.md's "Relief mesh":
 * "the level that halves the AREA of the tile's own full-resolution
 * bilinear surface over the quad's block, not the mean of its 4 corners
 * and not the median of the SAMPLES it covers"). The algorithm is
 * unchanged — only the field accessor is generalized from
 * `GlyphMapGeoTile.elevation` to a bare row-major `stride`+`values` pair,
 * so a second caller with no tile of its own (`@glyphcss/charts`'
 * `gridSurfacePolygons` colour banding) can use it with no dependency on
 * `@glyphcss/maps`. `@glyphcss/maps`' `mesh.ts` now calls THIS function; its
 * own tests (`mesh.surfaceMedian.test.ts`, `mesh.seaLevelBand.test.ts`,
 * `widget.reliefSurfaceBand.test.ts`) are the byte-identity gate for the
 * move.
 */

/** A row-major scalar field: `values[row * stride + col]`. */
export interface SurfaceMedianField {
  /** Row length — number of values per row. */
  readonly stride: number;
  readonly values: ArrayLike<number>;
}

export interface SurfaceMedianScratch {
  lo: Float64Array;
  hi: Float64Array;
  ends: Float64Array;
}

/**
 * The MINIMUM number of strips a block's surface is read at across the
 * `v` (row) direction, as used by `@glyphcss/maps`' relief colour
 * (`packages/maps/AGENTS.md`). The statistic is
 * exact along a row (the bilinear surface is linear in `u`) and
 * discretized only across rows, by a midpoint rule.
 */
export const SURFACE_MEDIAN_STRIPS = 8;

/**
 * Allocates scratch buffers sized for the largest block any call will
 * cover: `maxCellsInBlock` source cells (`(colNext - col) * (rowNext -
 * row)`, worst case across every call this scratch is reused for) times
 * `SURFACE_MEDIAN_STRIPS`.
 */
export function createSurfaceMedianScratch(maxCellsInBlock: number): SurfaceMedianScratch {
  const intervals = Math.max(1, maxCellsInBlock) * SURFACE_MEDIAN_STRIPS;
  return {
    lo: new Float64Array(intervals),
    hi: new Float64Array(intervals),
    ends: new Float64Array(intervals * 2),
  };
}

/**
 * The median of the field SURFACE over the vertex block
 * `[col..colNext] x [row..rowNext]`, inclusive of both edges — see this
 * file's own top-of-file doc for why this reads the surface rather than
 * the 4 corners' mean or the median of the samples it covers.
 *
 * Each source cell of the block contributes one uniform interval per
 * strip (from that strip's west height to its east height), so the
 * block's value distribution is a mixture of uniforms whose CDF is
 * piecewise linear, with a breakpoint at every interval end — solved
 * exactly (sort the ends, binary-search the CDF crossing, invert the one
 * linear piece it crosses on) rather than searched for.
 *
 * `scratch` is the caller's reusable buffer set (`createSurfaceMedianScratch`)
 * — one allocation per caller, not one per block. A cell with a
 * non-finite corner is left out rather than poisoning the block.
 */
export function surfaceMedianOfBlock(
  field: SurfaceMedianField,
  scratch: SurfaceMedianScratch,
  col: number,
  colNext: number,
  row: number,
  rowNext: number,
): number {
  const { stride, values } = field;
  const { lo, hi, ends } = scratch;
  // Strips resolve the `v` direction WITHIN a cell, so a block that
  // already spans several cell rows needs fewer of them — see
  // `SURFACE_MEDIAN_STRIPS`'s own doc for why this keeps accuracy
  // proportional to rows read rather than to quad count.
  const strips = Math.max(1, Math.ceil(SURFACE_MEDIAN_STRIPS / (rowNext - row)));
  let m = 0;
  for (let r = row; r < rowNext; r++) {
    const top = r * stride;
    const bottom = (r + 1) * stride;
    for (let c = col; c < colNext; c++) {
      const nw = values[top + c]!;
      const ne = values[top + c + 1]!;
      const sw = values[bottom + c]!;
      const se = values[bottom + c + 1]!;
      if (!Number.isFinite(nw) || !Number.isFinite(ne) || !Number.isFinite(sw) || !Number.isFinite(se)) continue;
      for (let j = 0; j < strips; j++) {
        const v = (j + 0.5) / strips;
        const west = nw + (sw - nw) * v;
        const east = ne + (se - ne) * v;
        lo[m] = west < east ? west : east;
        hi[m] = west < east ? east : west;
        m++;
      }
    }
  }
  if (m === 0) {
    return (
      values[row * stride + col]! +
      values[row * stride + colNext]! +
      values[rowNext * stride + col]! +
      values[rowNext * stride + colNext]!
    ) / 4;
  }
  let n = 0;
  for (let i = 0; i < m; i++) {
    ends[n++] = lo[i]!;
    ends[n++] = hi[i]!;
  }
  const sorted = ends.subarray(0, n);
  sorted.sort();
  const half = m / 2;
  // How much of the block's surface sits at or below `h`, in units of
  // intervals. A FLAT strip (`lo === hi`) is an atom, counted the moment
  // `h` reaches it — losing that would lose half the mass of such a block.
  const cdf = (h: number): number => {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const l = lo[i]!;
      const u = hi[i]!;
      if (u <= l) {
        if (h >= l) sum += 1;
      } else if (h >= u) sum += 1;
      else if (h > l) sum += (h - l) / (u - l);
    }
    return sum;
  };
  // The smallest sorted end whose CDF has reached one half. `sorted[n-1]`
  // is the block's maximum, where the CDF is `m`, so the search always
  // lands.
  let loIdx = 0;
  let hiIdx = n - 1;
  while (loIdx < hiIdx) {
    const mid = (loIdx + hiIdx) >> 1;
    if (cdf(sorted[mid]!) >= half) hiIdx = mid;
    else loIdx = mid + 1;
  }
  const upper = sorted[loIdx]!;
  if (loIdx === 0) return upper;
  const lower = sorted[loIdx - 1]!;
  // No end lies strictly between two consecutive ends, so on this segment
  // every interval is fully below it, fully above it, or spanning it —
  // and only the spanning ones vary, each at a constant rate.
  let rate = 0;
  for (let i = 0; i < m; i++) {
    const l = lo[i]!;
    const u = hi[i]!;
    if (l <= lower && u >= upper && u > l) rate += 1 / (u - l);
  }
  if (rate <= 0) return upper;
  const at = lower + (half - cdf(lower)) / rate;
  return at < lower ? lower : at > upper ? upper : at;
}
