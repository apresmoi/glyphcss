/**
 * The walk horizon against walk mode's own ENTRY GATE, and the box half of
 * the local horizon.
 *
 * `setWalk` pins `view.span` to `glyphMapWalkSpan(far)` so tile LOD, the URL
 * codec and every readout keep working, and the gate that admits walk mode is
 * `span <= GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG`. Those two numbers are set in
 * different files for different reasons and NOTHING made them agree: raise
 * the horizon far enough and the pinned span crosses the gate, at which point
 * a walk link — which carries the walker's own span, and which the page
 * re-gates on arrival (`mapWalkLinkEntry`) — silently opens the ordinary map
 * instead of the walk it was taken in. That is a failure with no error and no
 * symptom at the sender's end, which is exactly the kind this file exists to
 * make loud.
 *
 * So the ceiling is pinned as a NUMBER here, not as an inequality that a
 * future edit could satisfy by moving either side.
 */
import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_WALK_FAR_M,
  GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG,
  glyphMapWalkBoundsWithinHorizon,
  glyphMapWalkSpan,
} from "./walk";

/** The `far` at which the pinned footprint span exactly reaches the gate. */
const COLLISION_FAR_M = (GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG * 6_371_000 * (Math.PI / 180)) / 2;

describe("the walk horizon against the entry gate", () => {
  it("pins the collision at 2,780 m", () => {
    // Derived from the two constants rather than asserted about them, so this
    // number moving is a real statement about the mode's reach.
    expect(Math.round(COLLISION_FAR_M)).toBe(2780);
    expect(glyphMapWalkSpan(COLLISION_FAR_M)).toBeCloseTo(GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG, 12);
    expect(glyphMapWalkSpan(COLLISION_FAR_M + 1)).toBeGreaterThan(GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG);
  });

  it("keeps the shipped horizon inside the gate, with room", () => {
    const span = glyphMapWalkSpan(GLYPH_MAP_WALK_FAR_M);
    expect(span).toBeLessThanOrEqual(GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG);
    // Not merely inside: a walk link's own span has to READ as an ordinary
    // near-the-ground view to the page it lands on, and a horizon within a
    // few percent of the gate would make entering walk mode a thing a reader
    // could only do from a view they can no longer get back to. Half the
    // gate is the standing margin.
    expect(span).toBeLessThan(GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG / 2);
    expect(GLYPH_MAP_WALK_FAR_M).toBeLessThan(COLLISION_FAR_M / 2);
  });

  it("would refuse a link taken past the collision", () => {
    // The failure this file exists for, stated directly: the gate's own
    // predicate applied to the span a walk at that horizon would pin.
    const admits = (far: number) => glyphMapWalkSpan(far) <= GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG;
    expect(admits(GLYPH_MAP_WALK_FAR_M)).toBe(true);
    expect(admits(2_700)).toBe(true);
    expect(admits(2_900)).toBe(false);
    expect(admits(4_650)).toBe(false); // the true geometric horizon at 1.7 m
  });
});

describe("glyphMapWalkBoundsWithinHorizon", () => {
  // A tile far bigger than the horizon, with the walker inside it.
  const TILE = { west: 8.5, east: 8.6, south: 47.3, north: 47.4 };
  const INSIDE: readonly [number, number] = [8.55, 47.35];
  const M_PER_DEG = 6_371_000 * (Math.PI / 180);

  it("keeps the tile the walker is standing in, at any horizon", () => {
    // The whole reason this is a BOX test. Every one of this tile's corners,
    // edges and even its centre is kilometres from the walker, so the point
    // test would reject the ground under their feet.
    expect(glyphMapWalkBoundsWithinHorizon(INSIDE[0], INSIDE[1], TILE, 1)).toBe(true);
    expect(glyphMapWalkBoundsWithinHorizon(INSIDE[0], INSIDE[1], TILE, 600)).toBe(true);
  });

  it("keeps a neighbour the horizon reaches and drops one it does not", () => {
    // The walker 100 m east of the tile's west edge; the tile to the WEST
    // therefore starts 100 m away.
    const lonPerM = 1 / (M_PER_DEG * Math.cos(47.35 * (Math.PI / 180)));
    const nearEdge: readonly [number, number] = [TILE.west + 100 * lonPerM, 47.35];
    const westNeighbour = { ...TILE, west: TILE.west - 0.1, east: TILE.west };
    expect(glyphMapWalkBoundsWithinHorizon(nearEdge[0], nearEdge[1], westNeighbour, 600)).toBe(true);
    expect(glyphMapWalkBoundsWithinHorizon(nearEdge[0], nearEdge[1], westNeighbour, 50)).toBe(false);
  });

  it("measures to the box, not to a corner", () => {
    // A tile due north whose nearest EDGE is 200 m away but whose nearest
    // CORNER is far to one side. A corner-only test would reject it.
    const latPerM = 1 / M_PER_DEG;
    const north = {
      west: 8.0, east: 9.0,
      south: 47.35 + 200 * latPerM, north: 47.35 + 200 * latPerM + 0.1,
    };
    expect(glyphMapWalkBoundsWithinHorizon(8.55, 47.35, north, 600)).toBe(true);
    expect(glyphMapWalkBoundsWithinHorizon(8.55, 47.35, north, 100)).toBe(false);
  });

  it("crosses the antimeridian", () => {
    // The walker just east of the antimeridian; the tile that ends at +180 is
    // metres away in the world and 360 degrees away in the numbers.
    const tile = { west: 179.9, east: 180, south: -1, north: 1 };
    expect(glyphMapWalkBoundsWithinHorizon(-179.999, 0, tile, 600)).toBe(true);
    expect(glyphMapWalkBoundsWithinHorizon(-179.9, 0, tile, 600)).toBe(false);
  });
});
