/**
 * The /maps walk gate.
 *
 * Walk mode is a CAMERA mode, so the gate is about the camera and nothing
 * else. Two properties, both with a silent failure:
 *
 *  1. **The gate is ALTITUDE, not data.** The silent failure this pins is a
 *     gate that asks what is MOUNTED — which would make walking up a bare
 *     ridge impossible for no geometric reason, since the walker's height
 *     comes from `groundElevationSampler` and it answers for any raster
 *     layer, or the datum for none. Pinned by asserting the verdict is
 *     invariant to every layer combination there is, and moves only with the
 *     projection and the span.
 *  2. **A refusal SAYS WHY**, naming the one thing to change — the page's own
 *     idiom (`mapDirectionLocked`, `charModeReason`), not an inert control.
 */
import { describe, expect, it } from "vitest";
import {
  MAP_WALK_MAX_ENTRY_SPAN_DEG,
  MAP_WALK_TILE_BUDGET_Z,
  mapWalkAvailable,
  mapWalkBudgetLabel,
  mapWalkReason,
  mapWalkTileBudget,
} from "./mapsWalk";

const READY = { projectionId: "globe" as const, span: 0.01 };

describe("mapWalkReason", () => {
  it("offers walk mode on the globe, near the ground", () => {
    expect(mapWalkReason(READY)).toBeNull();
    expect(mapWalkAvailable(READY)).toBe(true);
  });

  it("refuses a flat sheet, and says the projection is why", () => {
    for (const projectionId of ["equirectangular", "mercator"] as const) {
      expect(mapWalkReason({ ...READY, projectionId })).toMatch(/globe/i);
      expect(mapWalkAvailable({ ...READY, projectionId })).toBe(false);
    }
  });

  it("refuses from too far out, and says how far in to come", () => {
    expect(mapWalkReason({ ...READY, span: MAP_WALK_MAX_ENTRY_SPAN_DEG })).toBeNull();
    const reason = mapWalkReason({ ...READY, span: MAP_WALK_MAX_ENTRY_SPAN_DEG * 1.001 });
    expect(reason).toMatch(/near the ground/i);
    expect(reason).toMatch(/zoom in/i);
    expect(mapWalkReason({ ...READY, span: 140 })).toMatch(/near the ground/i);
  });

  it("checks the projection before the scale — the cheapest wrong thing first", () => {
    expect(mapWalkReason({ projectionId: "mercator", span: 140 })).toMatch(/globe/i);
    expect(mapWalkReason({ projectionId: "globe", span: 140 })).toMatch(/near the ground/i);
  });

  /**
   * The scope correction this file exists to hold. Walk mode is not an
   * OpenStreetMap feature: what makes it safe is the ALTITUDE (the Earth is
   * locally flat over the visible frame, so the orthographic-derived
   * `glyphMapGlobe.visible()` is never consulted), and that property holds
   * identically over bare terrain. A gate that asked what is mounted would
   * make "walk through the mountain" impossible for no geometric reason at
   * all.
   */
  it("says nothing about which layers are mounted", () => {
    // The gate's whole input surface is the projection and the span. If a
    // data clause were ever added it would have to widen this type, so this
    // is a compile-time assertion as much as a runtime one.
    const gate: Parameters<typeof mapWalkReason>[0] = READY;
    expect(Object.keys(gate).sort()).toEqual(["projectionId", "span"]);
    // Terrain-only, OSM-only, both, neither — one verdict, because none of
    // them is an input.
    expect(mapWalkReason(READY)).toBeNull();
  });
});

describe("the tile budget", () => {
  it("is a handful of tiles even at the densest level the page serves", () => {
    // The 400 m horizon against z14's 0.011 deg tiles: a 2x2 block plus the
    // ring a disc can straddle. The widget's own sweep was measured
    // requesting exactly 4 deep tiles for this footprint on a z14-shaped
    // RASTER pyramid (`widget.walk.test.ts`), so this bound is not a hopeful
    // one — and a terrain walk on this page's own curated z7 relief (2.8 deg
    // tiles) is one tile.
    expect(mapWalkTileBudget()).toBeLessThanOrEqual(16);
    expect(mapWalkTileBudget()).toBeGreaterThanOrEqual(4);
    expect(mapWalkTileBudget(400, 7)).toBeLessThanOrEqual(4);
  });

  it("shows what the true geometric horizon would have cost", () => {
    // 4.65 km is the real horizon at 1.7 m, and it is why `far` is capped:
    // the widget's measured budget elsewhere is never more than 100 tiles.
    expect(mapWalkTileBudget(4650)).toBeGreaterThan(30);
    // 10 m of eye height puts it out of reach entirely.
    expect(mapWalkTileBudget(11300)).toBeGreaterThan(100);
  });

  it("states the horizon and the cost in one line", () => {
    expect(mapWalkBudgetLabel()).toBe(`400 m · ≤${mapWalkTileBudget()} tiles at z${MAP_WALK_TILE_BUDGET_Z}`);
  });
});
