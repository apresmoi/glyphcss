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
