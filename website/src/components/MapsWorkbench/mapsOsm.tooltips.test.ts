import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GLYPH_MAP_OPENMAPTILES_LAYERS, glyphMapOpenMapTilesLayers } from "@glyphcss/maps";
import type { GlyphMapVectorFeature, GlyphMapVectorSource } from "@glyphcss/maps";
import {
  MAP_OSM_ROW_SUMMARIES,
  MAP_OSM_SOURCE_MIN_ZOOM,
  MAP_OSM_SUBLAYERS,
  mapOsmScaleNote,
  mapOsmSublayerTooltip,
} from "./mapsOsm";

/**
 * The OSM card's per-row tooltips.
 *
 * A tooltip here makes three claims and each has a different owner, so each
 * is checked against its own source rather than against the prose:
 *
 *  1. **What the row is** is the one hand-written half, so what is asserted is
 *     that it EXISTS for every row `@glyphcss/maps` declares. A row appended
 *     to `GLYPH_MAP_OPENMAPTILES_LAYERS` — which has happened twice already —
 *     turns this file red instead of shipping a row a reader cannot ask about.
 *  2. **When it appears** comes from the vendored OpenFreeMap manifest, which
 *     this file re-reads. Nothing is taken from memory: the fixture IS the
 *     service's own `tilejson.json`.
 *  3. **What it drops** is derived from the row's filter axes, so this file
 *     runs the row's REAL filter — the one `glyphMapOpenMapTilesLayers` builds
 *     and the widget mounts — over features shaped like the ones the tooltip
 *     is talking about, and requires the two to agree.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILEJSON = path.resolve(__dirname, "../../../../packages/maps/fixtures/openfreemap/tilejson.json");

interface TileJson {
  readonly vector_layers: readonly { readonly id: string; readonly minzoom?: number }[];
}

const manifest = JSON.parse(readFileSync(TILEJSON, "utf8")) as TileJson;

/** The row filter the widget actually mounts, pulled back out of the built layer. */
function filterFor(id: string): (feature: GlyphMapVectorFeature) => boolean {
  const source = { kind: "collection" } as unknown as GlyphMapVectorSource;
  const built = glyphMapOpenMapTilesLayers(source, { include: [id] });
  expect(built).toHaveLength(1);
  const filter = built[0].filter;
  expect(filter).toBeTypeOf("function");
  return filter as (feature: GlyphMapVectorFeature) => boolean;
}

function feature(
  properties: Record<string, unknown>,
  geometryType: "point" | "line" | "polygon",
): GlyphMapVectorFeature {
  return { properties, geometryType } as unknown as GlyphMapVectorFeature;
}

describe("mapsOsm — every OSM row can say what it is", () => {
  it("has a summary for every row the package declares", () => {
    for (const row of MAP_OSM_SUBLAYERS) {
      expect(MAP_OSM_ROW_SUMMARIES[row.id], `no summary for row ${row.id} (${row.label})`).toBeTruthy();
    }
  });

  it("builds a non-empty tooltip for every row, and none of them just repeats the label", () => {
    for (const row of MAP_OSM_SUBLAYERS) {
      const tip = mapOsmSublayerTooltip(row.id);
      expect(tip, row.id).toBeTruthy();
      expect(tip!.length, row.id).toBeGreaterThan(row.label.length + 20);
      expect(tip!.startsWith(MAP_OSM_ROW_SUMMARIES[row.id]), row.id).toBe(true);
    }
  });

  it("carries no summary for a row that does not exist, rather than inventing one", () => {
    expect(mapOsmSublayerTooltip("omt-not-a-row")).toBeNull();
  });
});

describe("mapsOsm — when a row appears is read off the real manifest", () => {
  it("matches the vendored OpenFreeMap tilejson layer for layer", () => {
    const fromManifest = new Map(manifest.vector_layers.map((l) => [l.id, l.minzoom ?? 0]));
    expect(fromManifest.size).toBeGreaterThan(0);
    for (const [id, minZoom] of Object.entries(MAP_OSM_SOURCE_MIN_ZOOM)) {
      expect(fromManifest.get(id), `tilejson has no layer ${id}`).toBe(minZoom);
    }
    // And the other way: no source layer the manifest declares is missing here,
    // so a row moved onto one of them still gets a scale note.
    for (const [id, minZoom] of fromManifest) {
      expect(MAP_OSM_SOURCE_MIN_ZOOM[id], `no minzoom recorded for ${id}`).toBe(minZoom);
    }
  });

  it("covers every row's own source layer", () => {
    for (const row of MAP_OSM_SUBLAYERS) {
      expect(MAP_OSM_SOURCE_MIN_ZOOM[row.sourceLayer], row.id).toBeTypeOf("number");
    }
  });

  it("says nothing about scale for a layer that draws from the opening globe", () => {
    // water/boundary/place/water_name/landcover are all minzoom 0.
    expect(mapOsmScaleNote("water")).toBeNull();
    expect(mapOsmSublayerTooltip("omt-water")).toBe(MAP_OSM_ROW_SUMMARIES["omt-water"]);
  });

  it("warns about the rows that are invisible at the page's opening view", () => {
    // The four the card is most often asked about, each phrased as a SCALE the
    // reader can see rather than a z-number the page never shows.
    expect(mapOsmSublayerTooltip("omt-buildings")).toContain("only at street scale");
    expect(mapOsmSublayerTooltip("omt-aeroways")).toContain("zoomed into a city");
    expect(mapOsmSublayerTooltip("omt-peaks")).toContain("a range or a valley");
    expect(mapOsmSublayerTooltip("omt-parks")).toContain("about one country");
  });
});

describe("mapsOsm — what a row says it drops is what its filter drops", () => {
  it("roads: tunnels, driveways, parking aisles and indoor ways", () => {
    const tip = mapOsmSublayerTooltip("omt-roads")!;
    const keep = filterFor("omt-roads");
    expect(tip).toContain("tunnels and culverts");
    expect(keep(feature({ class: "motorway", brunnel: "tunnel" }, "line"))).toBe(false);
    expect(keep(feature({ class: "motorway", brunnel: "bridge" }, "line"))).toBe(true);

    expect(tip).toContain("driveways");
    expect(tip).toContain("parking aisles");
    expect(keep(feature({ class: "service", service: "driveway" }, "line"))).toBe(false);
    expect(keep(feature({ class: "service", service: "parking_aisle" }, "line"))).toBe(false);

    expect(tip).toContain("indoor paths");
    expect(keep(feature({ class: "path", indoor: 1 }, "line"))).toBe(false);
    expect(keep(feature({ class: "path" }, "line"))).toBe(true);
  });

  it("boundaries: international only, no maritime and no disputed lines", () => {
    const tip = mapOsmSublayerTooltip("omt-boundaries")!;
    const keep = filterFor("omt-boundaries");
    expect(tip).toContain("International borders only");
    expect(keep(feature({ admin_level: 2 }, "line"))).toBe(true);
    expect(keep(feature({ admin_level: 4 }, "line"))).toBe(false);

    expect(tip).toContain("maritime");
    expect(tip).toContain("disputed");
    expect(keep(feature({ admin_level: 2, maritime: 1, disputed: 0 }, "line"))).toBe(false);
    expect(keep(feature({ admin_level: 2, maritime: 0, disputed: 1 }, "line"))).toBe(false);
    expect(keep(feature({ admin_level: 2, maritime: 0, disputed: 0 }, "line"))).toBe(true);
  });

  it("buildings: the outlines the data marks as mapped part-by-part", () => {
    const tip = mapOsmSublayerTooltip("omt-buildings")!;
    const keep = filterFor("omt-buildings");
    expect(tip).toContain("mapped part-by-part");
    expect(keep(feature({ render_height: 20, hide_3d: true }, "polygon"))).toBe(false);
    expect(keep(feature({ render_height: 20 }, "polygon"))).toBe(true);
  });

  it("waterways: tunnels, i.e. culverted streams", () => {
    const tip = mapOsmSublayerTooltip("omt-waterways")!;
    const keep = filterFor("omt-waterways");
    expect(tip).toContain("tunnels and culverts");
    expect(keep(feature({ class: "stream", brunnel: "tunnel" }, "line"))).toBe(false);
    expect(keep(feature({ class: "stream" }, "line"))).toBe(true);
  });

  it("POIs: thinned by the schema's own rank, and street furniture dropped", () => {
    const tip = mapOsmSublayerTooltip("omt-pois")!;
    const keep = filterFor("omt-pois");
    const spec = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-pois")!;
    expect(tip).toContain(`top ${spec.maxRank} by importance rank`);
    expect(keep(feature({ class: "hospital", rank: spec.maxRank! }, "point"))).toBe(true);
    expect(keep(feature({ class: "hospital", rank: spec.maxRank! + 1 }, "point"))).toBe(false);

    for (const cls of spec.excludeClasses!) {
      expect(tip, cls).toContain(cls.replace(/_/g, " "));
      expect(keep(feature({ class: cls, rank: 1 }, "point")), cls).toBe(false);
    }
  });

  it("the three named-only label rows say so, and drop the unnamed", () => {
    for (const id of ["omt-peaks", "omt-parks", "omt-water-labels"]) {
      const spec = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === id)!;
      expect(spec.requireProperties, id).toContain("name");
      expect(mapOsmSublayerTooltip(id), id).toContain("Only named features are drawn.");
      const keep = filterFor(id);
      expect(keep(feature({ name: "Somewhere", ele: 1000 }, "point")), id).toBe(true);
      expect(keep(feature({ ele: 1000 }, "point")), id).toBe(false);
    }
  });

  it("says nothing about filtering on the rows that filter nothing", () => {
    // Land cover, land use and water narrow on geometry alone, so their
    // tooltips must not claim a drop they do not make.
    for (const id of ["omt-landcover", "omt-landuse", "omt-water"]) {
      const tip = mapOsmSublayerTooltip(id)!;
      expect(tip, id).not.toContain("Deliberately hidden");
      expect(tip, id).not.toContain("Only named");
      expect(tip, id).not.toContain("Thinned");
    }
  });
});
