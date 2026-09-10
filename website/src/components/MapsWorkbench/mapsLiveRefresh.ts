/**
 * The /maps page's LIVE REFRESH mechanism — the timers, the aborts, the
 * `document.hidden` gate and the per-row status, all of it on the PAGE.
 *
 * ## Why the clock is here and not on the layer
 *
 * `@glyphcss/maps` grew exactly one primitive for this: `setLayerSource(id,
 * source)`, which is IDLE-NEUTRAL — the rebuild it dispatches is counted by
 * the same `pendingUpdates` an `addLayer` is, so `map.idle()` keeps its exact
 * meaning and a test settles on it as always. A `refreshMs` on the layer
 * could not: counted in `widgetBusy()` it makes `idle()` never resolve (a map
 * that refreshes forever is never idle, literally), and excluded it is a
 * timer the widget holds and `idle()` deliberately hides, which none of that
 * predicate's five clauses does.
 *
 * So this file owns the interval and the widget never learns there is a
 * clock. That also puts the abort, the backoff, the visibility gate and each
 * service's own rate-limit policy where they can be reasoned about together,
 * beside `mapsGeocode.ts`, instead of inside a package that has no vocabulary
 * for any of them.
 *
 * ## What a refresh costs, and why it does not flash
 *
 * A `setLayerSource` on a `symbol`/`circle` layer used to mean every hotspot
 * `<div>` removed and re-created — the `+4298 -4298` shape
 * `widget.symbolRebuildFlash.test.ts` measures, plus a fresh element's first
 * resolved style being the SHOWN one, which is the opacity flash the page's
 * own `transition: opacity` then animates. A live row refreshing on a timer
 * would have reintroduced all of it, every time.
 *
 * It does not, because the point runtime RECONCILES when the incoming
 * features carry unique ids: survivors move through the hotspot's own
 * `setAt`, departures are removed, arrivals created, arbiter once. Every feed
 * here supplies an id from its own payload (a USGS event id, a GDACS event
 * id, a launch pad id, a NORAD catalogue number), which is why those ids are
 * not decoration.
 *
 * ## Failure leaves the previous frame standing
 *
 * A failed refresh calls no `setLayerSource` at all: the layer keeps the
 * features it last had, the row says what went wrong, and the next tick tries
 * again. Nothing blanks, and a rate limit is reported as one — including the
 * case where the service's own error response carries no CORS headers and so
 * arrives as an opaque failure with no status at all (see
 * `MAP_LIVE_OPAQUE_REASON`).
 */
import type { GlyphMapVectorFeatureCollection } from "@glyphcss/maps";
import {
  MAP_LIVE_FEEDS,
  MAP_LIVE_FEED_BY_ID,
  fetchMapLiveFeed,
  type MapLiveFeedId,
  type MapLiveFetch,
  type MapLiveOutcome,
} from "./mapsLive";
import {
  MAP_LIVE_SATELLITE_TICK_MS,
  mapLiveSatelliteFeatures,
  parseMapLiveTles,
  type MapLiveTle,
} from "./mapsLiveSatellites";

/**
 * What one row is doing, as the card prints it.
 *
 * `stale` and `failed` are deliberately different states rather than one
 * "error": a row that has data and could not refresh is still SHOWING
 * something true (just older), and a row that has never loaded is showing
 * nothing. Telling a reader "115 events, last refresh failed" and "no data
 * yet, rate limited" are different sentences and the card prints both.
 */
export interface MapLiveRowStatus {
  readonly state: "off" | "loading" | "live" | "stale" | "failed";
  /** Features currently mounted for this row. */
  readonly count: number;
  /** When the mounted features were fetched, epoch ms — `null` while there are none. */
  readonly fetchedAt: number | null;
  /** Reader-facing reason the LAST attempt failed, `null` when it did not. */
  readonly reason: string | null;
  readonly rateLimited: boolean;
}

export const MAP_LIVE_ROW_OFF: MapLiveRowStatus = {
  state: "off", count: 0, fetchedAt: null, reason: null, rateLimited: false,
};

/**
 * How long ago the mounted data was fetched, as a card prints it.
 *
 * Whole units and no "ago" — the row is three columns wide and the label
 * beside it already says what it is. Seconds up to a minute, then minutes,
 * then hours: a satellite row refreshed 4 s ago and a launch row refreshed 3
 * h ago are both meaningful, and a single unit for both would print either
 * "10800s" or "0h".
 */
export function mapLiveAge(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/**
 * A row's state as the three strings the card renders.
 *
 * The wording lives here rather than in the component for the reason
 * `mapsGeocode.ts` keeps its own reasons: a sentence a reader sees when a
 * service is down is a decision with a right answer, and a test should be
 * able to reach it without mounting a panel.
 *
 * `noun` is the row's own unit, because "115 features" is jargon and "115
 * events" is not.
 */
export function mapLiveRowReadout(
  status: MapLiveRowStatus,
  noun: string,
  now: number,
): { readonly value: string; readonly warn: boolean; readonly note: string | null } {
  switch (status.state) {
    case "off":
      return { value: "", warn: false, note: null };
    case "loading":
      return { value: "loading...", warn: false, note: null };
    case "failed":
      // Nothing was ever mounted, so the row is showing NOTHING and the
      // reason is the whole message rather than a footnote to a count.
      return { value: "no data", warn: true, note: status.reason };
    case "live":
      return {
        value: `${status.count} ${noun} · ${status.fetchedAt === null ? "now" : mapLiveAge(status.fetchedAt, now)}`,
        warn: false,
        note: null,
      };
    case "stale":
      // The count is still TRUE — those features are on the map — so it
      // stays in the value column and the failure is the second line.
      return {
        value: `${status.count} ${noun} · ${status.fetchedAt === null ? "?" : mapLiveAge(status.fetchedAt, now)}`,
        warn: true,
        note: `last refresh failed: ${status.reason}`,
      };
  }
}

export interface MapLiveControllerOptions {
  /** Mount this row's layer with its first collection. Called once per enable. */
  readonly mount: (id: MapLiveFeedId, source: GlyphMapVectorFeatureCollection) => void;
  /** Hand the mounted layer a new source — `map.setLayerSource`. */
  readonly update: (id: MapLiveFeedId, source: GlyphMapVectorFeatureCollection) => void;
  /** Take the row's layer down. */
  readonly unmount: (id: MapLiveFeedId) => void;
  readonly onStatus: (id: MapLiveFeedId, status: MapLiveRowStatus) => void;
  /** Transport seam, forwarded to `fetchMapLiveFeed`. */
  readonly fetchResponse?: MapLiveFetch;
  /** Clock seam — the satellite propagation instant and every `fetchedAt`. */
  readonly now?: () => number;
  /**
   * Whether the page is currently hidden.
   *
   * A background tab must not spend a reader's rate-limit budget, and it must
   * not propagate satellites into a picture nobody is looking at. Defaults to
   * `document.hidden`, and is a seam so the policy is testable without a DOM.
   */
  readonly isHidden?: () => boolean;
}

export interface MapLiveController {
  setEnabled(id: MapLiveFeedId, on: boolean): void;
  /**
   * The page became visible again. Any row whose refresh came due while it
   * was hidden goes out now, rather than waiting a whole further interval for
   * a tick it already missed.
   */
  wake(): void;
  /**
   * Refresh one row NOW, ignoring its cadence — and without touching the
   * layer, so it takes exactly the path a scheduled refresh takes.
   *
   * The perf harness's seam (`?bench=1`'s `refreshLive`). A refresh is the
   * one cost this feature adds that a reader can actually feel, and pricing
   * it by waiting five minutes for a scheduled one is not a measurement
   * anybody will take. Nothing else calls it: a row's own timer is the only
   * thing that refreshes it in the shipped page.
   */
  refresh(id: MapLiveFeedId): Promise<void>;
  /** Every row's current status, for a first render before anything has been fetched. */
  status(id: MapLiveFeedId): MapLiveRowStatus;
  destroy(): void;
}

interface FeedState {
  on: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  mounted: boolean;
  collection: GlyphMapVectorFeatureCollection | null;
  fetchedAt: number | null;
  reason: string | null;
  rateLimited: boolean;
  /** A refresh came due while the page was hidden and has not been made up yet. */
  deferred: boolean;
  /** Satellites only: the element sets the last fetch produced, propagated locally on every tick. */
  tles: readonly MapLiveTle[] | null;
}

const freshState = (): FeedState => ({
  on: false, timer: null, abort: null, mounted: false, collection: null,
  fetchedAt: null, reason: null, rateLimited: false, deferred: false, tles: null,
});

export function createMapLiveController(opts: MapLiveControllerOptions): MapLiveController {
  const now = opts.now ?? (() => Date.now());
  const isHidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  const states = new Map<MapLiveFeedId, FeedState>(MAP_LIVE_FEEDS.map((f) => [f.id, freshState()]));
  let destroyed = false;
  /**
   * The satellite tick. ONE interval for the whole controller rather than one
   * per row, because exactly one row has one — and it is armed only while
   * that row holds elements, so a page with the row off owns no timer at all.
   */
  let satelliteTimer: ReturnType<typeof setInterval> | null = null;

  function statusOf(state: FeedState): MapLiveRowStatus {
    if (!state.on) return MAP_LIVE_ROW_OFF;
    const count = state.collection?.features.length ?? 0;
    if (state.collection === null) {
      return state.reason === null
        ? { state: "loading", count: 0, fetchedAt: null, reason: null, rateLimited: false }
        : { state: "failed", count: 0, fetchedAt: null, reason: state.reason, rateLimited: state.rateLimited };
    }
    return state.reason === null
      ? { state: "live", count, fetchedAt: state.fetchedAt, reason: null, rateLimited: false }
      : { state: "stale", count, fetchedAt: state.fetchedAt, reason: state.reason, rateLimited: state.rateLimited };
  }

  function report(id: MapLiveFeedId, state: FeedState): void {
    opts.onStatus(id, statusOf(state));
  }

  /** Hand the widget a collection, mounting the layer if this is the first one. */
  function publish(id: MapLiveFeedId, state: FeedState, collection: GlyphMapVectorFeatureCollection): void {
    state.collection = collection;
    if (state.mounted) opts.update(id, collection);
    else { opts.mount(id, collection); state.mounted = true; }
  }

  function arm(id: MapLiveFeedId, state: FeedState): void {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void tick(id);
    }, MAP_LIVE_FEED_BY_ID[id].refreshMs);
  }

  async function tick(id: MapLiveFeedId): Promise<void> {
    const state = states.get(id)!;
    if (destroyed || !state.on) return;
    // A hidden tab spends nothing. The refresh is REMEMBERED rather than
    // dropped, so `wake()` makes it up immediately instead of the row
    // sitting a whole further interval out of date after the reader comes
    // back.
    if (isHidden()) {
      state.deferred = true;
      arm(id, state);
      return;
    }
    await refresh(id, state);
    if (destroyed || !state.on) return;
    arm(id, state);
  }

  async function refresh(id: MapLiveFeedId, state: FeedState): Promise<void> {
    state.deferred = false;
    state.abort?.abort();
    const abort = new AbortController();
    state.abort = abort;
    if (state.collection === null && state.reason === null) report(id, state);
    // The satellite row adapts its own payload: an element set is an orbit,
    // and turning it into points needs the instant as well. The parsed
    // elements are kept so the row can go on moving with no further request.
    const adapt = id === "satellites"
      ? (payload: unknown): GlyphMapVectorFeatureCollection | null => {
        const tles = parseMapLiveTles(typeof payload === "string" ? payload : "");
        if (tles.length === 0) return null;
        state.tles = tles;
        return mapLiveSatelliteFeatures(tles, new Date(now()));
      }
      : undefined;
    const outcome: MapLiveOutcome = await fetchMapLiveFeed({
      feed: id,
      signal: abort.signal,
      ...(opts.fetchResponse ? { fetchResponse: opts.fetchResponse } : {}),
      ...(adapt ? { adapt } : {}),
    });
    if (destroyed || state.abort !== abort || !state.on) return;
    state.abort = null;
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "failed") {
      // THE PREVIOUS FRAME STANDS. No `setLayerSource`, no unmount, no empty
      // collection — the layer keeps whatever it last drew and the row says
      // why it is not newer.
      state.reason = outcome.reason;
      state.rateLimited = outcome.rateLimited;
      report(id, state);
      return;
    }
    state.reason = null;
    state.rateLimited = false;
    state.fetchedAt = now();
    publish(id, state, outcome.collection);
    if (id === "satellites") syncSatelliteTimer();
    report(id, state);
  }

  /**
   * Re-propagate the held element sets and hand the row the new positions.
   *
   * No network, no parse — `mapLiveSatelliteFeatures` is arithmetic over the
   * elements the one fetch produced, and every object keeps its NORAD id, so
   * the widget reconciles and each dot MOVES rather than being re-created.
   */
  function satelliteTick(): void {
    const state = states.get("satellites")!;
    if (destroyed || !state.on || !state.tles || isHidden()) return;
    const collection = mapLiveSatelliteFeatures(state.tles, new Date(now()));
    publish("satellites", state, collection);
  }

  function syncSatelliteTimer(): void {
    const state = states.get("satellites")!;
    const wanted = !destroyed && state.on && state.tles !== null;
    if (wanted && satelliteTimer === null) satelliteTimer = setInterval(satelliteTick, MAP_LIVE_SATELLITE_TICK_MS);
    else if (!wanted && satelliteTimer !== null) { clearInterval(satelliteTimer); satelliteTimer = null; }
  }

  function stop(id: MapLiveFeedId, state: FeedState): void {
    if (state.timer !== null) { clearTimeout(state.timer); state.timer = null; }
    state.abort?.abort();
    state.abort = null;
    if (state.mounted) opts.unmount(id);
    // Everything the row held goes with it: the collection, the elements, and
    // the failure. Switching a row off and on again is a fresh start, not a
    // resumption of a stale one.
    states.set(id, freshState());
    if (id === "satellites") syncSatelliteTimer();
  }

  return {
    setEnabled(id: MapLiveFeedId, on: boolean): void {
      if (destroyed) return;
      const state = states.get(id)!;
      if (state.on === on) return;
      if (!on) { stop(id, state); opts.onStatus(id, MAP_LIVE_ROW_OFF); return; }
      state.on = true;
      report(id, state);
      void (async () => {
        await refresh(id, state);
        const live = states.get(id)!;
        if (!destroyed && live.on) arm(id, live);
      })();
    },
    wake(): void {
      if (destroyed) return;
      for (const [id, state] of states) {
        if (!state.on || !state.deferred) continue;
        void (async () => {
          await refresh(id, state);
          if (!destroyed && state.on) arm(id, state);
        })();
      }
      // A hidden tab stops propagating; coming back should not wait a whole
      // second for the dots to catch up with where things actually are.
      satelliteTick();
    },
    async refresh(id: MapLiveFeedId): Promise<void> {
      const state = states.get(id)!;
      if (destroyed || !state.on) return;
      await refresh(id, state);
    },
    status(id: MapLiveFeedId): MapLiveRowStatus {
      return statusOf(states.get(id)!);
    },
    destroy(): void {
      destroyed = true;
      for (const [id, state] of states) {
        if (state.timer !== null) clearTimeout(state.timer);
        state.abort?.abort();
        if (state.mounted) opts.unmount(id);
        states.set(id, freshState());
      }
      if (satelliteTimer !== null) { clearInterval(satelliteTimer); satelliteTimer = null; }
    },
  };
}
