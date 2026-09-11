/**
 * The LIVE card's URL state — and the first field on this page to take a
 * DIGIT for its token.
 *
 * All 52 letters of `a-zA-Z` are spent. The shared codec's only requirement
 * on a token is that it be a unique single character read at a fixed cursor
 * (`createUrlCodec` checks exactly that, and every value encoding is
 * self-delimiting), so a digit at a token-start position is unambiguous —
 * but "unambiguous by construction" is the kind of claim that deserves a
 * round trip through a real link with numbers on both sides of it, which is
 * what this file is.
 *
 * The card's own VISIBILITY is not a token: it is bit 10 of `L`
 * (`MAPS_LAYER_KEYS`), where every other card's is.
 */
import { describe, expect, it } from "vitest";
import {
  MAPS_LAYER_KEYS,
  MAPS_LIVE_FEED_KEYS,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsLayerMaskFromVisibility,
  mapsLayerVisibilityFromMask,
  mapsLiveFeedsFromMask,
  mapsLiveMaskFromFeeds,
} from "./mapsUrlState";
import { MAP_LIVE_FEEDS } from "./mapsLive";

describe("the live wire list is a wire format", () => {
  it("covers exactly the feeds the card offers, in the card's own order", () => {
    // Prefix-stable: a feed APPENDED to `MAP_LIVE_FEEDS` extends this list; a
    // feed inserted or reordered shifts every bit after it and silently
    // reinterprets already-shared links.
    expect([...MAPS_LIVE_FEED_KEYS]).toEqual(MAP_LIVE_FEEDS.map((f) => f.id));
  });

  it("gives the card itself a bit on the layer mask rather than a token of its own", () => {
    expect(MAPS_LAYER_KEYS).toContain("live");
    expect(MAPS_LAYER_KEYS.indexOf("live")).toBe(MAPS_LAYER_KEYS.length - 1);
  });

  it("keeps bit ORDER: each feed owns the bit at its own index", () => {
    MAPS_LIVE_FEED_KEYS.forEach((key, i) => {
      expect(mapsLiveMaskFromFeeds({ [key]: true })).toBe(1 << i);
    });
  });

  it("round-trips an arbitrary row set exactly", () => {
    const on = { quakes: true, disasters: false, launches: true, satellites: true };
    expect(mapsLiveFeedsFromMask(mapsLiveMaskFromFeeds(on))).toEqual(on);
  });
});

describe("the digit token", () => {
  it("costs nothing at all while every row is off, which is the default", () => {
    expect(MAPS_URL_DEFAULTS.liveMask).toBe(0);
    expect(mapsCodec.encode(MAPS_URL_DEFAULTS)).toBe("p3");
  });

  it("round-trips through a real link that carries numbers on both sides of it", () => {
    const state = {
      ...MAPS_URL_DEFAULTS,
      // Deliberately numeric neighbours: a float, an int bitfield, and a
      // tilt — the fields whose own base36 payloads a digit token could
      // plausibly be confused with if the grammar were not self-delimiting.
      centerLon: 8.2275, centerLat: 46.8182, span: 6.5, tilt: 55, bearing: 137,
      exaggeration: 40, terrainDensity: 2.5,
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, borders: true, live: true }),
      liveMask: mapsLiveMaskFromFeeds({ quakes: true, satellites: true }),
    };
    const link = mapsCodec.encode(state);
    expect(link).toContain("0");
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(link) };
    expect(mapsLiveFeedsFromMask(decoded.liveMask)).toEqual({
      quakes: true, disasters: false, launches: false, satellites: true,
    });
    // Nothing ordered before it was stranded, and nothing numeric beside it
    // was misread.
    expect(decoded.centerLon).toBeCloseTo(8.2275, 4);
    expect(decoded.centerLat).toBeCloseTo(46.8182, 4);
    // `span` is packed on its own log scale, so its round trip is exact to
    // about three decimals rather than to the float — that is the codec's
    // own pre-existing precision (`mapsUrlState.precision.test.ts` owns it),
    // not anything the digit token touches.
    expect(decoded.span).toBeCloseTo(6.5, 2);
    expect(decoded.tilt).toBeCloseTo(55, 4);
    expect(decoded.bearing).toBeCloseTo(137, 4);
    expect(decoded.exaggeration).toBeCloseTo(40, 4);
    expect(decoded.terrainDensity).toBeCloseTo(2.5, 4);
    expect(mapsLayerVisibilityFromMask(decoded.layerMask).live).toBe(true);
  });

  it("survives every single row set, not just one", () => {
    for (let mask = 0; mask < 1 << MAPS_LIVE_FEED_KEYS.length; mask++) {
      const decoded = mapsCodec.decode(mapsCodec.encode({ ...MAPS_URL_DEFAULTS, liveMask: mask }));
      expect({ mask, live: decoded.liveMask ?? MAPS_URL_DEFAULTS.liveMask }).toEqual({ mask, live: mask });
    }
  });

  /**
   * The card ON with every row off is a real, distinguishable state — the
   * reader opened the card and turned nothing on — and it has to survive a
   * link, since `liveMask` is at its default there and the codec omits it.
   */
  it("distinguishes an open card with no rows from a closed one", () => {
    const open = mapsCodec.decode(mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      layerMask: mapsLayerMaskFromVisibility({ terrain: true, borders: true, live: true }),
    }));
    expect(mapsLayerVisibilityFromMask(open.layerMask!).live).toBe(true);
    expect(mapsLiveFeedsFromMask(open.liveMask ?? MAPS_URL_DEFAULTS.liveMask))
      .toEqual({ quakes: false, disasters: false, launches: false, satellites: false });

    const closed = mapsCodec.decode(mapsCodec.encode(MAPS_URL_DEFAULTS));
    expect(mapsLayerVisibilityFromMask(closed.layerMask ?? MAPS_URL_DEFAULTS.layerMask).live).toBe(false);
  });
});
