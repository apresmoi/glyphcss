/**
 * `GlyphMapVectorProvider` adapter over the COUNTRY LABEL POINT tile pyramid
 * `website/scripts/bake-country-tiles.mjs` bakes to
 * `website/public/data/country-tiles/` — Natural Earth's 50m admin-0
 * `LABEL_X`/`LABEL_Y` positions, the data behind `/maps`'s `symbol` and
 * `circle` layers' "Countries" dataset (and the symbol layer's default).
 *
 * A near-exact mirror of `placeTilesProvider.ts`: same manifest-then-fetch
 * shape, same `glyphMapVectorTileBounds` addressing, same
 * `glyphMapDecodeVectorTile`, and the same tile-INDEX read so an address the
 * bake produced no tile for is answered with an EMPTY tile and no network
 * round trip (`createFeatureLayerRuntime` resolves a whole visible set
 * through one `Promise.all`, so a single rejected fetch would drop every
 * other tile in that view too).
 *
 * It is a SEPARATE provider from the places one rather than a fourth
 * `sourceLayer` inside it because attribution is derived from the mounted
 * layer's own provider, never hardcoded: populated places and admin-0
 * countries are two different Natural Earth files with two different
 * provenance records, and a tile carries one attribution list. Keeping them
 * apart is what makes `map.getAttributions()` credit the source the reader
 * is actually looking at.
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

/** The one baked `sourceLayer`, re-exported so the page's dataset picker and the bake script cannot drift apart silently. */
export const COUNTRY_TILE_LAYERS = ["countries"] as const;
export type CountryTileLayer = (typeof COUNTRY_TILE_LAYERS)[number];

/**
 * The column the `symbol` layer must use as its `priorityProperty` for this
 * dataset — the bake's own inversion of Natural Earth's `LABELRANK` into the
 * widget's HIGHER-wins convention (see `bake-country-tiles.mjs`'s
 * `labelPriority`). Exported so the page names the column once instead of
 * repeating a string literal that only the baker knows the meaning of.
 */
export const COUNTRY_PRIORITY_PROPERTY = "label_priority";
/** Observed range of {@link COUNTRY_PRIORITY_PROPERTY} in the baked data (`10 - LABELRANK`, LABELRANK 2..7). */
export const COUNTRY_PRIORITY_RANGE = { min: 3, max: 8 } as const;

interface CountryTilesManifest {
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
 * plain `GlyphMapVectorProvider` interface, exactly as `placeTilesProvider.ts`
 * does, so a rail card can show real provenance rather than a hardcoded
 * string.
 */
export async function createCountryTilesProvider(
  baseUrl = "/data/country-tiles",
): Promise<GlyphMapVectorProvider & { readonly resolution: string }> {
  const res = await fetch(`${baseUrl}/manifest.json`);
  if (!res.ok) {
    throw new Error(
      `glyphcss website: failed to load country-tiles manifest at ${baseUrl}/manifest.json (${res.status}). Run "node website/scripts/bake-country-tiles.mjs" first.`,
    );
  }
  const manifest = (await res.json()) as CountryTilesManifest;
  const index = new Map<number, ReadonlySet<string>>();
  for (const [z, keys] of Object.entries(manifest.tiles ?? {})) index.set(Number(z), new Set(keys));

  return {
    id: `country-tiles:${baseUrl}`,
    zooms: manifest.zooms,
    attribution: manifest.attribution,
    resolution: manifest.resolution,
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y) {
      if (!index.get(z)?.has(`${x}_${y}`)) return emptyTile(z, x, y, manifest.source, manifest.attribution);
      const tileRes = await fetch(`${baseUrl}/${z}/${x}_${y}.json`);
      if (!tileRes.ok) throw new Error(`country-tiles provider: failed to fetch tile ${z}/${x}_${y} (${tileRes.status}).`);
      return glyphMapDecodeVectorTile((await tileRes.json()) as GlyphMapVectorWireTile);
    },
  };
}
