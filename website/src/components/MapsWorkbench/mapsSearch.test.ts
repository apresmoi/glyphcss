/**
 * The /maps search slice — the pure half: folding, match scoring, ranking,
 * the country-bounds join, and the flight target.
 *
 * Two layers of test here on purpose:
 *
 *  1. SYNTHETIC features pin the rules themselves (what beats what, and why),
 *     so a ranking change shows up as a rule change rather than as a shifted
 *     city somewhere in a 1,493-entry list.
 *  2. The REAL baked pyramids (`public/data/{country,place,vector}-tiles`)
 *     are then indexed through the same code path the page uses, because the
 *     rules are only worth anything if they hold on the data that ships.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  glyphMapDecodeVectorTile,
  glyphMapVectorTileBounds,
  type GlyphMapProviderZoomLevel,
  type GlyphMapVectorFeature,
  type GlyphMapVectorProvider,
  type GlyphMapVectorTile,
} from "@glyphcss/maps";
import {
  MAP_SEARCH_BOUNDS_PADDING,
  MAP_SEARCH_POINT_SPAN,
  buildMapSearchIndex,
  loadMapSearchIndex,
  mapSearchFeatureBounds,
  mapSearchFlyTarget,
  mapSearchFold,
  mapSearchMatchScore,
  searchMapIndex,
} from "./mapsSearch";

const DATA = path.resolve(__dirname, "../../../public/data");

function point(name: string, lon: number, lat: number, props: Record<string, unknown> = {}): GlyphMapVectorFeature {
  return { id: name, geometryType: "point", properties: { name, ...props }, rings: [[[lon, lat]]] };
}

/** The same feature as it would arrive from two neighbouring tiles — same id, same point. */
function duplicated(f: GlyphMapVectorFeature): GlyphMapVectorFeature[] {
  return [f, { ...f }];
}

// ── The rules, on synthetic data ────────────────────────────────────────

describe("mapSearchFold", () => {
  it("folds case, diacritics and whitespace so an ASCII query reaches an accented name", () => {
    expect(mapSearchFold("São Tomé and Principe")).toBe("sao tome and principe");
    expect(mapSearchFold("Curaçao")).toBe("curacao");
    expect(mapSearchFold("  Åland  ")).toBe("aland");
    expect(mapSearchFold("Zürich")).toBe("zurich");
  });
});

describe("mapSearchMatchScore", () => {
  it("grades exact over prefix over word-start over mid-word, and rejects a non-match", () => {
    expect(mapSearchMatchScore("paris", "paris")).toBe(4);
    expect(mapSearchMatchScore("paris, texas", "paris")).toBe(3);
    expect(mapSearchMatchScore("new york", "york")).toBe(2);
    expect(mapSearchMatchScore("alexandria", "exand")).toBe(1);
    expect(mapSearchMatchScore("paris", "london")).toBe(0);
  });
});

describe("searchMapIndex ranking", () => {
  const index = buildMapSearchIndex({
    countries: [
      point("Mexico", -102, 23, { label_priority: 8, iso_a3: "MEX", continent: "North America", pop_est: 126_014_024 }),
      point("Malta", 14.4, 35.9, { label_priority: 4, iso_a3: "MLT", continent: "Europe", pop_est: 502_653 }),
    ],
    places: [
      point("Mexico City", -99.13, 19.44, { pop_max: 20_999_000, adm0name: "Mexico" }),
      point("Mexicali", -115.47, 32.65, { pop_max: 653_046, adm0name: "Mexico" }),
      point("Hyderabad", 68.37, 25.38, { pop_max: 1_459_000, adm0name: "Pakistan" }),
      point("Hyderabad", 78.47, 17.4, { pop_max: 6_376_000, adm0name: "India" }),
    ],
    countryPolygons: [],
  });

  it("puts an exact name above a prefix match: 'mexico' is the country, not the city", () => {
    const hits = searchMapIndex(index, "mexico");
    expect(hits[0].name).toBe("Mexico");
    expect(hits[0].kind).toBe("country");
    expect(hits[1].name).toBe("Mexico City");
  });

  it("ranks equally-matched cities by population, and carries the country that disambiguates them", () => {
    const hits = searchMapIndex(index, "hyderabad");
    expect(hits).toHaveLength(2);
    expect(hits[0].prominence).toBe(6_376_000);
    expect(hits[0].context).toBe("India");
    expect(hits[1].prominence).toBe(1_459_000);
    expect(hits[1].context).toBe("Pakistan");
  });

  it("ranks a country above a city at the same match grade", () => {
    // "mexic" is a prefix of the country and of two cities.
    const hits = searchMapIndex(index, "mexic");
    expect(hits[0].name).toBe("Mexico");
    expect(hits.map((h) => h.name)).toEqual(["Mexico", "Mexico City", "Mexicali"]);
  });

  it("resolves an ISO-3166 alpha-3 code to its country", () => {
    expect(searchMapIndex(index, "MEX")[0].name).toBe("Mexico");
    expect(searchMapIndex(index, "mlt")[0].name).toBe("Malta");
  });

  it("answers an empty query with nothing rather than the whole world", () => {
    expect(searchMapIndex(index, "   ")).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(searchMapIndex(index, "m", 2)).toHaveLength(2);
  });

  it("collapses one feature seen in two tiles, and keeps two features that merely share a name", () => {
    const deduped = buildMapSearchIndex({
      countries: [],
      places: [
        ...duplicated(point("Victoria", -123.37, 48.43, { pop_max: 289_625, adm0name: "Canada" })),
        point("Victoria", 55.45, -4.62, { pop_max: 33_576, adm0name: "Seychelles" }),
      ],
      countryPolygons: [],
    });
    const hits = searchMapIndex(deduped, "victoria");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.context)).toEqual(["Canada", "Seychelles"]);
  });
});

// ── Bounds + flight target ──────────────────────────────────────────────

describe("mapSearchFeatureBounds", () => {
  it("takes the shorter longitude window for a ring straddling the antimeridian", () => {
    const fiji = { rings: [[[177, -17], [179, -18], [-179, -16]]] } as unknown as GlyphMapVectorFeature;
    const b = mapSearchFeatureBounds(fiji)!;
    // Naive would be -179..179 (358 degrees of empty Pacific); the unwrapped
    // window is 177..181, four degrees wide.
    expect(b.east - b.west).toBeCloseTo(4, 6);
    expect(b.west).toBeCloseTo(177, 6);
  });

  it("returns null for a feature with no finite point", () => {
    expect(mapSearchFeatureBounds({ rings: [] } as unknown as GlyphMapVectorFeature)).toBeNull();
  });
});

describe("mapSearchFlyTarget", () => {
  const cityHit = {
    id: "c", kind: "place" as const, name: "Springfield", context: "United States of America",
    lngLat: [-89.65, 39.8] as const, prominence: 1,
  };

  it("flies to a point result at the fixed point span", () => {
    const target = mapSearchFlyTarget(cityHit);
    expect(target).toEqual({ center: [-89.65, 39.8], span: MAP_SEARCH_POINT_SPAN });
  });

  it("frames a large country by its own padded bounds", () => {
    const target = mapSearchFlyTarget({
      ...cityHit, kind: "country", name: "Brazil",
      bounds: { west: -74, east: -34, south: -34, north: 5 },
    });
    const padLon = 40 * MAP_SEARCH_BOUNDS_PADDING;
    expect(target.bounds?.west).toBeCloseTo(-74 - padLon, 6);
    expect(target.bounds?.east).toBeCloseTo(-34 + padLon, 6);
  });

  it("floors a country smaller than the point span at the point span, so a microstate is not flown to a smear", () => {
    const target = mapSearchFlyTarget({
      ...cityHit, kind: "country", name: "Luxembourg",
      bounds: { west: 5.7, east: 6.5, south: 49.4, north: 50.2 },
    });
    expect(target.bounds).toBeUndefined();
    expect(target.span).toBe(MAP_SEARCH_POINT_SPAN);
    expect(target.center?.[0]).toBeCloseTo(6.1, 6);
    expect(target.center?.[1]).toBeCloseTo(49.8, 6);
  });
});

// ── The real baked pyramids ─────────────────────────────────────────────

/** An fs-backed stand-in for `createPlaceTilesProvider`/`createCountryTilesProvider`/`createVectorTilesProvider`. */
function diskProvider(dir: string): GlyphMapVectorProvider {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
    zooms: GlyphMapProviderZoomLevel[];
  };
  return {
    id: `disk:${dir}`,
    zooms: manifest.zooms,
    bounds: (z, x, y) => glyphMapVectorTileBounds(z, x, y),
    async loadTile(z, x, y): Promise<GlyphMapVectorTile> {
      const file = path.join(dir, String(z), `${x}_${y}.json`);
      if (!existsSync(file)) {
        return { z, x, y, bounds: glyphMapVectorTileBounds(z, x, y), layers: {}, source: "disk", simplify: "none" };
      }
      return glyphMapDecodeVectorTile(JSON.parse(readFileSync(file, "utf8")));
    },
  };
}

describe("the real baked pyramids", () => {
  it("indexes every country and every place, from the deepest level of each pyramid", async () => {
    const index = await loadMapSearchIndex({
      countries: diskProvider(path.join(DATA, "country-tiles")),
      places: diskProvider(path.join(DATA, "place-tiles")),
      countryPolygons: diskProvider(path.join(DATA, "vector-tiles")),
    });
    const countries = index.entries.filter((e) => e.kind === "country");
    const places = index.entries.filter((e) => e.kind === "place");
    // The bakers report 242 countries and 1,251 places; anything less means
    // the index was built from a THINNED level.
    expect(countries).toHaveLength(242);
    expect(places).toHaveLength(1251);
    // The z0 polygon pyramid carries 177 of those countries; the rest are
    // microstates and island nations world-atlas omits at this resolution.
    expect(countries.filter((c) => c.bounds).length).toBeGreaterThanOrEqual(170);
    expect(index.entries.filter((e) => e.name === "Russia")[0].bounds!.east - index.entries.filter((e) => e.name === "Russia")[0].bounds!.west)
      .toBeLessThan(200);
  });

  it("surfaces the prominent match first for real queries", async () => {
    const index = await loadMapSearchIndex({
      countries: diskProvider(path.join(DATA, "country-tiles")),
      places: diskProvider(path.join(DATA, "place-tiles")),
      countryPolygons: diskProvider(path.join(DATA, "vector-tiles")),
    });
    const first = (q: string) => searchMapIndex(index, q)[0];

    expect(first("paris").name).toBe("Paris");
    expect(first("paris").context).toBe("France");
    expect(first("tokyo").name).toBe("Tokyo");
    expect(first("brazil").kind).toBe("country");
    expect(first("brazil").bounds).toBeDefined();
    // The real same-name case in this dataset: two Hyderabads, two
    // Victorias, two Santiagos. The larger wins and the country is printed.
    const hyderabads = searchMapIndex(index, "hyderabad");
    expect(hyderabads).toHaveLength(2);
    expect(hyderabads.map((h) => h.context)).toEqual(["India", "Pakistan"]);
    expect(searchMapIndex(index, "victoria")[0].context).toBe("Canada");
    // Deep-index-only evidence: San Marino is LABELRANK 6+, present only at
    // the deepest country level.
    expect(first("san marino").kind).toBe("country");
  });
});
