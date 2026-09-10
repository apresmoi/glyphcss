/**
 * OpenFreeMap — worldwide OpenStreetMap vector tiles, on demand.
 *
 * <https://openfreemap.org> serves the whole planet as OpenMapTiles-schema
 * MVT with no API key, no registration and no usage limit (it is MapHub's
 * production basemap). This is the provider that mounts it on
 * `createGlyphMap`, replacing "OSM on this map means one vendored 150 KB
 * Zurich extract" with "OSM means the planet".
 *
 * ## The endpoint, verified against the service
 *
 * `https://tiles.openfreemap.org/planet` is a TileJSON 3.0 manifest whose
 * `tiles[0]` carries a DATED snapshot segment (`.../planet/20260830_080001_pt/
 * {z}/{x}/{y}.pbf`). `latest` is the documented stable alias for the newest
 * snapshot and serves byte-identical tiles, so {@link
 * GLYPH_MAP_OPENFREEMAP_TILE_URL} uses it and this provider needs no manifest
 * round-trip at construction. The manifest itself is vendored at
 * `fixtures/openfreemap/tilejson.json` and every fact taken from it — zoom
 * range, bounds, layer names, property names, the attribution string — is
 * asserted against that copy in `openmaptiles.test.ts`.
 *
 * Responses are `application/vnd.mapbox-vector-tile`, uncompressed on the
 * wire (the CDN negotiates transfer encoding itself and `fetch` undoes it),
 * so the bytes reaching {@link glyphMapDecodeMVT} are plain MVT.
 *
 * ## Addressing
 *
 * Web Mercator, like every hosted OSM pyramid — NOT this package's
 * equal-angle grid. The provider therefore declares the `tileRange`
 * capability, and `createGlyphMap`'s sweep uses it instead of its own
 * indexer. See `mercator.ts`'s header for the full argument.
 *
 * ## Volume
 *
 * The sweep is the widget's existing one — its tile cache, its in-flight
 * guard, its 180 ms gesture-gated debounce. Nothing here fetches on its own.
 * How many tiles that sweep asks for is set by `glyphMapMercatorZooms`'
 * `tileResolution`: `glyphMapTargetLOD` picks the zoom whose tiles resolve
 * about that many cells across, so a viewport covers roughly
 * `view.cols / tileResolution` tiles at EVERY scale. Measured in
 * `openfreemap.test.ts` on a 140x63 grid: 1 tile at a world view (z0), <= 24
 * at a country view (z5), <= 24 at a city view (z14), and never more than
 * 100 anywhere on the ladder at any latitude.
 *
 * ## Failure
 *
 * A tile that 404s, times out or arrives undecodable resolves to an EMPTY
 * tile, never a rejection. The widget's sweep awaits a `Promise.all` over
 * every missing tile in the visible set, so one rejection would take down
 * the whole frame's fetch and blank layers that had nothing wrong with them.
 * An empty tile is also the truthful answer: OpenFreeMap serves nothing for
 * an address it has no data for. {@link GlyphMapOpenFreeMapOptions.onError}
 * is how a caller still hears about it.
 */
import type { GlyphMapAttribution } from "../types";
import { GLYPH_MAP_OPENFREEMAP_ATTRIBUTION } from "../attribution";
import { glyphMapDecodeMVT } from "./pmtiles";
import { glyphMapMercatorTileBounds, glyphMapMercatorTileRange, glyphMapMercatorZooms } from "./mercator";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./types";

/** The service's own documented stable tile template. `latest` tracks the newest weekly planet snapshot. */
export const GLYPH_MAP_OPENFREEMAP_TILE_URL = "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";

/** The zoom range the service's TileJSON declares (`fixtures/openfreemap/tilejson.json`). */
export const GLYPH_MAP_OPENFREEMAP_MIN_ZOOM = 0;
export const GLYPH_MAP_OPENFREEMAP_MAX_ZOOM = 14;

export interface GlyphMapOpenFreeMapOptions {
  readonly id?: string;
  /**
   * Tile URL template with `{z}`/`{x}`/`{y}` placeholders. Defaults to
   * {@link GLYPH_MAP_OPENFREEMAP_TILE_URL}. Override it to point at your own
   * self-hosted planet — which OpenFreeMap explicitly supports and publishes
   * Btrfs/MBTiles images for.
   */
  readonly tileUrl?: string;
  /** Restrict decoding to these OpenMapTiles source layers. Omitted = every layer the tile carries. Worth setting: a z14 city tile carries 9,000 POIs a `roads` layer never reads. */
  readonly layers?: readonly string[];
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /**
   * Cells one tile is treated as resolving, for LOD selection. Default 256 —
   * the slippy-map tile size these tiles were generalized FOR, and therefore
   * the honest measure of how much detail is in one. See
   * `glyphMapMercatorZooms`' doc for why the MVT extent (4096) is the wrong
   * number here.
   */
  readonly tileResolution?: number;
  /** Override the credit. Omitted = {@link GLYPH_MAP_OPENFREEMAP_ATTRIBUTION} — a legal requirement, not a default. */
  readonly attribution?: readonly GlyphMapAttribution[];
  /** Transport seam. Defaults to `fetch`; injected by tests, and the place to add a timeout, a retry or an auth header for a self-hosted deployment. */
  readonly fetchTile?: (url: string, z: number, x: number, y: number) => Promise<ArrayBuffer>;
  /** Called for every tile that failed to load or decode. The tile still resolves empty; this is how a UI can say "3 tiles are missing" instead of nothing. */
  readonly onError?: (error: unknown, tile: { readonly z: number; readonly x: number; readonly y: number }) => void;
}

async function fetchTileBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`glyphcss/maps: OpenFreeMap tile ${url} responded ${res.status}.`);
  return res.arrayBuffer();
}

/** A {@link GlyphMapVectorProvider} over OpenFreeMap's planet pyramid (or any OpenMapTiles-schema `{z}/{x}/{y}.pbf` endpoint). */
export function glyphMapOpenFreeMapProvider(opts: GlyphMapOpenFreeMapOptions = {}): GlyphMapVectorProvider {
  const id = opts.id ?? "openfreemap";
  const tileUrl = opts.tileUrl ?? GLYPH_MAP_OPENFREEMAP_TILE_URL;
  const attribution = opts.attribution ?? GLYPH_MAP_OPENFREEMAP_ATTRIBUTION;
  const load = opts.fetchTile ?? ((url) => fetchTileBytes(url));
  const zooms = glyphMapMercatorZooms(
    opts.minZoom ?? GLYPH_MAP_OPENFREEMAP_MIN_ZOOM,
    opts.maxZoom ?? GLYPH_MAP_OPENFREEMAP_MAX_ZOOM,
    opts.tileResolution ?? 256,
  );

  return {
    id,
    zooms,
    attribution,
    tileRange: glyphMapMercatorTileRange,
    bounds: glyphMapMercatorTileBounds,
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      const base = {
        z, x, y,
        bounds: glyphMapMercatorTileBounds(z, x, y),
        source: id,
        simplify: "mvt-source",
        attribution,
      } as const;
      const url = tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      try {
        const bytes = await load(url, z, x, y);
        return { ...base, layers: glyphMapDecodeMVT(bytes, z, x, y, opts.layers) };
      } catch (error) {
        opts.onError?.(error, { z, x, y });
        return { ...base, layers: {} };
      }
    },
  };
}
