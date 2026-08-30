/**
 * `GlyphMapProvider` adapter over the static tile pyramid `website/scripts/
 * bake-geo-tiles.mjs --tiles` bakes to `website/public/data/geo-tiles/`
 * (gitignored, regenerable output — see that script's own header). Mirrors
 * the manifest's `zooms[]` entries directly into `GlyphMapProviderZoomLevel[]`
 * (provider.ts's own doc: "everything GEOGRAPHIC... ground units per glyph
 * cell") and derives each tile's bounds with the SAME formula the bake
 * script uses (`lonMin = -180 + tx*tileLonSpan`, `latMax = 90 - ty*
 * tileLatSpan`) — load-bearing for LOD/culling to agree with what's actually
 * on disk.
 */
import type { GlyphMapAttribution, GlyphMapBounds, GlyphMapGeoTile, GlyphMapProvider, GlyphMapProviderZoomLevel } from "@glyphcss/maps";

interface GeoTilesManifest {
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  readonly source: string;
  readonly sampler: string;
  readonly attribution?: readonly GlyphMapAttribution[];
}

interface RawGeoTile {
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  readonly elevation: readonly number[];
  readonly source: string;
  readonly sampler: string;
}

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}

/**
 * Fetches the baked manifest once and returns a ready `GlyphMapProvider`.
 * `zooms` must be known synchronously for `glyphMapTargetLOD` to pick a
 * level before any tile fetch, so this factory is itself async rather than
 * the provider lazily resolving its own manifest.
 *
 * The returned object also carries `sampler` — the manifest's own elevation-
 * sampling provenance string (`bake-geo-tiles.mjs`'s choice, e.g.
 * `"nearest"`) — as an extra field beyond the plain `GlyphMapProvider`
 * interface, so the Terrain rail card can display it (MAPS.md §15's layer
 * cards) without a second manifest fetch. It is informational only: the
 * live app has no control that re-samples the already-baked tiles.
 */
export async function createGeoTilesProvider(baseUrl = "/data/geo-tiles"): Promise<GlyphMapProvider & { readonly sampler: string }> {
  const res = await fetch(`${baseUrl}/manifest.json`);
  if (!res.ok) {
    throw new Error(`glyphcss website: failed to load geo-tiles manifest at ${baseUrl}/manifest.json (${res.status}). Run "node website/scripts/bake-geo-tiles.mjs --tiles" first.`);
  }
  const manifest = (await res.json()) as GeoTilesManifest;
  const zoomByZ = new Map(manifest.zooms.map((z) => [z.z, z] as const));

  return {
    id: `geo-tiles:${baseUrl}`,
    zooms: manifest.zooms,
    attribution: manifest.attribution,
    sampler: manifest.sampler,
    bounds(z, x, y) {
      const level = zoomByZ.get(z);
      if (!level) throw new RangeError(`geo-tiles provider: no zoom level ${z}.`);
      return tileBounds(level, x, y);
    },
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const tileRes = await fetch(`${baseUrl}/${z}/${x}_${y}.json`);
      if (!tileRes.ok) throw new Error(`geo-tiles provider: failed to fetch tile ${z}/${x}_${y} (${tileRes.status}).`);
      const raw = (await tileRes.json()) as RawGeoTile;
      return {
        bounds: raw.bounds,
        cols: raw.cols,
        rows: raw.rows,
        elevation: Float32Array.from(raw.elevation),
        source: raw.source,
        sampler: raw.sampler,
      };
    },
  };
}
