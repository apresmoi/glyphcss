/**
 * The /maps page's LIVE slice: four public, keyless, openly-licensed feeds
 * read straight from the reader's own browser, adapted into
 * `GlyphMapVectorFeatureCollection`s and handed to a mounted layer through
 * `@glyphcss/maps`' `setLayerSource`.
 *
 * ## Why the fetch lives here and not in `packages/maps`
 *
 * The same rule `mapsGeocode.ts` already establishes: a live HTTP call, its
 * usage policy, its cadence and its vendored fixtures live in the
 * unpublished website, and the package owns only the mount. Two independent
 * reasons, and either alone would settle it.
 *
 *  1. **`map.idle()` has to stay honest.** A `refreshMs` on the layer would
 *     force the widget to either count a repeating timer in `widgetBusy()`
 *     — under which `idle()` never resolves, because a map that refreshes
 *     forever is never idle — or to hold a timer `idle()` deliberately
 *     hides, which no other clause of that predicate does. With the interval
 *     here, neither happens: the page awaits its own fetch, calls
 *     `setLayerSource`, and awaits `idle()`, which covers the rebuild and
 *     nothing else.
 *  2. **Licence.** `packages/*` is MIT and published to npm. Nothing about
 *     these services enters it — not an endpoint, not an attribution string,
 *     not a fixture. All four are keyless and openly licensed anyway (US
 *     government public domain twice, EC JRC open once, and CelesTrak's
 *     US-government-origin data with a citation request), and keeping them
 *     out of the packages is what keeps that a page obligation rather than a
 *     library one.
 *
 * ## Failure degrades, and says why
 *
 * `openfreemap.ts`'s contract, in the shape a card needs: no fetch here ever
 * rejects, and a failed refresh leaves the previous frame standing — the
 * layer keeps the features it last had, and the card says the refresh
 * failed. Nothing blanks.
 *
 * There is a specific trap behind {@link MAP_LIVE_OPAQUE_REASON}. Several of
 * these services send `Access-Control-Allow-Origin` on their 200s and NOT on
 * their error responses, so a perfectly readable `429` reaches the browser as
 * an opaque network failure: `fetch` rejects with a `TypeError`, and the
 * handler never sees the status, the `Retry-After`, or the throttle message.
 * An unexplained failure is therefore reported as PROBABLY rate limiting,
 * because on those services that is the only signal there is.
 *
 * ## Cadence, and why each one
 *
 * Every interval below is spent against the READER's own IP, not a shared
 * site quota — the fetch happens in their browser. That is the one place
 * having no server helps. The numbers are still chosen so that a page left
 * open all day cannot breach any published limit; see each spec's
 * `refreshMs`.
 *
 * ## Every field name here was read out of a live response
 *
 * Not out of prose docs — the same rule `vector/openmaptiles.ts` holds for
 * OpenFreeMap. One real captured response per feed is vendored under
 * `fixtures/live/`, each carrying the exact URL that produced it, and
 * `mapsLive.test.ts` replays them through the transport seam below. No test
 * here touches the network.
 */
import type {
  GlyphMapAttribution,
  GlyphMapCircleLayer,
  GlyphMapSymbolLayer,
  GlyphMapVectorFeature,
  GlyphMapVectorFeatureCollection,
} from "@glyphcss/maps";

/** The card's rows, in the order they are mounted and shown. */
export type MapLiveFeedId = "quakes" | "disasters" | "launches" | "satellites";

// ── Attribution ──────────────────────────────────────────────────────────
//
// A CODE CONSTANT per feed, never a string read out of the payload: a credit
// that a service could rewrite from its own response is not a credit, it is
// an injection site. Each collection carries its own, so `map.getAttributions()`
// picks it up from the mounted layer and it withdraws the moment the row is
// switched off — the same path the OpenFreeMap credit takes.

/** USGS ask for exactly this wording; the data is US Government work and therefore public domain. */
export const MAP_LIVE_USGS_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "Data courtesy of USGS", url: "https://earthquake.usgs.gov/earthquakes/feed/", license: "public domain" },
];

/** GDACS is run by the European Commission's Joint Research Centre with UN OCHA. */
export const MAP_LIVE_GDACS_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "GDACS — European Commission JRC / UN OCHA", url: "https://www.gdacs.org", license: "open" },
];

/** The Space Devs ask to be credited by name; the API is free and keyless. */
export const MAP_LIVE_LAUNCH_LIBRARY_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "Launch Library 2 — The Space Devs", url: "https://thespacedevs.com/llapi", license: "free, credit requested" },
];

/**
 * CelesTrak publish US-government-origin element sets under no licence at
 * all, and REQUEST a citation of Dr T.S. Kelso. That request is the whole
 * obligation, so it is stated in full rather than abbreviated to a domain.
 */
export const MAP_LIVE_CELESTRAK_ATTRIBUTION: readonly GlyphMapAttribution[] = [
  { name: "Orbital elements: CelesTrak (Dr T.S. Kelso)", url: "https://celestrak.org", license: "US-government-origin, citation requested" },
];

// ── Cadences ─────────────────────────────────────────────────────────────

/**
 * USGS regenerate the summary feeds every one to five minutes and publish no
 * rate limit; the feeds are served from a CDN. Five minutes is therefore the
 * fastest cadence that can bring anything new — 12 requests an hour, and a
 * faster one would re-read a file that had not changed.
 */
export const MAP_LIVE_QUAKES_REFRESH_MS = 5 * 60_000;

/**
 * GDACS events move on the scale of hours (an alert level is re-scored, an
 * episode is added), so a quarter of an hour is already far finer than the
 * data. Four requests an hour of a 140 KB document.
 */
export const MAP_LIVE_DISASTERS_REFRESH_MS = 15 * 60_000;

/**
 * ONE request an hour, against a measured ceiling of fifteen: the throttle
 * endpoint answers `{"your_request_limit":15,"limit_frequency_secs":3600}`
 * for an anonymous caller, and that budget is the READER's own IP. A launch
 * manifest changes on the scale of hours, so nothing is lost.
 *
 * The Space Devs also ask, twice and in bold, that clients not query them
 * directly and that an integrator cache server-side instead. This deployment
 * is a static page with no server, so that request cannot be honoured; a
 * page open for a day spends 24 of a reader's own 360 hourly requests, which
 * is the closest a serverless page can get to it. It is a stated preference
 * we are structurally unable to meet, not a term we are breaching.
 */
export const MAP_LIVE_LAUNCHES_REFRESH_MS = 60 * 60_000;

/**
 * TWELVE HOURS — in practice, once per session.
 *
 * A two-line element set is valid for days, and the motion a reader sees is
 * LOCAL SGP4 propagation (`mapsLiveSatellites.ts`), not a network refresh.
 * CelesTrak object to automated bulk polling, and this design sidesteps that
 * by construction rather than by throttling: it fetches the elements once
 * and then never asks again for half a day. The ceiling exists only so that
 * a tab left open across a weekend re-reads elements that have gone stale
 * rather than propagating a week-old epoch.
 */
export const MAP_LIVE_SATELLITES_REFRESH_MS = 12 * 60 * 60_000;

// ── Feed specifications ──────────────────────────────────────────────────

export interface MapLiveFeedSpec {
  readonly id: MapLiveFeedId;
  readonly label: string;
  /** The row's tooltip: what it is, and when it has something to show. */
  readonly tooltip: string;
  readonly url: string;
  /** Milliseconds between refreshes — see each constant for why it is that number. */
  readonly refreshMs: number;
  readonly attribution: readonly GlyphMapAttribution[];
  /** What the row costs the reader per refresh, measured on the vendored capture. */
  readonly payload: string;
  /** How the cadence reads in the card, so a reader can see what a left-open tab spends. */
  readonly cadence: string;
  /** What this row COUNTS, in the reader's words: "115 events", never "115 features". */
  readonly noun: string;
  /** `text` for a feed whose body is not JSON (CelesTrak serves plain-text element sets). */
  readonly format: "json" | "text";
}

export const MAP_LIVE_FEEDS: readonly MapLiveFeedSpec[] = [
  {
    id: "quakes",
    label: "Earthquakes",
    tooltip:
      "Every magnitude 2.5+ earthquake worldwide in the past seven days, from the USGS summary feed (US Government work, public domain). Dot size is magnitude. Always has something to show — the planet produces a few hundred a week, and they trace the plate boundaries, which is the shape a character grid draws best.",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
    refreshMs: MAP_LIVE_QUAKES_REFRESH_MS,
    attribution: MAP_LIVE_USGS_ATTRIBUTION,
    payload: "~270 KB, ~390 events",
    cadence: "every 5 min",
    noun: "quakes",
    format: "json",
  },
  {
    id: "disasters",
    label: "Disasters",
    tooltip:
      "GDACS' active event list — earthquakes, tropical cyclones, floods, wildfires, droughts and volcanoes currently being tracked by the European Commission's JRC with UN OCHA. Dot size is the alert level, so a red event reads larger than a green one. Around a hundred events at any time, worldwide.",
    url: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF",
    refreshMs: MAP_LIVE_DISASTERS_REFRESH_MS,
    attribution: MAP_LIVE_GDACS_ATTRIBUTION,
    payload: "~140 KB, ~99 events",
    cadence: "every 15 min",
    noun: "events",
    format: "json",
  },
  {
    id: "launches",
    label: "Launch sites",
    tooltip:
      "The next twenty orbital launches, labelled at the pad they fly from (Launch Library 2, free and keyless). One marker per PAD, carrying its soonest launch — around a dozen distinct sites at a time, so it is a sparse layer that reads at country zoom and disappears at world zoom.",
    // `mode=list` is 23 KB and carries no pad at all — no latitude, no
    // longitude, nothing to place a marker with. `mode=normal` is the
    // lightest response that does, and most of its bulk is per-launch image
    // and licence metadata this page never reads. There is no field
    // selection on this API.
    url: "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal",
    refreshMs: MAP_LIVE_LAUNCHES_REFRESH_MS,
    attribution: MAP_LIVE_LAUNCH_LIBRARY_ATTRIBUTION,
    payload: "~190 KB, 20 launches",
    cadence: "hourly (1 of 15 requests/hour)",
    noun: "pads",
    format: "json",
  },
  {
    id: "satellites",
    label: "Satellites",
    tooltip:
      "CelesTrak's named 'visual' group — the ~150 brightest objects in orbit, the ones actually visible from the ground. The orbital elements are fetched ONCE and the positions are propagated in your own browser, so the dots move continuously at no network cost at all. This is the only genuinely moving layer on the page.",
    url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
    refreshMs: MAP_LIVE_SATELLITES_REFRESH_MS,
    attribution: MAP_LIVE_CELESTRAK_ATTRIBUTION,
    payload: "~26 KB, ~157 objects, once per session",
    cadence: "elements once per session; motion is local",
    noun: "objects",
    format: "text",
  },
];

export const MAP_LIVE_FEED_BY_ID: Readonly<Record<MapLiveFeedId, MapLiveFeedSpec>> =
  Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f])) as Record<MapLiveFeedId, MapLiveFeedSpec>;

/** The layer id a row mounts under — stable, so a refresh can address it. */
export const mapLiveLayerId = (id: MapLiveFeedId): string => `live-${id}`;

// ── Failure ──────────────────────────────────────────────────────────────

/**
 * What an UNEXPLAINED failure is reported as.
 *
 * A browser turns any request it cannot read into one opaque `TypeError`: a
 * DNS failure, an offline machine, a blocked request, and — the case that
 * matters here — a perfectly ordinary `429 Too Many Requests` from a service
 * that omits `Access-Control-Allow-Origin` on its error responses. There is
 * no way to tell them apart from inside the page, and on these four services
 * the throttle is by far the likeliest, so that is what the reader is told.
 */
export const MAP_LIVE_OPAQUE_REASON = "no response — probably rate limited";

/**
 * How long a request is given before it is abandoned, milliseconds.
 *
 * FORTY-FIVE SECONDS, and it is one service that sets it. Measured from a
 * real browser against the live endpoints: USGS answers in well under a
 * second, GDACS and CelesTrak likewise, and Launch Library's
 * `?mode=normal` — the only response of theirs that carries pad coordinates
 * at all — took 10.6 s, 28.2 s and once more than 25 s on three consecutive
 * calls, while the same URL answers curl in 1.3 s and their own
 * `?mode=list` answers the browser in 4.4 s. So the slow one is genuinely
 * slow and genuinely works, and a timeout tight enough to look reasonable
 * would simply make that row fail.
 *
 * A timeout at all, rather than none, because `fetch` has none: the first
 * browser run of this feature left the launches row at "loading..." forever
 * against a service that was merely slow, which is the one failure mode a
 * reader cannot tell from a bug. `openfreemap.ts` states the same contract
 * for a tile ("404s, TIMES OUT or is undecodable resolves empty"); this is
 * that clause, for a document.
 */
export const MAP_LIVE_TIMEOUT_MS = 45_000;

/** What a timed-out request is reported as — a real failure, never a silent abort. */
export const MAP_LIVE_TIMEOUT_REASON = "no response — the service did not answer in time";

export type MapLiveOutcome =
  | { readonly kind: "ok"; readonly collection: GlyphMapVectorFeatureCollection }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly reason: string; readonly rateLimited: boolean };

/** The transport seam. Injected by tests; the place a timeout or a retry would go. */
export type MapLiveFetch = (url: string, signal: AbortSignal | undefined) => Promise<Response>;

export interface MapLiveRequest {
  readonly feed: MapLiveFeedId;
  readonly signal?: AbortSignal;
  readonly fetchResponse?: MapLiveFetch;
  /**
   * How this payload becomes features, when {@link parseMapLiveFeed} is not
   * the answer.
   *
   * Exactly one caller needs it and it is the satellite row: an element set
   * is an ORBIT, so turning it into points needs an INSTANT as well as the
   * payload, and the propagator (`mapsLiveSatellites.ts`, and the
   * satellite.js dependency behind it) has no business being reachable from
   * the three rows that are plain GeoJSON. So the row supplies its own
   * adapter and keeps the elements it parsed, which is what lets it go on
   * moving with no further request.
   */
  readonly adapt?: (payload: unknown) => GlyphMapVectorFeatureCollection | null;
}

const defaultFetch: MapLiveFetch = (url, signal) => fetch(url, { signal });

/**
 * Fetch one feed and adapt it, and NEVER throw.
 *
 * Four outcomes collapse into three, deliberately: a SUPERSEDED request says
 * nothing (`aborted`), and everything else that went wrong — no network, a
 * non-200, an unreadable body, a body that parsed but carried no usable
 * feature — is one `failed` with one short reader-facing reason. The caller
 * keeps whatever it already had on screen.
 */
export async function fetchMapLiveFeed(request: MapLiveRequest): Promise<MapLiveOutcome> {
  const spec = MAP_LIVE_FEED_BY_ID[request.feed];
  const load = request.fetchResponse ?? defaultFetch;
  if (request.signal?.aborted) return { kind: "aborted" };
  // The caller's signal and this deadline, as one signal. Composed by hand
  // rather than through `AbortSignal.any` so the reason SURVIVES: an aborted
  // request cannot say why it aborted, and the whole point is that a
  // SUPERSEDED request says nothing to the reader while a TIMED-OUT one says
  // something specific.
  let timedOut = false;
  const deadline = new AbortController();
  const timer = setTimeout(() => { timedOut = true; deadline.abort(); }, MAP_LIVE_TIMEOUT_MS);
  const forward = (): void => { deadline.abort(); };
  request.signal?.addEventListener("abort", forward);
  let payload: unknown;
  try {
    const response = await load(spec.url, deadline.signal);
    if (response.status === 429) {
      return { kind: "failed", reason: "rate limited — try again later", rateLimited: true };
    }
    if (!response.ok) {
      return { kind: "failed", reason: `service responded ${response.status}`, rateLimited: false };
    }
    payload = spec.format === "text" ? await response.text() : await response.json();
  } catch {
    if (request.signal?.aborted) return { kind: "aborted" };
    if (timedOut) return { kind: "failed", reason: MAP_LIVE_TIMEOUT_REASON, rateLimited: false };
    // See MAP_LIVE_OPAQUE_REASON: this branch cannot distinguish a throttle
    // from an outage, and the throttle is the likelier of the two.
    return { kind: "failed", reason: MAP_LIVE_OPAQUE_REASON, rateLimited: true };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", forward);
  }
  if (request.signal?.aborted) return { kind: "aborted" };
  const collection = (request.adapt ?? ((body: unknown) => parseMapLiveFeed(request.feed, body)))(payload);
  if (!collection) return { kind: "failed", reason: "unreadable response", rateLimited: false };
  return { kind: "ok", collection };
}

/** Route a feed's raw payload to its own reader. `null` = not a body this feed can produce. */
export function parseMapLiveFeed(feed: MapLiveFeedId, payload: unknown): GlyphMapVectorFeatureCollection | null {
  switch (feed) {
    case "quakes": return parseMapLiveQuakes(payload);
    case "disasters": return parseMapLiveDisasters(payload);
    case "launches": return parseMapLiveLaunches(payload);
    // Element sets are not features — they are an orbit each, and the
    // features come from propagating them at an instant. The satellite row
    // therefore goes through `mapsLiveSatellites.ts` rather than here, and
    // this arm exists so the exhaustive switch stays exhaustive.
    case "satellites": return null;
  }
}

// ── Readers ──────────────────────────────────────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A GeoJSON `Point` geometry's `[lon, lat]`, or `null` for anything else. */
function pointOf(geometry: unknown): readonly [number, number] | null {
  const g = record(geometry);
  if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as number[];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function pointFeature(id: string, point: readonly [number, number], properties: Record<string, unknown>): GlyphMapVectorFeature {
  return { id, geometryType: "point", properties, rings: [[point]] };
}

/**
 * USGS' summary GeoJSON.
 *
 * `id` is the event id (`us7000tgf2`) and it is what makes a refresh a
 * RECONCILE rather than a rebuild — the same event keeps the same marker
 * element across every refresh for the week it stays in the window, and only
 * genuinely new events create one.
 *
 * `geometry.coordinates` is `[lon, lat, depthKm]` — a THREE-element point,
 * where the third number is DEPTH IN KILOMETRES BELOW the surface, not an
 * elevation. It is carried as a property rather than handed to the
 * projection: a marker is a positioned `<div>` over the grid, so it has no
 * depth to be drawn at, and feeding a negative elevation would only sink the
 * anchor through the terrain.
 */
export function parseMapLiveQuakes(payload: unknown): GlyphMapVectorFeatureCollection | null {
  const body = record(payload);
  if (!body || !Array.isArray(body.features)) return null;
  const features: GlyphMapVectorFeature[] = [];
  for (const raw of body.features) {
    const f = record(raw);
    if (!f) continue;
    const point = pointOf(f.geometry);
    const id = typeof f.id === "string" ? f.id : "";
    if (!point || !id) continue;
    const p = record(f.properties) ?? {};
    const mag = typeof p.mag === "number" && Number.isFinite(p.mag) ? p.mag : 0;
    const depth = Array.isArray((record(f.geometry) ?? {}).coordinates) ? Number(((record(f.geometry)!.coordinates) as number[])[2]) : NaN;
    features.push(pointFeature(id, point, {
      mag,
      // The arbiter and the label both read this; USGS' own `title` is
      // already "M 5.3 - 83 km E of Lospalos, Timor Leste".
      title: typeof p.title === "string" ? p.title : `M ${mag}`,
      place: typeof p.place === "string" ? p.place : "",
      depthKm: Number.isFinite(depth) ? depth : null,
      time: typeof p.time === "number" ? p.time : null,
      url: typeof p.url === "string" ? p.url : "",
    }));
  }
  return { features, attribution: MAP_LIVE_USGS_ATTRIBUTION };
}

/**
 * GDACS' alert levels as a number, so one `radiusProperty` can express them.
 *
 * Green/Orange/Red is the whole vocabulary the API uses (`alertlevel`), and
 * it is ORDINAL — an orange event is more serious than a green one — so a
 * dot size is a faithful encoding of it. An unrecognised value reads as the
 * lowest rather than being dropped: a new alert level is still an event.
 */
export function mapLiveAlertRank(alertLevel: unknown): number {
  const level = typeof alertLevel === "string" ? alertLevel.toLowerCase() : "";
  if (level === "red") return 3;
  if (level === "orange") return 2;
  return 1;
}

/**
 * GDACS' active event list.
 *
 * Every feature in this response is a `Point` — the event's centroid — and
 * that is the whole feed. A tropical cyclone's TRACK is real and it is
 * literally a set of `LineString`s, but it lives behind a per-event geometry
 * endpoint (`properties.url.geometry`), one request per event, and one
 * measured cyclone's geometry document is 389 KB for 48 line segments and 62
 * polygons. Eighteen live cyclones is therefore about 7 MB across 18
 * requests, which is not a feed and is not what this row is.
 *
 * `eventid` is the identity across refreshes. `episodeid` deliberately is
 * NOT part of it: an episode is an UPDATE to the same event, so folding it
 * into the key would retire and re-create the marker every time the event
 * was re-scored — exactly the churn the reconcile exists to avoid.
 */
export function parseMapLiveDisasters(payload: unknown): GlyphMapVectorFeatureCollection | null {
  const body = record(payload);
  if (!body || !Array.isArray(body.features)) return null;
  const features: GlyphMapVectorFeature[] = [];
  for (const raw of body.features) {
    const f = record(raw);
    if (!f) continue;
    const point = pointOf(f.geometry);
    const p = record(f.properties);
    if (!point || !p) continue;
    const eventId = p.eventid;
    if (typeof eventId !== "number" && typeof eventId !== "string") continue;
    const severity = record(p.severitydata);
    features.push(pointFeature(`gdacs-${eventId}`, point, {
      title: typeof p.name === "string" ? p.name : String(p.eventname ?? ""),
      eventType: typeof p.eventtype === "string" ? p.eventtype : "",
      alertLevel: typeof p.alertlevel === "string" ? p.alertlevel : "",
      alertRank: mapLiveAlertRank(p.alertlevel),
      country: typeof p.country === "string" ? p.country : "",
      severity: typeof severity?.severitytext === "string" ? severity.severitytext : "",
    }));
  }
  return { features, attribution: MAP_LIVE_GDACS_ATTRIBUTION };
}

/**
 * Launch Library 2's upcoming manifest, reduced to ONE MARKER PER PAD.
 *
 * Two launches from the same pad are two rows in the response and one dot on
 * a map — at any zoom this page renders, a second label on the same pad is
 * an unreadable overlap, not extra information. The SOONEST launch wins,
 * because `net` is what a reader wants from a launch site. The results
 * arrive ordered by `net` already, so this is `first one wins` and no sort
 * is needed; it is written as an explicit comparison anyway, since an
 * ordering that comes back from a service is not an ordering this page may
 * assume.
 *
 * The pad id is the marker identity, so an hourly refresh moves nothing and
 * only re-labels a pad whose next launch changed.
 */
export function parseMapLiveLaunches(payload: unknown): GlyphMapVectorFeatureCollection | null {
  const body = record(payload);
  if (!body || !Array.isArray(body.results)) return null;
  const byPad = new Map<string, { feature: GlyphMapVectorFeature; net: number }>();
  for (const raw of body.results) {
    const launch = record(raw);
    if (!launch) continue;
    const pad = record(launch.pad);
    if (!pad) continue;
    // `typeof` first, then `Number`: `Number(null)` is 0, so a pad whose
    // coordinates are explicitly null (this API's own way of saying "not
    // located") would otherwise be placed in the Gulf of Guinea. Measured on
    // the real manifest — the API does ship such pads.
    if (typeof pad.longitude !== "number" || typeof pad.latitude !== "number") continue;
    const lon = pad.longitude;
    const lat = pad.latitude;
    const padId = pad.id;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (typeof padId !== "number" && typeof padId !== "string") continue;
    const net = Date.parse(typeof launch.net === "string" ? launch.net : "");
    const when = Number.isFinite(net) ? net : Number.POSITIVE_INFINITY;
    const held = byPad.get(String(padId));
    if (held && held.net <= when) continue;
    const location = record(pad.location);
    byPad.set(String(padId), {
      net: when,
      feature: pointFeature(`pad-${padId}`, [lon, lat], {
        title: typeof launch.name === "string" ? launch.name : "",
        pad: typeof pad.name === "string" ? pad.name : "",
        site: typeof location?.name === "string" ? location.name : "",
        net: typeof launch.net === "string" ? launch.net : "",
        provider: String(record(launch.launch_service_provider)?.name ?? ""),
        // The declutter arbiter's tie-break, and the only ranking these have:
        // the SOONER launch wins a collision. A rank over the pad list rather
        // than the raw timestamp, because the arbiter compares magnitudes and
        // a millisecond epoch is 13 digits of noise around a difference of
        // hours. Filled in below, once the whole manifest is known.
        priority: 0,
      }),
    });
  }
  // Soonest first, then rank descending, so the next launch on the manifest
  // carries the largest number.
  const ordered = [...byPad.values()].sort((a, b) => a.net - b.net);
  const features = ordered.map((entry, i) => ({
    ...entry.feature,
    properties: { ...entry.feature.properties, priority: ordered.length - i },
  }));
  return { features, attribution: MAP_LIVE_LAUNCH_LIBRARY_ATTRIBUTION };
}

// ── Layers ───────────────────────────────────────────────────────────────

/**
 * Colours, in the page's own palette rather than in the data's: GDACS ship
 * an alert COLOUR and USGS a `sig` score, and letting a service decide what
 * a cell is painted is both a legibility problem (three fixed colours that
 * have never been checked against this page's terrain ramps) and the same
 * class of mistake as reading an attribution off a payload.
 */
export const MAP_LIVE_COLORS: Readonly<Record<MapLiveFeedId, string>> = {
  quakes: "#ff6b4a",
  disasters: "#ffd166",
  launches: "#8ecae6",
  satellites: "#c9f0ff",
};

/**
 * The layer one row mounts.
 *
 * `circle` for the three quantitative rows and `symbol` for launches, and
 * the split is not a style choice: `circle` runs NO declutter arbiter (its
 * `sync` culls the far hemisphere and returns), so it draws every point it
 * is given at every zoom — right for a few hundred sized dots, wrong for a
 * few hundred names. `symbol` runs the arbiter, which is what makes a dozen
 * pad labels legible instead of a pile.
 *
 * Every layer takes a COLLECTION, never a provider: these feeds are one
 * document each, with no tile pyramid and nothing to sweep, and a static
 * source is exactly the kind the widget leaves inert until told
 * (`scheduleTileUpdate` re-sweeps only provider-backed layers). A live layer
 * should move when its data moves, not when the camera does.
 */
export function mapLiveLayer(
  id: MapLiveFeedId,
  source: GlyphMapVectorFeatureCollection,
): GlyphMapCircleLayer | GlyphMapSymbolLayer {
  const layerId = mapLiveLayerId(id);
  const color = MAP_LIVE_COLORS[id];
  switch (id) {
    case "quakes":
      // Radius from magnitude. The scale is what turns a 2.5..7.5 range into
      // a 4..12 px radius: small enough that the densest plate boundary is
      // still a chain of dots rather than a bar, large enough that a great
      // earthquake reads at world zoom.
      return { type: "circle", id: layerId, source, color, radiusProperty: "mag", radiusScale: 1.6, radius: 3 };
    case "disasters":
      // Alert level, 1..3, at 3 px a step.
      return { type: "circle", id: layerId, source, color, radiusProperty: "alertRank", radiusScale: 3, radius: 3 };
    case "satellites":
      return { type: "circle", id: layerId, source, color, radius: 2 };
    case "launches":
      // `textOffset` a cell up: the label would otherwise sit ON the pad it
      // names. `priorityProperty` is the arbiter's tie-break and these have
      // no natural ranking, so the soonest launch wins by carrying the
      // larger number (see `parseMapLiveLaunches`).
      return {
        type: "symbol", id: layerId, source, color,
        textProperty: "title", textAnchor: "top", textOffset: [0, -1],
        priorityProperty: "priority",
      };
  }
}
