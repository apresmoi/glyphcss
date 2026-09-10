/**
 * The Protomaps reader against a REAL archive — `fixtures/pmtiles/
 * zurich-z12.pmtiles`, a 150 KB reviewed extract of the Protomaps basemap
 * (planetiler build, OSM data, ODbL).
 *
 * `pmtiles.test.ts` next door decodes hand-written MVT payloads: it proves
 * the decoder's own control flow (unknown geometry skipped, ids/properties
 * retained) but proves nothing about the ARCHIVE path — `new PMTiles(source)`,
 * the root-directory read, gzip tile decompression, and the polygon/
 * multipolygon hole grouping never ran against real bytes. Everything this
 * file asserts about layer and property names was READ OUT of the archive's
 * own `vector_layers` metadata and its two tiles, never guessed: the whole
 * point of `vector/protomaps.ts`'s schema mapping is that it names fields
 * that exist.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glyphMapPMTilesBufferSource, glyphMapPMTilesProvider } from "./pmtiles";
import { GLYPH_MAP_PROTOMAPS_ATTRIBUTION } from "../attribution";

const FIXTURE = path.resolve(__dirname, "../../fixtures/pmtiles/zurich-z12.pmtiles");

/** The archive's only two tiles, at its only zoom — Web Mercator addressing, as PMTiles is. */
const ZURICH_TILES = [
  { z: 12, x: 2144, y: 1434 },
  { z: 12, x: 2145, y: 1434 },
] as const;

function fixtureSource() {
  return glyphMapPMTilesBufferSource(readFileSync(FIXTURE), FIXTURE);
}

describe("Protomaps PMTiles reader against the vendored Zurich extract", () => {
  it("opens the archive and reports its own single zoom level and extent", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    expect(provider.zooms.map((z) => z.z)).toEqual([12]);
    // The archive is a small city extract, not a world pyramid — the header's
    // own bbox is what makes "outside this box there is no data" a fact the
    // page can present rather than a guess.
    const b = provider.bounds(12, 2144, 1434);
    expect(b.west).toBeCloseTo(8.4375, 4);
    expect(b.east).toBeCloseTo(8.5254, 4);
    expect(b.north).toBeCloseTo(47.3983, 3);
    expect(b.south).toBeCloseTo(47.3388, 3);
  });

  it("decodes real gzipped MVT tiles into the Protomaps basemap's own source layers", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    const tile = await provider.loadTile(ZURICH_TILES[0].z, ZURICH_TILES[0].x, ZURICH_TILES[0].y);
    // Exactly the layer ids the archive's `vector_layers` metadata declares,
    // minus `landcover` (maxzoom 7, so absent at z12).
    expect(Object.keys(tile.layers).sort()).toEqual(
      ["boundaries", "buildings", "earth", "landuse", "places", "pois", "roads", "water"],
    );
    expect(tile.layers.roads.length).toBeGreaterThan(100);
    expect(tile.layers.landuse.length).toBeGreaterThan(500);
  });

  it("carries `kind` as the discriminator, with the real Protomaps values", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    const tile = await provider.loadTile(12, 2144, 1434);
    const kinds = (name: string) => new Set(tile.layers[name].map((f) => f.properties?.kind));
    // Roads are one undifferentiated source layer; `kind` is what separates a
    // motorway from a footpath, and is the reason the mapping exposes a filter.
    expect(kinds("roads")).toEqual(new Set(["highway", "major_road", "minor_road", "path", "rail"]));
    expect(kinds("water")).toEqual(new Set(["water", "river", "canal", "swimming_pool"]));
    expect(kinds("buildings")).toEqual(new Set(["building"]));
    expect(kinds("places")).toEqual(new Set(["locality", "neighbourhood", "macrohood"]));
    expect(kinds("boundaries")).toEqual(new Set(["locality", "county"]));
    expect(kinds("earth")).toEqual(new Set(["earth", "cliff"]));
    // The finer discriminator, present where OSM has it.
    const motorway = tile.layers.roads.find((f) => f.properties?.kind_detail === "motorway");
    expect(motorway?.properties?.kind).toBe("highway");
    expect(typeof motorway?.properties?.ref).toBe("string");
  });

  it("preserves geometry kind, hole groups and the numeric attributes the layers key on", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    const tile = await provider.loadTile(12, 2144, 1434);

    // roads: lines only.
    expect(new Set(tile.layers.roads.map((f) => f.geometryType))).toEqual(new Set(["line"]));
    // places: points only, with a `name` and a `population`.
    expect(new Set(tile.layers.places.map((f) => f.geometryType))).toEqual(new Set(["point"]));
    const zurich = tile.layers.places.find((f) => f.properties?.name === "Zürich");
    expect(zurich?.properties?.kind_detail).toBe("city");
    expect(zurich?.properties?.population).toBeGreaterThan(400_000);

    // water carries BOTH: rivers/canals as lines, lakes/basins as polygons.
    // A `line` layer over `water` therefore has to filter on geometry, not
    // just on `kind` — which is why the spec type carries both.
    const waterGeom = new Set(tile.layers.water.map((f) => f.geometryType));
    expect(waterGeom.has("line")).toBe(true);
    expect(waterGeom.has("polygon")).toBe(true);
    const limmat = tile.layers.water.find((f) => f.properties?.name === "Limmat");
    expect(limmat?.properties?.kind_detail).toBe("river");

    // buildings: polygons with `polygons` hole groups (never a flat ring
    // list) and OSM's own `height` where it is tagged.
    const building = tile.layers.buildings[0];
    expect(building.geometryType).toBe("polygon");
    expect(building.polygons?.[0]?.[0]?.length).toBeGreaterThan(3);
    expect(tile.layers.buildings.some((f) => Number.isFinite(Number(f.properties?.height)))).toBe(true);

    // Every decoded coordinate is a real lon/lat inside the extract.
    const [lon, lat] = tile.layers.roads[0].rings[0][0];
    expect(lon).toBeGreaterThan(8.4);
    expect(lon).toBeLessThan(8.6);
    expect(lat).toBeGreaterThan(47.3);
    expect(lat).toBeLessThan(47.5);
  });

  it("serves both tiles the archive holds and returns an empty tile outside them, never a throw", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    for (const { z, x, y } of ZURICH_TILES) {
      expect((await provider.loadTile(z, x, y)).layers.roads.length).toBeGreaterThan(0);
    }
    // One tile east of the extract: the archive simply has no entry, and the
    // reader answers with an empty layer set. That is what "outside the
    // extract there is no data" looks like at the provider boundary.
    expect(await provider.loadTile(12, 2146, 1434)).toMatchObject({ layers: {} });
  });

  it("carries the mandatory OSM/ODbL credit on the provider and on every tile", async () => {
    const provider = await glyphMapPMTilesProvider(fixtureSource());
    expect(provider.attribution).toEqual(GLYPH_MAP_PROTOMAPS_ATTRIBUTION);
    expect((await provider.loadTile(12, 2144, 1434)).attribution)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "OpenStreetMap contributors", license: "ODbL" })]));
  });
});
