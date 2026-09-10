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
 * open all day cannot breach any published limit; see each cadence constant,
 * and the "Time windows" block for why a window may carry its own.
 *
 * ## Every field name here was read out of a live response
 *
 * Not out of prose docs — the same rule `vector/openmaptiles.ts` holds for
 * OpenFreeMap. One real captured response per feed AND PER WINDOW is
 * vendored under `fixtures/live/`, each carrying the exact URL that produced
 * it, and `mapsLive.test.ts` / `mapsLive.windows.test.ts` replay them through
 * the transport seam below. No test here touches the network.
 */
import type {
  GlyphMapAttribution,
  GlyphMapGlyphLayer,
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
//
// THE RULE: poll at the publisher's own regeneration interval, unless the
// payload makes that wasteful. Every interval below is spent against the
// READER's own IP, not a shared site quota — the fetch happens in their
// browser — but a window that re-reads half a megabyte twelve times an hour
// to gain one event is waste wherever it is spent.

/**
 * USGS regenerate the summary feeds every one to five minutes and publish no
 * rate limit; the feeds are served from a CDN. Five minutes is therefore the
 * fastest cadence that can bring anything new — 12 requests an hour, and a
 * faster one would re-read a file that had not changed.
 *
 * It is the cadence of THREE of the four quake windows, because all three
 * are light (11-265 KB) and all three genuinely gain events at that scale:
 * the hour window gains one every four minutes, the day window one every
 * five, the week window one every twenty-seven.
 */
export const MAP_LIVE_QUAKES_REFRESH_MS = 5 * 60_000;

/**
 * THIRTY MINUTES, for the month window alone.
 *
 * `4.5_month` is 440 KB and carries 644 events — 0.9 an hour, i.e. 0.075 per
 * five minutes. At the floor above, twelve of every thirteen requests would
 * re-read an unchanged 440 KB file, which is 5.3 MB an hour to learn
 * nothing. At half an hour it is 0.45 new events per request and 880 KB an
 * hour: the same picture, a sixth of the bandwidth. This is the whole of
 * "the cadence follows the window" — nothing else in the ladder needed to
 * move, because nothing else in it is heavy.
 */
export const MAP_LIVE_QUAKES_MONTH_REFRESH_MS = 30 * 60_000;

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
 * THIRTY MINUTES, for the 24-hour launch window alone.
 *
 * The one window where the cadence has a reason to be finer than the row's:
 * a T-0 inside the next day slips by minutes, and a slip is the only thing
 * about a launch that changes on that scale. It is also by far the smallest
 * response of the four (15 KB against 190 KB), so two an hour is 30 KB an
 * hour — 2 of the reader's own measured 15 requests, against the 1 the
 * other three windows spend.
 */
export const MAP_LIVE_LAUNCHES_DAY_REFRESH_MS = 30 * 60_000;

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

// ── Time windows ─────────────────────────────────────────────────────────
//
// Asked for in these words: "those sets need a filter of recency, like last
// hour, today, last week, etc".
//
// ## A window is a DIFFERENT SOURCE, never a filtered payload
//
// USGS publish one summary feed per window and Launch Library take a `net`
// bound, so a narrower window is a SMALLER DOWNLOAD rather than a larger one
// with most of it thrown away. Measured against the live services, in bytes
// and features:
//
// | USGS feed          | bytes | events |   | USGS feed    | bytes | events |
// |--------------------|-------|--------|---|--------------|-------|--------|
// | `all_hour`         |  11 K |     15 |   | `all_week`   | 1.5 M |  2,184 |
// | `all_day`          | 195 K |    278 |   | `2.5_month`  | 1.5 M |  2,225 |
// | `2.5_day`          |  20 K |     28 |   | `4.5_month`  | 440 K |    644 |
// | `2.5_week`         | 265 K |    380 |   | `1.0_month`  | 5.2 M |  7,716 |
// | `4.5_week`         |  58 K |     85 |   | `all_month`  | 7.5 M | 10,988 |
//
// ## ONE axis, not two
//
// USGS cross a magnitude FLOOR (`all`/`1.0`/`2.5`/`4.5`) with a WINDOW
// (`hour`/`day`/`week`/`month`), and the control is the window alone with
// the floor CHOSEN PER WINDOW. Three reasons, and the first alone settles
// it:
//
//  1. Two axes is sixteen combinations, and the table above shows what is in
//     them: a 7.5 MB / 10,988-event `all_month` at one corner and an
//     almost-always-empty `4.5_hour` at the other. A control that can
//     produce a page-breaking download and a blank layer is not a control a
//     reader can use, and nothing on the card could tell them which
//     combination is which.
//  2. The floor is not a thing a reader of a MAP wants to pick. It is the
//     PRICE of the window — the only lever that keeps a month inside half a
//     megabyte — so it belongs to the window, derived, not chosen.
//  3. Because it is hidden, it is STATED: every button's own tooltip names
//     the floor it carries ({@link MapLiveWindowSpec.desc}), and
//     `mapsLive.windows.test.ts` reddens if one stops.
//
// The ladder that falls out — `all_hour`, `all_day`, `2.5_week`,
// `4.5_month` — rises in floor exactly as the window widens, and every rung
// of it is between 11 KB and 440 KB. `all_month` is not on it at any floor
// below 4.5: 7.5 MB is not a fetch a page may make on a reader's behalf, and
// 10,988 marks is not a picture.
//
// ## Two of the four rows have no time axis, and get no control
//
// - **Disasters (GDACS)** is a list of CURRENTLY ACTIVE events, not a
//   rolling window. The payload does carry dates (`fromdate`, `todate`,
//   `datemodified`), so a filter is possible — and measured on the vendored
//   99-event capture it is destructive: NOT ONE of those events began in the
//   last seven days, and the median age of a start date is 142 days for an
//   earthquake, 271 for a flood and 309 for a tropical cyclone. Every window
//   a reader would pick empties the row. That is the mechanical answer; the
//   real one is that filtering an ongoing cyclone by when it FORMED hides a
//   live hazard, which is the opposite of what this row is for.
// - **Satellites (CelesTrak)** is a live position. There is no recency
//   dimension at all: the elements are fetched once and propagated locally,
//   and every mark is where the object is right now.

/** Every window any row can be read at — **APPEND-ONLY**, it is a wire vocabulary (`MAPS_LIVE_WINDOW_KEYS`). */
export const MAP_LIVE_WINDOW_IDS = ["hour", "day", "week", "month", "all"] as const;
export type MapLiveWindowId = (typeof MAP_LIVE_WINDOW_IDS)[number];

export interface MapLiveWindowSpec {
  readonly id: MapLiveWindowId;
  /** The toggle button's own text — short, because it sits in a 24px card row. */
  readonly label: string;
  /**
   * The button's tooltip. It must say what the window IS, what it COSTS,
   * and — for a quake window — what MAGNITUDE FLOOR it carries, because the
   * floor is chosen for the reader and a control that changes something it
   * does not mention is a control that misleads.
   */
  readonly desc: string;
  /**
   * The URL this window fetches, at the instant it is fetched.
   *
   * A function of `now` rather than a string because Launch Library has no
   * per-window feed: its window is a `net__lte` bound computed from the
   * clock. USGS' are constant and simply ignore the argument.
   */
  readonly url: (now: number) => string;
  /** Milliseconds between refreshes — see each constant for why it is that number. */
  readonly refreshMs: number;
  /** What this window costs the reader per refresh, measured against the live service. */
  readonly payload: string;
}

const usgsSummary = (slug: string) => (): string =>
  `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${slug}.geojson`;

/**
 * An instant as Launch Library's filters take it — whole seconds, no
 * milliseconds. Their own `net` values are written this way, and the
 * captured fixtures carry the exact string this produces, so a change here
 * reddens `mapsLive.windows.test.ts` rather than silently asking for a URL
 * no capture was ever taken from.
 */
const launchInstant = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * `mode=list` is 23 KB and carries no pad at all — no latitude, no
 * longitude, nothing to place a marker with. `mode=normal` is the lightest
 * response that does, and most of its bulk is per-launch image and licence
 * metadata this page never reads. There is no field selection on this API.
 *
 * `limit=20` is a COUNT bound and it is unchanged by every window: the row
 * has always been "the next twenty", and a time window narrows that rather
 * than replacing it.
 */
const LAUNCH_MANIFEST = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal";
const launchWithin = (aheadMs: number) => (now: number): string =>
  `${LAUNCH_MANIFEST}&net__lte=${launchInstant(now + aheadMs)}`;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const QUAKE_WINDOWS: readonly MapLiveWindowSpec[] = [
  {
    id: "hour", label: "1h",
    desc: "the last HOUR, every magnitude — USGS' own `all_hour` feed, ~11 KB and around 15 events. Nothing is filtered out here, because an hour of magnitude 2.5+ worldwide is about two events and two marks is not a map.",
    url: usgsSummary("all_hour"), refreshMs: MAP_LIVE_QUAKES_REFRESH_MS, payload: "~11 KB, ~15 events",
  },
  {
    id: "day", label: "24h",
    desc: "the last 24 HOURS, every magnitude — `all_day`, ~195 KB and around 280 events. Still unfiltered: a day of magnitude 2.5+ is 28 events, which reads as scattered dots rather than as the plate boundaries.",
    url: usgsSummary("all_day"), refreshMs: MAP_LIVE_QUAKES_REFRESH_MS, payload: "~195 KB, ~280 events",
  },
  {
    id: "week", label: "7d",
    desc: "the last SEVEN DAYS, magnitude 2.5 and up — `2.5_week`, ~265 KB and around 380 events. The floor starts here because the unfiltered week is 1.5 MB and 2,184 events, which is neither a reasonable download nor a legible picture.",
    url: usgsSummary("2.5_week"), refreshMs: MAP_LIVE_QUAKES_REFRESH_MS, payload: "~265 KB, ~380 events",
  },
  {
    id: "month", label: "30d",
    desc: "the last THIRTY DAYS, magnitude 4.5 and up — `4.5_month`, ~440 KB and around 640 events, refreshed every half hour rather than every five minutes. The floor rises again because the magnitude 2.5 month is 1.5 MB and the unfiltered one is 7.5 MB and 10,988 events.",
    url: usgsSummary("4.5_month"), refreshMs: MAP_LIVE_QUAKES_MONTH_REFRESH_MS, payload: "~440 KB, ~640 events",
  },
];

/**
 * The launch row's axis points FORWARD — the manifest is upcoming, so the
 * question is "what flies in the next week", never "what flew last week".
 *
 * `all` is the row exactly as it shipped: no time bound at all, twenty
 * launches however far out they reach (about three weeks at the current
 * cadence). It stays the DEFAULT, so a link written before this control
 * existed fetches the same URL it always did.
 */
const LAUNCH_WINDOWS: readonly MapLiveWindowSpec[] = [
  {
    id: "day", label: "24h",
    desc: "the next 24 HOURS — around two launches from two pads, ~15 KB. Polled twice an hour rather than once, because a T-0 inside the next day slips by minutes and this is the only window in which that changes the picture.",
    url: launchWithin(DAY_MS), refreshMs: MAP_LIVE_LAUNCHES_DAY_REFRESH_MS, payload: "~15 KB, ~2 launches",
  },
  {
    id: "week", label: "7d",
    desc: "the next SEVEN DAYS — around nine launches from eight pads, ~85 KB.",
    url: launchWithin(7 * DAY_MS), refreshMs: MAP_LIVE_LAUNCHES_REFRESH_MS, payload: "~85 KB, ~9 launches",
  },
  {
    id: "month", label: "30d",
    desc: "the next THIRTY DAYS — the manifest carries more launches than the twenty this row asks for, so at this width the COUNT is what binds, not the date. ~190 KB.",
    url: launchWithin(30 * DAY_MS), refreshMs: MAP_LIVE_LAUNCHES_REFRESH_MS, payload: "~190 KB, 20 of ~23 launches",
  },
  {
    id: "all", label: "all",
    desc: "the next twenty launches, however far out they are — about three weeks, and no date bound at all. What this row has always shown. ~190 KB.",
    url: () => LAUNCH_MANIFEST, refreshMs: MAP_LIVE_LAUNCHES_REFRESH_MS, payload: "~190 KB, 20 launches",
  },
];

/** The single "window" of a row that has no time axis — see the block above for why these two do not. */
const ONE_WINDOW = (url: string, refreshMs: number, payload: string): readonly MapLiveWindowSpec[] =>
  [{ id: "all", label: "all", desc: "", url: () => url, refreshMs, payload }];

// ── Feed specifications ──────────────────────────────────────────────────

export interface MapLiveFeedSpec {
  readonly id: MapLiveFeedId;
  readonly label: string;
  /** The row's tooltip: what it is, and when it has something to show. */
  readonly tooltip: string;
  readonly attribution: readonly GlyphMapAttribution[];
  /** What this row COUNTS, in the reader's words: "115 events", never "115 features". */
  readonly noun: string;
  /** `text` for a feed whose body is not JSON (CelesTrak serves plain-text element sets). */
  readonly format: "json" | "text";
  /**
   * The windows this row can be read at, in the order the card shows them.
   *
   * NEVER empty, and **`length > 1` is the whole rule for whether the row
   * gets a control**: a row with one window is a row with no time axis, and
   * a control that cannot change anything is worse than no control.
   */
  readonly windows: readonly MapLiveWindowSpec[];
  /** The window a link that names none decodes to — FROZEN, see `mapsUrlState.ts`'s `liveWindows`. */
  readonly defaultWindow: MapLiveWindowId;
}

export const MAP_LIVE_FEEDS: readonly MapLiveFeedSpec[] = [
  {
    id: "quakes",
    label: "Earthquakes",
    tooltip:
      "Worldwide earthquakes from the USGS summary feeds (US Government work, public domain), over whichever time window the row is set to — the magnitude floor comes with the window, and each button says which one it carries. Drawn as glyphs in the grid, sized by magnitude; the biggest and the most recent also get their name. Click one to open its USGS page. Always has something to show — the planet produces a few hundred a week, and they trace the plate boundaries, which is the shape a character grid draws best.",
    attribution: MAP_LIVE_USGS_ATTRIBUTION,
    noun: "quakes",
    format: "json",
    windows: QUAKE_WINDOWS,
    defaultWindow: "week",
  },
  {
    id: "disasters",
    label: "Disasters",
    tooltip:
      "GDACS' active event list — earthquakes, tropical cyclones, floods, wildfires, droughts and volcanoes currently being tracked by the European Commission's JRC with UN OCHA. Drawn as rings, sized by alert level, so a red event reads larger than a green one and none of them can be mistaken for a quake. Around a hundred events at any time, worldwide. No time window: this is a list of what is ACTIVE, not a rolling one — measured on a real capture, not one of its 99 events had begun in the previous week.",
    attribution: MAP_LIVE_GDACS_ATTRIBUTION,
    noun: "events",
    format: "json",
    windows: ONE_WINDOW(
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF",
      MAP_LIVE_DISASTERS_REFRESH_MS,
      "~140 KB, ~99 events",
    ),
    defaultWindow: "all",
  },
  {
    id: "launches",
    label: "Launch sites",
    tooltip:
      "The next orbital launches, labelled at the pad they fly from (Launch Library 2, free and keyless). One glyph per PAD, carrying its soonest launch. The window points FORWARD — this row is upcoming, so it answers \"what flies in the next week\", never \"what flew last week\" — and at its widest it is around a dozen distinct sites, so it is a sparse layer that reads at country zoom and disappears at world zoom.",
    attribution: MAP_LIVE_LAUNCH_LIBRARY_ATTRIBUTION,
    noun: "pads",
    format: "json",
    windows: LAUNCH_WINDOWS,
    defaultWindow: "all",
  },
  {
    id: "satellites",
    label: "Satellites",
    tooltip:
      "CelesTrak's named 'visual' group — the ~150 brightest objects in orbit, the ones actually visible from the ground. Drawn as stars at their REAL orbital altitude, so on a globe they stand clear of the surface and vanish behind the far side. The elements are fetched ONCE and the positions are propagated in your own browser, so they move continuously at no network cost at all. This is the only genuinely moving layer on the page, and the one row with no time axis of any kind: every mark is where the object is right now.",
    attribution: MAP_LIVE_CELESTRAK_ATTRIBUTION,
    noun: "objects",
    format: "text",
    windows: ONE_WINDOW(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
      MAP_LIVE_SATELLITES_REFRESH_MS,
      "~26 KB, ~157 objects, once per session",
    ),
    defaultWindow: "all",
  },
];

export const MAP_LIVE_FEED_BY_ID: Readonly<Record<MapLiveFeedId, MapLiveFeedSpec>> =
  Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f])) as Record<MapLiveFeedId, MapLiveFeedSpec>;

/** The layer id a row mounts under — stable, so a refresh can address it. */
export const mapLiveLayerId = (id: MapLiveFeedId): string => `live-${id}`;

/**
 * One row's window, resolved.
 *
 * A window the row does not offer falls back to the row's own default
 * rather than throwing or returning nothing. That is not defensive coding
 * for a case that cannot happen: `liveWindows` is a URL field, so a link
 * written by a build with a different window list is a real input, and a
 * row that refused to resolve one would simply stop fetching.
 */
export function mapLiveWindow(feed: MapLiveFeedId, window: MapLiveWindowId): MapLiveWindowSpec {
  const spec = MAP_LIVE_FEED_BY_ID[feed];
  return spec.windows.find((w) => w.id === window)
    ?? spec.windows.find((w) => w.id === spec.defaultWindow)
    ?? spec.windows[0]!;
}

/** What one row fetches, at the instant it fetches it. The launch windows are a `net` bound, so `now` is not decoration. */
export function mapLiveFeedUrl(feed: MapLiveFeedId, window: MapLiveWindowId, now: number): string {
  return mapLiveWindow(feed, window).url(now);
}

/** How often one row refreshes at that window — see each cadence constant for why it is that number. */
export function mapLiveRefreshMs(feed: MapLiveFeedId, window: MapLiveWindowId): number {
  return mapLiveWindow(feed, window).refreshMs;
}

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
  /**
   * Which time window to read the feed at. Omitted = the row's own frozen
   * default, which is the URL this page fetched before windows existed.
   */
  readonly window?: MapLiveWindowId;
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
  /**
   * The instant this response is being read AT, milliseconds — supplied by
   * the controller so its own clock seam reaches the readers.
   *
   * One reader needs it: a quake's label priority is a function of its AGE
   * (see {@link mapLiveQuakeLabelScore}), and a score baked from
   * `Date.now()` inside a pure reader would make every test of it depend on
   * when it ran.
   */
  readonly now?: number;
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
  // The controller's clock seam reaches the URL as well as the readers: a
  // launch window is a `net` bound computed from it.
  const now = request.now ?? Date.now();
  const url = mapLiveFeedUrl(request.feed, request.window ?? spec.defaultWindow, now);
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
    const response = await load(url, deadline.signal);
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
  const collection = (request.adapt ?? ((body: unknown) => parseMapLiveFeed(request.feed, body, now)))(payload);
  if (!collection) return { kind: "failed", reason: "unreadable response", rateLimited: false };
  return { kind: "ok", collection };
}

/** Route a feed's raw payload to its own reader. `null` = not a body this feed can produce. */
export function parseMapLiveFeed(feed: MapLiveFeedId, payload: unknown, now = Date.now()): GlyphMapVectorFeatureCollection | null {
  switch (feed) {
    case "quakes": return parseMapLiveQuakes(payload, now);
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
 * How much a JUST-HAPPENED quake is worth, in MAGNITUDE POINTS, when the
 * declutter arbiter is deciding whose name to draw.
 *
 * The user asked for the trade in these words: "probably depending on
 * magnitude and how long has it happened". Both axes, as one score, so the
 * arbiter's existing greedy rule does the work and the label set thins
 * smoothly as the view zooms out instead of switching on at a threshold.
 *
 * MAGNITUDE IS THE UNIT, and it needs no scaling of its own: the Richter
 * scale is already logarithmic in energy, which is what every seismological
 * map draws, so `mag` enters the score unmodified and this constant is
 * simply how many steps of it recency is allowed to be worth.
 *
 * `1.5` is a statement a reader can check: a quake that happened MINUTES ago
 * outranks one up to 1.5 magnitudes larger from earlier in the week, and
 * nothing under M4 can outrank a M5.5 however fresh it is. Measured on the
 * vendored USGS week (385 events, M2.46-M5.6): at 1.5 the top of the list is
 * the two events of the last two hours, then the week's M5.5s and M5.6s with
 * a fresh M4.8 and M5.0 among them. At `2.0` an M4.1 from two hours ago
 * outranks every M5.5 on the planet, which is the wrong trade; at `1.0`
 * recency barely reorders anything and the score is just magnitude with
 * extra steps.
 */
export const MAP_LIVE_QUAKE_RECENCY_WEIGHT = 1.5;

/**
 * The time constant of the recency term, HOURS.
 *
 * A DECAY rather than a linear term, because the difference between "an hour
 * ago" and "two hours ago" is enormous and the difference between five days
 * and six is nothing — a linear age would spend the same amount of score on
 * both. Twelve hours puts the bonus at 61% after 6 h, 37% after 12 h, 14%
 * after a day and effectively nothing after three, which matches how long an
 * event stays news against a rolling SEVEN-day window.
 */
export const MAP_LIVE_QUAKE_RECENCY_TAU_H = 12;

/**
 * One quake's label priority: its magnitude plus a decaying recency bonus.
 *
 * A quake with no usable timestamp scores its magnitude alone rather than
 * being dropped or treated as infinitely old — an event with a missing field
 * is still an event, and magnitude is the axis that never goes missing.
 *
 * Only LABELS are rationed by this. Every quake is still drawn at its own
 * magnitude size; losing a name does not make an event invisible.
 */
export function mapLiveQuakeLabelScore(mag: number, timeMs: number | null, now: number): number {
  if (timeMs === null || !Number.isFinite(timeMs)) return mag;
  const ageHours = Math.max(0, (now - timeMs) / 3_600_000);
  return mag + MAP_LIVE_QUAKE_RECENCY_WEIGHT * Math.exp(-ageHours / MAP_LIVE_QUAKE_RECENCY_TAU_H);
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
 * elevation. It stays a PROPERTY and is never fed to the elevation axis,
 * and now that the mark is drawn in the grid that is a measured decision
 * rather than a convenience: a `glyph` layer's `altitudeProperty` would take
 * it happily, and the vendored week reaches 608 km down, so the mark would
 * be stamped inside the planet and blanked by the surface the reader can
 * see. `widget.glyphPoint.test.ts` renders exactly that and counts zero
 * cells. The epicentre is where a map says an earthquake IS.
 */
export function parseMapLiveQuakes(payload: unknown, now = Date.now()): GlyphMapVectorFeatureCollection | null {
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
      // What the declutter arbiter ranks this quake's LABEL by. Baked at
      // parse time because that is where both inputs are, and re-baked on
      // every refresh, which is what keeps the recency term moving.
      labelScore: mapLiveQuakeLabelScore(mag, typeof p.time === "number" ? p.time : null, now),
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
 * Whether this collection's features carry a URL worth opening.
 *
 * Read off the DATA, not off the row id: only the USGS feed ships a `url`
 * today, and a `case "quakes": onSelect` would make that a hard-coded fact
 * about one row rather than a property of what arrived. A collection with no
 * urls declares no `onSelect`, so the widget arms neither the hit test nor
 * the pointer cursor — a mark that opens nothing must not advertise that it
 * would.
 */
function featuresCarryUrls(source: GlyphMapVectorFeatureCollection): boolean {
  return source.features.some((f) => typeof f.properties?.url === "string" && (f.properties.url as string) !== "");
}

/**
 * Open a live feature's own `url` in a new tab.
 *
 * TWO deliberate details.
 *
 * `noopener,noreferrer` in the window features is what strips
 * `window.opener` from the page being opened: without it the third-party
 * document gets a live handle on this one and can navigate it. That is a
 * real capability being handed to a page whose content this page does not
 * control.
 *
 * The scheme is CHECKED. `url` came out of a network payload, so it is
 * untrusted text, and `window.open("javascript:...")` executes in this
 * origin. Only `http`/`https` are opened; anything else is silently ignored,
 * which is the right answer for a click on a marker rather than an error a
 * reader could not act on. `open` is a seam so the test can assert what
 * would have been opened without opening it.
 */
export function mapLiveOpenFeature(
  feature: GlyphMapVectorFeature,
  open: (url: string) => void = (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
): void {
  const url = feature.properties?.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  open(url);
}

/**
 * The layer one row mounts.
 *
 * ALL FOUR ROWS ARE `glyph` LAYERS — marks stamped into the character grid,
 * not `<div>`s positioned above it. Asked for in these words, on seeing the
 * DOM version: "lets not use that for the live datasets, lets use glyphs for
 * them :/". Three things come with it beyond the look: the marks survive
 * "Copy ASCII", they are occluded by the terrain in front of them, and they
 * disappear round the limb of a globe — none of which a `<div>` can do. The
 * page's OTHER point rows (places, peaks, POIs, countries, the OSM
 * sublayers) are deliberately untouched and stay `symbol`/`circle`: a name a
 * reader selects and copies is a genuinely different thing from a mark, and
 * converting the whole page is its own decision.
 *
 * ## What each row's mark IS
 *
 * The default ramp (`GLYPH_MAP_POINT_RAMP`, three centred discs of
 * increasing ink) carries a MAGNITUDE; a row whose mark carries an IDENTITY
 * instead supplies its own one- or two-entry ramp:
 *
 * - **quakes** — the disc ramp, sized by magnitude, plus a label.
 * - **disasters** — a ring ramp (`⊙ ⊚ ◉`) sized by alert level, so an alert
 *   is distinguishable from a quake in the two cases colour cannot help:
 *   `useColors: false`, and a reader who does not know which hue is which.
 *   The rings are the ramp's own ink profile, not a three-value scale — the
 *   ALERT LEVEL is carried by the size, exactly as a quake's magnitude is.
 * - **launches** — `▲`, one cell, a pad. Nothing here has a magnitude, so
 *   the mark is fixed and the row's information is its label.
 * - **satellites** — `★`, one cell. CelesTrak's `visual` group is literally
 *   the brightest objects in orbit, so a star is what they are, and a
 *   full-cell glyph is the answer to "the satellites are super tiny": about
 *   seven times the drawn area of the 4-px CSS dot it replaces. It takes
 *   `size: 0` — the exact-one-cell rule — rather than a disc, because an
 *   IDENTITY mark must stay one mark: measured across sub-cell placements, a
 *   multi-cell disc with a core-and-halo ramp draws zero cores 5-36% of the
 *   time and two cores 11-62% of the time, i.e. it loses the star or doubles
 *   the satellite depending on where the object happens to land.
 *
 * ## Sizes
 *
 * `sizeScale` is CELL ROWS per unit of the property, and both quantitative
 * rows are linear in a scale that is ALREADY logarithmic in what it measures
 * (Richter magnitude; a three-step alert ladder), which is why neither takes
 * an offset or a curve.
 */
export function mapLiveLayer(
  id: MapLiveFeedId,
  source: GlyphMapVectorFeatureCollection,
  onSelect: (feature: GlyphMapVectorFeature) => void = mapLiveOpenFeature,
): GlyphMapGlyphLayer {
  const layerId = mapLiveLayerId(id);
  const color = MAP_LIVE_COLORS[id];
  const selectable = featuresCarryUrls(source) ? { onSelect } : {};
  switch (id) {
    case "quakes":
      return {
        type: "glyph", id: layerId, source, color, ...selectable,
        // M2.5..M5.6 becomes a 0.5..1.1 row radius: the smallest is a
        // sub-cell dot and the largest a disc four columns across, so the
        // densest plate boundary is still a chain of marks rather than a bar
        // while a great earthquake reads at world zoom.
        sizeProperty: "mag", sizeScale: 0.2, size: 0.5,
        // USGS' own `title` already begins with the magnitude ("M 5.3 - 83
        // km E of Lospalos, Timor Leste"), so prefixing one would print it
        // twice. `labelScore` is the magnitude-and-recency trade
        // (`mapLiveQuakeLabelScore`); the arbiter drops the losers, and every
        // quake keeps its MARK either way.
        textProperty: "title", priorityProperty: "labelScore",
        textAnchor: "top", textOffset: [0, -1],
      };
    case "disasters":
      return {
        type: "glyph", id: layerId, source, color, ...selectable,
        ramp: ["⊙", "⊚", "◉"],
        sizeProperty: "alertRank", sizeScale: 0.25, size: 0.25,
      };
    case "satellites":
      return {
        type: "glyph", id: layerId, source, color, ...selectable,
        ramp: ["★"], size: 0,
        // THE HEIGHT THE READER ASKED ABOUT. `altKm` is the geodetic height
        // SGP4 already produces, and it is TRUE metres: the `glyph` layer
        // divides it back out of the terrain's exaggeration, so the ISS sits
        // 8.6% of a radius above the surface instead of two radii past the
        // far side of the planet at `/maps`' default 24x.
        altitudeProperty: "altKm", altitudeScale: 1000,
      };
    case "launches":
      return {
        type: "glyph", id: layerId, source, color, ...selectable,
        ramp: ["▲"],
        // `textOffset` a cell up: the label would otherwise sit ON the pad it
        // names. `priorityProperty` is the arbiter's tie-break and these have
        // no natural ranking, so the soonest launch wins by carrying the
        // larger number (see `parseMapLiveLaunches`).
        textProperty: "title", textAnchor: "top", textOffset: [0, -1],
        priorityProperty: "priority",
      };
  }
}
