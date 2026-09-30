/**
 * The /maps geocoder slice — the pure half: the request the page builds, the
 * results it reads back, and every way the service can let it down.
 *
 * Nothing here touches the network. Every response under test is a RECORDED
 * one: `fixtures/photon/*.json` holds the exact URL the recorder asked for,
 * the status it got, and the body Photon actually served on 2026-09-07. Each
 * fixture is replayed through the same `fetchJson` seam the page uses, so the
 * DATA is real while CI stays offline and deterministic — the discipline
 * `packages/maps`' `openfreemap.test.ts` established for OpenFreeMap.
 *
 * Every property name asserted below (`osm_type`, `osm_id`, `osm_key`,
 * `osm_value`, `type`, `name`, `housenumber`, `street`, `district`,
 * `locality`, `city`, `county`, `state`, `country`, `countrycode`, `extent`)
 * was read out of those recorded bodies, never out of Photon's prose docs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAP_GEOCODE_ATTRIBUTION,
  MAP_GEOCODE_BIAS_SCALE,
  MAP_GEOCODE_ENDPOINT,
  MAP_GEOCODE_LIMIT,
  MAP_GEOCODE_MIN_QUERY,
  geocodeMapSearch,
  mapGeocodeBiasZoom,
  mapGeocodeShouldQuery,
  mapGeocodeUrl,
  parseMapGeocodeBody,
  type MapGeocodeFetch,
  type MapGeocodeOutcome,
  type MapGeocodeView,
} from "./mapsGeocode";
import { MAP_SEARCH_OSM_SPAN, MAP_SEARCH_POINT_SPAN, mapSearchFlyTarget, type MapSearchResult } from "./mapsSearch";

/** Assert the outcome succeeded and hand back its rows, so every test below reads as one statement. */
function ok(outcome: MapGeocodeOutcome): readonly MapSearchResult[] {
  if (outcome.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
  return outcome.results;
}

const FIXTURES = path.resolve(__dirname, "fixtures/photon");

interface Recorded {
  readonly query: string;
  readonly view: MapGeocodeView;
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
}

function recorded(name: string): Recorded {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Recorded;
}

const NAMES = [
  "eiffel-tower-paris",
  "eiffel-tower-world",
  "obelisco-buenos-aires",
  "obelisco-biased-ar",
  "avenida-corrientes",
  "karl-liebknecht-29",
  "no-match",
] as const;

/** Replay one recorded response through the seam the page uses. */
async function replay(name: string) {
  const rec = recorded(name);
  const fetchJson = vi.fn(async () => rec.body);
  const outcome = await geocodeMapSearch({ query: rec.query, view: rec.view, fetchJson });
  return { rec, fetchJson, outcome };
}

afterEach(() => { vi.unstubAllGlobals(); });

// ── The request ─────────────────────────────────────────────────────────

describe("mapGeocodeUrl", () => {
  it("builds, for every recorded case, the exact URL the recorder asked Photon for", () => {
    for (const name of NAMES) {
      const rec = recorded(name);
      expect(mapGeocodeUrl(rec.query, rec.view), name).toBe(rec.url);
    }
  });

  it("puts the view at the centre of the bias and derives Photon's `zoom` from the span", () => {
    const url = new URL(mapGeocodeUrl("obelisco", { lon: -58.44, lat: -34.6, span: 0.5 }));
    expect(url.origin + url.pathname).toBe(MAP_GEOCODE_ENDPOINT);
    expect(url.searchParams.get("lon")).toBe("-58.44000");
    expect(url.searchParams.get("lat")).toBe("-34.60000");
    expect(url.searchParams.get("zoom")).toBe("9");
    expect(url.searchParams.get("location_bias_scale")).toBe(String(MAP_GEOCODE_BIAS_SCALE));
    expect(url.searchParams.get("limit")).toBe(String(MAP_GEOCODE_LIMIT));
    // A BIAS, never a `bbox`: a bbox would CROP, so "eiffel tower" typed while
    // looking at Argentina would answer nothing at all.
    expect(url.searchParams.has("bbox")).toBe(false);
  });

  it("omits the bias entirely when the page has no view to offer", () => {
    const url = new URL(mapGeocodeUrl("berlin", null));
    expect(url.searchParams.has("lat")).toBe(false);
    expect(url.searchParams.has("lon")).toBe(false);
    expect(url.searchParams.has("zoom")).toBe(false);
    expect(url.searchParams.get("q")).toBe("berlin");
  });
});

describe("mapGeocodeBiasZoom", () => {
  it("maps a whole-world view to Photon's widest focus and a street view to its tightest", () => {
    expect(mapGeocodeBiasZoom(360)).toBe(0);
    expect(mapGeocodeBiasZoom(0.5)).toBe(9);
    expect(mapGeocodeBiasZoom(MAP_SEARCH_OSM_SPAN)).toBe(15);
    // Clamped at both ends, and never NaN for a degenerate span.
    expect(mapGeocodeBiasZoom(1e-9)).toBe(18);
    expect(mapGeocodeBiasZoom(0)).toBe(18);
    expect(mapGeocodeBiasZoom(Number.NaN)).toBe(12);
  });
});

describe("mapGeocodeShouldQuery", () => {
  it("stays home until the query is long enough to mean something", () => {
    expect(MAP_GEOCODE_MIN_QUERY).toBe(3);
    expect(mapGeocodeShouldQuery("ei", false)).toBe(false);
    expect(mapGeocodeShouldQuery("  e  ", false)).toBe(false);
    expect(mapGeocodeShouldQuery("eif", false)).toBe(true);
  });

  it("stays home when the local index already answered the query exactly", () => {
    expect(mapGeocodeShouldQuery("paris", true)).toBe(false);
    expect(mapGeocodeShouldQuery("paris", false)).toBe(true);
  });
});

// ── The response ────────────────────────────────────────────────────────

describe("a landmark", () => {
  it("finds the Eiffel Tower and frames it, from the response the biased request actually got", async () => {
    const { outcome } = await replay("eiffel-tower-paris");
    const first = ok(outcome)[0];
    expect(first.kind).toBe("osm");
    expect(first.name).toBe("Eiffel Tower");
    expect(first.context).toBe("Paris, France");
    expect(first.lngLat[0]).toBeCloseTo(2.2945006, 6);
    expect(first.lngLat[1]).toBeCloseTo(48.8582599, 6);
    // Photon's `extent` is [minLon, maxLat, maxLon, minLat] — west, NORTH,
    // east, SOUTH — read off the recorded body, not off the docs.
    expect(first.bounds).toEqual({ west: 2.2933119, east: 2.2956897, south: 48.8574753, north: 48.8590453 });
    // The id is the OSM object, so the same feature from two queries is one row.
    expect(first.id).toBe("osm:W5013364");
  });

  it("flies there through the EXISTING fly path, at the POI span rather than a country's", () => {
    const results = parseMapGeocodeBody(recorded("eiffel-tower-paris").body)!;
    // The tower's own extent is 0.0024 x 0.0016 degrees — far under the floor,
    // so it takes the SPAN path, centred on the middle of its own box.
    const tower = mapSearchFlyTarget(results[0]);
    expect(tower.span).toBe(MAP_SEARCH_OSM_SPAN);
    expect(tower.center?.[0]).toBeCloseTo(2.2945008, 6);
    expect(tower.center?.[1]).toBeCloseTo(48.8582603, 6);
    // A row Photon gave no extent for centres exactly on its own point.
    const screen = results.find((r) => !r.bounds)!;
    expect(mapSearchFlyTarget(screen)).toEqual({ center: [...screen.lngLat], span: MAP_SEARCH_OSM_SPAN });
    // Four orders of AREA away from the span a country or a baked place takes.
    expect(MAP_SEARCH_OSM_SPAN).toBeLessThan(MAP_SEARCH_POINT_SPAN / 100);
  });

  it("collapses the near-duplicates one landmark generates in OSM", async () => {
    const { outcome } = await replay("eiffel-tower-paris");
    // Photon returned SIX features, three of them the tower's own information
    // screen and office at the same address; the reader gets one row per
    // distinct (name, place).
    expect(ok(outcome).map((r) => `${r.name} · ${r.context}`)).toEqual([
      "Eiffel Tower · Paris, France",
      "Eiffel Tower · Laeken - Laken, Brussels, Belgium",
      "Eiffel Tower Diner · Sains-en-Gohelle, France",
      "Eiffel Tower · Billund, Denmark",
    ]);
  });

  it("keeps the service's own ranking, which is the only ranking these results have", async () => {
    const results = ok((await replay("obelisco-buenos-aires")).outcome);
    expect(results[0].name).toBe("Obelisco");
    expect(results[0].context).toContain("Buenos Aires");
    expect(results.every((r) => r.prominence === 0)).toBe(true);
  });

  it("finds the Obelisco from the bare word when the reader is already looking at Argentina", async () => {
    const first = ok((await replay("obelisco-biased-ar")).outcome)[0];
    expect(first.name).toBe("Obelisco");
    expect(first.metric).toBe("obelisk");
    const target = mapSearchFlyTarget(first);
    expect(target.span).toBe(MAP_SEARCH_OSM_SPAN);
    expect(target.center?.[0]).toBeCloseTo(-58.3816, 3);
    expect(target.center?.[1]).toBeCloseTo(-34.6037, 3);
  });
});

describe("a street", () => {
  it("finds Avenida Corrientes and collapses the ways OSM splits it into", async () => {
    const results = ok((await replay("avenida-corrientes")).outcome);
    // Photon returned SIX way fragments of one avenue; two neighbourhoods
    // survive, which is the real answer — the avenue runs through both.
    expect(results.map((r) => `${r.name} · ${r.context}`)).toEqual([
      "Avenida Corrientes · San Nicolás, Buenos Aires, Argentina",
      "Avenida Corrientes · Balvanera, Autonomous City of Buenos Aires, Argentina",
    ]);
    const street = results[0];
    expect(street.metric).toBe("street");
    // One 130 m way fragment is far below the floor, so the flight frames the
    // street's neighbourhood rather than 130 metres of asphalt.
    expect(mapSearchFlyTarget(street).span).toBe(MAP_SEARCH_OSM_SPAN);
  });

  it("names an address that OSM gave no name at all", async () => {
    const results = ok((await replay("karl-liebknecht-29")).outcome);
    expect(results.map((r) => r.name)).toContain("29 Karl-Liebknecht-Straße");
    const nameless = results.find((r) => r.name === "29 Karl-Liebknecht-Straße")!;
    expect(nameless.context).toBe("Mitte, Berlin, Germany");
  });
});

describe("nothing to find", () => {
  it("answers a real empty result, not a failure", async () => {
    const { outcome } = await replay("no-match");
    expect(outcome).toEqual({ kind: "ok", results: [] });
  });
});

// ── Failure degrades, never breaks ──────────────────────────────────────

describe("failure leaves the local results standing", () => {
  it("reports a network failure instead of throwing", async () => {
    const outcome = await geocodeMapSearch({
      query: "eiffel tower",
      view: null,
      fetchJson: async () => { throw new TypeError("Failed to fetch"); },
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toMatch(/unavailable/i);
  });

  it("reports a rate-limit response through the real default transport, instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    const outcome = await geocodeMapSearch({ query: "eiffel tower", view: null });
    expect(outcome.kind).toBe("failed");
  });

  it("reports malformed JSON instead of throwing", async () => {
    for (const body of [null, "not json", { ok: true }, { type: "FeatureCollection", features: "nope" }]) {
      const outcome = await geocodeMapSearch({ query: "x", view: null, fetchJson: async () => body });
      expect(outcome.kind, JSON.stringify(body)).toBe("failed");
    }
  });

  it("drops an individual unusable feature and keeps the rest of the answer", async () => {
    const rec = recorded("eiffel-tower-paris") as { body: { features: unknown[] } };
    const body = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { name: "Broken" }, geometry: null }, ...rec.body.features],
    };
    const results = ok(await geocodeMapSearch({ query: "eiffel tower", view: null, fetchJson: async () => body }));
    expect(results[0].name).toBe("Eiffel Tower");
    expect(results.some((r) => r.name === "Broken")).toBe(false);
  });

  it("calls an abort an abort, not a failure — so a superseded query says nothing at all", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await geocodeMapSearch({
      query: "eiffel tower", view: null, signal: controller.signal,
      fetchJson: async () => { throw new Error("must not be reached"); },
    });
    expect(outcome).toEqual({ kind: "aborted" });

    const midflight = await geocodeMapSearch({
      query: "eiffel tower", view: null,
      fetchJson: async () => { throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" }); },
    });
    expect(midflight).toEqual({ kind: "aborted" });
  });

  it("passes the caller's signal to the transport so an in-flight request can be dropped", async () => {
    const controller = new AbortController();
    const fetchJson = vi.fn<MapGeocodeFetch>(async () => ({ type: "FeatureCollection", features: [] }));
    await geocodeMapSearch({ query: "berlin", view: null, signal: controller.signal, fetchJson });
    expect(fetchJson.mock.calls[0][1]).toBe(controller.signal);
  });
});

describe("attribution", () => {
  it("carries the OSM credit the data is licensed under, as data rather than as a string in a component", () => {
    expect(MAP_GEOCODE_ATTRIBUTION.map((a) => a.name)).toEqual(["OpenStreetMap contributors", "Photon"]);
    expect(MAP_GEOCODE_ATTRIBUTION[0].license).toBe("ODbL");
    expect(MAP_GEOCODE_ATTRIBUTION[0].url).toBe("https://www.openstreetmap.org/copyright");
    expect(MAP_GEOCODE_ATTRIBUTION[1].url).toBe("https://photon.komoot.io");
  });
});

