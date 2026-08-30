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
