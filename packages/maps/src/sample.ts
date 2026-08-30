import type {
  GlyphMapBounds,
  GlyphMapCellContext,
  GlyphMapField,
  GlyphMapNamedSampler,
  GlyphMapSampleOptions,
  GlyphMapSampler,
  GlyphMapSource,
  GlyphMapView,
} from "./types";
import { viewBounds } from "./view";

/**
 * The named-sampler id actually resolved for a sample call — "custom" for a
 * callback, since a function has no id and the tile's recorded `sampler`
 * (MAPS.md §10) then becomes the caller's own reproducibility problem.
 * Exported so a caller building a {@link GlyphMapArtifact} (or any other
 * determinism record) doesn't have to reimplement the default-resolution
 * rule (mean for continuous, majority for categorical) to know what actually
 * ran when `opts.sampler` was left unset.
 */
export function glyphMapSamplerId(sampler: GlyphMapSampler | undefined, kind: "continuous" | "categorical"): string {
  if (sampler === undefined) return kind === "categorical" ? "majority" : "mean";
  return typeof sampler === "function" ? "custom" : sampler;
}

/** Membership: a pixel belongs to the cell whose box contains that pixel's centre — half-open on the north/west edges (MAPS.md §5). */
function cellIndexFor(lon: number, lat: number, bounds: GlyphMapBounds, cols: number, rows: number): { col: number; row: number } | null {
  const lonStep = (bounds.east - bounds.west) / cols;
  const latStep = (bounds.north - bounds.south) / rows;
  const col = Math.floor((lon - bounds.west) / lonStep);
  const row = Math.floor((bounds.north - lat) / latStep);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  return { col, row };
}

function cellBoundsFor(col: number, row: number, bounds: GlyphMapBounds, cols: number, rows: number): GlyphMapBounds {
  const lonStep = (bounds.east - bounds.west) / cols;
  const latStep = (bounds.north - bounds.south) / rows;
  return {
    west: bounds.west + col * lonStep,
    east: bounds.west + (col + 1) * lonStep,
    north: bounds.north - row * latStep,
    south: bounds.north - (row + 1) * latStep,
  };
}

function sourcePixelCenter(source: GlyphMapSource, row: number, col: number): { lon: number; lat: number } {
  const lonStep = (source.bounds.east - source.bounds.west) / source.cols;
  const latStep = (source.bounds.north - source.bounds.south) / source.rows;
  return {
    lon: source.bounds.west + (col + 0.5) * lonStep,
    lat: source.bounds.north - (row + 0.5) * latStep,
  };
}

function isInvalid(value: number, source: GlyphMapSource): boolean {
  return Number.isNaN(value) || (source.noDataValue !== undefined && value === source.noDataValue);
}

/** Nearest single source pixel to (lon, lat) by regular-grid index rounding — no search needed. */
function nearestSourceSample(source: GlyphMapSource, lon: number, lat: number): { value: number; invalid: boolean } {
  const lonStep = (source.bounds.east - source.bounds.west) / source.cols;
  const latStep = (source.bounds.north - source.bounds.south) / source.rows;
  const col = Math.min(source.cols - 1, Math.max(0, Math.round((lon - source.bounds.west) / lonStep - 0.5)));
  const row = Math.min(source.rows - 1, Math.max(0, Math.round((source.bounds.north - lat) / latStep - 0.5)));
  const value = source.values[row * source.cols + col];
  return { value, invalid: isInvalid(value, source) };
}

/** Bilinear resample at (lon, lat), edge-replicated at the source's own boundary, invalid corners excluded and re-weighted. */
function bilinearSourceSample(source: GlyphMapSource, lon: number, lat: number): { value: number; invalid: boolean } {
  const lonStep = (source.bounds.east - source.bounds.west) / source.cols;
  const latStep = (source.bounds.north - source.bounds.south) / source.rows;
  const colF = (lon - source.bounds.west) / lonStep - 0.5;
  const rowF = (source.bounds.north - lat) / latStep - 0.5;
  const col0f = Math.floor(colF);
  const row0f = Math.floor(rowF);
  const tx = colF - col0f;
  const ty = rowF - row0f;
  const clampCol = (c: number) => Math.min(source.cols - 1, Math.max(0, c));
  const clampRow = (r: number) => Math.min(source.rows - 1, Math.max(0, r));
  const c0 = clampCol(col0f), c1 = clampCol(col0f + 1);
  const r0 = clampRow(row0f), r1 = clampRow(row0f + 1);
  const corners: [number, number, number][] = [
    [r0, c0, (1 - tx) * (1 - ty)],
    [r1, c0, (1 - tx) * ty],
    [r0, c1, tx * (1 - ty)],
    [r1, c1, tx * ty],
  ];
  let sum = 0;
  let weight = 0;
  for (const [r, c, w] of corners) {
    const v = source.values[r * source.cols + c];
    if (isInvalid(v, source)) continue;
    sum += v * w;
    weight += w;
  }
  if (weight <= 0) return { value: NaN, invalid: true };
  return { value: sum / weight, invalid: false };
}

function aggregate(sampler: GlyphMapNamedSampler | ((s: Float32Array, c: GlyphMapCellContext) => number), values: number[], lons: number[], lats: number[], ctx: GlyphMapCellContext): number {
  if (typeof sampler === "function") return sampler(Float32Array.from(values), ctx);
  switch (sampler) {
    case "mean": {
      let sum = 0;
      for (const v of values) sum += v;
      return sum / values.length;
    }
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "nearest": {
      const cx = (ctx.bounds.west + ctx.bounds.east) / 2;
      const cy = (ctx.bounds.south + ctx.bounds.north) / 2;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < values.length; i++) {
        const dx = lons[i] - cx, dy = lats[i] - cy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return values[best];
    }
    case "majority": {
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      let bestValue = values[0];
      let bestCount = -1;
      // Deterministic tie-break: smallest value wins, so equally-frequent
      // classes never depend on JS Map iteration/insertion order.
      for (const [value, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
        if (count > bestCount) { bestCount = count; bestValue = value; }
      }
      return bestValue;
    }
  }
}

/**
 * Source (a materialized {@link GlyphMapSource}) → sampled {@link GlyphMapField}
 * over a view's geographic window. Async for forward compatibility with a
 * COG/range-read source (MAPS.md §5); this slice's in-memory sources resolve
 * synchronously.
 *
 * The sampling rules here are determinism-bearing and frozen under the
 * `sampler` id (MAPS.md §5, §10) — see `cellIndexFor` for pixel membership,
 * and the upsample branch below for the zero-landing-pixel (magnification)
 * case every named aggregation is undefined on.
 */
export async function sampleGlyphMapField(source: GlyphMapSource, view: GlyphMapView, opts: GlyphMapSampleOptions = {}): Promise<GlyphMapField> {
  const bounds = viewBounds(view);
  const { cols, rows } = view;
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new RangeError("glyphcss/maps: sampleGlyphMapField requires positive integer view.cols/view.rows.");
  }
  const sampler: GlyphMapSampler = opts.sampler ?? (source.kind === "categorical" ? "majority" : "mean");
  const upsample = opts.upsample ?? (source.kind === "categorical" ? "nearest" : "bilinear");
  if (source.kind === "categorical" && upsample === "bilinear") {
    throw new TypeError('glyphcss/maps: upsample "bilinear" is not legal for a categorical field; use "nearest".');
  }
  const strict = opts.noData === "strict";

  const n = cols * rows;
  const validValues: number[][] = Array.from({ length: n }, () => []);
  const validLons: number[][] = Array.from({ length: n }, () => []);
  const validLats: number[][] = Array.from({ length: n }, () => []);
  const totalCount = new Int32Array(n);
  const invalidCount = new Int32Array(n);

  for (let r = 0; r < source.rows; r++) {
    for (let c = 0; c < source.cols; c++) {
      const { lon, lat } = sourcePixelCenter(source, r, c);
      const idx = cellIndexFor(lon, lat, bounds, cols, rows);
      if (!idx) continue;
      const cellIdx = idx.row * cols + idx.col;
      const value = source.values[r * source.cols + c];
      totalCount[cellIdx]++;
      if (isInvalid(value, source)) {
        invalidCount[cellIdx]++;
      } else {
        validValues[cellIdx].push(value);
        validLons[cellIdx].push(lon);
        validLats[cellIdx].push(lat);
      }
    }
  }

  const values = new Float32Array(n);
  const noData = new Uint8Array(n);
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellIdx = row * cols + col;
      const cBounds = cellBoundsFor(col, row, bounds, cols, rows);
      const total = totalCount[cellIdx];
      const validCount = validValues[cellIdx].length;

      let value: number;
      let isNoData: boolean;

      if (total === 0) {
        // Magnification: the view outresolves the source, so this cell
        // contains zero pixels and every named aggregation is undefined.
        const resolved = upsample === "bilinear"
          ? bilinearSourceSample(source, (cBounds.west + cBounds.east) / 2, (cBounds.south + cBounds.north) / 2)
          : nearestSourceSample(source, (cBounds.west + cBounds.east) / 2, (cBounds.south + cBounds.north) / 2);
        value = resolved.invalid ? NaN : resolved.value;
        isNoData = resolved.invalid;
      } else if (validCount === 0 || (strict && invalidCount[cellIdx] > 0)) {
        // Default rule: noData only when ALL samples are invalid.
        // `strict`: noData when ANY sample is invalid.
        value = NaN;
        isNoData = true;
      } else {
        const ctx: GlyphMapCellContext = { col, row, bounds: cBounds, count: validCount };
        value = aggregate(sampler, validValues[cellIdx], validLons[cellIdx], validLats[cellIdx], ctx);
        isNoData = false;
      }

      values[cellIdx] = value;
      noData[cellIdx] = isNoData ? 1 : 0;
      if (!isNoData) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }

  return {
    bounds,
    cols,
    rows,
    values,
    noData,
    kind: source.kind,
    units: source.units,
    min: Number.isFinite(min) ? min : NaN,
    max: Number.isFinite(max) ? max : NaN,
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface GlyphMapFieldValueAtOptions {
  /**
   * Default: `"bilinear"` for a `kind: "continuous"` field, `"nearest"` for
   * `"categorical"` — the SAME split `sample.ts`'s own raster `upsample`
   * rule uses (`"nearest"` is the only legal choice for categorical class
   * codes; averaging them is meaningless). A `contour` layer's field is
   * always continuous (elevation), so it gets bilinear by default without
   * asking — a nearest-only lookup reads a field whose own resolution is
   * coarser than the output grid (the common case: a wide-span view's LOD
   * field vs. a much finer glyph grid) as BLOCKY, quantized steps, which
   * `stampGlyphMapContour`'s per-cell crossing test then renders as thick,
   * chunky bands instead of a smooth line — bilinear removes that
   * quantization at the source, the same reason the raster pipeline
   * defaults continuous sampling to bilinear.
   */
  readonly interpolate?: "nearest" | "bilinear";
}

/**
 * Look up a sampled field at an arbitrary geographic point — the elevation
 * source a `contour` layer reads per output cell (`widget.ts`'s
 * contour-layer runtime). NaN when `(lon, lat)` falls outside the field's
 * bounds, or (bilinear) every corner needed is noData. The nearest-cell
 * formula is expressed in the SAME cell-center-relative coordinate the
 * bilinear branch shares (`Math.round(x - 0.5) === Math.floor(x)` for every
 * finite `x` — a exact identity, not an approximation), so `"nearest"`
 * stays byte-identical to this function's pre-bilinear behavior.
 */
export function glyphMapFieldValueAt(field: GlyphMapField, lon: number, lat: number, opts: GlyphMapFieldValueAtOptions = {}): number {
  const { bounds, cols, rows, values, noData, kind } = field;
  if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) return NaN;
  const interpolate = opts.interpolate ?? (kind === "continuous" ? "bilinear" : "nearest");
  const fx = ((lon - bounds.west) / (bounds.east - bounds.west)) * cols - 0.5;
  const fy = ((bounds.north - lat) / (bounds.north - bounds.south)) * rows - 0.5;

  const sampleAt = (c: number, r: number): number => {
    const idx = clampInt(r, 0, rows - 1) * cols + clampInt(c, 0, cols - 1);
    return noData[idx] ? NaN : values[idx];
  };

  if (interpolate === "nearest") {
    return sampleAt(Math.round(fx), Math.round(fy));
  }

  const col0 = Math.floor(fx);
  const row0 = Math.floor(fy);
  const tx = fx - col0;
  const ty = fy - row0;
  let sum = 0;
  let weight = 0;
  const accumulate = (v: number, w: number): void => {
    if (w > 0 && Number.isFinite(v)) {
      sum += v * w;
      weight += w;
    }
  };
  accumulate(sampleAt(col0, row0), (1 - tx) * (1 - ty));
  accumulate(sampleAt(col0 + 1, row0), tx * (1 - ty));
  accumulate(sampleAt(col0, row0 + 1), (1 - tx) * ty);
  accumulate(sampleAt(col0 + 1, row0 + 1), tx * ty);
  return weight > 0 ? sum / weight : NaN;
}
