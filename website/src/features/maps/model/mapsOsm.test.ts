/**
 * The /maps page's OpenStreetMap SOURCE.
 *
 * The page used to fetch one vendored 150 KB Protomaps extract of Zürich and
 * present a whole apparatus around the fact that its data covered four square
 * kilometres of a globe-scale page. It now mounts OpenFreeMap's planet
 * pyramid, so the questions worth pinning are different ones: is the source
 * the PROVIDER (swept on demand) rather than a fixed archive URL, does the
 * default point at OpenFreeMap's own public hosting rather than at anyone's
 * private infrastructure, does a self-hosted URL still get in, and does the
 * page pay for one tile fetch per tile rather than one per mounted layer.
 */
import { describe, expect, it, vi } from "vitest";
import {
  GLYPH_MAP_OPENFREEMAP_ATTRIBUTION,
  GLYPH_MAP_OPENFREEMAP_TILE_URL,
  GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS,
  glyphMapMercatorTileRange,
} from "@glyphcss/maps";
import {
  MAP_OSM_DEFAULT_ON,
  MAP_OSM_SOURCE_LAYERS,
  MAP_OSM_SUBLAYERS,
  createOsmSource,
  mapOsmMissingTilesLabel,
  mapOsmSourceLabel,
} from "./mapsOsm";

/** Bytes that decode to nothing, so a test can count requests without caring what came back. */
const EMPTY = new Uint8Array(0).buffer;

describe("createOsmSource", () => {
  it("is the OpenFreeMap planet PROVIDER, not a fixed archive to be fetched whole", () => {
    const source = createOsmSource();
    // A provider: the widget sweeps it per view. An extract would have had
    // `features`/`sources` and no `loadTile` at all.
    expect(typeof source.loadTile).toBe("function");
    expect(source.zooms.map((l) => l.z)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // Web Mercator addressing, declared as a capability — without it the
    // sweep would index `y` through latitude and request tiles the service
    // does not hold (`vector/mercator.ts`).
    expect(source.tileRange).toBe(glyphMapMercatorTileRange);
  });

  it("defaults to OpenFreeMap's own public hosting, never a bucket of someone else's", async () => {
    const fetchTile = vi.fn(async (_url: string) => EMPTY);
    await createOsmSource({ fetchTile }).loadTile(12, 2145, 1434);
    expect(fetchTile.mock.calls[0][0]).toBe("https://tiles.openfreemap.org/planet/latest/12/2145/1434.pbf");
    expect(GLYPH_MAP_OPENFREEMAP_TILE_URL).toContain("tiles.openfreemap.org");
  });

  it("takes a self-hosted archive URL as an OPT-IN, keeping OpenFreeMap the default", async () => {
    const fetchTile = vi.fn(async (_url: string) => EMPTY);
    const source = createOsmSource({ tileUrl: "/tiles/planet/{z}/{x}/{y}.pbf", fetchTile });
    await source.loadTile(3, 4, 5);
    expect(fetchTile.mock.calls[0][0]).toBe("/tiles/planet/3/4/5.pbf");
  });

  it("carries the ODbL credit the mounted layers derive their attribution from", () => {
    expect(createOsmSource().attribution).toEqual(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION);
    expect(createOsmSource().attribution?.map((a) => a.name)).toContain("OpenStreetMap contributors");
  });

  it("decodes only the source layers the card can actually render", async () => {
    // A z14 city tile carries thousands of housenumbers and street-name
    // labels this page has no row for; decoding them is pure cost.
    for (const name of MAP_OSM_SOURCE_LAYERS) expect(GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS).toContain(name);
    expect(MAP_OSM_SOURCE_LAYERS).not.toContain("housenumber");
    expect(MAP_OSM_SOURCE_LAYERS).not.toContain("transportation_name");
    expect([...MAP_OSM_SOURCE_LAYERS].sort()).toEqual(
      [...new Set(MAP_OSM_SUBLAYERS.map((s) => s.sourceLayer))].sort(),
    );
  });

  /**
   * Every mounted layer runs its OWN tile sweep with its OWN cache
   * (`widget.ts`'s `createFeatureLayerRuntime`), so N enabled rows on one
   * provider are N requests for the SAME tile in the same tick. Deduping
   * in-flight requests is what keeps "one tile at a world view" true of the
   * network rather than only of the sweep.
   */
  it("asks the network once for a tile several mounted layers want at the same time", async () => {
    const fetchTile = vi.fn(async () => { await Promise.resolve(); return EMPTY; });
    const source = createOsmSource({ fetchTile });
    const tiles = await Promise.all([source.loadTile(0, 0, 0), source.loadTile(0, 0, 0), source.loadTile(0, 0, 0)]);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    // Each caller still gets a real tile, not a shared mutable one.
    for (const tile of tiles) expect(tile.bounds.west).toBeCloseTo(-180, 6);
  });

  it("re-asks once the earlier request has settled, so nothing is pinned in memory forever", async () => {
    const fetchTile = vi.fn(async () => EMPTY);
    const source = createOsmSource({ fetchTile });
    await source.loadTile(0, 0, 0);
    await source.loadTile(0, 0, 0);
    expect(fetchTile).toHaveBeenCalledTimes(2);
  });

  it("degrades quietly on a failing tile and reports it through onError", async () => {
    const onError = vi.fn();
    const source = createOsmSource({ onError, fetchTile: async () => { throw new Error("504 Gateway Timeout"); } });
    const tile = await source.loadTile(9, 1, 1);
    expect(tile.layers).toEqual({});
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual({ z: 9, x: 1, y: 1 });
  });
});

describe("what the card says about the source", () => {
  it("names the service, the schema and the zoom ladder — all read off the provider", () => {
    expect(mapOsmSourceLabel(createOsmSource())).toBe("OpenFreeMap · OpenMapTiles · z0–14");
  });

  it("says nothing at all while every tile is arriving", () => {
    expect(mapOsmMissingTilesLabel(0)).toBeNull();
  });

  it("says how many tiles are missing when some are — the layer is thinner, not broken", () => {
    expect(mapOsmMissingTilesLabel(1)).toBe("1 tile unavailable");
    expect(mapOsmMissingTilesLabel(7)).toBe("7 tiles unavailable");
  });
});

describe("which rows the card offers", () => {
  it("offers one row per OpenMapTiles spec, defaulting to the ones with data at world scale", () => {
    const ids = MAP_OSM_SUBLAYERS.map((s) => s.id);
    expect(ids).toContain("omt-roads");
    expect(ids).toContain("omt-water");
    expect(ids).toContain("omt-buildings");
    // Protomaps' vocabulary is gone with the extract — this is the
    // OpenMapTiles schema now, and the ids are not interchangeable.
    expect(ids.every((id) => id.startsWith("omt-"))).toBe(true);
    for (const id of MAP_OSM_DEFAULT_ON) expect(ids).toContain(id);
    // `building` starts at z13 and `transportation` at z4, so a default-on
    // buildings row would draw nothing on the page's own opening view.
    expect(MAP_OSM_DEFAULT_ON).not.toContain("omt-buildings");
  });
});
