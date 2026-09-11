/**
 * Changing a row's time WINDOW, through the refresh machinery that was
 * already there.
 *
 * The whole claim of this file is that a window change is not a second
 * mechanism: it is a re-fetch with a different source, taking the same
 * `refresh` → `publish` → `update` path a scheduled tick takes. So the
 * mounted layer is REPLACED (one `setLayerSource`), never mounted twice and
 * never added to, and the row's timer re-arms at the NEW window's cadence
 * rather than at the one it was enabled with.
 *
 * Fake timers and an injected transport throughout; nothing here reaches a
 * service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { GlyphMapVectorFeatureCollection } from "@glyphcss/maps";
import { mapLiveFeedUrl, mapLiveRefreshMs, type MapLiveFeedId, type MapLiveWindowId } from "./mapsLive";
import { createMapLiveController } from "./mapsLiveRefresh";

const FIXTURES = path.resolve(__dirname, "fixtures/live");
const read = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as { url: string; body?: unknown; text?: string };

/**
 * Keyed BY URL, not by row: this file's subject is that a different window
 * asks for a different thing, and a transport that answered the same body
 * whatever it was asked for could not tell the difference.
 */
const BY_URL = new Map<string, { body?: unknown; text?: string }>(
  [
    "usgs-quakes-all-hour.json",
    "usgs-quakes-all-day.json",
    "usgs-quakes-2.5-week.json",
    "usgs-quakes-4.5-month.json",
    "launch-library-upcoming.json",
    "launch-library-upcoming-24h.json",
    "gdacs-eventlist.json",
    "celestrak-visual-tle.json",
  ].map((name) => { const cap = read(name); return [cap.url, cap] as const; }),
);

function harness() {
  const mounts: MapLiveFeedId[] = [];
  const updates: { id: MapLiveFeedId; count: number }[] = [];
  const unmounts: MapLiveFeedId[] = [];
  const requests: string[] = [];
  const sources = new Map<MapLiveFeedId, GlyphMapVectorFeatureCollection>();
  const controller = createMapLiveController({
    mount: (id, source) => { mounts.push(id); sources.set(id, source); },
    update: (id, source) => { updates.push({ id, count: source.features.length }); sources.set(id, source); },
    unmount: (id) => { unmounts.push(id); sources.delete(id); },
    onStatus: () => {},
    isHidden: () => false,
    // A fixed clock so the launch window's computed `net` bound is the one
    // its capture was taken at.
    now: () => LAUNCH_CAPTURE_MS,
    fetchResponse: async (url) => {
      requests.push(url);
      const cap = BY_URL.get(url);
      // A window whose capture is missing must FAIL the test rather than
      // quietly resolve with somebody else's body.
      if (!cap) throw new Error(`no capture for ${url}`);
      return { ok: true, status: 200, json: async () => cap.body, text: async () => cap.text ?? "" } as unknown as Response;
    },
  });
  return { controller, mounts, updates, unmounts, requests, sources };
}

/** The instant `launch-library-upcoming-24h.json` was captured at. */
const LAUNCH_CAPTURE_MS = Date.parse(read("launch-library-upcoming-24h.json").url.split("net__lte=")[1]!) - 86_400_000;

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("changing the window", () => {
  it("re-fetches that window's own source and REPLACES the mounted one", async () => {
    const { controller, mounts, updates, unmounts, requests, sources } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    expect(requests).toEqual([mapLiveFeedUrl("quakes", "week", 0)]);
    const week = sources.get("quakes")!.features.length;

    controller.setWindow("quakes", "hour");
    await settle();

    // A DIFFERENT URL was asked for...
    expect(requests[1]).toBe(mapLiveFeedUrl("quakes", "hour", 0));
    // ...and it landed through `update`, not through a second `mount` and
    // not by taking the layer down. That is what keeps the marker reconcile
    // (and `layerOrder`) intact across a window change.
    expect(mounts).toEqual(["quakes"]);
    expect(unmounts).toEqual([]);
    expect(updates.map((u) => u.id)).toEqual(["quakes"]);
    // REPLACES rather than appends: the hour window is a strict subset of
    // the week's, so an append would read LARGER than the week, not smaller.
    expect(sources.get("quakes")!.features.length).toBeLessThan(week);
    expect(updates[0]!.count).toBe(sources.get("quakes")!.features.length);
  });

  it("re-arms the row at the new window's cadence, not the old one", async () => {
    const { controller, requests } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    controller.setWindow("quakes", "month");
    await settle();
    expect(requests.length).toBe(2);

    // The window it was ENABLED with would have ticked here. The month
    // window's own cadence is six times slower, so nothing goes out.
    await vi.advanceTimersByTimeAsync(mapLiveRefreshMs("quakes", "week"));
    await settle();
    expect(requests.length).toBe(2);

    await vi.advanceTimersByTimeAsync(mapLiveRefreshMs("quakes", "month") - mapLiveRefreshMs("quakes", "week"));
    await settle();
    expect(requests.length).toBe(3);
    expect(requests[2]).toBe(mapLiveFeedUrl("quakes", "month", 0));
  });

  it("carries the window forward on every later tick, not just the first", async () => {
    const { controller, requests } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    controller.setWindow("quakes", "day");
    await settle();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(mapLiveRefreshMs("quakes", "day"));
      await settle();
    }
    expect(requests.slice(1)).toEqual(Array(4).fill(mapLiveFeedUrl("quakes", "day", 0)));
  });

  it("spends nothing while the row is off, and uses the window when it comes on", async () => {
    const { controller, requests } = harness();
    controller.setWindow("quakes", "hour");
    await settle();
    expect(requests).toEqual([]);
    controller.setEnabled("quakes", true);
    await settle();
    expect(requests).toEqual([mapLiveFeedUrl("quakes", "hour", 0)]);
  });

  it("does nothing at all when the window is the one already in force", async () => {
    const { controller, requests } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    controller.setWindow("quakes", "week");
    await settle();
    expect(requests.length).toBe(1);
  });

  /**
   * Switching a row off clears everything it held — `stop()`'s existing
   * rule. The window is a reader's choice about the CARD, not state the row
   * accumulated, so it is the one thing that survives: a reader who set
   * "last hour", turned the row off and turned it back on must not silently
   * get the week back.
   */
  it("keeps the reader's window across an off/on cycle", async () => {
    const { controller, requests } = harness();
    controller.setWindow("quakes", "hour");
    controller.setEnabled("quakes", true);
    await settle();
    controller.setEnabled("quakes", false);
    controller.setEnabled("quakes", true);
    await settle();
    expect(requests).toEqual([mapLiveFeedUrl("quakes", "hour", 0), mapLiveFeedUrl("quakes", "hour", 0)]);
  });

  /** The forward axis, through the same one path. */
  it("moves the launch row onto its own forward window", async () => {
    const { controller, requests, updates, mounts } = harness();
    controller.setEnabled("launches", true);
    await settle();
    expect(requests).toEqual([mapLiveFeedUrl("launches", "all", LAUNCH_CAPTURE_MS)]);
    controller.setWindow("launches", "day");
    await settle();
    expect(requests[1]).toBe(mapLiveFeedUrl("launches", "day", LAUNCH_CAPTURE_MS));
    expect(mounts).toEqual(["launches"]);
    expect(updates.length).toBe(1);
    // The next 24 hours is two launches from two pads; the uncapped manifest
    // is thirteen.
    expect(updates[0]!.count).toBeLessThan(5);
  });

  /**
   * A row with no time axis has no control, so nothing can ask it to change
   * window — but the controller must not be the thing that enforces that by
   * throwing, since a link from another build can carry any index at all.
   */
  it("leaves a row with no time axis on its own single source", async () => {
    const { controller, requests } = harness();
    controller.setEnabled("disasters", true);
    await settle();
    controller.setWindow("disasters", "hour" as MapLiveWindowId);
    await settle();
    expect(requests).toEqual([mapLiveFeedUrl("disasters", "all", 0)]);
  });
});
