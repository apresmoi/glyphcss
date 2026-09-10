/**
 * The four live feeds, replayed through the transport seam against ONE REAL
 * CAPTURED RESPONSE EACH.
 *
 * The fixtures under `fixtures/live/` are verbatim service responses — the
 * same rule the OpenFreeMap work holds — each carrying the URL that produced
 * it. Nothing in this file touches the network: every `fetchResponse` is
 * injected, and a test that reached a service would be a test whose result
 * depends on what the planet is doing today.
 *
 * The failure clauses are the load-bearing half. A live layer that BLANKS on
 * a bad refresh is worse than one that never refreshed, and on several of
 * these services a rate limit is indistinguishable from an outage (they omit
 * `Access-Control-Allow-Origin` on their error responses, so the browser
 * hands the page an opaque `TypeError` instead of a readable 429). Both are
 * pinned.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GLYPH_FONT_ATLAS, isGlyphInFontAtlas } from "glyphcss";
import { glyphMapAsciiLabel, GLYPH_MAP_POINT_RAMP } from "@glyphcss/maps";
import {
  MAP_LIVE_CELESTRAK_ATTRIBUTION,
  MAP_LIVE_DISASTERS_REFRESH_MS,
  MAP_LIVE_FEEDS,
  MAP_LIVE_FEED_BY_ID,
  MAP_LIVE_LAUNCHES_REFRESH_MS,
  MAP_LIVE_OPAQUE_REASON,
  MAP_LIVE_QUAKES_REFRESH_MS,
  MAP_LIVE_SATELLITES_REFRESH_MS,
  MAP_LIVE_TIMEOUT_MS,
  MAP_LIVE_TIMEOUT_REASON,
  fetchMapLiveFeed,
  mapLiveAlertRank,
  mapLiveLayer,
  mapLiveLayerId,
  mapLiveOpenFeature,
  mapLiveQuakeLabelScore,
  parseMapLiveDisasters,
  parseMapLiveLaunches,
  parseMapLiveQuakes,
  type MapLiveFeedId,
} from "./mapsLive";

const FIXTURES = path.resolve(__dirname, "fixtures/live");

interface Capture { readonly recorded: string; readonly url: string; readonly status: number; readonly body?: unknown; readonly text?: string }

function capture(name: string): Capture {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Capture;
}

const CAPTURES: Readonly<Record<MapLiveFeedId, string>> = {
  quakes: "usgs-quakes-2.5-week.json",
  disasters: "gdacs-eventlist.json",
  launches: "launch-library-upcoming.json",
  satellites: "celestrak-visual-tle.json",
};

/** A `Response`-shaped stand-in over a recorded body. `Response` itself is not in this environment's globals for every runner. */
function replay(cap: Capture, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cap.body,
    text: async () => cap.text ?? JSON.stringify(cap.body),
  } as unknown as Response;
}

describe("live feed specs", () => {
  it("declares one spec per row, and each fixture was captured from that spec's own URL", () => {
    expect(MAP_LIVE_FEEDS.map((f) => f.id)).toEqual(["quakes", "disasters", "launches", "satellites"]);
    for (const spec of MAP_LIVE_FEEDS) {
      expect(capture(CAPTURES[spec.id]).url).toBe(spec.url);
    }
  });

  /**
   * The cadences, as numbers rather than as prose. Launch Library's 15
   * requests/hour is the only MEASURED ceiling among the four (read off
   * `ll.thespacedevs.com/2.3.0/api-throttle/`), and a page left open for a
   * day must not come near it.
   */
  it("cannot breach a published rate limit with a page left open", () => {
    const perHour = (ms: number) => 3_600_000 / ms;
    expect(perHour(MAP_LIVE_LAUNCHES_REFRESH_MS)).toBe(1);
    expect(perHour(MAP_LIVE_LAUNCHES_REFRESH_MS)).toBeLessThan(15);
    expect(perHour(MAP_LIVE_QUAKES_REFRESH_MS)).toBe(12);
    expect(perHour(MAP_LIVE_DISASTERS_REFRESH_MS)).toBe(4);
    // The elements are an orbit, not a position: half a day is "once per
    // session" for any real session, which is what CelesTrak ask for.
    expect(MAP_LIVE_SATELLITES_REFRESH_MS).toBe(12 * 60 * 60_000);
  });

  it("gives every row a stable layer id", () => {
    expect(MAP_LIVE_FEEDS.map((f) => mapLiveLayerId(f.id)))
      .toEqual(["live-quakes", "live-disasters", "live-launches", "live-satellites"]);
  });
});

describe("USGS earthquakes", () => {
  it("reads the real feed into keyed point features carrying magnitude", () => {
    const collection = parseMapLiveQuakes(capture(CAPTURES.quakes).body);
    expect(collection).not.toBeNull();
    const features = collection!.features;
    expect(features.length).toBeGreaterThan(300);
    // Every feature carries the USGS event id — the whole reason a refresh
    // can reconcile instead of rebuilding.
    expect(features.every((f) => typeof f.id === "string" && f.id!.length > 0)).toBe(true);
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(features.every((f) => f.geometryType === "point" && f.rings.length === 1 && f.rings[0]!.length === 1)).toBe(true);
    // The 2.5+ window, ALMOST: two of the 385 events in this capture sit at
    // 2.46 and 2.47, because a magnitude is REVISED after the event enters
    // the feed and USGS do not re-filter it out. So the honest assertion is
    // that every event carries a real magnitude near the window, not that the
    // window is exact — a stricter one would have been a test that only
    // passed on captures where nothing had been downgraded yet.
    expect(features.every((f) => Number.isFinite(Number(f.properties?.mag)))).toBe(true);
    expect(Math.min(...features.map((f) => Number(f.properties?.mag)))).toBeGreaterThan(2.4);
    const known = features.find((f) => f.id === "us7000tgf2");
    expect(known).toBeDefined();
    expect(known!.properties?.mag).toBe(5.3);
    expect(known!.rings[0]![0]).toEqual([127.7505, -8.5914]);
    // `[lon, lat, depthKm]` — the third coordinate is a DEPTH, carried as a
    // property rather than fed to the projection as an elevation.
    expect(known!.properties?.depthKm).toBe(10);
    expect(collection!.attribution?.[0]?.name).toBe("Data courtesy of USGS");
  });

  it("drops an unusable feature rather than the whole response", () => {
    const collection = parseMapLiveQuakes({
      features: [
        { id: "good", geometry: { type: "Point", coordinates: [10, 20, 5] }, properties: { mag: 3 } },
        { id: "no-geometry", properties: { mag: 3 } },
        { geometry: { type: "Point", coordinates: [1, 2] }, properties: { mag: 3 } },
        { id: "not-a-point", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      ],
    });
    expect(collection!.features.map((f) => f.id)).toEqual(["good"]);
  });

  it("is not a feature collection at all when the body is not one", () => {
    expect(parseMapLiveQuakes(null)).toBeNull();
    expect(parseMapLiveQuakes({ message: "Service Unavailable" })).toBeNull();
    expect(parseMapLiveQuakes("<html>")).toBeNull();
  });
});

describe("GDACS disasters", () => {
  it("reads the real event list, keyed on the EVENT id and not the episode", () => {
    const collection = parseMapLiveDisasters(capture(CAPTURES.disasters).body);
    const features = collection!.features;
    expect(features.length).toBeGreaterThan(50);
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(features.every((f) => f.id!.startsWith("gdacs-"))).toBe(true);
    // An id that folded in `episodeid` would retire and re-create a marker
    // every time the event was re-scored.
    expect(features.every((f) => /^gdacs-\d+$/.test(f.id!))).toBe(true);
    const types = new Set(features.map((f) => f.properties?.eventType));
    expect(types.has("TC")).toBe(true);
    expect(types.has("EQ")).toBe(true);
    expect(collection!.attribution?.[0]?.name).toContain("GDACS");
  });

  it("ranks the alert vocabulary ordinally, and never drops an unknown level", () => {
    expect(mapLiveAlertRank("Red")).toBe(3);
    expect(mapLiveAlertRank("Orange")).toBe(2);
    expect(mapLiveAlertRank("Green")).toBe(1);
    expect(mapLiveAlertRank("Puce")).toBe(1);
    expect(mapLiveAlertRank(undefined)).toBe(1);
  });
});

describe("Launch Library 2", () => {
  it("reduces the real manifest to one marker per pad, carrying its soonest launch", () => {
    const body = capture(CAPTURES.launches).body as { results: { pad?: { id?: number } }[] };
    const collection = parseMapLiveLaunches(body);
    const features = collection!.features;
    expect(features.length).toBeGreaterThan(5);
    // Strictly fewer markers than launches, because pads repeat.
    expect(features.length).toBeLessThan(body.results.length);
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(features.every((f) => f.id!.startsWith("pad-"))).toBe(true);
    expect(features.every((f) => typeof f.properties?.title === "string" && f.properties.title !== "")).toBe(true);
    // The soonest launch on the manifest carries the largest priority, which
    // is what the declutter arbiter breaks ties on.
    const priorities = features.map((f) => Number(f.properties?.priority));
    expect(Math.max(...priorities)).toBe(features.length);
    expect(new Set(priorities).size).toBe(features.length);
  });

  it("keeps the earlier launch when one pad flies twice", () => {
    const collection = parseMapLiveLaunches({
      results: [
        { name: "Later", net: "2026-10-01T00:00:00Z", pad: { id: 7, latitude: 28.5, longitude: -80.5, name: "SLC-40" } },
        { name: "Sooner", net: "2026-09-20T00:00:00Z", pad: { id: 7, latitude: 28.5, longitude: -80.5, name: "SLC-40" } },
      ],
    });
    expect(collection!.features.length).toBe(1);
    expect(collection!.features[0]!.properties?.title).toBe("Sooner");
  });

  it("drops a launch with no pad coordinates", () => {
    const collection = parseMapLiveLaunches({
      results: [
        { name: "Placed", net: "2026-09-20T00:00:00Z", pad: { id: 1, latitude: 1, longitude: 2 } },
        { name: "Unplaced", net: "2026-09-21T00:00:00Z", pad: { id: 2, latitude: null, longitude: null } },
        { name: "Padless", net: "2026-09-22T00:00:00Z" },
      ],
    });
    expect(collection!.features.map((f) => f.properties?.title)).toEqual(["Placed"]);
  });
});

describe("fetching, and failing", () => {
  it("adapts a 200 from each JSON feed", async () => {
    for (const id of ["quakes", "disasters", "launches"] as const) {
      const outcome = await fetchMapLiveFeed({
        feed: id,
        fetchResponse: async (url) => {
          expect(url).toBe(MAP_LIVE_FEED_BY_ID[id].url);
          return replay(capture(CAPTURES[id]));
        },
      });
      expect(outcome.kind).toBe("ok");
      if (outcome.kind !== "ok") return;
      expect(outcome.collection.features.length).toBeGreaterThan(0);
      expect(outcome.collection.attribution?.length).toBeGreaterThan(0);
    }
  });

  it("reads a readable 429 as a rate limit", async () => {
    const outcome = await fetchMapLiveFeed({
      feed: "launches",
      fetchResponse: async () => replay(capture(CAPTURES.launches), 429),
    });
    expect(outcome).toEqual({ kind: "failed", reason: "rate limited — try again later", rateLimited: true });
  });

  /**
   * THE TRAP. A service that omits `Access-Control-Allow-Origin` on its error
   * responses turns its own 429 into an opaque `TypeError` at the browser —
   * no status, no `Retry-After`, no message. There is no way to tell that
   * apart from an outage from inside the page, and on these services the
   * throttle is the likelier of the two, so it is what the reader is told.
   */
  it("reads an opaque network failure as probably rate limited", async () => {
    const outcome = await fetchMapLiveFeed({
      feed: "quakes",
      fetchResponse: async () => { throw new TypeError("Failed to fetch"); },
    });
    expect(outcome).toEqual({ kind: "failed", reason: MAP_LIVE_OPAQUE_REASON, rateLimited: true });
    expect(MAP_LIVE_OPAQUE_REASON).toContain("rate limited");
  });

  it("reports an ordinary non-200 by its status, without claiming a rate limit", async () => {
    const outcome = await fetchMapLiveFeed({
      feed: "disasters",
      fetchResponse: async () => replay(capture(CAPTURES.disasters), 503),
    });
    expect(outcome).toEqual({ kind: "failed", reason: "service responded 503", rateLimited: false });
  });

  it("reports a 200 carrying an unreadable body as a failure, never as an empty layer", async () => {
    const outcome = await fetchMapLiveFeed({
      feed: "quakes",
      fetchResponse: async () => ({ ok: true, status: 200, json: async () => "<!doctype html>", text: async () => "" }) as unknown as Response,
    });
    expect(outcome).toEqual({ kind: "failed", reason: "unreadable response", rateLimited: false });
  });

  it("says nothing at all about a superseded request", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await fetchMapLiveFeed({ feed: "quakes", signal: controller.signal, fetchResponse: async () => replay(capture(CAPTURES.quakes)) });
    expect(outcome).toEqual({ kind: "aborted" });

    // The real mid-flight path: the caller aborts while the request is open,
    // the composed deadline signal forwards it, and `fetch` rejects. It has
    // to read as `aborted` and not as the opaque-failure arm, or a
    // superseded refresh would tell the reader the service was rate limiting
    // them.
    const live = new AbortController();
    const midflight = await fetchMapLiveFeed({
      feed: "quakes",
      signal: live.signal,
      fetchResponse: (_url, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
        live.abort();
      }),
    });
    expect(midflight).toEqual({ kind: "aborted" });
  });

  /**
   * `fetch` has no timeout of its own, and the first browser run of this
   * feature left a row at "loading..." indefinitely against a service that
   * was merely slow — the one failure a reader cannot tell from a bug. A
   * deadline is therefore part of the contract, and it must land as a
   * FAILURE with a reason, never as the silent `aborted` a superseded
   * request gets.
   */
  it("gives up on a service that never answers, and says so", async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchMapLiveFeed({
        feed: "launches",
        // Never resolves, and never rejects — a hung connection, which is
        // exactly what was observed.
        fetchResponse: (_url, signal) => new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
        }),
      });
      await vi.advanceTimersByTimeAsync(MAP_LIVE_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({
        kind: "failed", reason: MAP_LIVE_TIMEOUT_REASON, rateLimited: false,
      });
    } finally { vi.useRealTimers(); }
  });

  it("does not arm a deadline that outlives the request", async () => {
    vi.useFakeTimers();
    try {
      const outcome = await fetchMapLiveFeed({ feed: "quakes", fetchResponse: async () => replay(capture(CAPTURES.quakes)) });
      expect(outcome.kind).toBe("ok");
      // A timer left running would keep the page awake and, on a
      // long-refreshing row, accumulate one per refresh.
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("never rejects, whatever the transport does", async () => {
    for (const thrown of [new TypeError("Failed to fetch"), new Error("boom"), "a string", null]) {
      await expect(fetchMapLiveFeed({ feed: "quakes", fetchResponse: async () => { throw thrown; } })).resolves.toBeDefined();
    }
  });
});

describe("layers", () => {
  it("mounts every row as a `glyph` layer — marks in the grid, not DOM nodes", () => {
    const empty = { features: [] };
    // All four, because the reader asked for all four: "lets not use that for
    // the live datasets, lets use glyphs for them". The page's other point
    // rows are deliberately not converted.
    expect(mapLiveLayer("quakes", empty)).toMatchObject({ type: "glyph", id: "live-quakes", sizeProperty: "mag", textProperty: "title", priorityProperty: "labelScore" });
    expect(mapLiveLayer("disasters", empty)).toMatchObject({ type: "glyph", id: "live-disasters", sizeProperty: "alertRank", ramp: ["⊙", "⊚", "◉"] });
    // A star, at its real orbital altitude in TRUE metres — `altKm` is what
    // SGP4 already produced.
    expect(mapLiveLayer("satellites", empty)).toMatchObject({ type: "glyph", id: "live-satellites", ramp: ["★"], size: 0, altitudeProperty: "altKm", altitudeScale: 1000 });
    expect(mapLiveLayer("launches", empty)).toMatchObject({ type: "glyph", id: "live-launches", ramp: ["▲"], textProperty: "title" });
  });

  it("arms `onSelect` only for a row whose own features carry a url", () => {
    // Read off the DATA, never off the row id: a mark that opens nothing must
    // not advertise a pointer cursor.
    const quakes = parseMapLiveQuakes(capture(CAPTURES.quakes).body, 1_789_070_925_000)!;
    expect(mapLiveLayer("quakes", quakes).onSelect).toBeTypeOf("function");
    expect(mapLiveLayer("satellites", { features: [] }).onSelect).toBeUndefined();
    expect(mapLiveLayer("quakes", { features: [] }).onSelect).toBeUndefined();
  });

  it("opens a feature's own url in a new tab, and refuses a scheme that is not http(s)", () => {
    const opened: string[] = [];
    const open = (url: string) => { opened.push(url); };
    mapLiveOpenFeature({ id: "a", geometryType: "point", rings: [[[0, 0]]], properties: { url: "https://example.test/q" } }, open);
    // A url is untrusted text out of a network payload, and
    // `window.open("javascript:...")` runs in THIS origin.
    mapLiveOpenFeature({ id: "b", geometryType: "point", rings: [[[0, 0]]], properties: { url: "javascript:alert(1)" } }, open);
    mapLiveOpenFeature({ id: "c", geometryType: "point", rings: [[[0, 0]]], properties: {} }, open);
    expect(opened).toEqual(["https://example.test/q"]);
  });

  it("ranks a quake's label by magnitude AND recency, with recency worth at most 1.5 magnitudes", () => {
    const now = 1_789_070_925_000;
    const hoursAgo = (h: number) => now - h * 3_600_000;
    // A fresh small quake outranks an old one of the same size...
    expect(mapLiveQuakeLabelScore(3, hoursAgo(0.1), now)).toBeGreaterThan(mapLiveQuakeLabelScore(3, hoursAgo(120), now));
    // ...but never outranks one 1.5 magnitudes larger, however fresh.
    expect(mapLiveQuakeLabelScore(4, now, now)).toBeLessThan(mapLiveQuakeLabelScore(5.6, hoursAgo(168), now));
    // A missing timestamp scores its magnitude alone rather than being
    // treated as infinitely old — an event with a missing field is still an
    // event.
    expect(mapLiveQuakeLabelScore(5, null, now)).toBe(5);
    // Measured on the vendored USGS week: the top of the list is the two
    // events of the last two hours, then the week's largest.
    const week = parseMapLiveQuakes(capture(CAPTURES.quakes).body, now)!;
    const top = [...week.features]
      .sort((a, b) => Number(b.properties!.labelScore) - Number(a.properties!.labelScore))
      .slice(0, 4)
      .map((f) => String(f.properties!.title));
    expect(top[0]).toContain("southern East Pacific Rise");
    expect(top[1]).toContain("Lospalos");
    expect(top.every((t) => t.startsWith("M 5"))).toBe(true);
  });

  it("carries the source it was handed, so a refresh is a source swap and nothing else", () => {
    const source = parseMapLiveQuakes(capture(CAPTURES.quakes).body)!;
    expect(mapLiveLayer("quakes", source).source).toBe(source);
  });

  it("draws every row out of the COLOUR-FONT ATLAS, or the whole map loses its zero-span encoding", () => {
    // Not a style check. `/maps` renders with `colorEncoding: "atlas"`, and
    // glyphcss latches the WHOLE SCENE back to the span encoder for any frame
    // containing a glyph the atlas does not carry — so one exotic marker
    // would quietly cost the entire map its encoding, at every zoom, for as
    // long as the row is on.
    const empty = { features: [] };
    const marks = (["quakes", "disasters", "launches", "satellites"] as const)
      .flatMap((id) => mapLiveLayer(id, empty).ramp ?? GLYPH_MAP_POINT_RAMP);
    expect(marks.length).toBeGreaterThan(4);
    for (const glyph of marks) expect(isGlyphInFontAtlas(glyph, GLYPH_FONT_ATLAS), glyph).toBe(true);

    // And the LABELS, which are the half that actually broke: 385 real USGS
    // titles carry `î é ā ü í ó ū á` and a right single quote, none of them
    // in the atlas. `glyphMapAsciiLabel` is what folds them; without it the
    // whole map silently drops to the span encoder.
    const titles = parseMapLiveQuakes(capture(CAPTURES.quakes).body, 1_789_070_925_000)!
      .features.map((f) => String(f.properties!.title));
    const raw = new Set([...titles.join("")].filter((c) => c !== " " && !isGlyphInFontAtlas(c, GLYPH_FONT_ATLAS)));
    expect(raw.size, "the fixture must still contain out-of-atlas characters or this proves nothing").toBeGreaterThan(0);
    const folded = [...titles.map(glyphMapAsciiLabel).join("")].filter((c) => c !== " " && !isGlyphInFontAtlas(c, GLYPH_FONT_ATLAS));
    expect(folded).toEqual([]);
  });

  it("credits CelesTrak by the citation they ask for", () => {
    expect(MAP_LIVE_CELESTRAK_ATTRIBUTION[0]!.name).toContain("Kelso");
  });
});
