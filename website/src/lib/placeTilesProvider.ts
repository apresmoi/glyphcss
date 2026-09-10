/**
 * `GlyphMapVectorProvider` adapter over the POINT tile pyramid
 * `website/scripts/bake-place-tiles.mjs` bakes to
 * `website/public/data/place-tiles/` — Natural Earth's 50m populated
 * places, the data behind `/maps`'s `symbol`, `circle` and `heatmap` layers.
 *
 * Mirrors `vectorTilesProvider.ts` (same manifest-then-fetch shape, same
 * `glyphMapVectorTileBounds` addressing, same `glyphMapDecodeVectorTile`)
 * with ONE deliberate difference: it reads the manifest's TILE INDEX and
 * answers an address the bake produced no tile for with an EMPTY tile,
 * without a network round trip.
 *
 * That is not an optimization. Most of the world is ocean, so most addresses
 * in a point pyramid have no tile at all, and `createGlyphMap`'s feature
 * runtime resolves a whole visible set through one `Promise.all` — a single
 * rejected fetch would drop every OTHER tile in that view too, so the layer
 * would blink out wherever the viewport happened to include open water.
 *
 * The three baked `sourceLayer`s (`places`, `capitals`, `megacities`) are
 * re-exported as {@link PLACE_TILE_LAYERS} so the page's dataset picker and
 * the bake script cannot drift apart silently.
 */
import {
  glyphMapDecodeVectorTile,
  glyphMapVectorTileBounds,
  type GlyphMapAttribution,
  type GlyphMapProviderZoomLevel,
  type GlyphMapVectorProvider,
  type GlyphMapVectorTile,
  type GlyphMapVectorWireTile,
} from "@glyphcss/maps";

export const PLACE_TILE_LAYERS = ["places", "capitals", "megacities"] as const;
export type PlaceTileLayer = (typeof PLACE_TILE_LAYERS)[number];

interface PlaceTilesManifest {
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  readonly source: string;
  readonly resolution: string;
  readonly attribution?: readonly GlyphMapAttribution[];
  /** `{ [z]: ["x_y", ...] }` — every address the bake actually wrote. */
  readonly tiles: Readonly<Record<string, readonly string[]>>;
}

function emptyTile(z: number, x: number, y: number, source: string, attribution?: readonly GlyphMapAttribution[]): GlyphMapVectorTile {
  return { z, x, y, bounds: glyphMapVectorTileBounds(z, x, y), layers: {}, source, simplify: "none", attribution };
}

/**
 * The returned provider also carries `resolution` — the manifest's own
 * Natural Earth source resolution ("50m") — as an extra field beyond the
 * plain `GlyphMapVectorProvider` interface, the same way
 * `vectorTilesProvider.ts` carries `simplify` and `geoTilesProvider.ts`
 * carries `sampler`, so the rail cards can show real provenance rather than
 * a hardcoded string.
 */
export async function createPlaceTilesProvider(
  baseUrl = "/data/place-tiles",
): Promise<GlyphMapVectorProvider & { readonly resolution: string }> {
  const res = await fetch(`${baseUrl}/manifest.json`);
  if (!res.ok) {
    throw new Error(
      `glyphcss website: failed to load place-tiles manifest at ${baseUrl}/manifest.json (${res.status}). Run "node website/scripts/bake-place-tiles.mjs" first.`,
    );
  }
  const manifest = (await res.json()) as PlaceTilesManifest;
  const index = new Map<number, ReadonlySet<string>>();
  for (const [z, keys] of Object.entries(manifest.tiles ?? {})) index.set(Number(z), new Set(keys));

  return {
    id: `place-tiles:${baseUrl}`,
    zooms: manifest.zooms,
    attribution: manifest.attribution,
    resolution: manifest.resolution,
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y) {
      if (!index.get(z)?.has(`${x}_${y}`)) return emptyTile(z, x, y, manifest.source, manifest.attribution);
      const tileRes = await fetch(`${baseUrl}/${z}/${x}_${y}.json`);
      if (!tileRes.ok) throw new Error(`place-tiles provider: failed to fetch tile ${z}/${x}_${y} (${tileRes.status}).`);
      return glyphMapDecodeVectorTile((await tileRes.json()) as GlyphMapVectorWireTile);
    },
  };
}
