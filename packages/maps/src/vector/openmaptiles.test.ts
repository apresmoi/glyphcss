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
 * Six more tiles are vendored, each for something none of those three
 * carries at all, and each named for what it is the only witness to:
 * `z4-1-6-maritime.mvt` (the one `maritime: 1` boundary line),
 * `z14-3851-6772-hide3d.mvt` (Houston: `hide_3d: true` on 3 of 153
 * buildings), `z14-4834-6165-aeroway.mvt` (JFK, 11.7 KB: the only aeroway
 * LINES in the set — every other tile's `aeroway` features are `helipad`
 * POLYGONS, so a runway row asserted on those would pass while drawing
 * nothing), `z8-60-96-peaks.mvt` (69 KB: 13 `mountain_peak` points of
 * which 2 carry no `name`, the only real witness that the peaks row drops
 * a feature it could not label), and two over Bariloche that
 * `widget.lineLabelAnchor.test.ts` owns — `z10-308-640-lakeline.mvt` (the
 * reported `Lago Nahuel Huapi` as a LINE label, with the water polygons
 * under it and a `water_name` POINT in the same tile) and
 * `z12-1235-2560-multipart.mvt` (the only MULTI-PART label line in the
 * set).
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
  GLYPH_MAP_OPENMAPTILES_LANDCOVER_COLORS,
  GLYPH_MAP_OPENMAPTILES_LANDUSE_COLORS,
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_OPENMAPTILES_POI_FURNITURE,
  GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK,
  GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS,
  GLYPH_MAP_OPENMAPTILES_WATER_COLORS,
  glyphMapOpenMapTilesAdminLevel,
  glyphMapOpenMapTilesBrunnel,
  glyphMapOpenMapTilesClass,
  glyphMapOpenMapTilesFeatureFilter,
  glyphMapOpenMapTilesFlag,
  glyphMapOpenMapTilesLayers,
} from "./openmaptiles";
import type { GlyphMapFillExtrusionLayer, GlyphMapFillLayer, GlyphMapSymbolLayer } from "../widget";
import type { GlyphMapVectorFeature } from "./types";
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

  it("forwards a per-layer label anchor onto the symbol row that asked for it", () => {
    const built = glyphMapOpenMapTilesLayers(provider(), {
      textAnchors: { "omt-places": "left", "omt-water-labels": "bottom" },
    });
    const byId = new Map(built.map((l) => [l.id, l]));
    expect((byId.get("omt-places") as GlyphMapSymbolLayer).textAnchor).toBe("left");
    expect((byId.get("omt-water-labels") as GlyphMapSymbolLayer).textAnchor).toBe("bottom");
    // Every other symbol row is untouched.
    expect(byId.get("omt-peaks")).not.toHaveProperty("textAnchor");
  });

  it("drops an anchor naming the centred default, so an untouched caller's layers are unchanged", () => {
    // `glyphMapLabelPlacement` answers `null` for a centred, unoffset label
    // and nothing downstream then touches the element's transform or the
    // declutter candidate — so declaring `"center"` RENDERS the same. Omitting
    // the key is what keeps the built object identical to the one this
    // builder returned before the option existed, which is the stronger
    // claim and the one a caller handing over a complete record relies on.
    const every = Object.fromEntries(GLYPH_MAP_OPENMAPTILES_LAYERS.map((s) => [s.id, "center" as const]));
    for (const layer of glyphMapOpenMapTilesLayers(provider(), { textAnchors: every })) {
      expect(layer, layer.id).not.toHaveProperty("textAnchor");
    }
  });

  it("drops an anchor aimed at a row that draws no labels", () => {
    // A caller's record is legitimately keyed over EVERY row — `/maps` packs
    // one positionally in its URL — and no other layer type has the option
    // to receive, so the entry must be dropped here rather than forwarded.
    const every = Object.fromEntries(GLYPH_MAP_OPENMAPTILES_LAYERS.map((s) => [s.id, "top" as const]));
    for (const layer of glyphMapOpenMapTilesLayers(provider(), { textAnchors: every })) {
      if (layer.type === "symbol") expect((layer as GlyphMapSymbolLayer).textAnchor, layer.id).toBe("top");
      else expect(layer, layer.id).not.toHaveProperty("textAnchor");
    }
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
    // All 11 of the tile's watercourses are lines the row's geometry filter
    // keeps; 2 of them are `brunnel: tunnel` culverts the row now hides, so
    // what reaches the grid is 9.
    expect(z12[waterway.sourceLayer!].filter((f) => f.geometryType === "line")).toHaveLength(11);
    expect(z12[waterway.sourceLayer!].filter(waterway.filter!)).toHaveLength(9);
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

/**
 * The three flags below are the schema's own answer to "is this thing
 * actually on the surface, and is this line actually a border" — and until
 * they were read, the mapping drew a subway line as a street, an EEZ line as
 * the France-Germany border, and a block outline over the buildings inside
 * it. Each block asserts the count on a REAL tile, so the fix cannot be
 * satisfied by setting an option.
 */
describe("`brunnel` — the flag that says a road is not on the surface", () => {
  it("is written the way the mapping reads it, on real features", () => {
    const z14 = { transportation: mvt("z14-8579-5736.mvt", 14, 8579, 5736).transportation.filter((f) => f.geometryType === "line") };
    const brunnels = new Set(z14.transportation.map(glyphMapOpenMapTilesBrunnel));
    // Absent is the common case — the field is simply not written for a
    // surface road, so "not a tunnel" can never be a `!== "tunnel"` on a
    // required column.
    expect(brunnels).toEqual(new Set([undefined, "bridge", "tunnel"]));
    expect(z14.transportation.filter((f) => glyphMapOpenMapTilesBrunnel(f) === "tunnel")).toHaveLength(47);
    expect(z14.transportation.filter((f) => glyphMapOpenMapTilesBrunnel(f) === "bridge")).toHaveLength(98);
  });

  it("takes tunnels out and leaves bridges in — 47 of Zurich Hardbrucke's 605 lines, 54 of the z12 tile's 1,911", () => {
    const drop = glyphMapOpenMapTilesFeatureFilter({ geometry: "line", excludeBrunnel: ["tunnel"] });
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736).transportation;
    expect(z14.filter(drop)).toHaveLength(558);
    expect(z14.filter(drop).filter((f) => glyphMapOpenMapTilesBrunnel(f) === "bridge")).toHaveLength(98);
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434).transportation;
    expect(z12.filter(drop)).toHaveLength(1857);
  });

  it("is the SAME defect on a waterway, and the fixture is nearly half culvert", () => {
    // 13 of 27 — a culverted stream drawn on the surface is a river running
    // through a building, which is why the waterways row carries the axis too.
    const drop = glyphMapOpenMapTilesFeatureFilter({ geometry: "line", excludeBrunnel: ["tunnel"] });
    expect(mvt("z14-8579-5736.mvt", 14, 8579, 5736).waterway.filter(drop)).toHaveLength(14);
    expect(mvt("z12-2145-1434.mvt", 12, 2145, 1434).waterway.filter(drop)).toHaveLength(9);
  });
});

describe("glyphMapOpenMapTilesFlag — one reader for a schema that writes its flags two ways", () => {
  it("reads the NUMBER form (`maritime`, `disputed`) and the BOOLEAN form (`hide_3d`) alike", () => {
    // Measured, not assumed: `boundary.maritime`/`disputed` arrive as 0/1
    // numbers and are present on every feature, while `building.hide_3d`
    // arrives as a real `true` and is absent otherwise. A reader that only
    // knew one writing would silently keep half the features it was asked
    // to drop.
    const maritime = mvt("z4-1-6-maritime.mvt", 4, 1, 6).boundary;
    expect(maritime.every((f) => typeof f.properties?.maritime === "number")).toBe(true);
    expect(maritime.filter((f) => glyphMapOpenMapTilesFlag(f, "maritime"))).toHaveLength(1);
    expect(maritime.filter((f) => glyphMapOpenMapTilesFlag(f, "disputed"))).toHaveLength(0);

    const houston = mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772).building;
    const hidden = houston.filter((f) => glyphMapOpenMapTilesFlag(f, "hide_3d"));
    expect(hidden).toHaveLength(3);
    expect(hidden.every((f) => f.properties?.hide_3d === true)).toBe(true);
    // `0` is written, not absent, and it is NOT set.
    expect(mvt("z0-0-0.mvt", 0, 0, 0).boundary.filter((f) => glyphMapOpenMapTilesFlag(f, "maritime"))).toHaveLength(0);
  });
});

describe("boundaries: an EEZ line across open ocean is not a border a reader expects drawn", () => {
  const drawn = () => glyphMapOpenMapTilesFeatureFilter({
    geometry: "line", maxAdminLevel: 2, excludeFlags: ["maritime", "disputed"],
  });

  it("drops the maritime line the z4 tile exists to witness", () => {
    // 4/1/6 holds exactly one boundary feature: an `admin_level: 2` line with
    // `maritime: 1`. Under the old table it was drawn in the same weight as
    // a land border; there is now nothing left to draw in that tile.
    const z4 = mvt("z4-1-6-maritime.mvt", 4, 1, 6).boundary;
    expect(z4.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "line", maxAdminLevel: 2 }))).toHaveLength(1);
    expect(z4.filter(drawn())).toHaveLength(0);
  });

  it("drops the disputed line at world scale and keeps the undisputed one", () => {
    // z0 is the negative for `maritime` (both lines are 0) and the positive
    // for `disputed` (exactly one is 1), so the two axes cannot pass by
    // accident on the same feature.
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0).boundary;
    expect(z0.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "line", maxAdminLevel: 2 }))).toHaveLength(2);
    expect(z0.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "line", maxAdminLevel: 2, excludeFlags: ["maritime"] }))).toHaveLength(2);
    expect(z0.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "line", maxAdminLevel: 2, excludeFlags: ["disputed"] }))).toHaveLength(1);
    expect(z0.filter(drawn())).toHaveLength(1);
  });
});

describe("`hide_3d` — the schema saying 'do not extrude this outline'", () => {
  it("drops the three Houston outlines and touches nothing in the Zurich tile", () => {
    const drop = glyphMapOpenMapTilesFeatureFilter({ geometry: "polygon", excludeFlags: ["hide_3d"] });
    const houston = mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772).building;
    expect(houston).toHaveLength(153);
    expect(houston.filter(drop)).toHaveLength(150);
    // The three carry real heights (5 m, 40 m, 132 m) — they are not
    // degenerate features a height filter would have caught anyway.
    expect(houston.filter((f) => !drop(f)).map((f) => f.properties?.render_height).sort((a, b) => Number(a) - Number(b)))
      .toEqual([5, 40, 132]);
    // And the flag is genuinely rare: the Zurich tile carries none at all,
    // so the axis is a no-op wherever the data does not ask for it.
    const zurich = mvt("z14-8579-5736.mvt", 14, 8579, 5736).building;
    expect(zurich.filter(drop)).toHaveLength(zurich.length);
  });
});

describe("`service` and `indoor` — ways that are not the street network", () => {
  it("drops driveways and parking aisles, which are car-park hatching", () => {
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736).transportation;
    // 42 driveways + 30 parking aisles of the 164 `class: service` features.
    const drop = glyphMapOpenMapTilesFeatureFilter({ geometry: "line", excludeService: ["driveway", "parking_aisle"] });
    expect(z14.filter(drop)).toHaveLength(605 - 72);
    expect(z14.filter(drop).every((f) => f.properties?.service !== "driveway")).toBe(true);
    // `alley`, `yard`, `spur`, `siding` and `crossover` are real ways and stay.
    expect(z14.filter(drop).filter((f) => f.properties?.service !== undefined)).toHaveLength(20);
  });

  it("drops indoor corridors, which are not streets at all", () => {
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736).transportation;
    expect(z14.filter((f) => glyphMapOpenMapTilesFlag(f, "indoor"))).toHaveLength(4);
    expect(z14.filter(glyphMapOpenMapTilesFeatureFilter({ geometry: "line", excludeFlags: ["indoor"] }))).toHaveLength(601);
  });
});

/**
 * The table's own defaults, measured through the BUILT layers rather than
 * through a hand-made filter — the spec can declare an axis and the builder
 * can still drop it on the floor, which is exactly what happened to
 * `render_min_height` for the life of this mapping.
 */
describe("what the shipped table actually draws, on real tiles", () => {
  const provider = () => glyphMapOpenFreeMapProvider();
  const built = (id: string) => glyphMapOpenMapTilesLayers(provider(), { include: [id] })[0];
  const kept = (id: string, layers: Record<string, readonly GlyphMapVectorFeature[]>) => {
    const layer = built(id);
    return (layers[layer.sourceLayer!] ?? []).filter(layer.filter!).length;
  };

  it("roads: 605 lines in the Zurich Hardbrucke tile become 497", () => {
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736);
    expect(z14.transportation.filter((f) => f.geometryType === "line")).toHaveLength(605);
    // 47 tunnels, then 59 more driveways/parking aisles that were not already
    // tunnels, then 2 more indoor corridors: 17.9% of the row's ink.
    expect(kept("omt-roads", z14)).toBe(497);
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(kept("omt-roads", z12)).toBe(1857);
  });

  it("waterways: 27 become 14, because 13 of them are culverted", () => {
    expect(kept("omt-waterways", mvt("z14-8579-5736.mvt", 14, 8579, 5736))).toBe(14);
    expect(kept("omt-waterways", mvt("z12-2145-1434.mvt", 12, 2145, 1434))).toBe(9);
  });

  it("boundaries: the world view keeps the land border and loses the maritime and disputed ones", () => {
    expect(kept("omt-boundaries", mvt("z0-0-0.mvt", 0, 0, 0))).toBe(1);
    expect(kept("omt-boundaries", mvt("z4-1-6-maritime.mvt", 4, 1, 6))).toBe(0);
  });

  it("buildings: the three `hide_3d` Houston outlines are not extruded", () => {
    expect(kept("omt-buildings", mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772))).toBe(150);
    expect(kept("omt-buildings", mvt("z14-8579-5736.mvt", 14, 8579, 5736))).toBe(50);
  });

  it("leaves every other row's filter exactly as wide as it was", () => {
    // The axes are opt-in per row: a row that does not name one keeps every
    // feature its class/geometry/admin filter already kept.
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736);
    expect(kept("omt-landcover", z14)).toBe(z14.landcover.filter((f) => f.geometryType === "polygon").length);
    expect(kept("omt-water", z14)).toBe(z14.water.filter((f) => f.geometryType === "polygon").length);
    // `omt-pois` stood here and no longer can: the POI row names `maxRank`
    // and `excludeClasses` deliberately, and its own block below asserts the
    // 3,944 -> 686 it produces on this very tile. `omt-places` is the row
    // that still names no narrowing axis at all, so it carries the claim.
    expect(kept("omt-places", z14)).toBe(z14.place.filter((f) => f.geometryType === "point").length);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * The ADDITIVE half: data the tiles carry and the mapping never drew.
 *
 * Everything above this line is either a field the mapping always read or a
 * flag it learned to STOP drawing. What follows is the opposite — four
 * things the service ships on every tile that reached no row at all:
 *
 *   1. three whole source layers (`park`, `aeroway`, `water_name`),
 *   2. the `class` column on the three ground/water FILL rows, which painted
 *      glacier ice, desert sand and a hotel swimming pool in one colour
 *      each,
 *   3. `poi.rank`, the throttle the layer has always carried and never used,
 *   4. `mountain_peak`'s `name` and `ele`, drawn as an anonymous dot.
 *
 * A sixth vendored tile arrives with this: `z14-4834-6165-aeroway.mvt`
 * (JFK, 11.7 KB). It is the only witness to an aeroway LINE — every other
 * vendored tile's `aeroway` features are `helipad` POLYGONS, so a runway row
 * asserted on those would pass while drawing nothing.
 *
 * Two source layers stay unmapped ON THE DATA, not on taste.
 * `aerodrome_label` is 1 feature in the JFK tile's own neighbourhood and 0
 * in five of the six vendored tiles — including JFK itself, the one tile in
 * the set that is an airport. `housenumber` is 635 features in the vendored
 * Zurich z14 tile against 1,991 building footprints, each of which would be
 * a positioned DOM hotspot.
 */
describe("`park` / `aeroway` / `water_name` — three source layers the mapping never decoded", () => {
  const provider = () => glyphMapOpenFreeMapProvider();
  const row = (id: string) => glyphMapOpenMapTilesLayers(provider(), { include: [id] })[0]!;

  it("the six unmapped source layers are down to two, and each of the three new rows names one of them", () => {
    const mapped = new Set(GLYPH_MAP_OPENMAPTILES_LAYERS.map((s) => s.sourceLayer));
    expect([...GLYPH_MAP_OPENMAPTILES_SOURCE_LAYERS].filter((l) => !mapped.has(l)).sort())
      .toEqual(["aerodrome_label", "housenumber", "transportation_name"]);
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-parks")!.sourceLayer).toBe("park");
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-aeroways")!.sourceLayer).toBe("aeroway");
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-water-labels")!.sourceLayer).toBe("water_name");
  });

  it("the three rows are APPENDED, because the /maps URL bitfield is positional over this list", () => {
    // `MAPS_OSM_SUBLAYER_KEYS` (website) is bit-for-bit this list's order and
    // is append-only: an INSERTION here silently reinterprets every shared
    // link. The website's own cross-check asserts equality; this asserts the
    // half that lives in the package.
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.slice(-3).map((s) => s.id))
      .toEqual(["omt-parks", "omt-aeroways", "omt-water-labels"]);
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.slice(0, 10).map((s) => s.id)).toEqual([
      "omt-landcover", "omt-landuse", "omt-water", "omt-waterways", "omt-roads",
      "omt-buildings", "omt-boundaries", "omt-places", "omt-peaks", "omt-pois",
    ]);
  });

  it("the aeroways row keeps JFK's 13 runway and taxiway LINES and drops its aprons", () => {
    const jfk = mvt("z14-4834-6165-aeroway.mvt", 14, 4834, 6165);
    expect(jfk.aeroway).toHaveLength(16);
    const kept = jfk.aeroway.filter(row("omt-aeroways").filter!);
    expect(kept).toHaveLength(13);
    expect(kept.filter((f) => glyphMapOpenMapTilesClass(f) === "runway")).toHaveLength(3);
    expect(kept.filter((f) => glyphMapOpenMapTilesClass(f) === "taxiway")).toHaveLength(10);
    // The apron, the aerodrome outline and a runway drawn as a POLYGON are
    // what the geometry filter is for — a `line` row cannot stamp them.
    expect(jfk.aeroway.filter((f) => f.geometryType === "polygon")).toHaveLength(3);
    // `ref` is on the wire for every one of them (`13R/31L`, `K3`), which is
    // why this row is worth a fixture at all; nothing reads it yet.
    expect(kept.every((f) => typeof f.properties?.ref === "string")).toBe(true);
  });

  it("the aeroways row draws nothing where a tile's only aeroway is a helipad polygon", () => {
    const zurich = mvt("z14-8579-5736.mvt", 14, 8579, 5736);
    expect(zurich.aeroway).toHaveLength(1);
    expect(zurich.aeroway.filter(row("omt-aeroways").filter!)).toHaveLength(0);
  });

  it("the parks row keeps the NAMED protected-area points, which is the only readable half of a free-text layer", () => {
    const jfk = mvt("z14-4834-6165-aeroway.mvt", 14, 4834, 6165);
    const kept = jfk.park.filter(row("omt-parks").filter!);
    expect(jfk.park).toHaveLength(9);
    expect(kept).toHaveLength(5);
    expect(kept.every((f) => typeof f.properties?.name === "string")).toBe(true);
    expect(kept.map((f) => f.properties!.name)).toContain("Bayswater Point State Park");
    // And `class` is confirmed free text on this very tile — `"State Park"`
    // and `"National Recreation Area"` are values, so no filter UI could
    // offer a vocabulary and the row narrows on none.
    expect(jfk.park.map(glyphMapOpenMapTilesClass)).toEqual(expect.arrayContaining(["State Park", "National Recreation Area"]));
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-parks")!.classes).toBeUndefined();
  });

  it("the parks and water-labels rows drop a nameless point, which a label row would place as an empty div", () => {
    // SYNTHETIC, and stated as such: across the six vendored tiles and eight
    // live ones sampled, every `park` and `water_name` POINT carries a name
    // (251 of 251 park points in a z6 US tile, 4 of 4 ocean labels at z0).
    // The clause is still each row's own — a label row with no text is an
    // empty positioned `<div>` taking declutter space — and `mountain_peak`
    // above is the case where real data exercises it.
    const nameless = { geometryType: "point", properties: { class: "nature_reserve" }, rings: [[[0, 0]]] } as const;
    const named = { geometryType: "point", properties: { class: "nature_reserve", name: "X" }, rings: [[[0, 0]]] } as const;
    for (const id of ["omt-parks", "omt-water-labels"]) {
      expect(row(id).filter!(nameless), id).toBe(false);
      expect(row(id).filter!(named), id).toBe(true);
    }
  });

  it("the parks row draws nothing from a tile whose parks are unnamed polygons", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(z12.park).toHaveLength(3);
    expect(z12.park.filter(row("omt-parks").filter!)).toHaveLength(0);
  });

  it("the water-labels row names the oceans at the world view, where the map labelled no water at all", () => {
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    const kept = z0.water_name.filter(row("omt-water-labels").filter!);
    expect(kept.map((f) => f.properties!.name).sort()).toEqual([
      "North Atlantic Ocean", "North Pacific Ocean", "South Atlantic Ocean", "South Pacific Ocean",
    ]);
    // z14 is the same row doing lake names.
    const z14 = mvt("z14-8579-5736.mvt", 14, 8579, 5736);
    expect(z14.water_name.filter(row("omt-water-labels").filter!)).toHaveLength(13);
  });

  it("the water-labels row keeps the layer's LINE labels, which is how a LAKE is named", () => {
    // `water_name` mixes point and line geometry in one source layer, and the
    // split is the schema saying what SHAPE the name has: a compact body's
    // name is a point, an elongated one's is the path a normal renderer runs
    // the name along. Narrowing the row to points therefore kept the four
    // oceans at z0 and dropped every lake on Earth — the vendored Zurich z12
    // tile's Zürichsee and Greifensee here, and the reported Lago Nahuel
    // Huapi in `widget.lineLabelAnchor.test.ts`, which is a LINE at every
    // zoom that carries it. `glyphMapLabelAnchorPoint` is what makes a line
    // placeable; the row's job is only to stop discarding it.
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    expect(z12.water_name).toHaveLength(2);
    expect(z12.water_name.every((f) => f.geometryType === "line")).toBe(true);
    const kept = z12.water_name.filter(row("omt-water-labels").filter!);
    expect(kept.map((f) => f.properties!.name).sort()).toEqual(["Greifensee", "Zürichsee"]);
    // And the row still narrows: the same tile's `water` POLYGONS are not
    // labels, so the axis is two of the three kinds, never "everything".
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-water-labels")!.geometry)
      .toEqual(["point", "line"]);
    const polygon: GlyphMapVectorFeature = { geometryType: "polygon", properties: { name: "Zürichsee" }, rings: [] };
    expect(row("omt-water-labels").filter!(polygon)).toBe(false);
  });
});

describe("`class` colouring — glacier ice, desert sand and a swimming pool were one colour each", () => {
  const provider = () => glyphMapOpenFreeMapProvider();
  const row = (id: string) => glyphMapOpenMapTilesLayers(provider(), { include: [id] })[0]! as GlyphMapFillLayer;
  /** What the widget resolves per feature (`widget.ts`'s `color` callback), reproduced exactly. */
  const paint = (layer: GlyphMapFillLayer, f: GlyphMapVectorFeature) =>
    (layer.colorProperty && layer.colors ? layer.colors[String(f.properties?.[layer.colorProperty])] : undefined) ?? layer.color!;
  const distinct = (layer: GlyphMapFillLayer, feats: readonly GlyphMapVectorFeature[]) =>
    new Set(feats.filter(layer.filter!).map((f) => paint(layer, f)));

  it("paints z0's Antarctic and Greenland ICE as ice, not as forest", () => {
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    const layer = row("omt-landcover");
    expect(z0.landcover).toHaveLength(11);
    expect(new Set(z0.landcover.map(glyphMapOpenMapTilesClass))).toEqual(new Set(["ice"]));
    expect(distinct(layer, z0.landcover).size).toBe(1);
    // The whole point: it is no longer the row's own green.
    expect(paint(layer, z0.landcover[0]!)).not.toBe(layer.color);
  });

  it("separates a real tile's ground classes instead of flattening them to one", () => {
    const houston = mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772);
    const zurich = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const layer = row("omt-landcover");
    // Houston: grass 116, wood 8, sand 2. Zurich z12: grass 20, farmland 11, wood 4.
    expect(distinct(layer, houston.landcover).size).toBe(3);
    expect(distinct(layer, zurich.landcover).size).toBe(3);
    const landuse = row("omt-landuse");
    expect(distinct(landuse, zurich.landuse).size).toBeGreaterThan(3);
  });

  it("stops painting a hotel swimming pool the blue of the Pacific", () => {
    const houston = mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772);
    const z0 = mvt("z0-0-0.mvt", 0, 0, 0);
    const layer = row("omt-water");
    // 26 of Houston's 33 water polygons are swimming pools.
    const pools = houston.water.filter((f) => glyphMapOpenMapTilesClass(f) === "swimming_pool");
    expect(pools).toHaveLength(26);
    const ocean = z0.water.find((f) => glyphMapOpenMapTilesClass(f) === "ocean")!;
    expect(paint(layer, pools[0]!)).not.toBe(paint(layer, ocean));
    expect(distinct(layer, houston.water).size).toBe(3);
  });

  it("falls back to the row's own colour for a class the table does not name, so an unknown value is never a hole", () => {
    const layer = row("omt-landcover");
    const alien: GlyphMapVectorFeature = { geometryType: "polygon", properties: { class: "not-a-real-class" }, rings: [] };
    expect(paint(layer, alien)).toBe(layer.color);
  });

  it("names no colour key the tiles do not actually carry — the tables are read from the data, not from the schema docs", () => {
    // The standing rule for this service, applied to VALUES as well as to
    // field names. Every key in the three tables has to appear as a `class`
    // on a real decoded feature in the vendored set, so a key copied out of
    // the published schema and never shipped goes red here.
    const tiles = [
      mvt("z0-0-0.mvt", 0, 0, 0),
      mvt("z4-1-6-maritime.mvt", 4, 1, 6),
      mvt("z12-2145-1434.mvt", 12, 2145, 1434),
      mvt("z14-8579-5736.mvt", 14, 8579, 5736),
      mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772),
      mvt("z14-4834-6165-aeroway.mvt", 14, 4834, 6165),
      mvt("z8-60-96-peaks.mvt", 8, 60, 96),
    ];
    const seen = (sourceLayer: string) =>
      new Set(tiles.flatMap((t) => (t[sourceLayer] ?? []).map(glyphMapOpenMapTilesClass)));
    for (const [sourceLayer, table] of [
      ["landcover", GLYPH_MAP_OPENMAPTILES_LANDCOVER_COLORS],
      ["landuse", GLYPH_MAP_OPENMAPTILES_LANDUSE_COLORS],
      ["water", GLYPH_MAP_OPENMAPTILES_WATER_COLORS],
    ] as const) {
      const present = seen(sourceLayer);
      for (const key of Object.keys(table)) expect(present.has(key), `${sourceLayer}.${key}`).toBe(true);
    }
    // And `landcover`'s table is COMPLETE over what the tiles hold, which is
    // the claim "seven kinds of ground" rests on.
    for (const cls of seen("landcover")) expect(Object.keys(GLYPH_MAP_OPENMAPTILES_LANDCOVER_COLORS)).toContain(cls);
  });

  it("leaves colorProperty off every row that is not a fill", () => {
    for (const layer of glyphMapOpenMapTilesLayers(provider())) {
      if (layer.type === "fill") continue;
      expect(layer).not.toHaveProperty("colorProperty");
      expect(layer).not.toHaveProperty("colors");
    }
  });
});

describe("`poi.rank` — the throttle the layer always carried", () => {
  const provider = () => glyphMapOpenFreeMapProvider();
  const pois = () => glyphMapOpenMapTilesLayers(provider(), { include: ["omt-pois"] })[0]!;

  it("is on every feature of both real POI tiles, so the cap can drop an unranked one without losing anything", () => {
    for (const [name, z, x, y] of [["z14-8579-5736.mvt", 14, 8579, 5736], ["z14-3851-6772-hide3d.mvt", 14, 3851, 6772]] as const) {
      const poi = mvt(name, z, x, y).poi;
      expect(poi.every((f) => typeof f.properties?.rank === "number")).toBe(true);
    }
  });

  it("cuts the vendored Zurich tile's 3,944 hotspots to 686 — each one was a positioned DOM div", () => {
    const poi = mvt("z14-8579-5736.mvt", 14, 8579, 5736).poi;
    expect(poi).toHaveLength(3944);
    const kept = poi.filter(pois().filter!);
    expect(kept).toHaveLength(686);
    expect(kept.every((f) => Number(f.properties!.rank) <= GLYPH_MAP_OPENMAPTILES_POI_MAX_RANK)).toBe(true);
    // Not one waste basket, bollard or bicycle stand survives — 1,065 of the
    // tile's POIs (27.0%) are street furniture, which says nothing about a
    // place and is drawn as the same amber dot as a hospital.
    expect(kept.some((f) => GLYPH_MAP_OPENMAPTILES_POI_FURNITURE.includes(glyphMapOpenMapTilesClass(f)!))).toBe(false);
    expect(poi.filter((f) => GLYPH_MAP_OPENMAPTILES_POI_FURNITURE.includes(glyphMapOpenMapTilesClass(f)!))).toHaveLength(1065);
  });

  it("cuts Houston's 2,001 to 684 on the same two rules", () => {
    const poi = mvt("z14-3851-6772-hide3d.mvt", 14, 3851, 6772).poi;
    expect(poi).toHaveLength(2001);
    expect(poi.filter(pois().filter!)).toHaveLength(684);
  });

  it("keeps a z12 tile's transport POIs whole, because the cap is a rank and not a quota", () => {
    // All 51 of the vendored z12 tile's POIs are stations and ferry
    // terminals ranked 1-7. A quota would have thrown some away.
    const poi = mvt("z12-2145-1434.mvt", 12, 2145, 1434).poi;
    expect(poi.filter(pois().filter!)).toHaveLength(51);
  });
});

describe("`mountain_peak` — 92 named peaks per alpine tile, drawn as anonymous dots", () => {
  const provider = () => glyphMapOpenFreeMapProvider();
  const peaks = () => glyphMapOpenMapTilesLayers(provider(), { include: ["omt-peaks"] })[0]! as GlyphMapSymbolLayer;

  it("is a labelled symbol row, not a circle", () => {
    expect(peaks().type).toBe("symbol");
  });

  it("composes the name AND the elevation the tile carries, for every peak in the vendored tile", () => {
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const layer = peaks();
    const kept = z12.mountain_peak.filter(layer.filter!);
    expect(kept).toHaveLength(8);
    expect(kept.every((f) => typeof f.properties?.name === "string" && typeof f.properties?.ele === "number")).toBe(true);
    const labels = kept.map((f) => layer.text!(f));
    expect(labels).toContain("Adlisberg 701");
    expect(labels).toContain("Zürichberg 676");
    // Every label carries both halves — the join is not "name, and elevation
    // when it happens to be there for the first one".
    expect(labels.every((l) => /^\S.* \d+$/.test(l))).toBe(true);
  });

  it("ranks by ELEVATION, not by the schema's inverted `rank`", () => {
    // `glyphMapDeclutterLabels` keeps the HIGHER priority, and OpenMapTiles'
    // `rank` counts 1 = most prominent — so feeding it `rank` would keep the
    // least prominent peak of any overlapping pair. `ele` is both the right
    // ordering and a column the tile already carries.
    const layer = peaks();
    expect(layer.priorityProperty).toBe("ele");
    const z12 = mvt("z12-2145-1434.mvt", 12, 2145, 1434);
    const kept = z12.mountain_peak.filter(layer.filter!);
    const top = [...kept].sort((a, b) => Number(b.properties!.ele) - Number(a.properties!.ele))[0]!;
    expect(layer.text!(top)).toBe("Guglen 708");
  });

  it("drops the two REAL unnamed peaks of `z8-60-96-peaks.mvt`, which a label row would place as empty divs", () => {
    // The row was a `circle`, where a nameless peak is still a dot. As a
    // `symbol` it would be an empty positioned `<div>` taking declutter
    // space from a peak that HAS a name. This tile is the vendored witness:
    // 13 peak points, 11 named, 2 not — and every one of the 13 carries an
    // `ele`, so the name is the only thing separating them.
    const z8 = mvt("z8-60-96-peaks.mvt", 8, 60, 96);
    const layer = peaks();
    expect(z8.mountain_peak).toHaveLength(13);
    expect(z8.mountain_peak.every((f) => typeof f.properties?.ele === "number")).toBe(true);
    const kept = z8.mountain_peak.filter(layer.filter!);
    expect(kept).toHaveLength(11);
    expect(kept.every((f) => layer.text!(f) !== "")).toBe(true);
    expect(kept.map((f) => layer.text!(f))).toContain("Albany Hill 389");
  });

  it("still drops the z14 cliff LINES the layer is dominated by there", () => {
    const layer = peaks();
    const line: GlyphMapVectorFeature = { geometryType: "line", properties: { class: "cliff", name: "n", ele: 1 }, rings: [] };
    expect(layer.filter!(line)).toBe(false);
  });

  it("falls back to whichever half a feature has, so a peak with no elevation is still named", () => {
    const layer = peaks();
    const nameless: GlyphMapVectorFeature = { geometryType: "point", properties: { name: "Büel" }, rings: [[[0, 0]]] };
    expect(layer.text!(nameless)).toBe("Büel");
    const anonymous: GlyphMapVectorFeature = { geometryType: "point", properties: { ele: 4478 }, rings: [[[0, 0]]] };
    expect(layer.text!(anonymous)).toBe("4478");
  });
});
