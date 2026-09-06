/**
 * The OSM card's coverage arithmetic.
 *
 * The vendored Protomaps extract is Zürich at zoom 12 — roughly 4 km across.
 * The /maps page opens on the whole world. So the honest presentation problem
 * is not "does the layer render" but "does the reader know WHY it renders
 * nothing when they are looking at the Pacific". These are the two pure
 * pieces of that: where the extract lands on the CURRENT frame, and where a
 * "show me the data" flight should go.
 *
 * Coverage asks the widget's own projector rather than comparing geographic
 * boxes, and the third test here is why: `tilt` rotates an orbit projection's
 * CAMERA by an absolute angle while the field of view shrinks with the zoom,
 * so at city scale the page's default 40° tilt puts `view.center` thousands
 * of rows off the grid. A box comparison would report "in view" for a frame
 * that draws none of the data.
 */
import { describe, expect, it } from "vitest";
import {
  MAP_OSM_FLY_PADDING,
  MAP_OSM_FLY_TILT,
  MAP_OSM_MIN_VIEW_FRACTION,
  mapOsmCoverage,
  mapOsmFlyToTarget,
  type MapOsmProject,
} from "./mapsOsm";

/** The vendored archive's own header bbox — `packages/maps/fixtures/pmtiles/zurich-z12.pmtiles`. */
const ZURICH = { west: 8.52, east: 8.56, south: 47.36, north: 47.39 };

const COLS = 160;
const ROWS = 64;

/** A flat, untilted projector: the same aspect-locked mapping an equirectangular view uses. */
function flatProjector(centerLon: number, centerLat: number, span: number): MapOsmProject {
  const latSpan = (span * ROWS) / COLS;
  return ([lon, lat]) => {
    const col = ((lon - centerLon) / span + 0.5) * COLS;
    const row = (0.5 - (lat - centerLat) / latSpan) * ROWS;
    return { col, row, visible: col >= 0 && col < COLS && row >= 0 && row < ROWS };
  };
}

describe("mapOsmCoverage", () => {
  it("is not coverage on a whole-world view — the extract is a fiftieth of one cell", () => {
    const c = mapOsmCoverage(ZURICH, flatProjector(0, 0, 360), COLS, ROWS);
    // It IS on screen. That is exactly why "on screen" is not the test.
    expect(c.onScreen).toBe(true);
    expect(c.screenFraction).toBeLessThan(MAP_OSM_MIN_VIEW_FRACTION);
    expect(c.inCoverage).toBe(false);
  });

  it("is coverage once the view is framed on the extract", () => {
    const c = mapOsmCoverage(ZURICH, flatProjector(8.54, 47.375, 0.06), COLS, ROWS);
    expect(c.onScreen).toBe(true);
    expect(c.screenFraction).toBeGreaterThan(0.5);
    expect(c.inCoverage).toBe(true);
  });

  it("is not coverage when a close-in view sits beside the extract", () => {
    expect(mapOsmCoverage(ZURICH, flatProjector(9.2, 47.375, 0.06), COLS, ROWS).inCoverage).toBe(false);
    expect(mapOsmCoverage(ZURICH, flatProjector(8.54, 48.2, 0.06), COLS, ROWS).inCoverage).toBe(false);
  });

  it("is not coverage when the camera is pointed away, even though the view CENTRE is the extract", () => {
    // What a tilted orbit projection actually answers at city scale: the
    // point is geometrically fine and lands thousands of rows off the grid.
    const tilted: MapOsmProject = () => ({ col: 67.5, row: -22775.5, visible: false });
    const c = mapOsmCoverage(ZURICH, tilted, COLS, ROWS);
    expect(c.onScreen).toBe(false);
    expect(c.inCoverage).toBe(false);
  });

  it("reports nothing at all when the projector answers NaN (the far hemisphere)", () => {
    const behind: MapOsmProject = () => ({ col: NaN, row: NaN, visible: false });
    expect(mapOsmCoverage(ZURICH, behind, COLS, ROWS)).toEqual({ onScreen: false, screenFraction: 0, inCoverage: false });
  });

  it("is coverage when the view straddles the extract's edge", () => {
    expect(mapOsmCoverage(ZURICH, flatProjector(8.555, 47.375, 0.06), COLS, ROWS).inCoverage).toBe(true);
  });
});

describe("mapOsmFlyToTarget", () => {
  it("frames the extract's own box, padded so its edges are not on the screen edge", () => {
    const target = mapOsmFlyToTarget(ZURICH);
    expect(target.bounds.west).toBeLessThan(ZURICH.west);
    expect(target.bounds.east).toBeGreaterThan(ZURICH.east);
    expect(target.bounds.south).toBeLessThan(ZURICH.south);
    expect(target.bounds.north).toBeGreaterThan(ZURICH.north);
    // Padding is a FRACTION of the extract, not a fixed number of degrees —
    // a fixed one would swamp a 0.04-degree box and be invisible on a large one.
    const padLon = (ZURICH.east - ZURICH.west) * MAP_OSM_FLY_PADDING;
    expect(target.bounds.west).toBeCloseTo(ZURICH.west - padLon, 10);
    expect(target.bounds.east).toBeCloseTo(ZURICH.east + padLon, 10);
  });

  it("lands somewhere `mapOsmCoverage` then agrees is in coverage", () => {
    const { bounds } = mapOsmFlyToTarget(ZURICH);
    const project = flatProjector(
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
      bounds.east - bounds.west,
    );
    expect(mapOsmCoverage(ZURICH, project, COLS, ROWS).inCoverage).toBe(true);
  });

  it("levels the tilt — a city-scale flight that kept 40 degrees would arrive off screen", () => {
    expect(MAP_OSM_FLY_TILT).toBe(0);
  });
});
