/**
 * The TIME WINDOW a live row is read at.
 *
 * Asked for in these words: "those sets need a filter of recency, like last
 * hour, today, last week, etc". Three things this file pins, and each of
 * them is a decision rather than a mechanism:
 *
 *  1. **A window is a DIFFERENT SOURCE, never a filtered payload.** USGS
 *     publish one summary feed per window and Launch Library take a `net`
 *     bound, so a narrower window is a SMALLER DOWNLOAD. Fetching 7.8 MB and
 *     throwing most of it away would be the same picture at forty times the
 *     cost, and there is one real captured response per window under
 *     `fixtures/live/` to prove each URL is a real one.
 *  2. **A row gets a control only where the axis is real.** Two of the four
 *     have one and two do not, and `windows.length` is the discriminator the
 *     card reads — see {@link MAP_LIVE_FEEDS} for the per-row argument.
 *  3. **The cadence follows the window.** Polling a 440 KB month feed every
 *     five minutes re-reads an unchanged file twelve times out of thirteen.
 *
 * Nothing here touches the network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAP_LIVE_FEEDS,
  MAP_LIVE_FEED_BY_ID,
  MAP_LIVE_LAUNCHES_REFRESH_MS,
  MAP_LIVE_QUAKES_REFRESH_MS,
  MAP_LIVE_WINDOW_IDS,
  fetchMapLiveFeed,
  mapLiveFeedUrl,
  mapLiveRefreshMs,
  mapLiveWindow,
  type MapLiveFeedId,
  type MapLiveWindowId,
} from "./mapsLive";

const FIXTURES = path.resolve(__dirname, "fixtures/live");

interface Capture { readonly recorded: string; readonly url: string; readonly status: number; readonly body?: unknown; readonly text?: string }

const capture = (name: string): Capture =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Capture;

/**
 * One real captured response per (row, window) pair — the discipline the
 * unwindowed rows already held, extended to every window a reader can pick.
 */
const CAPTURES: Readonly<Record<string, string>> = {
  "quakes:hour": "usgs-quakes-all-hour.json",
  "quakes:day": "usgs-quakes-all-day.json",
  "quakes:week": "usgs-quakes-2.5-week.json",
  "quakes:month": "usgs-quakes-4.5-month.json",
  "launches:day": "launch-library-upcoming-24h.json",
  "launches:week": "launch-library-upcoming-7d.json",
  "launches:month": "launch-library-upcoming-30d.json",
  "launches:all": "launch-library-upcoming.json",
  "disasters:all": "gdacs-eventlist.json",
  "satellites:all": "celestrak-visual-tle.json",
};

function replay(cap: Capture): Response {
  return {
    ok: true,
    status: 200,
    json: async () => cap.body,
    text: async () => cap.text ?? JSON.stringify(cap.body),
  } as unknown as Response;
}

/** The instant a capture was taken at — the launch URLs carry a computed `net` bound, so it has to be the exact one. */
const recordedMs = (cap: Capture): number => Date.parse(cap.recorded);

describe("which rows have a time axis at all", () => {
  /**
   * The whole "a control that does nothing is worse than no control"
   * clause, as four explicit numbers rather than as a rule that could be
   * satisfied by an empty list.
   */
  it("gives a window list only to the two rows whose axis is real", () => {
    expect(Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f.windows.map((w) => w.id)]))).toEqual({
      // Backwards: USGS publish one summary feed per window.
      quakes: ["hour", "day", "week", "month"],
      // GDACS' list is CURRENTLY ACTIVE events, not a rolling window.
      disasters: ["all"],
      // Forwards: the manifest is upcoming, so "next week", never "last week".
      launches: ["day", "week", "month", "all"],
      // A live position has no recency dimension at all.
      satellites: ["all"],
    });
  });

  it("marks exactly those two as carrying a control", () => {
    expect(MAP_LIVE_FEEDS.filter((f) => f.windows.length > 1).map((f) => f.id)).toEqual(["quakes", "launches"]);
  });

  it("keeps the wire vocabulary a superset of every row's own list", () => {
    for (const spec of MAP_LIVE_FEEDS) {
      for (const window of spec.windows) expect(MAP_LIVE_WINDOW_IDS).toContain(window.id);
    }
  });

  it("names a default that is one of the row's own windows", () => {
    for (const spec of MAP_LIVE_FEEDS) {
      expect(spec.windows.map((w) => w.id)).toContain(spec.defaultWindow);
    }
  });

  /**
   * The frozen-default rule, at the level of what is actually FETCHED: a
   * link that carries no window token must fetch exactly the URL this page
   * fetched before windows existed.
   */
  it("leaves both defaults on the URL the page already shipped", () => {
    expect(mapLiveFeedUrl("quakes", "week", 0))
      .toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson");
    expect(mapLiveFeedUrl("launches", "all", 0))
      .toBe("https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal");
    expect(MAP_LIVE_FEED_BY_ID.quakes.defaultWindow).toBe("week");
    expect(MAP_LIVE_FEED_BY_ID.launches.defaultWindow).toBe("all");
  });

  /** A link written by a build with a different window list must not strand the row. */
  it("falls back to the row's own default for a window it does not offer", () => {
    expect(mapLiveWindow("disasters", "month" as MapLiveWindowId).id).toBe("all");
    expect(mapLiveWindow("quakes", "all" as MapLiveWindowId).id).toBe("week");
  });
});

describe("each window is its own source", () => {
  it("was captured from the URL its own window builds", () => {
    for (const [key, file] of Object.entries(CAPTURES)) {
      const [feed, window] = key.split(":") as [MapLiveFeedId, MapLiveWindowId];
      const cap = capture(file);
      expect({ key, url: mapLiveFeedUrl(feed, window, recordedMs(cap)) }).toEqual({ key, url: cap.url });
    }
  });

  it("fetches its own URL and mounts the features that came back", async () => {
    const counts: Record<string, number> = {};
    const asked: string[] = [];
    for (const [key, file] of Object.entries(CAPTURES)) {
      const [feed, window] = key.split(":") as [MapLiveFeedId, MapLiveWindowId];
      if (feed === "satellites") continue; // an element set is an orbit, not a feature — see `parseMapLiveFeed`.
      const cap = capture(file);
      const outcome = await fetchMapLiveFeed({
        feed,
        window,
        now: recordedMs(cap),
        fetchResponse: async (url) => { asked.push(url); return replay(cap); },
      });
      expect({ key, kind: outcome.kind }).toEqual({ key, kind: "ok" });
      counts[key] = outcome.kind === "ok" ? outcome.collection.features.length : -1;
    }
    // Every request went to that window's own URL, and no two windows of one
    // row asked for the same thing.
    expect(new Set(asked).size).toBe(asked.length);
    // The pictures are genuinely different sizes — a window that returned the
    // same features as its neighbour would be a control that does nothing.
    expect(counts["quakes:hour"]).toBeLessThan(counts["quakes:day"]!);
    expect(counts["quakes:day"]).toBeLessThan(counts["quakes:week"]!);
    expect(counts["quakes:week"]).toBeLessThan(counts["quakes:month"]!);
    expect(counts["launches:day"]).toBeLessThan(counts["launches:week"]!);
    expect(counts["launches:week"]).toBeLessThan(counts["launches:month"]!);
  });

  /**
   * The MAGNITUDE FLOOR is the payload's price, and it RISES with the
   * window. That makes the control one axis a reader understands rather
   * than two they have to combine, and the floor has to be stated on the
   * button that carries it or the control lies.
   */
  it("raises the magnitude floor with the window, and says so on every button", () => {
    const slug = (w: MapLiveWindowId) => mapLiveFeedUrl("quakes", w, 0).split("/").pop();
    expect(slug("hour")).toBe("all_hour.geojson");
    expect(slug("day")).toBe("all_day.geojson");
    expect(slug("week")).toBe("2.5_week.geojson");
    expect(slug("month")).toBe("4.5_month.geojson");
    // The two windows that carry a floor name it; the two that carry none
    // say the picture is unfiltered.
    expect(mapLiveWindow("quakes", "week").desc).toContain("2.5");
    expect(mapLiveWindow("quakes", "month").desc).toContain("4.5");
    expect(mapLiveWindow("quakes", "hour").desc).toContain("magnitude");
    expect(mapLiveWindow("quakes", "day").desc).toContain("magnitude");
  });

  /** The launch window is a forward bound on `net`, computed from the instant of the fetch. */
  it("points the launch window forwards, at the instant it is fetched", () => {
    const now = Date.UTC(2026, 8, 10, 22, 56, 49);
    expect(mapLiveFeedUrl("launches", "day", now)).toContain("net__lte=2026-09-11T22:56:49Z");
    expect(mapLiveFeedUrl("launches", "week", now)).toContain("net__lte=2026-09-17T22:56:49Z");
    expect(mapLiveFeedUrl("launches", "month", now)).toContain("net__lte=2026-10-10T22:56:49Z");
    // `all` is the row as it shipped: a COUNT bound and no time bound at all.
    expect(mapLiveFeedUrl("launches", "all", now)).not.toContain("net__lte");
  });
});

describe("the cadence follows the window", () => {
  const perHour = (ms: number) => 3_600_000 / ms;

  /**
   * The rule, in one sentence: poll at the publisher's own regeneration
   * interval unless the payload makes that wasteful. USGS regenerate every
   * one to five minutes, so five minutes is the floor below which nothing
   * new can arrive — and the month window is the one where the arrival rate
   * (644 events a month, i.e. 0.075 per five minutes) no longer justifies
   * re-reading 440 KB.
   */
  it("keeps the three light quake windows at the publisher's floor and slows the heavy one", () => {
    expect(perHour(mapLiveRefreshMs("quakes", "hour"))).toBe(12);
    expect(perHour(mapLiveRefreshMs("quakes", "day"))).toBe(12);
    expect(perHour(mapLiveRefreshMs("quakes", "week"))).toBe(12);
    expect(perHour(mapLiveRefreshMs("quakes", "month"))).toBe(2);
    expect(mapLiveRefreshMs("quakes", "month")).toBeGreaterThan(mapLiveRefreshMs("quakes", "week"));
  });

  /**
   * Launch Library's ceiling is 15 requests an hour for an anonymous caller
   * and it is the READER's own budget. The 24-hour window is the one where
   * a slipping T-0 changes the picture inside the window's own span, and it
   * is also by far the smallest response, so it is the only one that polls
   * faster than hourly.
   */
  it("polls the narrow launch window twice an hour and the rest hourly, well inside the measured ceiling", () => {
    expect(perHour(mapLiveRefreshMs("launches", "day"))).toBe(2);
    expect(perHour(mapLiveRefreshMs("launches", "week"))).toBe(1);
    expect(perHour(mapLiveRefreshMs("launches", "month"))).toBe(1);
    expect(perHour(mapLiveRefreshMs("launches", "all"))).toBe(1);
    for (const window of MAP_LIVE_FEED_BY_ID.launches.windows) {
      expect(perHour(mapLiveRefreshMs("launches", window.id))).toBeLessThan(15);
    }
  });

  /** The two axis-less rows keep exactly the cadence they always had. */
  it("leaves the rows with no window on their own single cadence", () => {
    expect(perHour(mapLiveRefreshMs("disasters", "all"))).toBe(4);
    expect(mapLiveRefreshMs("satellites", "all")).toBe(12 * 60 * 60_000);
  });

  /** The shipped constants stay the DEFAULT window's cadence, so no link changes what it costs. */
  it("keeps each default window on the constant the page already published", () => {
    expect(mapLiveRefreshMs("quakes", "week")).toBe(MAP_LIVE_QUAKES_REFRESH_MS);
    expect(mapLiveRefreshMs("launches", "all")).toBe(MAP_LIVE_LAUNCHES_REFRESH_MS);
  });
});
