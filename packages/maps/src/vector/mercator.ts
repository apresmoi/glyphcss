/**
 * Web Mercator tile addressing — the SECOND addressing scheme this package
 * speaks, and the reason a hosted OSM basemap can now be swept instead of
 * read whole.
 *
 * ## Why a second scheme at all
 *
 * Every pyramid this package bakes (`bake-geo-tiles.mjs`,
 * `bake-vector-tiles.mjs`, `bake-place-tiles.mjs`) is EQUAL-ANGLE: tile
 * `(x, y)` at zoom `z` spans `360/2^z` degrees of longitude AND
 * `180/2^z` degrees of latitude, so `y = floor((90 - north) / tileLatSpan)`.
 * Every hosted OSM pyramid on the open web — OpenFreeMap, PMTiles archives,
 * anything Planetiler or Tippecanoe cut — is WEB MERCATOR: `y` is a function
 * of `log(tan)` , not of latitude directly. The two disagree in `y` at any
 * meaningful zoom: at z12 the vendored Zurich extract lives at Mercator
 * `y = 1434` and equal-angle `y = 1025` (pinned in `protomaps.test.ts` and
 * again in `mercator.test.ts`), so a sweep run under the wrong indexer
 * requests tiles that do not exist and never requests the ones that do.
 *
 * ## Why an addressing STRATEGY rather than a retiling provider
 *
 * The widget's tile sweep has exactly ONE equal-angle assumption in it:
 * `candidateTileRange` turns the view's geographic window into an index box
 * via `glyphMapTileRangeForLevel`. Everything downstream is already
 * addressing-agnostic — `isBoundsVisible` tests `provider.bounds(z, x, y)`,
 * which is the provider's own function; the cache key, the in-flight guard
 * and the 180 ms debounce are all keyed on `z/x_y` opaquely. So the whole
 * fix is to let a provider supply that one function
 * ({@link import("./types").GlyphMapVectorProvider.tileRange}), the same
 * capability-presence rule projections already follow (AGENTS.md: "every
 * projection-specific branch in the widget keys on capability presence,
 * never on `projection.id`"). Providers that declare nothing keep
 * {@link import("../provider").glyphMapEqualAngleTileRange} by default
 * parameter, so the terrain/border/place/country pyramids are untouched.
 *
 * The alternative — a provider that RETILES Mercator onto the equal-angle
 * grid — was rejected: one equal-angle tile straddles up to two Mercator
 * rows, so every request becomes two fetches plus a reprojection and a
 * re-clip of the geometry, and the widget's cache identity stops matching
 * the network's. That is real machinery bought to preserve an invariant
 * (one indexer) that costs one optional function to relax.
 */
import type { GlyphMapBounds } from "../types";
import type { GlyphMapProviderZoomLevel } from "../provider";
import type { GlyphMapTileIndexRange } from "../provider";

/**
 * Web Mercator's own latitude limit — where `y` reaches 0 and `2^z`. The
 * projection is a `log(tan)` and simply does not reach the poles; a square
 * world tile stops here by construction, which is why every slippy map's
 * `bounds` reads `[-180, -85.05113, 180, 85.05113]` (OpenFreeMap's own
 * TileJSON included, vendored at `fixtures/openfreemap/tilejson.json`).
 *
 * Consequence for this package: ABOVE THIS LATITUDE THERE IS NO DATA, and
 * the honest answer to a sweep there is an empty tile range — not a clamped
 * index that would smear the top row of tiles across the Arctic.
 */
export const GLYPH_MAP_MERCATOR_MAX_LAT = 85.0511287798066;

/** Web Mercator tile index of a lon/lat at zoom `z`, clamped into the grid (and into the projection's own latitude window). */
export function glyphMapMercatorTileIndex(lon: number, lat: number, z: number): { readonly x: number; readonly y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-GLYPH_MAP_MERCATOR_MAX_LAT, Math.min(GLYPH_MAP_MERCATOR_MAX_LAT, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const yFraction = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor(yFraction * n))),
  };
}

/** Geographic bounds of Web Mercator tile `(x, y)` at zoom `z`. */
export function glyphMapMercatorTileBounds(z: number, x: number, y: number): GlyphMapBounds {
  const n = 2 ** z;
  const latOf = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: latOf(y),
    south: latOf(y + 1),
  };
}

/**
 * The Mercator {@link import("../provider").GlyphMapTileRangeStrategy}.
 *
 * Three behaviours that are NOT the equal-angle strategy's, each deliberate:
 *
 *  - **No window** (`null` — the sweep could not unproject anything) falls
 *    back to the whole grid, matching the equal-angle rule.
 *  - **An antimeridian-crossing window** (`west < -180` or `east > 180`)
 *    keeps its LATITUDE restriction and widens only longitude to the full
 *    row. The equal-angle strategy surrenders the whole window here, which
 *    is survivable at a curated z7 (16,383 tiles) and catastrophic at a
 *    hosted z12 (16.7 million). Longitude wraps; latitude never does, so
 *    there is no reason to give up both.
 *  - **A window entirely past {@link GLYPH_MAP_MERCATOR_MAX_LAT}** returns
 *    an EMPTY range (`y1 < y0`), so a sweep over the poles enumerates
 *    nothing rather than clamping onto the top/bottom row and mounting
 *    Arctic tiles for a view that is over the pole. `y1 < y0` is the same
 *    degenerate-range shape `glyphMapTileRangeForLevel` documents; the
 *    widget's own "never blank the layer" failsafe still applies above it.
 */
export function glyphMapMercatorTileRange(
  level: GlyphMapProviderZoomLevel,
  window: GlyphMapBounds | null,
): GlyphMapTileIndexRange {
  const n = Math.max(1, level.cols);
  const full = { x0: 0, x1: n - 1, y0: 0, y1: Math.max(0, level.rows - 1) };
  if (!window) return full;
  if (window.south > GLYPH_MAP_MERCATOR_MAX_LAT || window.north < -GLYPH_MAP_MERCATOR_MAX_LAT) {
    return { x0: 0, x1: n - 1, y0: 0, y1: -1 };
  }
  const north = glyphMapMercatorTileIndex(0, window.north, level.z).y;
  const south = glyphMapMercatorTileIndex(0, window.south, level.z).y;
  const y0 = Math.min(north, south);
  const y1 = Math.max(north, south);
  if (window.west < -180 || window.east > 180 || window.east - window.west >= 360) {
    return { x0: 0, x1: n - 1, y0, y1 };
  }
  const x0 = glyphMapMercatorTileIndex(window.west, 0, level.z).x;
  const x1 = glyphMapMercatorTileIndex(window.east, 0, level.z).x;
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1 };
}

/**
 * The `zooms` manifest for a square Web Mercator pyramid.
 *
 * `tileCols`/`tileRows` carry the meaning {@link GlyphMapProviderZoomLevel}
 * documents for vector data — the level's NATIVE resolution expressed as an
 * equivalent quad count — because that is exactly what `glyphMapTargetLOD`
 * divides `tileLonSpan` by. For a vector basemap the honest number is NOT
 * the MVT coordinate extent (4096): that is arithmetic precision, not
 * detail. A z0 tile is encoded at 1/4096 of a degree of precision and still
 * holds nothing but continents, so feeding 4096 here makes the LOD picker
 * believe z0 already resolves 0.088 degrees and never deepen. The number
 * that means "how much detail is in this tile" for a basemap is the display
 * size it was generalized FOR — 256, the slippy-map tile — which is why
 * that is the default and why {@link GlyphMapMercatorZoomOptions} is spelled
 * `tileResolution` rather than `extent`.
 *
 * `tileLatSpan` is the level's AVERAGE latitude span (the Mercator domain's
 * height divided by the row count) rather than any one row's real span,
 * which varies from ~55% of it at the equator to the whole top row's
 * unbounded stretch. Nothing correctness-bearing reads it: the widget uses
 * it only to pad the candidate GEOGRAPHIC window before
 * {@link glyphMapMercatorTileRange} indexes that window itself, and a
 * generous window only ever costs a slower sweep (`isBoundsVisible` stays
 * the per-tile authority).
 */
export function glyphMapMercatorZooms(minZoom: number, maxZoom: number, tileResolution = 256): GlyphMapProviderZoomLevel[] {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    zooms.push({
      z,
      cols: n,
      rows: n,
      tileLonSpan: 360 / n,
      tileLatSpan: (2 * GLYPH_MAP_MERCATOR_MAX_LAT) / n,
      tileCols: tileResolution,
      tileRows: tileResolution,
    });
  }
  return zooms;
}
