/**
 * Curated-place RASTER tile overlay — the raster mirror of `vector/
 * curated.ts` (read that file first; this one follows its own doc
 * verbatim except where raster's own shape forces a difference — see
 * below). Wraps an existing base {@link GlyphMapProvider} (the global
 * z0-z4 ETOPO1 pyramid) with one or more DEEPER zoom levels that only have
 * REAL tiles inside a curated place's own bounds; every other tile at a
 * curated depth degrades to the deepest ancestor tile that actually
 * exists — another, shallower curated level, or the base pyramid's own
 * max zoom — never blank, never a throw.
 *
 * Exact quadtree containment depends on every zoom level here (base AND
 * curated) sharing the SAME `-180 + x·(360/2^z)` equal-angle addressing
 * `website/src/lib/geoTilesProvider.ts`'s `tileBounds` / `bake-geo-
 * tiles.mjs` already use — CONFIRMED identical to `vector/tile.ts`'s
 * `glyphMapVectorTileBounds` (both derive `tileLonSpan`/`tileLatSpan` as
 * `360/2^z`/`180/2^z` and place tile `(x, y)`'s origin at `-180 +
 * x·tileLonSpan`, `90 - y·tileLatSpan`), so a curated-depth `bounds(z,x,y)`
 * reuses that same exported formula rather than a third hand-rolled copy of
 * it, and the ancestor of `(z, x, y)` at any shallower zoom `zt` is
 * `floor(x / 2^(z - zt))`, `floor(y / 2^(z - zt))`.
 *
 * Differs from the vector curated provider in three ways forced by raster's
 * own shape:
 *  - MULTIPLE curated depths, not one: a curated place ships several deeper
 *    levels here (z5/z6/z7 over a z0-z4 global base), and the degradation
 *    rule stays the same at every depth — a miss falls back to the
 *    deepest ancestor that actually has a tile, which may be ANOTHER
 *    curated level or the base's own max zoom.
 *  - MULTIPLE curated PLACES can share a zoom, too: `curated` entries are
 *    grouped by `zoom.z` rather than keyed 1:1, so a second place at a
 *    zoom an existing place already occupies UNIONS both places' real-tile
 *    key sets into one zoom record instead of one silently overwriting the
 *    other.
 *  - Curated tiles are FETCHED, not held in memory (the vector wrapper's
 *    `ReadonlyMap<string, GlyphMapVectorTile>` assumes an already-loaded,
 *    in-memory bake; a raster curated tile is a `.bin` payload behind an
 *    HTTP request). A curated level therefore carries only the SET of real
 *    tile keys — so "is this a real curated tile" is answered
 *    synchronously, with no speculative fetch that 404s — plus its own
 *    `loadTile`, which performs the actual fetch/decode.
 *
 * An empty/absent `curated` list returns `base` UNCHANGED (not a wrapper
 * that merely behaves like one) — the honest form of "no-op": `base.bounds`
 * still throws at a depth it doesn't declare, exactly as it would with no
 * curated overlay at all, rather than this wrapper silently absorbing that
 * into its own always-succeeding `bounds`.
 */
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapGeoTile } from "./tile";
import { glyphMapVectorTileBounds } from "./vector/tile";

/** One curated depth: its own zoom record, plus the exact set of `"x_y"` tile keys that are REAL at that depth, and a loader that fetches one. */
export interface GlyphMapCuratedRasterTiles {
  readonly zoom: GlyphMapProviderZoomLevel;
  /** Real, baked tile keys at `zoom.z` — only the tiles the curated place's bounds actually touch. */
  readonly tiles: ReadonlySet<string>;
  loadTile(x: number, y: number): Promise<GlyphMapGeoTile>;
}

interface GroupedLevel {
  readonly zoom: GlyphMapProviderZoomLevel;
  /** `"x_y"` -> the specific curated entry that owns that key's `loadTile`. */
  readonly owners: Map<string, GlyphMapCuratedRasterTiles>;
}

/**
 * Wrap `base` with one or more curated-depth zoom levels. A request at a
 * curated depth either returns a real curated tile (fetched via the owning
 * entry's own `loadTile`), or degrades to the deepest ancestor tile that
 * actually exists — walking shallower curated levels first, then the
 * base provider's own max zoom, which by the global pyramid's full-
 * coverage guarantee always has a tile. Never a throw, never blank.
 *
 * `curated.length === 0` returns `base` unchanged — see the module doc's
 * "honest no-op" note.
 *
 * Throws only if some curated zoom is not strictly deeper than the base
 * pyramid's own max zoom — an inverted or overlapping pyramid has no
 * sensible ancestor relationship to resolve against.
 */
export function glyphMapCuratedProvider(base: GlyphMapProvider, curated: readonly GlyphMapCuratedRasterTiles[]): GlyphMapProvider {
  if (curated.length === 0) return base;

  const baseMaxZ = Math.max(...base.zooms.map((z) => z.z));
  const grouped = new Map<number, GroupedLevel>();
  for (const c of curated) {
    if (c.zoom.z <= baseMaxZ) {
      throw new RangeError(
        `glyphcss/maps: glyphMapCuratedProvider — curated zoom ${c.zoom.z} must be DEEPER than the base pyramid's own max zoom ${baseMaxZ}.`,
      );
    }
    const existing = grouped.get(c.zoom.z);
    // Stored curated files are partial, but this wrapper's effective
    // coverage is global because every miss resolves to an ancestor. Keeping
    // the storage bounds here would prevent consumers from requesting those
    // misses, so the fallback contract could never run outside the place.
    const zoom: GlyphMapProviderZoomLevel = existing?.zoom ?? { ...c.zoom, bounds: undefined };
    const owners = existing?.owners ?? new Map<string, GlyphMapCuratedRasterTiles>();
    for (const key of c.tiles) owners.set(key, c);
    grouped.set(c.zoom.z, { zoom, owners });
  }

  /** The identity `loadTile(z, x, y)` will actually resolve to, without fetching — shared by `loadTile` and the public `resolveTile` capability so the two can never disagree. */
  function resolveIdentity(z: number, x: number, y: number): { readonly z: number; readonly x: number; readonly y: number } {
    for (let zt = z; zt > baseMaxZ; zt--) {
      const scale = 2 ** (z - zt);
      const tx = Math.floor(x / scale);
      const ty = Math.floor(y / scale);
      if (grouped.get(zt)?.owners.has(`${tx}_${ty}`)) return { z: zt, x: tx, y: ty };
    }
    const scale = 2 ** (z - baseMaxZ);
    return { z: baseMaxZ, x: Math.floor(x / scale), y: Math.floor(y / scale) };
  }

  async function resolve(z: number, x: number, y: number): Promise<GlyphMapGeoTile> {
    const r = resolveIdentity(z, x, y);
    const owner = r.z > baseMaxZ ? grouped.get(r.z)?.owners.get(`${r.x}_${r.y}`) : undefined;
    return owner ? owner.loadTile(r.x, r.y) : base.loadTile(r.z, r.x, r.y);
  }

  return {
    id: `${base.id}+curated`,
    zooms: [...base.zooms, ...[...grouped.values()].map((g) => g.zoom)].sort((a, b) => a.z - b.z),
    attribution: base.attribution,
    bounds(z, x, y) {
      return z > baseMaxZ ? glyphMapVectorTileBounds(z, x, y) : base.bounds(z, x, y);
    },
    loadTile(z, x, y) {
      return z > baseMaxZ ? resolve(z, x, y) : base.loadTile(z, x, y);
    },
    resolveTile(z, x, y) {
      return z > baseMaxZ ? resolveIdentity(z, x, y) : { z, x, y };
    },
  };
}
