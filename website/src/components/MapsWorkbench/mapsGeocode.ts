/**
 * The /maps page's GEOCODER slice: turning a typed landmark, street or address
 * into the same {@link MapSearchResult} the local place index already
 * produces, so one list, one ranking convention and one flight path serve
 * both.
 *
 * Pure except for one injected transport seam — `MapSearchBox.tsx` owns the
 * debounce, the abort and the chrome, and `mapsSearch.ts` still owns the
 * flight. Everything with a right answer (what the request looks like, what
 * the response means, what happens when the service is down) is decided here,
 * where a test can reach it without mounting anything.
 *
 * ## Why a geocoder at all
 *
 * The baked country/state pyramids carry Natural Earth's 242 admin-0 label
 * points and 1,251 populated places. They are instant and they work offline,
 * and they cannot answer "eiffel tower" or "avenida corrientes", because a
 * vector tile carries label GEOMETRY, not a searchable index. Nothing baked
 * into this repo could: a planet-wide street index is two orders of magnitude
 * larger than everything `public/data` holds.
 *
 * ## Why Photon, and not Nominatim
 *
 * Nominatim's usage policy explicitly forbids autocomplete-style querying —
 * one request per keystroke is the case it names. Photon
 * (<https://photon.komoot.io>) is komoot's OSM geocoder built FOR
 * search-as-you-type: OpenSearch-backed, no API key, no registration, and it
 * answers a partial query. Its demo server's own policy is
 * "you are welcome to use the API for your project as long as the number of
 * requests stay in a reasonable limit", which is what
 * {@link mapGeocodeShouldQuery} and `MapSearchBox`'s debounce exist to honour.
 *
 * `Access-Control-Allow-Origin: *` on both the GET and its preflight, verified
 * against the live service, is what makes it reachable from a static page at
 * all.
 *
 * ## Every field name here was read out of a live response
 *
 * Not out of Photon's prose docs — the same rule `vector/openmaptiles.ts`
 * holds for OpenFreeMap. Seven real responses are vendored under
 * `fixtures/photon/`, each carrying the exact URL that produced it, and
 * `mapsGeocode.test.ts` replays them through the seam below. The response is
 * GeoJSON: a `FeatureCollection` of `Point` features whose `properties` carry
 * `osm_type` / `osm_id` / `osm_key` / `osm_value` / `type` / `name` /
 * `housenumber` / `street` / `locality` / `district` / `city` / `county` /
 * `state` / `country` / `countrycode` / `postcode`, plus an OPTIONAL `extent`.
 *
 * `extent` is `[minLon, maxLat, maxLon, minLat]` — west, NORTH, east, SOUTH,
 * which is not the order any of this repo's own boxes use. Read off the
 * recorded Eiffel Tower (`[2.2933119, 48.8590453, 2.2956897, 48.8574753]`,
 * where 48.8590 is plainly the northern edge), and pinned by a test, because
 * getting it backwards produces a box that still looks plausible.
 */
import type { GlyphMapAttribution } from "@glyphcss/maps";
import { mapSearchFold, type MapSearchResult } from "./mapsSearch";

/** Photon's forward-search endpoint. */
export const MAP_GEOCODE_ENDPOINT = "https://photon.komoot.io/api/";

/**
 * How many rows the remote half of the list offers.
 *
 * Six rather than the local half's eight: the remote rows are APPENDED, so
 * this is what the list grows by, and a landmark query that matched nothing
 * locally is answered entirely out of these six.
 */
export const MAP_GEOCODE_LIMIT = 6;

/**
 * Shortest query that leaves the machine.
 *
 * Three characters. Below that the answer is noise (Photon returns whatever
 * is most prominent worldwide starting with two letters), so the request buys
 * the reader nothing and costs the service a round trip.
 */
export const MAP_GEOCODE_MIN_QUERY = 3;

/**
 * How long the box waits for the typing to stop before anything leaves the
 * machine, milliseconds.
 *
 * A TRAILING debounce, so a reader who types straight through sends nothing
 * at all until they pause. The worst case is therefore not "one request per
 * keystroke" but "one request per 250 ms of pause": a typist who pauses just
 * over the window between every keystroke tops out at 4 requests/second, and
 * each one ABORTS the previous, so at most one is in flight. A real 8 char/s
 * typist writing "obelisco buenos aires" sends ONE request — at the end —
 * plus one per mid-phrase pause, so two or three for a completed query.
 * Photon's demo server asks only that the volume "stay in a reasonable
 * limit"; this is what makes that true without a rate limiter.
 *
 * 250 ms rather than something longer because the local half of the list is
 * already on screen by then: the debounce delays the OSM rows, never the
 * baked ones.
 */
export const MAP_GEOCODE_DEBOUNCE_MS = 250;

/**
 * How much of Photon's own prominence ranking survives the location bias:
 * 0 ignores prominence almost completely, 1 gives it about equal weight.
 *
 * The service's own default, kept deliberately rather than tuned. Verified
 * live on both of the queries this feature exists for: at 0.4, "eiffel tower"
 * biased on a Paris view answers the Paris tower first (and drops the Alberta
 * mountain summit named after it out of the six entirely), and the bare word
 * "obelisco" biased on a Buenos Aires view answers the Obelisco first. Pushing
 * it lower would start burying a prominent landmark under whatever happens to
 * be near the reader; pushing it higher would undo the bias this feature
 * needs. Both recorded responses are vendored.
 */
export const MAP_GEOCODE_BIAS_SCALE = 0.4;

/** Photon's own default focus radius, used when the page cannot say what it is looking at. */
const MAP_GEOCODE_DEFAULT_ZOOM = 12;
const MAP_GEOCODE_MAX_ZOOM = 18;

/**
 * The credit these rows carry.
 *
 * `createGlyphMap` derives the map's attribution from its MOUNTED LAYERS, and
 * a geocoder is not a layer — nothing about a search result reaches
 * `map.getAttributions()`. So the page carries this itself, and
 * `MapSearchBox` prints it next to the results rather than in the map's own
 * credit line, where it would claim a provenance the render does not have.
 *
 * Photon's index is OpenStreetMap data (ODbL); komoot's demo server is the
 * service, and its own page credits itself as "an OpenStreetMap project run
 * by komoot".
 */
export const MAP_GEOCODE_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
  { name: "Photon", url: "https://photon.komoot.io", license: "Apache-2.0" },
];

/** What the page is looking at, as the bias needs it. */
export interface MapGeocodeView {
  readonly lon: number;
  readonly lat: number;
  /** `map.getView().span`, degrees of longitude across the viewport. */
  readonly span: number;
}

/** The transport seam. Defaults to `fetch` + a status check + `json()`; injected by tests, and the place a timeout or a retry would go. */
export type MapGeocodeFetch = (url: string, signal: AbortSignal | undefined) => Promise<unknown>;

export interface MapGeocodeRequest {
  readonly query: string;
  /** Where to bias. `null` biases nowhere — a legitimate state before the map has reported a view. */
  readonly view: MapGeocodeView | null;
  readonly signal?: AbortSignal;
  readonly fetchJson?: MapGeocodeFetch;
}

/**
 * What a lookup can end in. Three outcomes rather than two, because a
 * SUPERSEDED query and a BROKEN service must not read the same in the UI: the
 * first should say nothing at all (the reader has already typed past it), the
 * second should say something quiet. Never a rejection — see the failure
 * contract below.
 */
export type MapGeocodeOutcome =
  | { readonly kind: "ok"; readonly results: readonly MapSearchResult[] }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Photon's `zoom` — "the radius around the center to focus on ... roughly the
 * map zoom parameter of a corresponding map" — derived from this map's span.
 *
 * A slippy-map tile at zoom `z` covers `360 / 2**z` degrees, so the zoom whose
 * tile matches the viewport is `log2(360 / span)`. The page's own span is the
 * only scale signal it has, and using it means the bias tightens exactly as
 * the reader zooms in: a whole-world view biases at 0 (barely at all, which is
 * right — a reader looking at the whole planet has expressed no preference),
 * a city view at ~12, a street view at 15.
 */
export function mapGeocodeBiasZoom(span: number): number {
  if (!Number.isFinite(span)) return MAP_GEOCODE_DEFAULT_ZOOM;
  if (!(span > 0)) return MAP_GEOCODE_MAX_ZOOM;
  return Math.max(0, Math.min(MAP_GEOCODE_MAX_ZOOM, Math.round(Math.log2(360 / span))));
}

/**
 * The exact URL a query and a view produce.
 *
 * A location BIAS (`lat`/`lon`/`zoom`/`location_bias_scale`), never Photon's
 * `bbox`: `bbox` is a FILTER, so a reader looking at Argentina who types
 * "eiffel tower" would be told there is no such thing. A bias reorders; a
 * filter excludes, and excluding is the one thing a search box must not do.
 *
 * `lang=en` is explicit because the local half of the list is Natural Earth's
 * English NAME column and a mixed-language list reads as a bug. Verified
 * live: it is the difference between "Eiffel Tower" and "Tour Eiffel" in the
 * `name` field. Photon still MATCHES every language, so "tour eiffel" finds it.
 */
export function mapGeocodeUrl(query: string, view: MapGeocodeView | null): string {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("limit", String(MAP_GEOCODE_LIMIT));
  params.set("lang", "en");
  if (view && Number.isFinite(view.lon) && Number.isFinite(view.lat)) {
    params.set("lat", view.lat.toFixed(5));
    params.set("lon", view.lon.toFixed(5));
    params.set("zoom", String(mapGeocodeBiasZoom(view.span)));
    params.set("location_bias_scale", String(MAP_GEOCODE_BIAS_SCALE));
  }
  return `${MAP_GEOCODE_ENDPOINT}?${params.toString()}`;
}

/**
 * Whether this query is worth a round trip at all.
 *
 * Two gates, both about being a good citizen of a free service somebody else
 * pays for:
 *
 *  1. {@link MAP_GEOCODE_MIN_QUERY} characters, so a reader who has typed "e"
 *     is not asking the planet about it.
 *  2. `localExact` — the local index already returned a result whose NAME is
 *     exactly this query. "paris", "berlin", "japan" are answered instantly,
 *     offline, and correctly by the baked pyramids, and the remote round trip
 *     could only offer Paris, Texas underneath the right answer. The trade is
 *     deliberate and it is narrow: it keys on an exact whole-name match, so
 *     "paris opera" and "eiffel tower" both still go out.
 */
export function mapGeocodeShouldQuery(query: string, localExact: boolean): boolean {
  return !localExact && query.trim().length >= MAP_GEOCODE_MIN_QUERY;
}

// ── Reading the response ────────────────────────────────────────────────

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** `[minLon, maxLat, maxLon, minLat]` — Photon's own order, which is not this repo's. */
function extentBounds(extent: unknown): MapSearchResult["bounds"] {
  if (!Array.isArray(extent) || extent.length !== 4) return undefined;
  const [west, north, east, south] = extent as number[];
  if (![west, north, east, south].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return { west, east, south, north };
}

/**
 * What tells two same-named rows apart, in the order a reader scans: the
 * neighbourhood, then the settlement, then the country.
 *
 * `city ?? state ?? county` rather than `city ?? county`: an OSM feature out
 * in the country has no `city`, and Photon's `county` for the recorded
 * Alberta summit is "Improvement District No. 9" while its `state` is
 * "Alberta" — the state is what a reader recognises. Segments that repeat
 * (Paris the district inside Paris the city) collapse.
 */
function contextOf(p: Record<string, unknown>): string {
  const segments = [text(p.district), text(p.city) || text(p.state) || text(p.county), text(p.country)];
  const out: string[] = [];
  for (const s of segments) if (s && !out.includes(s)) out.push(s);
  return out.join(", ");
}

/**
 * The row's own name.
 *
 * Most features have one. An ADDRESS often does not — the recorded
 * Karl-Liebknecht-Straße 29 in Berlin-Mitte is a `place=house` with a
 * `housenumber` and a `street` and no `name` at all — and a blank row is
 * worse than no row, so the address itself becomes the name.
 */
function nameOf(p: Record<string, unknown>): string {
  const name = text(p.name);
  if (name) return name;
  const street = text(p.street);
  const number = text(p.housenumber);
  if (street) return number ? `${number} ${street}` : street;
  return "";
}

/**
 * The one word in the right-hand column: what this thing IS.
 *
 * `osm_value` carries it (`tower`, `obelisk`, `peak`, `restaurant`, `house`),
 * except for a road, where `osm_value` is the highway CLASS (`tertiary`,
 * `secondary`, `service`) — jargon that tells a reader nothing. Photon's own
 * `type` says `street` for exactly those, so that wins there.
 */
function metricOf(p: Record<string, unknown>): string {
  if (text(p.type) === "street") return "street";
  return text(p.osm_value).replace(/_/g, " ") || text(p.osm_key).replace(/_/g, " ");
}

function toResult(feature: unknown): MapSearchResult | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as Record<string, unknown>;
  const geometry = f.geometry as Record<string, unknown> | null | undefined;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords as number[];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const name = nameOf(p);
  if (!name) return null;
  const osmType = text(p.osm_type);
  const osmId = typeof p.osm_id === "number" || typeof p.osm_id === "string" ? String(p.osm_id) : "";
  return {
    id: `osm:${osmType}${osmId}` || `osm:${lon},${lat}`,
    kind: "osm",
    name,
    context: contextOf(p),
    metric: metricOf(p),
    lngLat: [lon, lat],
    bounds: extentBounds(p.extent),
    // Photon's results arrive RANKED and its ranking score is not exposed,
    // so there is no prominence to carry and nothing here may re-sort them.
    // Zero, uniformly, is the honest value: it is never compared.
    prominence: 0,
  };
}

/**
 * A GeoJSON body into rows, or `null` when the body is not one.
 *
 * De-dupes on `(folded name, place, country)`. One landmark is many OSM
 * objects — the recorded Eiffel Tower response is six features of which three
 * are the tower, its information office and an information screen at the same
 * address, and the recorded Avenida Corrientes response is six fragments of
 * ONE avenue, split into ways. Six identical-looking rows is not a list, it is
 * a stutter; the first of each group is kept, which is the one Photon ranked
 * highest.
 */
export function parseMapGeocodeBody(body: unknown): readonly MapSearchResult[] | null {
  if (!body || typeof body !== "object") return null;
  const features = (body as Record<string, unknown>).features;
  if (!Array.isArray(features)) return null;
  const out: MapSearchResult[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const result = toResult(feature);
    if (!result) continue;
    const key = `${mapSearchFold(result.name)}@${mapSearchFold(result.context)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function fetchGeocodeJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Photon responded ${res.status}.`);
  return res.json();
}

/**
 * Look a query up, and NEVER throw.
 *
 * This is `openfreemap.ts`'s contract for a failed tile, in the shape a search
 * box needs: there, a tile that 404s, times out or arrives undecodable
 * resolves EMPTY rather than rejecting, because one rejection would take down
 * the whole frame's `Promise.all` and blank layers that had nothing wrong with
 * them. Here the thing that must survive is the LOCAL half of the list — it is
 * instant, it is offline, and a geocoder outage is no reason for it to
 * disappear. So every failure mode (no network, a non-200, a rate limit, a
 * body that is not JSON, a body that is JSON but not a feature collection)
 * lands as `failed` with one short reader-facing reason, and an individual
 * unusable FEATURE is simply dropped from an otherwise good answer.
 *
 * A superseded query lands as `aborted`, which the UI shows nothing for.
 */
export async function geocodeMapSearch(request: MapGeocodeRequest): Promise<MapGeocodeOutcome> {
  const { query, view, signal } = request;
  if (signal?.aborted) return { kind: "aborted" };
  const load = request.fetchJson ?? fetchGeocodeJson;
  let body: unknown;
  try {
    body = await load(mapGeocodeUrl(query, view), signal);
  } catch (error) {
    if (isAbort(error) || signal?.aborted) return { kind: "aborted" };
    return { kind: "failed", reason: "OpenStreetMap search unavailable" };
  }
  if (signal?.aborted) return { kind: "aborted" };
  const results = parseMapGeocodeBody(body);
  if (!results) return { kind: "failed", reason: "OpenStreetMap search unavailable" };
  return { kind: "ok", results };
}
