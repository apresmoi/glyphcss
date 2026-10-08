/**
 * The Live card's per-row TIME WINDOW on the wire — token `1`, the second
 * digit this schema has spent.
 *
 * The letters ran out at `l` (all 52 of `a-zA-Z`), `0` took the row
 * bitfield, and this is the next one. Everything the digit-token argument
 * rests on is the same: the codec's only requirement is a unique single
 * character read at a fixed cursor, and every value encoding is
 * length-prefixed base36 and therefore self-delimiting — so a digit at a
 * token-start position is unambiguous even when the value beside it is
 * itself digits. Two digit tokens in one link is the case that argument had
 * not yet been asked to carry, so it is pinned here against a real link.
 *
 * The load-bearing clause is the last one: a link shared before windows
 * existed must decode to exactly the state it decoded to then, plus each
 * row's frozen default window.
 */
import { describe, expect, it } from "vitest";
import {
  MAPS_LIVE_FEED_KEYS,
  MAPS_LIVE_WINDOW_KEYS,
  MAPS_LIVE_WINDOW_SLOTS,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsLayerMaskFromVisibility,
  mapsLayerVisibilityFromMask,
  mapsLiveFeedsFromMask,
  mapsLiveMaskFromFeeds,
  mapsLiveWindowRecordFromTuple,
  mapsLiveWindowsFromRecord,
} from "./mapsUrlState";
import { MAP_LIVE_FEEDS, MAP_LIVE_WINDOW_IDS } from "./mapsLive";

describe("the window wire list is a wire format", () => {
  it("covers every window any row offers, and is a superset of none of them by accident", () => {
    expect([...MAPS_LIVE_WINDOW_KEYS]).toEqual([...MAP_LIVE_WINDOW_IDS]);
    for (const spec of MAP_LIVE_FEEDS) {
      for (const window of spec.windows) expect(MAPS_LIVE_WINDOW_KEYS).toContain(window.id);
    }
  });

  it("gives one slot to every row, in the row bitfield's own order", () => {
    expect(MAPS_LIVE_WINDOW_SLOTS).toBe(MAPS_LIVE_FEED_KEYS.length);
    expect([...MAPS_LIVE_FEED_KEYS]).toEqual(MAP_LIVE_FEEDS.map((f) => f.id));
  });

  it("defaults every slot to that row's own default window", () => {
    expect(mapsLiveWindowRecordFromTuple(MAPS_URL_DEFAULTS.liveWindows)).toEqual(
      Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f.defaultWindow])),
    );
  });

  it("round-trips an arbitrary per-row choice exactly", () => {
    const chosen = { quakes: "hour", disasters: "all", launches: "month", satellites: "all" } as const;
    expect(mapsLiveWindowRecordFromTuple(mapsLiveWindowsFromRecord(chosen))).toEqual(chosen);
  });

  /**
   * A slot naming an index this build does not have (a link written by a
   * build that appended a window) resolves to that ROW's own default rather
   * than to `undefined` — the row would fetch its default anyway, so
   * resolving it here keeps the page's state honest about what is mounted.
   */
  it("resolves an out-of-vocabulary slot to the row's own default", () => {
    const record = mapsLiveWindowRecordFromTuple([99, 99, 99, 99]);
    expect(record).toEqual(Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f.defaultWindow])));
    // ...and so does a short tuple, which is what a hand-edited link gives.
    expect(mapsLiveWindowRecordFromTuple([0])).toEqual({
      ...Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f.defaultWindow])),
      quakes: "hour",
    });
  });
});

describe("the second digit token", () => {
  it("costs nothing while every row is on its own default", () => {
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).toBe("p3");
  });

  it("round-trips beside the FIRST digit token, in one link", () => {
    const state = {
      ...MAPS_URL_DEFAULTS,
      centerLon: 8.2275, centerLat: 46.8182, span: 6.5, tilt: 55, bearing: 137,
      exaggeration: 40, terrainDensity: 2.5,
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, borders: true, live: true }),
      liveMask: mapsLiveMaskFromFeeds({ quakes: true, launches: true }),
      liveWindows: mapsLiveWindowsFromRecord({ quakes: "month", disasters: "all", launches: "day", satellites: "all" }),
    };
    const link = mapsCodec.encode(state);
    expect(link).toContain("0");
    expect(link).toContain("1");
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(link) };
    expect(mapsLiveWindowRecordFromTuple(decoded.liveWindows)).toEqual({
      quakes: "month", disasters: "all", launches: "day", satellites: "all",
    });
    // `0` was not misread as this token's payload, nor the reverse.
    expect(mapsLiveFeedsFromMask(decoded.liveMask)).toEqual({
      quakes: true, disasters: false, launches: true, satellites: false,
    });
    expect(decoded.centerLon).toBeCloseTo(8.2275, 4);
    expect(decoded.tilt).toBeCloseTo(55, 4);
    expect(decoded.bearing).toBeCloseTo(137, 4);
    expect(mapsLayerVisibilityFromMask(decoded.layerMask).live).toBe(true);
  });

  it("survives every single per-row combination, not just one", () => {
    for (const spec of MAP_LIVE_FEEDS) {
      for (const window of spec.windows) {
        const record = {
          ...Object.fromEntries(MAP_LIVE_FEEDS.map((f) => [f.id, f.defaultWindow])),
          [spec.id]: window.id,
        };
        const decoded = mapsCodec.decode(mapsCodec.encode({
          ...MAPS_URL_DEFAULTS,
          liveWindows: mapsLiveWindowsFromRecord(record),
        }));
        expect({ row: spec.id, window: window.id, got: mapsLiveWindowRecordFromTuple(decoded.liveWindows ?? MAPS_URL_DEFAULTS.liveWindows) })
          .toEqual({ row: spec.id, window: window.id, got: record });
      }
    }
  });

  /**
   * THE CLAUSE THAT MATTERS. A verbatim link produced by the build before
   * this token existed — the Live card open with three rows on, over a
   * tilted, turned Alpine view. Every field it carries must decode to what
   * it decoded to then, and the rows it does not mention must read as their
   * own defaults rather than as anything this build invented.
   */
  it("decodes a link written before windows existed, unchanged", () => {
    const shipped = "p3e214x54wcdoy5rvh5ks32w0t21jb23tL2sjT1p01d";
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(shipped) };
    expect(decoded.centerLon).toBeCloseTo(8.2275, 4);
    expect(decoded.centerLat).toBeCloseTo(46.8182, 4);
    expect(decoded.span).toBeCloseTo(6.5, 2);
    expect(decoded.tilt).toBeCloseTo(55, 4);
    expect(decoded.bearing).toBeCloseTo(137, 4);
    expect(decoded.exaggeration).toBeCloseTo(40, 4);
    expect(decoded.terrainDensity).toBeCloseTo(2.5, 4);
    expect(decoded.layerMask).toBe(1027);
    expect(decoded.liveMask).toBe(13);
    expect(mapsLiveFeedsFromMask(decoded.liveMask)).toEqual({
      quakes: true, disasters: false, launches: true, satellites: true,
    });
    // The token is absent, so every row reads its frozen default — and those
    // defaults are the URLs the page fetched the day that link was written.
    expect(mapsLiveWindowRecordFromTuple(decoded.liveWindows)).toEqual({
      quakes: "week", disasters: "all", launches: "all", satellites: "all",
    });
  });
});
