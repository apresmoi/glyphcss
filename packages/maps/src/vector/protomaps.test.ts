/**
 * The Protomaps basemap → glyphcss layer-vocabulary mapping, checked against
 * the archive it maps. Every layer name, property name and `kind` value
 * asserted here was read out of `fixtures/pmtiles/zurich-z12.pmtiles` (its
 * own `vector_layers` metadata and its two tiles), never guessed from the
 * published schema docs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glyphMapPMTilesBufferSource } from "./pmtiles";
import {
  GLYPH_MAP_PROTOMAPS_LAYERS,
  GLYPH_MAP_PROTOMAPS_SOURCE_LAYERS,
  glyphMapProtomapsExtract,
  glyphMapProtomapsFeatureFilter,
  glyphMapProtomapsKind,
  glyphMapProtomapsLayers,
} from "./protomaps";
import { glyphMapTileRangeForLevel } from "../provider";

const FIXTURE = path.resolve(__dirname, "../../fixtures/pmtiles/zurich-z12.pmtiles");
const extract = () => glyphMapProtomapsExtract(glyphMapPMTilesBufferSource(readFileSync(FIXTURE), FIXTURE));

describe("glyphMapProtomapsExtract", () => {
  it("reads the archive's own extent, zoom and tile count", async () => {
    const e = await extract();
    expect(e.zoom).toBe(12);
    expect(e.tileCount).toBe(2);
    expect(e.bounds.west).toBeCloseTo(8.52, 2);
    expect(e.bounds.east).toBeCloseTo(8.56, 2);
    expect(e.bounds.south).toBeCloseTo(47.36, 2);
    expect(e.bounds.north).toBeCloseTo(47.39, 2);
  });

  it("groups features into one collection per Protomaps source layer present", async () => {
    const e = await extract();
    // `landcover` is declared by the archive but has maxzoom 7, so it is
    // genuinely absent at z12 — an extract reports what it HOLDS.
    expect(Object.keys(e.sources).sort()).toEqual(
      ["boundaries", "buildings", "earth", "landuse", "places", "pois", "roads", "water"],
    );
    expect(GLYPH_MAP_PROTOMAPS_SOURCE_LAYERS).toContain("landcover");
    // Both tiles merged, not just the first.
    expect(e.sources.roads.features.length).toBeGreaterThan(300);
    expect(e.sources.landuse.features.length).toBeGreaterThan(1200);
  });

  it("reports the `kind` vocabulary the extract actually holds, per layer", async () => {
    const e = await extract();
    expect(e.kinds.roads).toEqual(["ferry", "highway", "major_road", "minor_road", "path", "rail"]);
    expect(e.kinds.water).toEqual(["basin", "canal", "river", "swimming_pool", "water"]);
    expect(e.kinds.buildings).toEqual(["building"]);
    expect(e.kinds.places).toEqual(["locality", "macrohood", "neighbourhood"]);
  });

  it("carries the ODbL OpenStreetMap credit on every collection it produces", async () => {
    const e = await extract();
    for (const collection of Object.values(e.sources)) {
      expect(collection.attribution).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "OpenStreetMap contributors", license: "ODbL" })]),
      );
    }
  });
});

describe("glyphMapProtomapsKind", () => {
  it("reads `kind`, and falls back to the older `pmap:kind` spelling", () => {
    expect(glyphMapProtomapsKind({ rings: [], properties: { kind: "highway" } })).toBe("highway");
    expect(glyphMapProtomapsKind({ rings: [], properties: { "pmap:kind": "river" } })).toBe("river");
    expect(glyphMapProtomapsKind({ rings: [] })).toBeUndefined();
  });
});

describe("glyphMapProtomapsFeatureFilter", () => {
  it("narrows `roads` by kind — the whole reason one source layer is not one map layer", async () => {
    const roads = (await extract()).sources.roads.features;
    const motorways = roads.filter(glyphMapProtomapsFeatureFilter({ kinds: ["highway"] }));
    expect(motorways.length).toBeGreaterThan(0);
    expect(motorways.length).toBeLessThan(roads.length);
    expect(new Set(motorways.map(glyphMapProtomapsKind))).toEqual(new Set(["highway"]));
  });

  it("splits `water` by GEOMETRY — rivers are lines, lakes are polygons, in one source layer", async () => {
    const water = (await extract()).sources.water.features;
    const lines = water.filter(glyphMapProtomapsFeatureFilter({ geometry: "line" }));
    const areas = water.filter(glyphMapProtomapsFeatureFilter({ geometry: "polygon" }));
    expect(lines.length).toBeGreaterThan(0);
    expect(areas.length).toBeGreaterThan(0);
    expect(lines.length + areas.length).toBeLessThanOrEqual(water.length);
    expect(lines.some((f) => f.properties?.name === "Limmat")).toBe(true);
    expect(areas.every((f) => f.geometryType === "polygon")).toBe(true);
  });

  it("keeps everything when neither axis is constrained", async () => {
    const roads = (await extract()).sources.roads.features;
    expect(roads.filter(glyphMapProtomapsFeatureFilter({})).length).toBe(roads.length);
  });
});

describe("glyphMapProtomapsLayers", () => {
  it("maps each Protomaps source layer onto the glyphcss layer type that fits it", async () => {
    const layers = await extract().then((e) => glyphMapProtomapsLayers(e));
    const byId = new Map(layers.map((l) => [l.id, l]));
    expect([...byId.keys()]).toEqual(GLYPH_MAP_PROTOMAPS_LAYERS.filter((s) => s.sourceLayer !== "landcover").map((s) => s.id));
    expect(byId.get("osm-roads")?.type).toBe("line");
    expect(byId.get("osm-water")?.type).toBe("fill");
    expect(byId.get("osm-waterway")?.type).toBe("line");
    expect(byId.get("osm-landuse")?.type).toBe("fill");
    expect(byId.get("osm-buildings")?.type).toBe("fill-extrusion");
    expect(byId.get("osm-places")?.type).toBe("symbol");
    expect(byId.get("osm-boundaries")?.type).toBe("line");
    // `landcover` is in the schema table but absent from this extract, so no
    // layer is produced for it — a layer with no features is not mounted.
    expect(byId.has("osm-landcover")).toBe(false);
  });

  it("gives every produced layer a source that carries the OSM credit", async () => {
    const layers = await extract().then((e) => glyphMapProtomapsLayers(e));
    for (const layer of layers) {
      const source = (layer as { source: { attribution?: readonly { name: string }[] } }).source;
      expect(source.attribution?.some((a) => a.name === "OpenStreetMap contributors")).toBe(true);
    }
  });

  it("wires each layer's own filter so the two `water` layers are disjoint and non-empty", async () => {
    const e = await extract();
    const layers = glyphMapProtomapsLayers(e);
    const pick = (id: string) => {
      const layer = layers.find((l) => l.id === id) as unknown as { source: { features: readonly unknown[] }; filter?: (f: never) => boolean };
      return layer.source.features.filter((f) => layer.filter?.(f as never) ?? true);
    };
    const areas = pick("osm-water");
    const lines = pick("osm-waterway");
    expect(areas.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(areas.filter((f) => lines.includes(f))).toHaveLength(0);
  });

  it("keys buildings on the height column OSM actually populates", async () => {
    const e = await extract();
    const buildings = glyphMapProtomapsLayers(e).find((l) => l.id === "osm-buildings") as unknown as {
      heightProperty?: string; source: { features: readonly { properties?: Record<string, unknown> }[] };
    };
    expect(buildings.heightProperty).toBe("height");
    expect(buildings.source.features.some((f) => Number.isFinite(Number(f.properties?.height)))).toBe(true);
  });

  it("honours per-source-layer kind narrowing from the caller", async () => {
    const e = await extract();
    const layers = glyphMapProtomapsLayers(e, { kinds: { roads: ["highway"] } });
    const roads = layers.find((l) => l.id === "osm-roads") as unknown as {
      source: { features: readonly never[] }; filter?: (f: never) => boolean;
    };
    const kept = roads.source.features.filter((f) => roads.filter!(f));
    expect(kept.length).toBeGreaterThan(0);
    expect(new Set(kept.map(glyphMapProtomapsKind))).toEqual(new Set(["highway"]));
  });

  it("takes a per-layer colour override without changing the mapping", async () => {
    const e = await extract();
    const layers = glyphMapProtomapsLayers(e, { colors: { "osm-roads": "#ff00ff" } });
    expect((layers.find((l) => l.id === "osm-roads") as { color?: string }).color).toBe("#ff00ff");
    expect((layers.find((l) => l.id === "osm-water") as { color?: string }).color)
      .toBe(GLYPH_MAP_PROTOMAPS_LAYERS.find((s) => s.id === "osm-water")!.color);
  });
});

describe("why the extract is loaded as feature collections, not mounted as a tile provider", () => {
  it("the widget's equal-angle tile sweep addresses a DIFFERENT tile than Web Mercator does", async () => {
    const provider = await import("./pmtiles").then((m) =>
      m.glyphMapPMTilesProvider(glyphMapPMTilesBufferSource(readFileSync(FIXTURE), FIXTURE)));
    const level = provider.zooms[0];
    const e = await extract();
    // `glyphMapTileRangeForLevel` is the equal-angle addressing every baked
    // pyramid in this package shares (AGENTS.md, "Tiles"). PMTiles is Web
    // Mercator. Handed the archive's own extent, the two disagree by ~400
    // rows of tiles, so a widget tile sweep over this provider would enumerate
    // tiles the archive does not hold and never request the two it does.
    const range = glyphMapTileRangeForLevel({ ...level, bounds: e.bounds });
    expect(range.x0).toBe(2144);
    expect(range.x1).toBe(2145);
    expect(range.y0).not.toBe(1434);
    expect(range.y1).not.toBe(1434);
    // And the real Mercator address the reader itself uses:
    expect(provider.bounds(12, 2144, 1434).north).toBeGreaterThan(47.3);
    expect(provider.bounds(12, 2144, range.y0).north).toBeGreaterThan(60);
  });
});
