/**
 * Curated-place vector tile overlay (coordinator scope addition to MAPS.md
 * §13 slice 5): "past the level where global data is still affordable, only
 * the curated Places get deeper bundles... a Place owns a detail bundle
 * that is fetched when the view enters its bounds at sufficient zoom, and
 * released when it leaves. Everywhere else degrades gracefully to the
 * deepest global level rather than blanking."
 *
 * This wraps an existing base {@link GlyphMapVectorProvider} (the global
 * pyramid) with ONE extra, DEEPER zoom level that only has REAL tiles for
 * the curated place's own bounds — every other tile at that depth falls
 * back to the base provider's own deepest ancestor tile covering the same
 * region, so a pan into an uncurated area at that zoom never blanks or
 * errors, it just shows coarser detail. The wrapper is pure composition
 * (no fetch/DOM of its own) — `createGlyphMap`'s existing tile-diff/LOD
 * loop (`glyphMapTargetLOD`/`glyphMapDegreesPerCell`, unchanged) drives it
 * exactly like any other provider, since the curated zoom level is still
 * the SAME `GlyphMapProviderZoomLevel` record shape.
 */
import type { GlyphMapProviderZoomLevel } from "../provider";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./types";
import { glyphMapVectorTileBounds } from "./tile";

export interface GlyphMapCuratedVectorTiles {
  /** The curated depth's own zoom record (its `z`, and `cols`/`rows` continuing the SAME quadtree doubling the base pyramid uses). */
  readonly zoom: GlyphMapProviderZoomLevel;
  /** Real, baked tiles at `zoom.z`, keyed `"x_y"` — only the tiles the curated place's bounds actually touch. */
  readonly tiles: ReadonlyMap<string, GlyphMapVectorTile>;
}

/**
 * Wrap `base` with one curated-depth zoom level. A request for that depth
 * either returns a real curated tile, or degrades to the base provider's
 * own DEEPEST zoom level's ancestor tile covering the same quadrant (never
 * a throw, never an empty tile) — exact quadtree containment, since every
 * level here shares the SAME `-180 + x·(360/2^z)` addressing (`vector/
 * tile.ts`'s `glyphMapVectorTileBounds`), so the ancestor at the base's max
 * `z` is `floor(x / 2^(z - maxZ))`, `floor(y / 2^(z - maxZ))`.
 */
export function glyphMapCuratedVectorProvider(
  base: GlyphMapVectorProvider,
  curated: GlyphMapCuratedVectorTiles,
): GlyphMapVectorProvider {
  const baseMaxZ = Math.max(...base.zooms.map((z) => z.z));
  const curatedZ = curated.zoom.z;
  if (curatedZ <= baseMaxZ) {
    throw new RangeError(
      `glyphcss/maps: glyphMapCuratedVectorProvider — curated zoom ${curatedZ} must be DEEPER than the base pyramid's own max zoom ${baseMaxZ}.`,
    );
  }
  return {
    id: `${base.id}+curated`,
    zooms: [...base.zooms, curated.zoom],
    attribution: base.attribution,
    bounds(z, x, y) {
      return z === curatedZ ? glyphMapVectorTileBounds(z, x, y) : base.bounds(z, x, y);
    },
    async loadTile(z, x, y) {
      if (z !== curatedZ) return base.loadTile(z, x, y);
      const tile = curated.tiles.get(`${x}_${y}`);
      if (tile) return tile;
      const scale = 2 ** (z - baseMaxZ);
      return base.loadTile(baseMaxZ, Math.floor(x / scale), Math.floor(y / scale));
    },
  };
}
