/**
 * `GlyphMapVectorProvider` adapter over the static tile pyramid
 * `website/scripts/bake-vector-tiles.mjs` bakes to `website/public/data/
 * vector-tiles/` (gitignored, regenerable output — same convention as
 * `geoTilesProvider.ts`). Mirrors that file's shape closely: fetch the
 * manifest once, derive each tile's bounds with the SAME z/x/y formula the
 * bake script uses (`glyphMapVectorTileBounds`, `@glyphcss/maps`), decode
 * each fetched tile with `glyphMapDecodeVectorTile`.
 *
 * The curated Switzerland bundle is wired through `glyphMapCuratedVectorProvider`
 * — a real, deeper (z4) zoom level that only has tiles for Switzerland's own
 * bounds; every other z4 request degrades to the base pyramid's z3 tile
 * covering the same region (never blank, never a throw — MAPS.md's
 * "everywhere else degrades gracefully" requirement).
 */
import {
  glyphMapCuratedVectorProvider,
  glyphMapDecodeVectorTile,
  glyphMapVectorTileBounds,
  type GlyphMapAttribution,
  type GlyphMapProviderZoomLevel,
  type GlyphMapVectorProvider,
  type GlyphMapVectorTile,
  type GlyphMapVectorWireTile,
} from "@glyphcss/maps";

interface VectorTilesManifest {
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  readonly source: string;
  readonly simplify: string;
  readonly attribution?: readonly GlyphMapAttribution[];
  readonly curated?: readonly {
    readonly name: string;
    readonly zoom: GlyphMapProviderZoomLevel;
    readonly tiles: readonly string[];
  }[];
}

async function fetchTile(baseUrl: string, z: number, x: number, y: number): Promise<GlyphMapVectorTile> {
  const res = await fetch(`${baseUrl}/${z}/${x}_${y}.json`);
  if (!res.ok) throw new Error(`vector-tiles provider: failed to fetch tile ${z}/${x}_${y} (${res.status}).`);
  const wire = (await res.json()) as GlyphMapVectorWireTile;
  return glyphMapDecodeVectorTile(wire);
}

export async function createVectorTilesProvider(baseUrl = "/data/vector-tiles"): Promise<GlyphMapVectorProvider> {
  const res = await fetch(`${baseUrl}/manifest.json`);
  if (!res.ok) {
    throw new Error(
      `glyphcss website: failed to load vector-tiles manifest at ${baseUrl}/manifest.json (${res.status}). Run "node website/scripts/bake-vector-tiles.mjs" first.`,
    );
  }
  const manifest = (await res.json()) as VectorTilesManifest;

  const base: GlyphMapVectorProvider = {
    id: `vector-tiles:${baseUrl}`,
    zooms: manifest.zooms,
    attribution: manifest.attribution,
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    loadTile: (z, x, y) => fetchTile(baseUrl, z, x, y),
  };

  const curatedEntry = manifest.curated?.[0];
  if (!curatedEntry) return base;

  const curatedTiles = new Map<string, GlyphMapVectorTile>();
  for (const key of curatedEntry.tiles) {
    const [xStr, yStr] = key.split("_");
    curatedTiles.set(key, await fetchTile(`${baseUrl}/curated`, curatedEntry.zoom.z, Number(xStr), Number(yStr)));
  }
  return glyphMapCuratedVectorProvider(base, { zoom: curatedEntry.zoom, tiles: curatedTiles });
}
