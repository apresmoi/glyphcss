/**
 * Walk-mode COLLISION, the pure half.
 *
 * Every assertion here counts METRES and POSITIONS, never ink: the whole
 * feature is a statement about where a body ends up, and a render can look
 * right while the walker is standing inside a wall.
 *
 * The properties, and how each one fails silently:
 *
 *  1. **A wall stops the walker, a body radius short of it.** Silent
 *     failure: a point test, which stops the EYE inside the face, so the
 *     render tears instead of the walker arriving.
 *  2. **An angled step SLIDES.** Silent failure: cancelling a blocked step
 *     whole, which is correct-looking and feels like glue — the reader
 *     sticks to every wall they brush walking down a street.
 *  3. **A doorway is passable.** Silent failure: a radius tuned to a real
 *     body, or a slide that cannot round a corner, and the reader is fenced
 *     out of every gap that visibly looks walkable.
 *  4. **A walker who starts inside gets out.** Silent failure: the model
 *     only ever says no, and a tile streaming in around a standing walker
 *     seals them in for the life of the session.
 *  5. **Distances are METRES.** Silent failure: comparing degrees, which is
 *     correct at the equator and 2x wrong at 60 degrees — a latitude nobody
 *     writes a test at unless they mean to.
 *  6. **A courtyard is not solid.** Silent failure: hole rings read as outer
 *     ones, which makes the building hollow and the courtyard a block.
 */
import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_WALK_BODY_RADIUS_M,
  createGlyphMapWalkCollisionIndex,
  glyphMapWalkFootprints,
  glyphMapWalkResolveStep,
  type GlyphMapWalkCollisionIndex,
} from "./walkCollision";

const METRES_PER_DEGREE = 6_371_000 * (Math.PI / 180);
const ZURICH: readonly [number, number] = [8.5445, 47.37418];

/** Metres east/north of an origin, as lon/lat — the frame every fixture below is authored in. */
function at(origin: readonly [number, number], east: number, north: number): [number, number] {
  const lat = origin[1] + north / METRES_PER_DEGREE;
  const lon = origin[0] + east / (METRES_PER_DEGREE * Math.cos(origin[1] * (Math.PI / 180)));
  return [lon, lat];
}

/** Metres between two lon/lat points at this latitude — the unit every assertion is in. */
function metres(origin: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const cos = Math.cos(origin[1] * (Math.PI / 180));
  const east = (b[0] - a[0]) * METRES_PER_DEGREE * cos;
  const north = (b[1] - a[1]) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

function eastNorth(origin: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const cos = Math.cos(origin[1] * (Math.PI / 180));
  return [(b[0] - a[0]) * METRES_PER_DEGREE * cos, (b[1] - a[1]) * METRES_PER_DEGREE];
}

/** An axis-aligned rectangular building, authored in metres about `origin`. */
function box(origin: readonly [number, number], west: number, east: number, south: number, north: number) {
  return {
    geometryType: "polygon" as const,
    rings: [[
      at(origin, west, south), at(origin, east, south),
      at(origin, east, north), at(origin, west, north), at(origin, west, south),
    ] as [number, number][]],
  };
}

function indexOf(...features: Parameters<typeof glyphMapWalkFootprints>[0] extends Iterable<infer F> ? F[] : never): GlyphMapWalkCollisionIndex {
  return createGlyphMapWalkCollisionIndex(glyphMapWalkFootprints(features));
}

/**
 * Walk `steps` sub-steps of `stepM` metres on the compass heading `heading`,
 * resolving each against `index` — the motion loop's own shape, so a stopped
 * walker is a stopped SEQUENCE and not a single refused call.
 */
function walk(
  index: GlyphMapWalkCollisionIndex,
  start: readonly [number, number],
  headingDeg: number,
  stepM: number,
  steps: number,
  radiusM?: number,
): readonly [number, number] {
  let position = start;
  const rad = headingDeg * (Math.PI / 180);
  for (let i = 0; i < steps; i++) {
    const to = at(position, Math.sin(rad) * stepM, Math.cos(rad) * stepM);
    position = glyphMapWalkResolveStep({ index, from: position, to, radiusM });
  }
  return position;
}

describe("walk collision — a wall stops the walker", () => {
  it("returns the requested destination VERBATIM with nothing mounted", () => {
    const empty = createGlyphMapWalkCollisionIndex([]);
    const to = at(ZURICH, 0, 1);
    expect(glyphMapWalkResolveStep({ index: empty, from: ZURICH, to })).toBe(to);
    expect(empty.size).toBe(0);
  });

  it("stops a walker driven north into a wall, a body radius short of it, and never inside it", () => {
    // A block whose south wall is 10 m north of the walker.
    const index = indexOf(box(ZURICH, -20, 20, 10, 40));
    const end = walk(index, ZURICH, 0, 0.1, 300);

    const [east, north] = eastNorth(ZURICH, ZURICH, end);
    // Stopped: 300 steps of 0.1 m is 30 m of intent, and the walker covered
    // 10 m of it minus a body.
    expect(north).toBeLessThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
    // But it did not stop early either — it is within one sub-step of the
    // wall, not stalled halfway down the street.
    expect(north).toBeGreaterThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.15);
    // A wall does not push sideways.
    expect(Math.abs(east)).toBeLessThan(1e-6);
  });

  it("does not tunnel through a building on a single enormous step", () => {
    // 40 m in one call — a stalled tab coming back, which a point test on
    // the destination alone passes straight through (the far side of the
    // block is open ground).
    const index = indexOf(box(ZURICH, -20, 20, 10, 30));
    const end = glyphMapWalkResolveStep({ index, from: ZURICH, to: at(ZURICH, 0, 40) });
    const [, north] = eastNorth(ZURICH, ZURICH, end);
    expect(north).toBeLessThan(10);
  });
});

describe("walk collision — sliding", () => {
  it("SLIDES along a wall taken at an angle instead of halting", () => {
    const index = indexOf(box(ZURICH, -100, 100, 10, 40));
    // North-east: the wall takes the north component, the east one survives.
    const end = walk(index, ZURICH, 45, 0.2, 200);
    const [east, north] = eastNorth(ZURICH, ZURICH, end);

    // The walker is against the wall...
    expect(north).toBeGreaterThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.25);
    expect(north).toBeLessThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
    // ...and has travelled a long way ALONG it. 200 steps of 0.2 m at 45
    // degrees is 28.3 m of east intent; the first ~13.7 m of the walk is
    // spent reaching the wall, and every step after that keeps its full east
    // component, so a slide gets nearly all of it.
    expect(east).toBeGreaterThan(25);
  });

  it("halts rather than sliding when the wall is taken head-on", () => {
    const index = indexOf(box(ZURICH, -100, 100, 10, 40));
    const a = walk(index, ZURICH, 0, 0.2, 100);
    const b = walk(index, a, 0, 0.2, 50);
    // A slide has no tangential component to keep here, so the walker is
    // exactly where the previous run left them — no creep along the wall.
    expect(metres(ZURICH, a, b)).toBeLessThan(1e-9);
  });

  it("rounds an inside corner: the slide changes wall without stopping", () => {
    // An L: a wall to the north and another to the east of the walker's path.
    const index = indexOf(box(ZURICH, -100, 100, 10, 40), box(ZURICH, 20, 60, -40, 10));
    const end = walk(index, ZURICH, 45, 0.2, 300);
    const [east, north] = eastNorth(ZURICH, ZURICH, end);
    // It reached the second wall and stopped against THAT, having slid along
    // the first to get there.
    expect(east).toBeGreaterThan(19 - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.3);
    expect(east).toBeLessThan(20 - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
    expect(north).toBeLessThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
  });
});

describe("walk collision — gaps", () => {
  it("lets the walker through a doorway-width gap", () => {
    // Two blocks with a 1.0 m gap on the walker's own meridian.
    const index = indexOf(
      box(ZURICH, -30, -0.5, 10, 40),
      box(ZURICH, 0.5, 30, 10, 40),
    );
    const end = walk(index, ZURICH, 0, 0.1, 600);
    const [, north] = eastNorth(ZURICH, ZURICH, end);
    // Straight through and out the far side (the blocks reach 40 m), with
    // 60 m of intent — so this is "walked through", not "squeezed in".
    expect(north).toBeGreaterThan(45);
  });

  it("refuses a gap narrower than the body", () => {
    // 0.4 m — narrower than the 0.6 m a 0.3 m body needs.
    const index = indexOf(
      box(ZURICH, -30, -0.2, 10, 40),
      box(ZURICH, 0.2, 30, 10, 40),
    );
    const end = walk(index, ZURICH, 0, 0.1, 400);
    const [, north] = eastNorth(ZURICH, ZURICH, end);
    expect(north).toBeLessThan(10);
  });
});

describe("walk collision — never trapped", () => {
  it("lets a walker who is INSIDE a footprint walk out, in every direction", () => {
    // The building arrived around them: the walker is at its centre.
    const index = indexOf(box(ZURICH, -20, 20, -20, 20));
    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const end = walk(index, ZURICH, heading, 0.5, 8);
      // Four metres of intent, and all four were taken — nothing about being
      // inside may slow the way out down, let alone stop it.
      expect(metres(ZURICH, ZURICH, end)).toBeGreaterThan(3.9);
    }
  });

  it("refuses NO direction to a walker who is inside — including further IN", () => {
    // Off-centre, 5 m inside the south edge of a 60 m block. Walking north
    // is walking DEEPER for the first 25 m, which is the case a
    // "reduces penetration" rule alone refuses: the walker's nearest surface
    // is behind them, so every northward step increases the distance to it
    // and they stand there pressing a key with nothing happening.
    const index = indexOf(box(ZURICH, -30, 30, -5, 55));
    const end = walk(index, ZURICH, 0, 0.5, 130);
    const [, north] = eastNorth(ZURICH, ZURICH, end);
    // Straight through and out the far side: 65 m of intent, 55 m to the
    // north wall, and being inside must not slow any of it down.
    expect(north).toBeGreaterThan(60);
  });

  it("lets a walker STANDING IN THE SHELL of a wall that just appeared step away from it", () => {
    // 0.1 m from the south wall — outside the footprint, so the "inside"
    // escape does not fire, but well inside the body radius, so a plain
    // destination test refuses every direction including this one.
    const start = at(ZURICH, 0, 9.9);
    const index = indexOf(box(ZURICH, -20, 20, 10, 40));
    const end = walk(index, start, 180, 0.1, 20);
    const [, north] = eastNorth(ZURICH, start, end);
    expect(north).toBeLessThan(-1.9);
  });

  it("does not let the shell escape become a way THROUGH the wall", () => {
    const start = at(ZURICH, 0, 9.9);
    const index = indexOf(box(ZURICH, -20, 20, 10, 40));
    const end = walk(index, start, 0, 0.1, 200);
    const [, north] = eastNorth(ZURICH, start, end);
    // Pressed north from inside the shell, the walker stays put: the step
    // increases penetration, so neither escape clause admits it.
    expect(north).toBeLessThan(1e-9);
  });
});

describe("walk collision — metres, not degrees", () => {
  it("stops at the same DISTANCE walking east as walking north, at 60 degrees of latitude", () => {
    // A degree of longitude is half a degree of latitude here, so a test
    // written in degrees is exactly 2x wrong on one of the two axes.
    const north60: readonly [number, number] = [8.5, 60];
    const northWall = indexOf(box(north60, -40, 40, 10, 40));
    const eastWall = indexOf(box(north60, 10, 40, -40, 40));
    const walkedNorth = walk(northWall, north60, 0, 0.1, 300);
    const walkedEast = walk(eastWall, north60, 90, 0.1, 300);
    const dNorth = metres(north60, north60, walkedNorth);
    const dEast = metres(north60, north60, walkedEast);
    expect(dEast).toBeCloseTo(dNorth, 6);
    expect(dNorth).toBeGreaterThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.15);
  });
});

describe("walk collision — footprint topology", () => {
  it("treats a HOLE as open ground: a courtyard is walkable and its walls still block", () => {
    // A 60 m block with a 20 m courtyard cut out of the middle.
    const outer = box(ZURICH, -30, 30, -30, 30).rings[0];
    const hole = box(ZURICH, -10, 10, -10, 10).rings[0];
    const index = createGlyphMapWalkCollisionIndex(glyphMapWalkFootprints([
      { geometryType: "polygon", rings: [outer, hole], polygons: [[outer, hole]] },
    ]));

    // Standing in the courtyard, a short walk is free (the walker is NOT
    // inside the solid, so this is ordinary open ground rather than the
    // never-trap escape).
    const inCourtyard = walk(index, ZURICH, 0, 0.1, 50);
    expect(metres(ZURICH, ZURICH, inCourtyard)).toBeCloseTo(5, 6);

    // And the courtyard's own wall stops them: 10 m to the inner face.
    const pressed = walk(index, ZURICH, 0, 0.1, 300);
    const [, north] = eastNorth(ZURICH, ZURICH, pressed);
    expect(north).toBeLessThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
    expect(north).toBeGreaterThan(10 - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.15);
  });

  it("keeps hole ownership only through `polygons` — flat `rings` are separate solids", () => {
    // The documented consequence of a source that lost hole ownership: both
    // rings are outer, so the courtyard IS solid. Pinned so the fallback is
    // a decision rather than a surprise.
    const outer = box(ZURICH, -30, 30, -30, 30).rings[0];
    const hole = box(ZURICH, -10, 10, -10, 10).rings[0];
    const footprints = glyphMapWalkFootprints([{ geometryType: "polygon", rings: [outer, hole] }]);
    expect(footprints).toHaveLength(2);
  });

  it("drops point and line features — an extrusion layer over a road source collides with nothing", () => {
    expect(glyphMapWalkFootprints([
      { geometryType: "point", rings: [[[8.5, 47.3]]] },
      { geometryType: "line", rings: [[[8.5, 47.3], [8.6, 47.4], [8.7, 47.5]]] },
    ])).toEqual([]);
  });
});

describe("walk collision — the index", () => {
  it("answers only the walker's NEIGHBOURHOOD, not everything mounted", () => {
    const features = [];
    // 400 buildings strung a kilometre out along the meridian.
    for (let i = 0; i < 400; i++) features.push(box(ZURICH, -5, 5, 10 + i * 3, 12 + i * 3));
    const index = createGlyphMapWalkCollisionIndex(glyphMapWalkFootprints(features));
    expect(index.size).toBe(400);
    // A body-plus-step query reaches a handful of them, not four hundred.
    expect(index.near(ZURICH[0], ZURICH[1], 1).length).toBeLessThanOrEqual(4);
    // And it does find the one it is standing next to.
    const nearWall = at(ZURICH, 0, 10.5);
    expect(index.near(nearWall[0], nearWall[1], 1).length).toBeGreaterThan(0);
  });
});
