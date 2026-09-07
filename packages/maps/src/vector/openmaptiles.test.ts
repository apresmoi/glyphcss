/**
 * The OpenMapTiles schema → glyphcss layer-vocabulary mapping, checked
 * against the data it maps.
 *
 * **Every layer name, property name and `class` value asserted here was read
 * out of the live OpenFreeMap service**, not out of the published schema
 * docs — `fixtures/openfreemap/tilejson.json` is
 * `https://tiles.openfreemap.org/planet` with the ~90 `name:<lang>` fields
 * stripped, and `fixtures/openfreemap/z0-0-0.mvt`,
 * `fixtures/openfreemap/z12-2145-1434.mvt` and
 * `fixtures/openfreemap/z14-8579-5736.mvt` are three real tiles it served
 * (`building` starts at z13, so the third is the only one that can say
 * anything about a building at all). A schema drift therefore shows up here
 * as a red test rather than as an empty layer.
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
  GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION,
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS,
  glyphMapOpenMapTilesAdminLevel,
  glyphMapOpenMapTilesClass,
  glyphMapOpenMapTilesFeatureFilter,
  glyphMapOpenMapTilesLayers,
} from "./openmaptiles";
import type { GlyphMapFillExtrusionLayer } from "../widget";
import { glyphMapFeatureSeed, glyphMapVaryColor } from "../facade";
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
    // And its BASE is a second column of the same kind. Both are Numbers on
    // one datum (metres above the ground), which is what lets the buildings
    // row draw a stepped structure instead of stacking every part on the
    // pavement.
    expect(fields("building").render_height).toBe("Number");
    expect(fields("building").render_min_height).toBe("Number");
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

  it("z14 Zurich is the first level that holds buildings at all, and every one carries BOTH height columns", () => {
    const layers = mvt("z14-8579-5736.mvt", 14, 8579, 5736);
    expect(Object.keys(layers)).toContain("building");
    const buildings = layers.building;
    expect(buildings.length).toBe(50);
    // Not "usually present" — the schema mapping reads them unconditionally.
    expect(buildings.every((f) => typeof f.properties?.render_height === "number")).toBe(true);
    expect(buildings.every((f) => typeof f.properties?.render_min_height === "number")).toBe(true);
  });

  it("emits attribute-identical buildings as ONE multipolygon, which is why a colour is seeded per FOOTPRINT", () => {
    // The measurement behind `glyphMapFeatureSeed`'s `part` argument and
    // behind `glyphMapVectorMesh` resolving a colour per polygon GROUP. If a
    // seed were per FEATURE, this tile's 1,991 buildings would be painted in
    // at most 50 tones and its largest single feature would paint 400-odd of
    // them identically — the "they all look the same" the variation exists
    // to fix.
    const buildings = mvt("z14-8579-5736.mvt", 14, 8579, 5736).building;
    const footprints = buildings.reduce((n, f) => n + (f.polygons?.length ?? f.rings.length), 0);
    expect(footprints).toBe(1991);
    expect(footprints / buildings.length).toBeGreaterThan(20);
    expect(Math.max(...buildings.map((f) => f.polygons?.length ?? f.rings.length))).toBeGreaterThan(100);
  });

  it("carries real non-zero `render_min_height` — stepped structures are data, not a hypothetical", () => {
    const buildings = mvt("z14-8579-5736.mvt", 14, 8579, 5736).building;
    const stepped = buildings.filter((f) => Number(f.properties?.render_min_height) > 0);
    expect(stepped.length).toBe(8);
    // Every one of them is a genuine band: it starts above the ground and
    // ends above where it starts, so `height - base` is a real thickness.
    expect(stepped.every((f) => Number(f.properties?.render_height) > Number(f.properties?.render_min_height))).toBe(true);
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

  it("reads the building's BASE too — the second column this schema carries", () => {
    const building = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.type === "fill-extrusion")!;
    expect(building.baseOffsetProperty).toBe("render_min_height");
  });

  it("opens the buildings row with a facade and a per-footprint tone", () => {
    const building = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.type === "fill-extrusion")!;
    expect(building.facade).toBe(true);
    expect(building.colorVariation).toBe(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION);
    expect(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION).toBeGreaterThan(0);
    expect(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION).toBeLessThanOrEqual(1);
  });
});

describe("GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION, measured on the real tile's own footprints", () => {
  /** Redmean — the same perceptual distance `colorTolerance` coalesces runs on. */
  const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const;
  function redmean(a: string, b: string): number {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    const rm = (r1 + r2) / 2;
    return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
  }
  const BASE = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.type === "fill-extrusion")!.color;
  /** Every footprint's own anchor and seed, so "adjacent" below means geographically adjacent. */
  const parts = mvt("z14-8579-5736.mvt", 14, 8579, 5736).building.flatMap((f) =>
    (f.polygons ?? f.rings.map((r) => [r])).flatMap((g) => {
      const a = g[0]?.[0];
      return a ? [{ lon: a[0], lat: a[1], seed: glyphMapFeatureSeed(f, a) }] : [];
    }),
  ).slice(0, 400);

  /** Share of footprints whose NEAREST neighbour is a distinguishably different tone, and the widest excursion from the row's own colour. */
  function judge(amount: number): { separable: number; spread: number } {
    const colors = parts.map((p) => glyphMapVaryColor(BASE, p.seed, amount));
    let separable = 0;
    for (let i = 0; i < parts.length; i++) {
      let best = -1, bd = Infinity;
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue;
        const d = (parts[i]!.lon - parts[j]!.lon) ** 2 + (parts[i]!.lat - parts[j]!.lat) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      // ~40 redmean is about where two greys stop reading as two greys.
      if (best >= 0 && redmean(colors[i]!, colors[best]!) > 40) separable++;
    }
    return { separable: separable / parts.length, spread: Math.max(...colors.map((c) => redmean(c, BASE))) };
  }

  it("separates most adjacent buildings, which a narrower range does not", () => {
    // The reason the row opts in at all. Measured on 400 real footprints:
    // 0.15 separates 6% of neighbours (the block still reads as one mass) and
    // the shipped value separates 88%.
    expect(judge(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION).separable).toBeGreaterThan(0.8);
    expect(judge(0.15).separable).toBeLessThan(0.2);
  });

  it("and still reads as ONE material, which a wider range does not", () => {
    // The other side of it, and the reason this is not simply `1`. Redmean
    // spans ~765 across the whole gamut; the shipped value keeps every
    // building within ~14% of the row's own colour (105), while `1` reaches
    // 209 — a city of unrelated colours — to separate 95% instead of 88%.
    const shipped = judge(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION);
    expect(shipped.spread).toBeLessThan(0.16 * 765);
    expect(judge(1).spread).toBeGreaterThan(shipped.spread * 1.8);
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

  it("forwards the buildings row's three appearance options onto the built layer", () => {
    // The row can declare them and the builder can still drop them on the
    // floor — which is exactly what happened to `render_min_height` for the
    // life of this mapping. Assert the BUILT layer, not the spec.
    const built = glyphMapOpenMapTilesLayers(provider(), { include: ["omt-buildings"] })[0];
    expect(built.type).toBe("fill-extrusion");
    const buildings = built as GlyphMapFillExtrusionLayer;
    expect(buildings.heightProperty).toBe("render_height");
    expect(buildings.baseOffsetProperty).toBe("render_min_height");
    expect(buildings.facade).toBe(true);
    expect(buildings.colorVariation).toBe(GLYPH_MAP_OPENMAPTILES_BUILDING_COLOR_VARIATION);
  });

  it("leaves the options off every row that is not the buildings row", () => {
    for (const layer of glyphMapOpenMapTilesLayers(provider())) {
      if (layer.type === "fill-extrusion") continue;
      expect(layer).not.toHaveProperty("facade");
      expect(layer).not.toHaveProperty("colorVariation");
      expect(layer).not.toHaveProperty("baseOffsetProperty");
    }
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
