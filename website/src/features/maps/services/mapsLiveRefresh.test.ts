/**
 * The refresh mechanism, on fake timers and an injected transport. Nothing
 * here reaches a service and nothing here waits on wall-clock time.
 *
 * Four properties carry the feature and each has its own clause: a refresh
 * REPLACES the source of a mounted layer (never remounts it), a failed
 * refresh leaves the previous frame standing and says why, the cadence is the
 * one each spec claims, and a hidden tab spends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { GlyphMapVectorFeatureCollection } from "@glyphcss/maps";
import {
  MAP_LIVE_DISASTERS_REFRESH_MS,
  MAP_LIVE_LAUNCHES_REFRESH_MS,
  MAP_LIVE_OPAQUE_REASON,
  MAP_LIVE_QUAKES_REFRESH_MS,
  type MapLiveFeedId,
} from "./mapsLive";
import { MAP_LIVE_SATELLITE_TICK_MS } from "./mapsLiveSatellites";
import { createMapLiveController, mapLiveAge, mapLiveRowReadout, type MapLiveRowStatus } from "./mapsLiveRefresh";

const FIXTURES = path.resolve(__dirname, "fixtures/live");
const read = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as { body?: unknown; text?: string };

const BODIES: Readonly<Record<MapLiveFeedId, { body?: unknown; text?: string }>> = {
  quakes: read("usgs-quakes-2.5-week.json"),
  disasters: read("gdacs-eventlist.json"),
  launches: read("launch-library-upcoming.json"),
  satellites: read("celestrak-visual-tle.json"),
};

interface Harness {
  readonly mounts: MapLiveFeedId[];
  readonly updates: { id: MapLiveFeedId; count: number }[];
  readonly unmounts: MapLiveFeedId[];
  readonly statuses: Map<MapLiveFeedId, MapLiveRowStatus>;
  readonly requests: string[];
  hidden: boolean;
  /** Set to a status code to make every subsequent request answer with it. */
  failWith: number | null;
  /** Set to make every subsequent request reject the way an opaque CORS failure does. */
  opaque: boolean;
}

function harness() {
  const h: Harness = {
    mounts: [], updates: [], unmounts: [], statuses: new Map(), requests: [],
    hidden: false, failWith: null, opaque: false,
  };
  const sources = new Map<MapLiveFeedId, GlyphMapVectorFeatureCollection>();
  const controller = createMapLiveController({
    mount: (id, source) => { h.mounts.push(id); sources.set(id, source); },
    update: (id, source) => { h.updates.push({ id, count: source.features.length }); sources.set(id, source); },
    unmount: (id) => { h.unmounts.push(id); sources.delete(id); },
    onStatus: (id, status) => { h.statuses.set(id, status); },
    isHidden: () => h.hidden,
    fetchResponse: async (url) => {
      h.requests.push(url);
      if (h.opaque) throw new TypeError("Failed to fetch");
      const feed = (Object.keys(BODIES) as MapLiveFeedId[]).find((id) => url.includes(hostOf(id)))!;
      const cap = BODIES[feed];
      const status = h.failWith ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => cap.body,
        text: async () => cap.text ?? "",
      } as unknown as Response;
    },
  });
  return { h, controller, sources };
}

const hostOf = (id: MapLiveFeedId): string => ({
  quakes: "earthquake.usgs.gov",
  disasters: "gdacs.org",
  launches: "thespacedevs.com",
  satellites: "celestrak.org",
}[id]);

/** Let every queued microtask (the fetch chain) run without advancing the clock. */
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("a refresh replaces the source of a mounted layer", () => {
  it("mounts once and then only ever updates", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    expect(h.mounts).toEqual(["quakes"]);
    expect(h.updates).toEqual([]);
    expect(h.unmounts).toEqual([]);
    const first = h.statuses.get("quakes")!;
    expect(first.state).toBe("live");
    expect(first.count).toBeGreaterThan(300);

    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS);
    await settle();

    // The layer was never taken down and never re-mounted: the refresh is a
    // SOURCE SWAP, which is what lets the widget reconcile the markers rather
    // than destroying and re-creating every one of them.
    expect(h.mounts).toEqual(["quakes"]);
    expect(h.unmounts).toEqual([]);
    expect(h.updates.length).toBe(1);
    expect(h.updates[0]!.id).toBe("quakes");
    expect(h.updates[0]!.count).toBe(first.count);
    controller.destroy();
  });

  it("takes the layer down when the row is switched off, and starts clean when it comes back", async () => {
    const { h, controller } = harness();
    controller.setEnabled("disasters", true);
    await settle();
    expect(h.mounts).toEqual(["disasters"]);

    controller.setEnabled("disasters", false);
    expect(h.unmounts).toEqual(["disasters"]);
    expect(controller.status("disasters").state).toBe("off");

    // No timer survives the switch-off: advancing an hour must not fetch.
    const requestsAfterOff = h.requests.length;
    await vi.advanceTimersByTimeAsync(MAP_LIVE_DISASTERS_REFRESH_MS * 4);
    await settle();
    expect(h.requests.length).toBe(requestsAfterOff);

    controller.setEnabled("disasters", true);
    await settle();
    expect(h.mounts).toEqual(["disasters", "disasters"]);
    controller.destroy();
  });
});

describe("an on-demand refresh", () => {
  /**
   * The harness's seam has to take the SAME path a scheduled refresh takes,
   * or it prices something the page never does. So it must update the
   * mounted layer and never remount it.
   */
  it("updates the mounted layer without taking it down", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    expect(h.mounts).toEqual(["quakes"]);

    await controller.refresh("quakes");
    await settle();
    expect(h.mounts).toEqual(["quakes"]);
    expect(h.unmounts).toEqual([]);
    expect(h.updates.length).toBe(1);
    controller.destroy();
  });

  it("does nothing at all for a row that is off", async () => {
    const { h, controller } = harness();
    await controller.refresh("quakes");
    await settle();
    expect(h.requests).toEqual([]);
    expect(h.mounts).toEqual([]);
    controller.destroy();
  });
});

describe("a failed refresh leaves the previous frame standing, and says so", () => {
  it("keeps the mounted features and reports the reason", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    const good = h.statuses.get("quakes")!;
    expect(good.state).toBe("live");

    h.failWith = 503;
    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS);
    await settle();

    const stale = h.statuses.get("quakes")!;
    expect(stale.state).toBe("stale");
    expect(stale.count).toBe(good.count);
    expect(stale.fetchedAt).toBe(good.fetchedAt);
    expect(stale.reason).toBe("service responded 503");
    expect(stale.rateLimited).toBe(false);
    // Not one call reached the layer, so nothing on screen changed.
    expect(h.updates).toEqual([]);
    expect(h.unmounts).toEqual([]);

    // And it recovers on the next tick.
    h.failWith = null;
    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS);
    await settle();
    expect(h.statuses.get("quakes")!.state).toBe("live");
    expect(h.updates.length).toBe(1);
    controller.destroy();
  });

  /**
   * The trap the report names: a service that omits CORS headers on its error
   * responses turns its own 429 into an opaque failure with no status. There
   * is nothing to read, so the row says what is overwhelmingly likely.
   */
  it("calls an unexplained failure a probable rate limit", async () => {
    const { h, controller } = harness();
    h.opaque = true;
    controller.setEnabled("launches", true);
    await settle();
    const status = h.statuses.get("launches")!;
    expect(status.state).toBe("failed");
    expect(status.count).toBe(0);
    expect(status.reason).toBe(MAP_LIVE_OPAQUE_REASON);
    expect(status.rateLimited).toBe(true);
    // Nothing was mounted, so nothing is showing a lie.
    expect(h.mounts).toEqual([]);
    controller.destroy();
  });

  it("reports a readable 429 as a rate limit too", async () => {
    const { h, controller } = harness();
    h.failWith = 429;
    controller.setEnabled("launches", true);
    await settle();
    expect(h.statuses.get("launches")!.rateLimited).toBe(true);
    controller.destroy();
  });
});

describe("the cadence is what the spec claims", () => {
  it("spends one request an hour on Launch Library, against its measured 15", async () => {
    const { h, controller } = harness();
    controller.setEnabled("launches", true);
    await settle();
    expect(h.requests.length).toBe(1);

    // A full day with the page open.
    for (let hour = 0; hour < 24; hour++) {
      await vi.advanceTimersByTimeAsync(MAP_LIVE_LAUNCHES_REFRESH_MS);
      await settle();
    }
    expect(h.requests.length).toBe(25);
    // Which is 1/hour — a fifteenth of the reader's own published budget.
    expect(3_600_000 / MAP_LIVE_LAUNCHES_REFRESH_MS).toBe(1);
    controller.destroy();
  });

  it("does not fetch a whole interval early", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    expect(h.requests.length).toBe(1);
    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS - 1);
    await settle();
    expect(h.requests.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(h.requests.length).toBe(2);
    controller.destroy();
  });

  it("owns no timer at all once destroyed", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    controller.setEnabled("satellites", true);
    await settle();
    const before = h.requests.length;
    controller.destroy();
    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS * 3);
    await settle();
    expect(h.requests.length).toBe(before);
    expect(h.unmounts.sort()).toEqual(["quakes", "satellites"]);
  });
});

describe("a hidden tab spends nothing", () => {
  it("skips the refresh while hidden and makes it up on wake", async () => {
    const { h, controller } = harness();
    controller.setEnabled("quakes", true);
    await settle();
    expect(h.requests.length).toBe(1);

    h.hidden = true;
    await vi.advanceTimersByTimeAsync(MAP_LIVE_QUAKES_REFRESH_MS * 3);
    await settle();
    // Three intervals in a background tab cost the reader's rate budget
    // nothing at all.
    expect(h.requests.length).toBe(1);

    h.hidden = false;
    controller.wake();
    await settle();
    expect(h.requests.length).toBe(2);
    controller.destroy();
  });

  it("stops propagating satellites while hidden", async () => {
    const { h, controller } = harness();
    controller.setEnabled("satellites", true);
    await settle();
    expect(h.mounts).toEqual(["satellites"]);
    const mountedUpdates = h.updates.length;

    await vi.advanceTimersByTimeAsync(MAP_LIVE_SATELLITE_TICK_MS * 3);
    expect(h.updates.length).toBe(mountedUpdates + 3);

    h.hidden = true;
    await vi.advanceTimersByTimeAsync(MAP_LIVE_SATELLITE_TICK_MS * 5);
    expect(h.updates.length).toBe(mountedUpdates + 3);
    controller.destroy();
  });
});

describe("satellites move without a network", () => {
  it("propagates on a tick with no further request, and the object set never changes", async () => {
    const { h, controller, sources } = harness();
    controller.setEnabled("satellites", true);
    await settle();
    expect(h.requests.length).toBe(1);
    const first = sources.get("satellites")!;
    expect(first.features.length).toBeGreaterThan(100);
    const ids = first.features.map((f) => f.id);

    await vi.advanceTimersByTimeAsync(MAP_LIVE_SATELLITE_TICK_MS * 10);
    await settle();

    // Ten ticks, zero requests: the elements are an orbit and the motion is
    // arithmetic.
    expect(h.requests.length).toBe(1);
    expect(h.updates.length).toBe(10);
    const later = sources.get("satellites")!;
    // Same objects, in the same order — which is what makes every tick a
    // reconcile rather than a rebuild.
    expect(later.features.map((f) => f.id)).toEqual(ids);
    expect(later.features[0]!.rings[0]![0]).not.toEqual(first.features[0]!.rings[0]![0]);
    controller.destroy();
  });

  it("arms no tick while the row is off", async () => {
    const { h, controller } = harness();
    await vi.advanceTimersByTimeAsync(MAP_LIVE_SATELLITE_TICK_MS * 10);
    expect(h.updates).toEqual([]);
    controller.destroy();
  });
});

describe("what the card prints", () => {
  const at = 1_700_000_000_000;

  it("counts age in the largest whole unit that still says something", () => {
    expect(mapLiveAge(at, at)).toBe("0s");
    expect(mapLiveAge(at, at + 12_000)).toBe("12s");
    expect(mapLiveAge(at, at + 59_400)).toBe("59s");
    expect(mapLiveAge(at, at + 61_000)).toBe("1m");
    expect(mapLiveAge(at, at + 3_599_000)).toBe("59m");
    expect(mapLiveAge(at, at + 3_601_000)).toBe("1h");
    // A clock that went backwards is not a negative age.
    expect(mapLiveAge(at, at - 5_000)).toBe("0s");
  });

  it("prints a live row as its own count in its own noun", () => {
    const readout = mapLiveRowReadout(
      { state: "live", count: 385, fetchedAt: at, reason: null, rateLimited: false }, "quakes", at + 12_000,
    );
    expect(readout).toEqual({ value: "385 quakes · 12s", warn: false, note: null });
  });

  /**
   * The load-bearing wording. A stale row is still showing 385 real
   * earthquakes; replacing that count with an error would tell the reader
   * the map had gone blank when it had not. So the count stays and the
   * failure is a second line.
   */
  it("keeps a stale row's count and puts the failure underneath it", () => {
    const readout = mapLiveRowReadout(
      { state: "stale", count: 385, fetchedAt: at, reason: "rate limited — try again later", rateLimited: true },
      "quakes", at + 300_000,
    );
    expect(readout.value).toBe("385 quakes · 5m");
    expect(readout.warn).toBe(true);
    expect(readout.note).toBe("last refresh failed: rate limited — try again later");
  });

  it("says no data — and why — for a row that never loaded", () => {
    const readout = mapLiveRowReadout(
      { state: "failed", count: 0, fetchedAt: null, reason: MAP_LIVE_OPAQUE_REASON, rateLimited: true }, "pads", at,
    );
    expect(readout).toEqual({ value: "no data", warn: true, note: MAP_LIVE_OPAQUE_REASON });
  });

  it("says nothing for a row that is off, and says it is working while it loads", () => {
    expect(mapLiveRowReadout({ state: "off", count: 0, fetchedAt: null, reason: null, rateLimited: false }, "quakes", at))
      .toEqual({ value: "", warn: false, note: null });
    expect(mapLiveRowReadout({ state: "loading", count: 0, fetchedAt: null, reason: null, rateLimited: false }, "quakes", at).value)
      .toBe("loading...");
  });
});
