import type { GlyphMapAttribution, GlyphMapBounds } from "./types";

/**
 * The geographic tile schema (MAPS.md §13 slice 2's headline decision,
 * §10's determinism table): tiles carry lon/lat/elevation and projection is
 * applied CLIENT-SIDE — never pre-projected coordinates, unlike both
 * existing bakers this package supersedes (`website/scripts/bake-globe.mjs`,
 * `bakeFlatTile`/`bakeTile`).
 *
 * Deliberately distinct from slice 1's cell-centered {@link GlyphMapField}
 * (`cols * rows` values, one per CELL): a relief mesh needs a value at every
 * QUAD CORNER so adjacent quads share an edge with no seam, so this is
 * VERTEX-centered — a `(cols + 1) * (rows + 1)` grid, `cols`/`rows` counting
 * QUADS (matching `bake-globe.mjs`'s own per-vertex sampling loop, the
 * convention {@link glyphMapPolygons}'s parity gate is measured against).
 */
export interface GlyphMapGeoTile {
  readonly bounds: GlyphMapBounds;
  /** Quad columns/rows. The elevation grid is `(cols + 1) x (rows + 1)` vertices. */
  readonly cols: number;
  readonly rows: number;
  /** Vertex-centered elevation in meters, row-major, row 0 = `bounds.north`, length `(cols + 1) * (rows + 1)`. */
  readonly elevation: Float32Array;
  /** Recorded as the `source` id (MAPS.md §10) — e.g. `"etopo1"`. */
  readonly source: string;
  /** Recorded as the `sampler` id (MAPS.md §10) — e.g. `"nearest"`. A callback sampler has no id; the caller records `"custom"` (mirrors `glyphMapSamplerId`, `sample.ts`). */
  readonly sampler: string;
  /** Provenance for a STATIC (non-provider) tile — a provider-backed layer instead carries this on {@link GlyphMapProvider.attribution}. */
  readonly attribution?: readonly GlyphMapAttribution[];
}

/**
 * A tile vertex's geographic position — the SAME formula
 * `website/scripts/bake-globe.mjs`'s `bakeTile`/`bakeFlatTile` use for their
 * own vertex grid (`lat = latMax - (latMax - latMin) * j / rows`, `lon =
 * lonMin + (lonMax - lonMin) * i / cols`), load-bearing for exact parity
 * (MAPS.md §13 slice 2's acceptance gate 3).
 */
export function glyphMapGeoTileVertexLonLat(tile: GlyphMapGeoTile, col: number, row: number): readonly [lon: number, lat: number] {
  const { west, east, south, north } = tile.bounds;
  const lon = west + ((east - west) * col) / tile.cols;
  const lat = north - ((north - south) * row) / tile.rows;
  return [lon, lat];
}

function vertexIndex(tile: GlyphMapGeoTile, col: number, row: number): number {
  return row * (tile.cols + 1) + col;
}

/**
 * Bilinear elevation at an arbitrary geographic point, read from the tile's
 * own VERTEX grid — the surface {@link glyphMapPolygons} actually builds, so
 * an annotation of the terrain (a `contour` layer, a heatmap's ground-hugging
 * relief) reads exactly the field the terrain draws. NaN outside `bounds`.
 *
 * Why this and not `glyphMapFieldValueAt` over a cell-centered field derived
 * from the same tile: adjacent tiles SHARE their edge vertex row/column (the
 * vertex-centered schema exists for precisely that reason — see this file's
 * header), so at a shared boundary both neighbours interpolate the SAME
 * values and agree exactly. A cell-centered derivation throws that away: its
 * outermost samples sit half a cell INSIDE the tile, so a band one cell wide
 * straddling every shared boundary has no sample on either side and each
 * neighbour flat-extrapolates its own edge cell instead. The two
 * extrapolations differ by one cell of terrain gradient, so the sampled field
 * STEPS at every tile edge — measured at 39 m across a meridian boundary and
 * 59 m across a parallel one on a gentle synthetic terrain, and a contour
 * inks wherever the field steps across a level, so the step draws a line
 * along the boundary that the terrain does not have. On the real z3 pyramid
 * those boundaries are the parallels 67.5/45/22.5 and eight meridians, which
 * read at a pole as concentric octagons.
 *
 * Interpolation is over the QUAD the point falls in, so a point exactly on
 * the tile's own east/south edge resolves to the last vertex column/row
 * rather than falling off the end.
 *
 * `window` (`GlyphMapPolygonsOptions.minElevation`/`maxElevation`, omitted =
 * unbounded and byte-identical) is applied PER VERTEX, before the blend,
 * because that is the order the SURFACE is built in: `glyphMapPolygons`
 * clamps each retained vertex and the quad between them is the interpolation
 * of the clamped values. Clamping the blended value instead is a different
 * function wherever a quad STRADDLES a window bound — `max(x, m)` is convex,
 * so interpolating clamped corners is never below clamping the interpolation
 * and is strictly above it across every straddling quad. Measured on a quad
 * falling from -4,000 m to +4,000 m under `minElevation: 0`: the drawn
 * surface at its midpoint is +2,000 m and the blend-then-clamp answer was 0,
 * i.e. 48 km of world at `/maps`' `exaggeration: 24`, which put a draped road
 * so far under its own terrain that the depth test dropped every cell of it
 * (`widget.reliefWindowGroundSlope.test.ts`).
 */
export function glyphMapGeoTileElevationAt(
  tile: GlyphMapGeoTile,
  lon: number,
  lat: number,
  window?: { readonly minElevation?: number; readonly maxElevation?: number },
): number {
  const { west, east, south, north } = tile.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return NaN;
  const fx = ((lon - west) / (east - west)) * tile.cols;
  const fy = ((north - lat) / (north - south)) * tile.rows;
  const c0 = Math.min(tile.cols - 1, Math.max(0, Math.floor(fx)));
  const r0 = Math.min(tile.rows - 1, Math.max(0, Math.floor(fy)));
  const tx = fx - c0;
  const ty = fy - r0;
  const e = tile.elevation;
  const lo = window?.minElevation ?? -Infinity;
  const hi = window?.maxElevation ?? Infinity;
  const clamp = lo === -Infinity && hi === Infinity
    ? (v: number): number => v
    : (v: number): number => Math.min(hi, Math.max(lo, v));
  const a = clamp(e[vertexIndex(tile, c0, r0)]!);
  const b = clamp(e[vertexIndex(tile, c0 + 1, r0)]!);
  const c = clamp(e[vertexIndex(tile, c0, r0 + 1)]!);
  const d = clamp(e[vertexIndex(tile, c0 + 1, r0 + 1)]!);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Min/max over a tile's vertex elevations — the range an annotation of THIS tile is scaled against. */
export function glyphMapGeoTileElevationRange(tile: GlyphMapGeoTile): { readonly min: number; readonly max: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < tile.elevation.length; i++) {
    const v = tile.elevation[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Shape/provenance metadata a baked int16 tile carries OUTSIDE its binary
 * payload — a manifest entry (`GlyphMapProviderZoomLevel`) plus this tile's
 * own `x`/`y` already determine `bounds`/`cols`/`rows`, so a reader builds
 * this from the manifest rather than the payload repeating it.
 */
export interface GlyphMapGeoTileInt16Meta {
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  readonly source: string;
  readonly sampler: string;
  readonly attribution?: readonly GlyphMapAttribution[];
}

/**
 * Decodes a baked `{z}/{x}_{y}.bin` payload (`website/scripts/
 * bake-geo-tiles.mjs`'s `"int16"` format) into a {@link GlyphMapGeoTile}.
 *
 * The payload is nothing but `(cols + 1) * (rows + 1)` little-endian int16
 * elevation samples, row-major, in the SAME order `bakeGeoTile`'s loop
 * produces (`row * (cols + 1) + col`) — no header, no length prefix, since
 * the manifest already carries `cols`/`rows` and the byte length is exactly
 * derivable from them. ETOPO1's own `z` variable is NetCDF int32 whole
 * metres in `[-10898, 8271]` (measured against the full source grid), which
 * int16's `[-32768, 32767]` range holds losslessly with ~3x headroom — this
 * decoder trusts that range rather than re-validating it per sample.
 *
 * Pure and browser-safe: takes raw bytes, never fetches. Throws a
 * `RangeError` naming the expected vs. actual sample count when the byte
 * length doesn't match `meta.cols`/`meta.rows` — a stale manifest/payload
 * pairing (a level bumped in one but not the other) must fail loudly, not
 * silently decode a garbled or truncated grid.
 */
export function glyphMapDecodeGeoTileInt16(bytes: ArrayBuffer | ArrayBufferView, meta: GlyphMapGeoTileInt16Meta): GlyphMapGeoTile {
  const buf = ArrayBuffer.isView(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  const vcols = meta.cols + 1;
  const vrows = meta.rows + 1;
  const expectedSamples = vcols * vrows;
  const expectedBytes = expectedSamples * 2;
  if (buf.byteLength !== expectedBytes) {
    const actualSamples = buf.byteLength % 2 === 0 ? `${buf.byteLength / 2} samples` : "not a whole number of int16 samples";
    throw new RangeError(
      `glyphcss/maps: geo-tile int16 payload has ${buf.byteLength} bytes (${actualSamples}), expected ${expectedBytes} bytes (${expectedSamples} samples) for a ${meta.cols}x${meta.rows}-quad tile.`,
    );
  }
  const elevation = new Float32Array(expectedSamples);
  for (let i = 0; i < expectedSamples; i++) {
    elevation[i] = buf.getInt16(i * 2, true);
  }
  return { bounds: meta.bounds, cols: meta.cols, rows: meta.rows, elevation, source: meta.source, sampler: meta.sampler, attribution: meta.attribution };
}

/**
 * A tile whose bounds straddle the antimeridian (`bounds.east > 180`, an
 * "unwrapped" continuous-longitude authoring convention — e.g. `west: 170,
 * east: 190` for a tile spanning 170°E to 170°W) projects to two disjoint
 * regions; a single mesh built from it would bridge across the whole map as
 * garbage strips (MAPS.md §7). Splitting BEFORE projecting means a caller
 * feeds each half through {@link glyphMapPolygons} independently. Returns
 * `[tile]` unchanged when it doesn't straddle the seam.
 *
 * The split falls on a whole-column boundary nearest the seam (never
 * resampling a fractional column), so no vertex position or elevation value
 * on either half is anything but a literal slice of the source tile's own
 * grid — exact parity for a tile that already doesn't need splitting is
 * unaffected, and a caller of the split halves gets the same vertex data a
 * non-straddling tile authored to fall exactly on the seam would.
 */
export function splitGlyphMapGeoTileAtAntimeridian(tile: GlyphMapGeoTile): readonly GlyphMapGeoTile[] {
  const { west, east } = tile.bounds;
  if (east <= 180) return [tile];
  const vcols = tile.cols + 1;
  const vrows = tile.rows + 1;
  // The column nearest the seam (180°), clamped inside the grid so both
  // halves keep at least one quad.
  const seamCol = Math.min(tile.cols - 1, Math.max(1, Math.round(((180 - west) / (east - west)) * tile.cols)));

  const slice = (colStart: number, colEnd: number, lonWest: number, lonEast: number): GlyphMapGeoTile => {
    const cols = colEnd - colStart;
    const out = new Float32Array((cols + 1) * vrows);
    for (let row = 0; row < vrows; row++) {
      for (let col = 0; col <= cols; col++) {
        out[row * (cols + 1) + col] = tile.elevation[vertexIndex(tile, colStart + col, row)];
      }
    }
    return {
      bounds: { west: lonWest, east: lonEast, south: tile.bounds.south, north: tile.bounds.north },
      cols,
      rows: tile.rows,
      elevation: out,
      source: tile.source,
      sampler: tile.sampler,
    };
  };

  const west1 = slice(0, seamCol, west, 180);
  const east1raw = slice(seamCol, tile.cols, 180, east - 360);
  // The eastern half's own `west`/`east` are re-expressed in the normal
  // [-180, 180) range (`east - 360`), so a consumer never has to reason
  // about the unwrapped authoring convention past this function.
  const east1: GlyphMapGeoTile = {
    ...east1raw,
    bounds: { west: -180, east: east - 360, south: tile.bounds.south, north: tile.bounds.north },
  };
  return [west1, east1];
}
