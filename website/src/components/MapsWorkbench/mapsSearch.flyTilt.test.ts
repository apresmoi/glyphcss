// @vitest-environment happy-dom
/**
 * The load-bearing half of /maps search, driven through the REAL widget:
 * selecting a result must put the searched point ON THE GRID, and must do it
 * WITHOUT taking the reader's pitch away.
 *
 * The assertion is `map.project()`, never a comparison of geographic
 * coordinates: `view.center` being exactly the searched lon/lat is a
 * statement about a number, not about what is rendered.
 *
 * A flight used to level the camera to 0 first, because `tilt` swung the
 * camera about the GLOBE'S centre and an unlevelled flight into place scale
 * arrived at row −22,775 of a 63-row grid. `tilt` now pitches about the
 * surface point under the view centre (`widget.tiltPivot.test.ts`), so the
 * levelling bought nothing — and with pitch reachable as a GESTURE, silently
 * flattening the map on every search is a real loss. These cases are what
 * makes deleting it safe: they fly at the page's own default pitch and
 * demand the destination land dead centre anyway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap, glyphMapGlobe, type GlyphMapHandle } from "@glyphcss/maps";
import {
  MAP_SEARCH_POINT_SPAN,
  flyToMapSearchResult,
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
  it("flies to a city, lands it dead centre, and KEEPS the reader's pitch", async () => {
    const map = orbitMap(PAGE_TILT);
    await flyToMapSearchResult(map, TOKYO, { durationMs: 0 });

    expect(map.getView().span).toBeCloseTo(MAP_SEARCH_POINT_SPAN, 6);

    // This used to land at row ~430 of a 63-row grid (nearly seven screens
    // below the bottom edge), and at more than twenty thousand rows off for
    // the page's old 0.07-degree OSM flight, because `tilt` swung the camera
    // about the GLOBE'S CENTRE by an absolute angle while the field of view
    // shrank with the zoom.
    const at = map.project(TOKYO.lngLat);
    expect(at.visible).toBe(true);
    expect(at.col).toBeCloseTo(COLS / 2, 6);
    expect(at.row).toBeCloseTo(ROWS / 2, 6);

    // ...and the flight left the pitch alone. A search that flattens the map
    // undoes the reader's own Ctrl+drag every time they look something up.
    expect(map.getTilt()).toBe(PAGE_TILT);
  });

  it("frames a country by its bounds and keeps its extremes on the grid", async () => {
    const map = orbitMap(PAGE_TILT);
    await flyToMapSearchResult(map, BRAZIL, { durationMs: 0 });

    // A bounds flight is wider than the point span, so this also proves the
    // result is not an artefact of one particular zoom.
    expect(map.getView().span).toBeGreaterThan(MAP_SEARCH_POINT_SPAN);
    // The pitch is still the reader's, not zeroed. It arrives clamped to the
    // horizon ceiling at this wider span — the request itself is remembered,
    // so zooming back in restores the full 40 (`widget.tiltGesture.test.ts`).
    expect(map.getTilt()).toBeCloseTo(Math.min(PAGE_TILT, map.getMaxTilt()), 9);
    expect(map.getTilt()).toBeGreaterThan(0);
    for (const corner of [
      [BRAZIL.bounds!.west, BRAZIL.bounds!.south],
      [BRAZIL.bounds!.east, BRAZIL.bounds!.north],
      [BRAZIL.lngLat[0], BRAZIL.lngLat[1]],
    ] as const) {
      expect(map.project(corner as readonly [number, number]).visible).toBe(true);
    }
  });
});
