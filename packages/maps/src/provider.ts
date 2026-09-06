import type { GlyphMapAttribution, GlyphMapBounds, GlyphMapView } from "./types";
import type { GlyphMapGeoTile } from "./tile";

/**
 * One zoom level of a {@link GlyphMapProvider}'s tile pyramid. Everything is
 * GEOGRAPHIC (degrees), never world units or camera `zoom` — MAPS.md §13
 * slice 3's bug #2: `flatmap.astro`/`world.astro` keyed LOD on absolute
 * `camera.zoom`, which only worked because both happened to have world scale
 * ≈ 1 unit ≈ hemisphere. A projection with a different native scale (a
 * `radius: 100` globe, an Albers conic authored in different units) breaks
 * that link, so LOD selection here is expressed entirely in degrees —
 * ground units per glyph CELL, not per world unit or per pixel.
 */
export interface GlyphMapProviderZoomLevel {
  /** Zoom index, matching {@link GlyphMapGeoTile} tiles this level serves. */
  readonly z: number;
  /** Tile grid dimensions at this zoom (tiles across / down the provider's whole covered domain). */
  readonly cols: number;
  readonly rows: number;
  /** Degrees of longitude/latitude spanned by ONE tile at this zoom. */
  readonly tileLonSpan: number;
  readonly tileLatSpan: number;
  /** A tile's own quad resolution at this zoom (matches the {@link GlyphMapGeoTile}s this level serves — `tile.cols`/`tile.rows`). Needed to compute this level's NATIVE degrees-per-glyph-cell resolution. */
  readonly tileCols: number;
  readonly tileRows: number;
  /**
   * OPTIONAL: the geographic extent this level can serve — absent means the
   * provider's whole domain. `glyphMapTileRangeForLevel` uses it to restrict
   * a tile sweep before the per-tile visibility test, so it MUST include
   * fallback coverage as well as physically stored tiles. A curated wrapper
   * that serves misses through global ancestor tiles therefore has global
   * effective coverage and must leave this absent.
   */
  readonly bounds?: GlyphMapBounds;
}

/** An inclusive tile-index box a sweep enumerates: `x0..x1` by `y0..y1`. `y1 < y0` (or `x1 < x0`) is the degenerate/empty range. */
export interface GlyphMapTileIndexRange {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/**
 * How a provider's tile pyramid is ADDRESSED: the view's geographic window
 * (already padded by the sweep, and possibly reaching outside +/-180 or
 * +/-90) turned into an index box at one zoom level. `null` means the sweep
 * could not derive a window at all (nothing on screen unprojects) and the
 * strategy should answer with whatever it considers "everything".
 *
 * This is the ONE piece of the widget's tile sweep that knows about
 * addressing at all — see `vector/mercator.ts`'s header for why that is
 * true, and why a second strategy is cheaper than retiling. A provider that
 * declares none gets {@link glyphMapEqualAngleTileRange}.
 */
export type GlyphMapTileRangeStrategy = (
  level: GlyphMapProviderZoomLevel,
  window: GlyphMapBounds | null,
) => GlyphMapTileIndexRange;

/**
 * The equal-angle strategy every baked pyramid in this package uses — this
 * package's own addressing, extracted verbatim from `createGlyphMap`'s
 * `candidateTileRange` so it can sit beside a second one rather than be
 * assumed. A window needing antimeridian wraparound (`west < -180` or
 * `east > 180`) is DROPPED to `undefined`, which
 * {@link glyphMapTileRangeForLevel} already falls back to the full range
 * for; that rule was the sweep's and is now this strategy's, unchanged.
 */
export const glyphMapEqualAngleTileRange: GlyphMapTileRangeStrategy = (level, window) =>
  glyphMapTileRangeForLevel({
    ...level,
    bounds: window && window.west >= -180 && window.east <= 180 ? window : undefined,
  });

/**
 * The inclusive tile-index range a sweep should enumerate at `level` —
 * `[0, cols-1] x [0, rows-1]` when `level.bounds` is absent, or restricted
 * to the index range that box covers (same `-180 + x·tileLonSpan` equal-
 * angle addressing every geo-tile pyramid in this package shares). Falls
 * back to the full range on a degenerate result (an inverted or empty
 * intersection) rather than silently sweeping zero tiles.
 */
export function glyphMapTileRangeForLevel(level: GlyphMapProviderZoomLevel): GlyphMapTileIndexRange {
  const full = { x0: 0, x1: level.cols - 1, y0: 0, y1: level.rows - 1 };
  const b = level.bounds;
  if (!b) return full;
  const x0 = Math.max(0, Math.floor((b.west + 180) / level.tileLonSpan));
  const x1 = Math.min(level.cols - 1, Math.floor((b.east + 180) / level.tileLonSpan));
  const y0 = Math.max(0, Math.floor((90 - b.north) / level.tileLatSpan));
  const y1 = Math.min(level.rows - 1, Math.floor((90 - b.south) / level.tileLatSpan));
  if (x1 < x0 || y1 < y0) return full;
  return { x0, x1, y0, y1 };
}

/**
 * A tile pyramid: manifest + fetch + (implicitly, via {@link glyphMapTargetLOD})
 * LOD policy (MAPS.md §9/§14 — "a layer's `source` is either an in-memory
 * dataset or a `GlyphMapProvider`... the provider is per-SOURCE, not
 * per-map, so a relief pyramid and a vector pyramid coexist"). Deliberately
 * dumb: it describes WHAT tiles exist and how to fetch one; `createGlyphMap`
 * owns the tile cache, active-set diff, in-flight guard and fetch debounce
 * (absorbed from `world.astro`/`flatmap.astro`), and {@link glyphMapTargetLOD}
 * owns picking WHICH zoom level to use, so none of that is duplicated per
 * provider implementation.
 */
export interface GlyphMapProvider {
  readonly id: string;
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  /**
   * Provenance for whatever this provider serves (e.g. ETOPO1 → NOAA NCEI,
   * public domain, 2009) — MAPS.md's attribution requirement: derived from
   * the layers actually mounted, not a website-side lookup table. See
   * `attribution.ts`'s `glyphMapCollectAttributions`, which reads this off
   * every mounted layer's source/provider.
   */
  readonly attribution?: readonly GlyphMapAttribution[];
  /** Geographic bounds of tile `(x, y)` at zoom `z`. Pure — no fetch. */
  bounds(z: number, x: number, y: number): GlyphMapBounds;
  /** Fetch (or synchronously build) tile `(x, y)`'s data at zoom `z`. May be called more than once for the same tile — cache it yourself if that matters, or rely on the caller's own cache (`createGlyphMap` never calls this twice for a tile it has already cached). */
  loadTile(z: number, x: number, y: number): Promise<GlyphMapGeoTile>;
  /**
   * OPTIONAL: resolves what tile `loadTile(z, x, y)` will ACTUALLY return,
   * without fetching. A provider that degrades a miss to an ancestor tile
   * (`glyphMapCuratedProvider`) implements this so a caller sweeping many
   * `(x, y)` candidates at one zoom can recognize, before fetching or
   * mounting anything, that several of them resolve to the SAME underlying
   * tile — `createGlyphMap`'s raster tile-diff loop keys its cache/mount
   * set by this identity instead of the requested address, so two sibling
   * misses that both degrade to one ancestor mount that ancestor's mesh
   * once, not twice. A provider without this capability is assumed to
   * resolve every request to itself (no degradation to dedupe).
   */
  resolveTile?(z: number, x: number, y: number): { readonly z: number; readonly x: number; readonly y: number };
}

/**
 * Ground units per glyph cell (MAPS.md §13 slice 3's bug #2 fix) — degrees of
 * the view's span covered by ONE output column. Works identically across
 * projections with different native scales because it never touches world
 * units or `camera.zoom`: `view.span`/`view.cols` are geographic by
 * construction (MAPS.md §3b).
 */
export function glyphMapDegreesPerCell(view: GlyphMapView): number {
  return view.span / view.cols;
}

/**
 * Picks the SMALLEST (coarsest, cheapest) zoom level whose native resolution
 * (`tileLonSpan / tileCols`, degrees per source quad) is fine enough to not
 * look blocky at `degPerCell` — i.e. resolves at least one source quad per
 * output cell. Falls back to the FINEST available level when even that one
 * is coarser than `degPerCell` (zoomed in past what the provider ships), and
 * to the coarsest when every level is already fine enough (zoomed out
 * past what the provider needs).
 *
 * Deliberately provider-driven rather than a fixed threshold table (both
 * example pages hardcoded `camera.zoom` breakpoints tied to their own tile
 * pyramid) — a provider with a different zoom-level count or coverage still
 * gets a sensible answer with no changes here.
 */
/**
 * Takes only the `zooms` shape it actually reads — not the full
 * {@link GlyphMapProvider} interface — so a {@link
 * import("./vector/types").GlyphMapVectorProvider} (whose `zooms` is
 * deliberately the SAME `GlyphMapProviderZoomLevel[]` record shape, see
 * that type's own doc) works here UNCHANGED: the coordinator's "reuse the
 * LOD machinery... one visible-set computation serves both providers."
 */
export function glyphMapTargetLOD(provider: { readonly zooms: readonly GlyphMapProviderZoomLevel[] }, degPerCell: number): number {
  if (provider.zooms.length === 0) {
    throw new RangeError("glyphcss/maps: glyphMapTargetLOD requires a provider with at least one zoom level.");
  }
  const zooms = [...provider.zooms].sort((a, b) => a.z - b.z);
  let chosen = zooms[0].z;
  for (const level of zooms) {
    chosen = level.z;
    const nativeDegPerCell = level.tileLonSpan / level.tileCols;
    if (nativeDegPerCell <= degPerCell) break;
  }
  return chosen;
}
