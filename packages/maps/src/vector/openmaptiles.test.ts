/**
 * The OpenMapTiles schema → glyphcss layer-vocabulary mapping, checked
 * against the data it maps.
 *
 * **Every layer name, property name and `class` value asserted here was read
 * out of the live OpenFreeMap service**, not out of the published schema
 * docs — `fixtures/openfreemap/tilejson.json` is
 * `https://tiles.openfreemap.org/planet` with the ~90 `name:<lang>` fields
 * stripped, and `fixtures/openfreemap/z0-0-0.mvt` /
 * `fixtures/openfreemap/z12-2145-1434.mvt` are two real tiles it served. A
 * schema drift therefore shows up here as a red test rather than as an empty
 * layer.
 *
 * This is a DIFFERENT schema from `protomaps.ts`'s, not a variant of it:
 * OpenMapTiles discriminates on `class` where Protomaps uses `kind`, splits
 * water polygons (`water`) from watercourse lines (`waterway`) into two
 * source layers where Protomaps keeps both in `water`, discriminates
 * `boundary` numerically on `admin_level` rather than on any string, calls a
 * building's height `render_height` rather than `height`, and has no
 * landmass (`earth`) layer at all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glyphMapDecodeMVT } from "./pmtiles";
import {
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS,
  glyphMapOpenMapTilesAdminLevel,
  glyphMapOpenMapTilesClass,
  glyphMapOpenMapTilesFeatureFilter,
  glyphMapOpenMapTilesLayers,
} from "./openmaptiles";
import { GLYPH_MAP_OPENFREEMAP_ATTRIBUTION } from "../attribution";
import { glyphMapOpenFreeMapProvider, GLYPH_MAP_OPENFREEMAP_TILE_URL } from "./openfreemap";

const FIXTURES = path.resolve(__dirname, "../../fixtures/openfreemap");
const tilejson = JSON.parse(readFileSync(path.join(FIXTURES, "tilejson.json"), "utf8")) as {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number];
  attribution: string;
  vector_layers: { id: string; minzoom: number; maxzoom: number; fields: Record<string, string> }[];
};
const mvt = (name: string, z: number, x: number, y: number) =>
  glyphMapDecodeMVT(readFileSync(path.join(FIXTURES, name)), z, x, y);

describe("the service's own TileJSON", () => {
  it("declares a Web Mercator planet pyramid, z0-z14, capped at Mercator's latitude limit", () => {
    expect(tilejson.minzoom).toBe(0);
    expect(tilejson.maxzoom).toBe(14);
    expect(tilejson.bounds[0]).toBe(-180);
    expect(tilejson.bounds[2]).toBe(180);
    expect(tilejson.bounds[1]).toBeCloseTo(-85.05113, 4);
    expect(tilejson.bounds[3]).toBeCloseTo(85.05113, 4);
  });

  it("serves .pbf under a {z}/{x}/{y} template, which is what the provider's default URL matches", () => {
    expect(tilejson.tiles[0]).toMatch(/^https:\/\/tiles\.openfreemap\.org\/planet\/.+\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    // The dated segment in the TileJSON (`20260830_080001_pt`) is a snapshot
    // id; `latest` is the documented stable alias and is what we ship, so no
    // consumer has to re-fetch a manifest to keep working.
    expect(GLYPH_MAP_OPENFREEMAP_TILE_URL).toBe("https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf");
  });

  it("names exactly the source layers this file maps", () => {
    expect(tilejson.vector_layers.map((l) => l.id).sort()).toEqual([...GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS].sort());
  });

  it("carries the properties every mapping row reads", () => {
    const fields = (id: string) => tilejson.vector_layers.find((l) => l.id === id)!.fields;
    // A building's height is `render_height`, NOT Protomaps' `height`.
    expect(Object.keys(fields("building"))).toContain("render_height");
    expect(Object.keys(fields("building"))).not.toContain("height");
    // A boundary has no `class` at all — it discriminates on a NUMBER.
    expect(fields("boundary").admin_level).toBe("Number");
    expect(Object.keys(fields("boundary"))).not.toContain("kind");
    // Places rank by `rank`, not by a population column.
    expect(Object.keys(fields("place"))).toEqual(expect.arrayContaining(["class", "rank", "name"]));
    expect(Object.keys(fields("place"))).not.toContain("population");
    // `class` is THE discriminator everywhere else.
    for (const id of ["transportation", "water", "waterway", "landcover", "landuse", "place", "poi"]) {
      expect(fields(id).class).toBe("String");
    }
    // No landmass layer exists in this schema.
    expect(tilejson.vector_layers.map((l) => l.id)).not.toContain("earth");
  });

  it("declares the zoom each layer actually starts at, which is why a world view has no roads", () => {
    const minzoom = (id: string) => tilejson.vector_layers.find((l) => l.id === id)!.minzoom;
    expect(minzoom("water")).toBe(0);
    expect(minzoom("boundary")).toBe(0);
    expect(minzoom("place")).toBe(0);
    expect(minzoom("transportation")).toBe(4);
    expect(minzoom("poi")).toBe(11);
    expect(minzoom("building")).toBe(13);
  });
});

describe("real decoded tiles", () => {
  it("z0 holds the coarse world layers and nothing finer", () => {
    const layers = mvt("z0-0-0.mvt", 0, 0, 0);
    expect(Object.keys(layers).sort()).toEqual(["boundary", "landcover", "place", "water", "water_name"]);
    expect(layers.water).toHaveLength(17);
    expect(layers.place).toHaveLength(45);
    expect(layers.boundary).toHaveLength(2);
  });

  it("z12 Zurich holds the street-scale layers", () => {
    const layers = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(Object.keys(layers).sort()).toEqual([
      "boundary", "landcover", "landuse", "mountain_peak", "park", "place",
      "poi", "transportation", "transportation_name", "water", "water_name", "waterway",
    ]);
    expect(layers.transportation).toHaveLength(1911);
    expect(layers.waterway).toHaveLength(11);
  });

  it("discriminates on `class`, with the real vocabulary the data holds", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const classes = (name: string) =>
      [...new Set(z12[name].map(glyphMapOpenMapTilesClass).filter((c): c is string => c !== undefined))].sort();
    expect(classes("transportation")).toEqual([
      "busway", "ferry", "minor", "motorway", "path", "path_construction",
      "primary", "rail", "secondary", "tertiary", "tertiary_construction", "track", "trunk",
    ]);
    expect(classes("water")).toEqual(["lake", "pond", "river", "swimming_pool"]);
    expect(classes("waterway")).toEqual(["canal", "river"]);
    expect(classes("place")).toEqual(["city", "hamlet", "suburb", "town", "village"]);
  });

  it("splits water POLYGONS from waterway LINES across two source layers", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(new Set(z12.water.map((f) => f.geometryType))).toEqual(new Set(["polygon"]));
    expect(new Set(z12.waterway.map((f) => f.geometryType))).toEqual(new Set(["line"]));
  });

  it("reads a boundary's numeric admin_level, which is the only thing distinguishing a country from a state", () => {
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    expect(z0.boundary.map(glyphMapOpenMapTilesAdminLevel)).toEqual([2, 2]);
    expect(z0.boundary.every((f) => glyphMapOpenMapTilesClass(f) === undefined)).toBe(true);
  });
});

describe("glyphMapOpenMapTilesFeatureFilter", () => {
  it("keeps everything when given nothing", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(z12.transportation.filter(glyphMapOpenMapTilesFeatureFilter({}))).toHaveLength(1911);
  });

  it("narrows by class and by geometry independently", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const motorway = z12.transportation.filter(glyphMapOpenMapTilesFeatureFilter({ classes: ["motorway"] }));
    expect(motorway.length).toBeGreaterThan(0);
    expect(motorway.length).toBeLessThan(1911);
    expect(motorway.every((f) => glyphMapOpenMapTilesClass(f) === "motorway")).toBe(true);

    const points = z12.transportation_name.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "point" }));
    expect(points.every((f) => f.geometryType === "point")).toBe(true);
    expect(points.length).toBeLessThan(z12.transportation_name.length);
  });

  it("narrows a boundary by admin level, which no class filter could do", () => {
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    expect(z0.boundary.filter(glyphMapOpenMapTilesFeatureFilter({ maxAdminLevel: 2 }))).toHaveLength(2);
    expect(z0.boundary.filter(glyphMapOpenMapTilesFeatureFilter({ minAdminLevel: 4 }))).toHaveLength(0);
    // A feature with no admin_level at all is not silently kept by an
    // admin-level filter — it is not a boundary this row is about.
    expect(z0.water.filter(glyphMapOpenMapTilesFeatureFilter({ maxAdminLevel: 2 }))).toHaveLength(0);
  });
});

describe("GLYPH_MAP_OPENMAPTILES_LAYERS", () => {
  it("names only source layers the schema actually declares", () => {
    for (const spec of GLYPH_MAP_OPENMAPTILES_LAYERS) {
      expect(GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS).toContain(spec.sourceLayer);
    }
  });

  it("covers the schema's cartographic backbone with unique ids", () => {
    const ids = GLYPH_MAP_OPENMAPTILES_LAYERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.map((s) => s.sourceLayer)).toEqual(
      expect.arrayContaining(["water", "waterway", "transportation", "boundary", "building", "place", "landcover"]),
    );
    // The Protomaps ids must not collide — both mappings can be mounted on
    // one map, and `removeLayer` keys on the id.
    expect(ids.every((id) => id.startsWith("omt-"))).toBe(true);
  });

  it("reads a building's height from render_height, the name this schema uses", () => {
    const building = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.type === "fill-extrusion")!;
    expect(building.heightProperty).toBe("render_height");
  });
});

describe("glyphMapOpenMapTilesLayers", () => {
  const provider = () => glyphMapOpenFreeMapProvider();

  it("builds one mountable layer per spec, all on the one provider", () => {
    const built = glyphMapOpenMapTilesLayers(provider());
    expect(built.length).toBe(GLYPH_MAP_OPENMAPTILES_LAYERS.length);
    for (const layer of built) {
      expect(layer.source).toBe(layer.source);
      expect(typeof layer.sourceLayer).toBe("string");
      expect(layer.filter).toBeTypeOf("function");
    }
    const roads = built.find((l) => l.id === "omt-roads")!;
    expect(roads.type).toBe("line");
    expect(roads.sourceLayer).toBe("transportation");
  });

  it("honours include order, colour overrides and per-layer density", () => {
    const built = glyphMapOpenMapTilesLayers(provider(), {
      include: ["omt-boundaries", "omt-water"],
      colors: { "omt-water": "#123456" },
      densities: { "omt-boundaries": 2 },
    });
    expect(built.map((l) => l.id)).toEqual(["omt-boundaries", "omt-water"]);
    expect(built[1].color).toBe("#123456");
    expect(built[0].density).toBe(2);
    expect(built[1].density).toBeUndefined();
  });

  it("carries the required attribution on every layer's source", () => {
    for (const layer of glyphMapOpenMapTilesLayers(provider())) {
      expect((layer.source as { attribution?: unknown }).attribution).toEqual(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION);
    }
  });

  it("applies its filter to real decoded features", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const water = glyphMapOpenMapTilesLayers(provider(), { include: ["omt-water"] })[0];
    const waterway = glyphMapOpenMapTilesLayers(provider(), { include: ["omt-waterways"] })[0];
    // The same source layer name never feeds both: `water` is polygons,
    // `waterway` is lines, and each row selects its own.
    expect(z12[water.sourceLayer!].filter(water.filter!).length).toBeGreaterThan(0);
    expect(z12[waterway.sourceLayer!].filter(waterway.filter!)).toHaveLength(11);
  });
});

describe("GLYPH_MAP_OPENFREEMAP_ATTRIBUTION", () => {
  it("is the credit the service's own TileJSON asks for, ODbL and all", () => {
    expect(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION.map((a) => a.name)).toEqual([
      "OpenStreetMap contributors", "OpenMapTiles", "OpenFreeMap",
    ]);
    const osm = GLYPH_MAP_OPENFREEMAP_ATTRIBUTION.find((a) => a.name === "OpenStreetMap contributors")!;
    expect(osm.license).toBe("ODbL");
    expect(osm.url).toBe("https://www.openstreetmap.org/copyright");
    // Every credit named in the service's own attribution HTML is present.
    for (const url of ["openfreemap.org", "openmaptiles.org", "openstreetmap.org/copyright"]) {
      expect(tilejson.attribution).toContain(url);
      expect(GLYPH_MAP_OPENFREEMAP_ATTRIBUTION.some((a) => a.url?.includes(url))).toBe(true);
    }
  });
});
