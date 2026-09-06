// @vitest-environment happy-dom
/**
 * The load-bearing half of /maps search, driven through the REAL widget:
 * selecting a result must put the searched point ON THE GRID.
 *
 * The assertion is `map.project()`, never a comparison of geographic
 * coordinates. On an ORBIT projection `tilt` adds an ABSOLUTE camera pitch,
 * so `view.center` being exactly the searched lon/lat says nothing at all
 * about whether that point is rendered — which is precisely the trap
 * `mapsOsm.ts` documents and `widget.osm.test.ts` pins for the OSM flight.
 *
 * The second case is the control: the identical flight WITHOUT levelling,
 * at the page's own default tilt, so the test states what levelling buys
 * rather than merely asserting a constant is zero.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap, glyphMapGlobe, type GlyphMapHandle } from "@glyphcss/maps";
import {
  MAP_SEARCH_FLY_TILT,
  MAP_SEARCH_POINT_SPAN,
  flyToMapSearchResult,
  mapSearchFlyTarget,
  type MapSearchResult,
} from "./mapsSearch";

/** The page's own default pitch — the one a flight has to defeat (`MapsWorkbench`'s `tilt` default). */
const PAGE_TILT = 40;
const COLS = 140;
const ROWS = 63;

const TOKYO: MapSearchResult = {
  id: "place:1159189113", kind: "place", name: "Tokyo", context: "Japan",
  lngLat: [139.7514, 35.6853], prominence: 35_676_000,
};
const BRAZIL: MapSearchResult = {
  id: "country:BRA", kind: "country", name: "Brazil", context: "South America",
  lngLat: [-53.09, -10.77], prominence: 8,
  bounds: { west: -73.99, east: -34.79, south: -33.75, north: 5.27 },
};

const hosts: HTMLElement[] = [];
const maps: GlyphMapHandle[] = [];

function orbitMap(tilt: number): GlyphMapHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 20], span: 360, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe(),
    tilt,
  });
  maps.push(map);
  return map;
}

afterEach(() => {
  for (const map of maps.splice(0)) map.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe("selecting a search result lands the target on the grid", () => {
  it("flies to a city and puts it on screen, having levelled the tilt", async () => {
    const map = orbitMap(PAGE_TILT);
    const tilts: number[] = [];
    await flyToMapSearchResult(map, TOKYO, { durationMs: 0, onTilt: (t) => tilts.push(t) });

    // The page's own copy of `tilt` was written too, so the Dock's slider
    // agrees with the camera.
    expect(tilts).toEqual([MAP_SEARCH_FLY_TILT]);
    expect(map.getView().span).toBeCloseTo(MAP_SEARCH_POINT_SPAN, 6);

    const at = map.project(TOKYO.lngLat);
    expect(at.visible).toBe(true);
    expect(at.col).toBeGreaterThanOrEqual(0);
    expect(at.col).toBeLessThanOrEqual(COLS);
    expect(at.row).toBeGreaterThanOrEqual(0);
    expect(at.row).toBeLessThanOrEqual(ROWS);
  });

  it("would land hundreds of rows off the grid without the levelling", async () => {
    const map = orbitMap(PAGE_TILT);
    // The same flight, minus the one thing `flyToMapSearchResult` does first.
    await map.flyTo(mapSearchFlyTarget(TOKYO), { durationMs: 0 });

    // Measured: row ~430 on a 63-row grid, i.e. nearly seven screens below
    // the bottom edge. (The page's own OSM flight, at its 0.07-degree extract
    // span, is off by more than twenty thousand rows — the error grows as the
    // span shrinks, because `tilt` is an absolute angle and the field of view
    // is not.)
    const at = map.project(TOKYO.lngLat);
    expect(at.visible).toBe(false);
    expect(Math.abs(at.row - ROWS / 2)).toBeGreaterThan(ROWS * 5);
  });

  it("frames a country by its bounds and keeps its extremes on the grid", async () => {
    const map = orbitMap(PAGE_TILT);
    await flyToMapSearchResult(map, BRAZIL, { durationMs: 0 });

    // A bounds flight is wider than the point span, so this also proves the
    // levelling is not merely papering over one particular zoom.
    expect(map.getView().span).toBeGreaterThan(MAP_SEARCH_POINT_SPAN);
    for (const corner of [
      [BRAZIL.bounds!.west, BRAZIL.bounds!.south],
      [BRAZIL.bounds!.east, BRAZIL.bounds!.north],
      [BRAZIL.lngLat[0], BRAZIL.lngLat[1]],
    ] as const) {
      expect(map.project(corner as readonly [number, number]).visible).toBe(true);
    }
  });
});
