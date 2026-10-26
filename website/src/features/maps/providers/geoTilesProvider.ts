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
 *
 * Tiles are `{z}/{x}_{y}.bin` — a raw little-endian int16 payload, decoded
 * via `@glyphcss/maps`'s `glyphMapDecodeGeoTileInt16` — never JSON. This
 * reader requires the exact `format: "int16"`, `byteOrder: "little-endian"`,
 * `version: 2` schema and has no fallback path: a mismatched manifest is a
 * stale/regenerate-me condition, not something to silently reinterpret.
 *
 * When the manifest carries `curated` entries (`bake-geo-tiles.mjs`'s z5-z7
 * overlay for each curated place — Switzerland and Bahía Blanca/Sierra de la
 * Ventana as of this writing), the base z0-z4 provider is wrapped in
 * `@glyphcss/maps`'s `glyphMapCuratedProvider` — real curated tiles fetched
 * from `curated/{z}/{x}_{y}.bin`, everything else at those depths degrading
 * to the deepest ancestor tile that actually exists. An empty/absent
 * `curated` list is a genuine no-op — `glyphMapCuratedProvider` with zero
 * levels returns `base` itself, unwrapped — so this reader has exactly one
 * code path regardless of whether the manifest declares curated depth.
 *
 * Below the baked pyramid, levels down to {@link STREAMED_MAX_ZOOM} are
 * streamed from the AWS terrain tiles (`terrariumTiles.ts`). A streamed tile
 * that fails to load degrades to the baked/curated answer resampled onto the
 * requested tile, so the ground never goes blank and siblings never mount one
 * shared ancestor twice.
 */
import type {
  GlyphMapAttribution,
  GlyphMapBounds,
  GlyphMapCuratedRasterTiles,
  GlyphMapGeoTile,
  GlyphMapProvider,
  GlyphMapProviderZoomLevel,
} from "@glyphcss/maps";
import {
  glyphMapCuratedProvider,
  glyphMapDecodeGeoTileInt16,
  glyphMapGeoTileElevationAt,
  glyphMapVectorTileBounds,
} from "@glyphcss/maps";
import {
  buildTerrariumGeoTile,
  createTerrariumFetcher,
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_MAX_ZOOM,
} from "./terrariumTiles";

/**
 * The deepest streamed level: 0.00049-degree quads (~40 m), about the
 * terrain tiles' real ~30 m resolution over most land. Deeper levels would
 * only interpolate, at four times the quads per level.
 */
export const STREAMED_MAX_ZOOM = 12;

interface GeoTilesManifestCurated {
  readonly name: string;
  readonly zoom: GlyphMapProviderZoomLevel;
  readonly bounds: GlyphMapBounds;
  readonly tiles: readonly string[];
}

interface GeoTilesManifest {
  readonly version: number;
  readonly format: string;
  readonly byteOrder: string;
  readonly zooms: readonly GlyphMapProviderZoomLevel[];
  readonly source: string;
  readonly sampler: string;
  readonly attribution?: readonly GlyphMapAttribution[];
  readonly curated?: readonly GeoTilesManifestCurated[];
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
export async function createGeoTilesProvider(
  baseUrl = "/data/geo-tiles",
  fetchTerrarium = createTerrariumFetcher(),
): Promise<GlyphMapProvider & { readonly sampler: string }> {
  const res = await fetch(`${baseUrl}/manifest.json`);
  if (!res.ok) {
    throw new Error(
      `glyphcss website: failed to load geo-tiles manifest at ${baseUrl}/manifest.json (${res.status}). Run "node website/scripts/bake-geo-tiles.mjs --tiles" first.`,
    );
  }
  const manifest = (await res.json()) as GeoTilesManifest;
  if (manifest.format !== "int16" || manifest.byteOrder !== "little-endian" || manifest.version !== 2) {
    throw new Error(
      `glyphcss website: geo-tiles manifest at ${baseUrl}/manifest.json has format ${JSON.stringify(manifest.format)}/byteOrder ${JSON.stringify(manifest.byteOrder)}/version ${JSON.stringify(manifest.version)} (expected "int16"/"little-endian"/2). Run "node website/scripts/bake-geo-tiles.mjs --tiles" to re-bake a current pyramid.`,
    );
  }
  const zoomByZ = new Map(manifest.zooms.map((z) => [z.z, z] as const));

  const base: GlyphMapProvider = {
    id: `geo-tiles:${baseUrl}`,
    zooms: manifest.zooms,
    attribution: manifest.attribution,
    bounds(z, x, y) {
      const level = zoomByZ.get(z);
      if (!level) throw new RangeError(`geo-tiles provider: no zoom level ${z}.`);
      return tileBounds(level, x, y);
    },
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const level = zoomByZ.get(z);
      if (!level) throw new RangeError(`geo-tiles provider: no zoom level ${z}.`);
      const tileRes = await fetch(`${baseUrl}/${z}/${x}_${y}.bin`);
      if (!tileRes.ok) throw new Error(`geo-tiles provider: failed to fetch tile ${z}/${x}_${y} (${tileRes.status}).`);
      const bytes = await tileRes.arrayBuffer();
      // `attribution` is deliberately omitted here — this is a
      // provider-backed tile, and `GlyphMapGeoTile.attribution` is
      // documented as the STATIC-tile provenance slot; a provider-backed
      // layer carries it once on `GlyphMapProvider.attribution` above
      // instead (matches the pre-int16 raw-JSON path, which never set it).
      return glyphMapDecodeGeoTileInt16(bytes, {
        bounds: tileBounds(level, x, y),
        cols: level.tileCols,
        rows: level.tileRows,
        source: manifest.source,
        sampler: manifest.sampler,
      });
    },
  };

  const curatedLevels: GlyphMapCuratedRasterTiles[] = (manifest.curated ?? []).map((entry) => ({
    // `entry.bounds` describes which files were baked, not the wrapper's
    // effective coverage: misses outside it are served by ancestor tiles.
    zoom: entry.zoom,
    tiles: new Set(entry.tiles),
    async loadTile(x, y): Promise<GlyphMapGeoTile> {
      const z = entry.zoom.z;
      const tileRes = await fetch(`${baseUrl}/curated/${z}/${x}_${y}.bin`);
      if (!tileRes.ok)
        throw new Error(`geo-tiles provider: failed to fetch curated tile ${z}/${x}_${y} (${tileRes.status}).`);
      const bytes = await tileRes.arrayBuffer();
      return glyphMapDecodeGeoTileInt16(bytes, {
        bounds: tileBounds(entry.zoom, x, y),
        cols: entry.zoom.tileCols,
        rows: entry.zoom.tileRows,
        source: manifest.source,
        sampler: manifest.sampler,
      });
    },
  }));

  const baked = glyphMapCuratedProvider(base, curatedLevels);
  const bakedMaxZ = Math.max(...baked.zooms.map((z) => z.z));
  const baseMaxZ = Math.max(...manifest.zooms.map((z) => z.z));
  const tileCols = manifest.zooms[0].tileCols,
    tileRows = manifest.zooms[0].tileRows;

  async function bakedFallback(z: number, x: number, y: number, bounds: GlyphMapBounds): Promise<GlyphMapGeoTile> {
    const zt = Math.min(z, bakedMaxZ),
      scale = 2 ** (z - zt);
    const ancestor = await baked.loadTile(zt, Math.floor(x / scale), Math.floor(y / scale));
    const elevation = new Float32Array((tileCols + 1) * (tileRows + 1));
    for (let r = 0; r <= tileRows; r++) {
      const lat = bounds.north - ((bounds.north - bounds.south) * r) / tileRows;
      for (let c = 0; c <= tileCols; c++) {
        elevation[r * (tileCols + 1) + c] = glyphMapGeoTileElevationAt(
          ancestor,
          bounds.west + ((bounds.east - bounds.west) * c) / tileCols,
          lat,
        );
      }
    }
    return { bounds, cols: tileCols, rows: tileRows, elevation, source: ancestor.source, sampler: ancestor.sampler };
  }

  const streamed: GlyphMapProviderZoomLevel[] = [];
  for (let z = baseMaxZ + 1; z <= STREAMED_MAX_ZOOM; z++) {
    streamed.push({
      z,
      cols: 2 ** z,
      rows: 2 ** z,
      tileLonSpan: 360 / 2 ** z,
      tileLatSpan: 180 / 2 ** z,
      tileCols,
      tileRows,
    });
  }

  return {
    id: `${baked.id}+terrarium`,
    zooms: [...manifest.zooms, ...streamed],
    attribution: [...(manifest.attribution ?? []), TERRARIUM_ATTRIBUTION],
    bounds(z, x, y) {
      return z > baseMaxZ ? glyphMapVectorTileBounds(z, x, y) : base.bounds(z, x, y);
    },
    async loadTile(z, x, y) {
      if (z <= baseMaxZ) return base.loadTile(z, x, y);
      const bounds = glyphMapVectorTileBounds(z, x, y);
      try {
        return await buildTerrariumGeoTile(bounds, tileCols, tileRows, Math.min(z, TERRARIUM_MAX_ZOOM), fetchTerrarium);
      } catch (err) {
        console.warn(`glyphcss website: streamed terrain ${z}/${x}_${y} failed, using the baked pyramid.`, err);
        return bakedFallback(z, x, y, bounds);
      }
    },
    sampler: `${manifest.sampler} (z0-z${baseMaxZ}), bilinear streamed (z${baseMaxZ + 1}-z${STREAMED_MAX_ZOOM})`,
  };
}
