/**
 * A SHARED LINK arriving in walk mode.
 *
 * Two properties, and each has a silent failure of its own:
 *
 *  1. **The link never opens a mode the gate forbids.** `map.setWalk` throws
 *     a `RangeError` on a flat sheet, and the entry gate is also what keeps
 *     the mode geometrically safe at all (`mapsWalk.ts`' altitude clause) —
 *     so a hand-edited or stale link that says "walking" at a whole-world
 *     span must decode to the ordinary map, not to a refusal and not to a
 *     first-person camera aimed at nothing.
 *  2. **A permitted link carries the walker's PITCH through entry.** The
 *     widget's `setWalk` deliberately stands the walker up looking at the
 *     horizon (`tiltRequest = appliedTilt = 90`), discarding whatever pitch
 *     the camera had — correct for a reader stepping down off the map, and
 *     exactly wrong for a link that already knows which way the sender was
 *     looking. So the entry has to hand that pitch back, and the value it
 *     hands back is the link's own `tilt` token, unchanged: while walking
 *     `getTilt()` IS the pitch (90 = the horizon), so no conversion exists
 *     to get wrong.
 */
import { describe, expect, it } from "vitest";
import { MAP_WALK_MAX_ENTRY_SPAN_DEG, mapWalkLinkEntry } from "./mapsWalk";

/** A link written by a walker: at the walk footprint's own span, on the globe. */
const WALK_LINK = { walk: true, projectionId: "globe" as const, span: 0.0071944, tilt: 74 };

describe("mapWalkLinkEntry", () => {
  it("enters walk mode for a link that says so at a view the gate permits", () => {
    expect(mapWalkLinkEntry(WALK_LINK)).toEqual({ walking: true, tilt: 74 });
  });

  it("hands back the link's own tilt as the pitch, with no conversion", () => {
    // Level (the horizon), and the two extremes of the neck, all pass
    // through untouched — the widget owns the clamp, this owns the value.
    expect(mapWalkLinkEntry({ ...WALK_LINK, tilt: 90 }).tilt).toBe(90);
    expect(mapWalkLinkEntry({ ...WALK_LINK, tilt: 6 }).tilt).toBe(6);
    expect(mapWalkLinkEntry({ ...WALK_LINK, tilt: 174 }).tilt).toBe(174);
  });

  it("degrades to the ordinary view on a flat sheet, where setWalk would throw", () => {
    for (const projectionId of ["equirectangular", "mercator"] as const) {
      expect(mapWalkLinkEntry({ ...WALK_LINK, projectionId })).toEqual({ walking: false, tilt: null });
    }
  });

  it("degrades to the ordinary view from too far out", () => {
    expect(mapWalkLinkEntry({ ...WALK_LINK, span: MAP_WALK_MAX_ENTRY_SPAN_DEG * 1.001 })).toEqual({ walking: false, tilt: null });
    expect(mapWalkLinkEntry({ ...WALK_LINK, span: 140 })).toEqual({ walking: false, tilt: null });
    // The boundary itself is inside the gate, exactly as `mapWalkReason` has it.
    expect(mapWalkLinkEntry({ ...WALK_LINK, span: MAP_WALK_MAX_ENTRY_SPAN_DEG }).walking).toBe(true);
  });

  it("never enters for a link that does not ask to, however walkable the view", () => {
    expect(mapWalkLinkEntry({ ...WALK_LINK, walk: false })).toEqual({ walking: false, tilt: null });
  });

  it("never throws on a link that asks for the impossible", () => {
    expect(() => mapWalkLinkEntry({ walk: true, projectionId: "equirectangular", span: 720, tilt: 0 })).not.toThrow();
    expect(() => mapWalkLinkEntry({ walk: true, projectionId: "globe", span: Number.NaN, tilt: Number.NaN })).not.toThrow();
    // A NaN span cannot satisfy `span <= max`, so it degrades like any other
    // view the gate refuses rather than entering on a comparison that is
    // false in both directions.
    expect(mapWalkLinkEntry({ walk: true, projectionId: "globe", span: Number.NaN, tilt: 90 }).walking).toBe(false);
  });
});
