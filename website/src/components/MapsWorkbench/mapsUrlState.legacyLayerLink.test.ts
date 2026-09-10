// @vitest-environment happy-dom
/**
 * Old links, after the layer-CONTENT tokens landed.
 *
 * Sixteen fields were APPENDED to the v3 schema (`L` `O` `T` `B` `N` `Q` `W`
 * `X` `Y` `Z` `H` `G` `I` `R` `U` `V`) so a shared link finally restores what
 * is on the map and not just how it is drawn. No version bump: nothing was
 * retired, so the only thing that could go wrong is an OLD link decoding
 * differently than it used to — either because a new token collides with one
 * it carries, or because `decodePacked`'s "unknown token: stop, keep what's
 * parsed" short-circuit strands a field.
 *
 * This file pins that it does not, against the REAL links already vendored
 * across this suite: two "2"-tagged and one "1"-tagged string, each captured
 * from a browser at the time its schema was live, plus the two raw v1
 * precision links. Each is checked twice — the values the existing tests say
 * it decodes to, unchanged; and every new layer-content field at its default,
 * i.e. terrain + borders and nothing else, exactly the map an old link has
 * always produced.
 *
 * `happy-dom` and the `@glyphcss/effects` stub for the same reason
 * `mapsUrlState.terrainRenderModeLink.test.ts` needs both — see that file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import {
  MAPS_PARAM,
  MAPS_URL_DEFAULTS,
  mapsCodec,
  mapsLayerVisibilityFromMask,
  mapsOsmSublayersFromMask,
  readInitialMapsState,
  type MapsUrlState,
} from "./mapsUrlState";

/** `mapsUrlState.terrainRenderModeLink.test.ts` — a real v2 link carrying the retired `m` token. */
const TERRAIN_MODE_LINK = "p2x54wcdoy5rvh5ks33wbP1m0";
/** `mapsUrlState.charModeBrailleLink.test.ts` — a real v2 link carrying the retired `braille` char mode. */
const BRAILLE_LINK = "p2x6-27axsy5o1wu8s358yc1";
/** `mapsUrlState.orthographicLink.test.ts` — a real v1 link carrying the retired `orthographic` projection. */
const ORTHOGRAPHIC_LINK = "p1p3e211x23fy3-19s2fat1mP1";
/** `mapsUrlState.precision.test.ts` — real v1 links from before the coordinate-precision fix. */
const OLD_LINK_A = "p1x24gy2hsE1";
const OLD_LINK_B = "p1x2-cy2p0s2e4";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

/**
 * Every layer-content field, at exactly the value an absent token decodes to.
 *
 * Spelled out as LITERALS, never derived from `MAPS_LAYER_DEFAULT_ON` or
 * `MAPS_URL_DEFAULTS.osmMask`: an expectation computed from the constant
 * under test moves with it, so widening the default set would keep this file
 * green while every old link silently started mounting a layer it never
 * mounted before. That is the whole property this file exists to pin.
 */
function expectDefaultMapContent(state: MapsUrlState): void {
  expect(mapsLayerVisibilityFromMask(state.layerMask)).toEqual({
    terrain: true, borders: true, contour: false, osm: false,
    fill: false, symbol: false, circle: false, heatmap: false, "fill-extrusion": false, model: false,
  });
  // The OSM card itself is OFF above, so none of this is mounted by any of
  // these links — this is what the reader gets if they then switch the card
  // on. All THREE rows appended since (`omt-parks`, `omt-aeroways`,
  // `omt-water-labels`) are off, because an omitted `O` decodes to the frozen
  // `MAPS_OSM_MASK_LINK_DEFAULT` rather than to whatever the page happens to
  // open on today. `omt-water-labels` was `true` here for as long as the
  // omission sentinel was derived from `MAP_OSM_DEFAULT_ON`, and these four
  // links could not tell that that was a break — every one of them has the
  // card OFF, so nothing rendered either way. `mapsUrlState.osmDefaultLink.test.ts`
  // covers the link that has it ON, which is where it did render.
  expect(mapsOsmSublayersFromMask(state.osmMask)).toEqual({
    "omt-landcover": false, "omt-landuse": false, "omt-water": true, "omt-waterways": true,
    "omt-roads": true, "omt-buildings": false, "omt-boundaries": true, "omt-places": false,
    "omt-peaks": false, "omt-pois": false,
    "omt-parks": false, "omt-aeroways": false, "omt-water-labels": false,
  });
  expect(state.terrainDensity).toBe(1);
  expect(state.borderDensity).toBe(1);
  expect(state.contourDensity).toBe(1);
  expect(state.osmDensity).toBe(1);
  expect(state.fillDensity).toBe(1);
  expect(state.extrusionDensity).toBe(1);
  expect(state.symbolDataset).toBe("countries");
  expect(state.circleDataset).toBe("countries");
  expect(state.heatmapDataset).toBe("places");
  expect(state.modelShape).toBe("pyramid");
  expect(state.contourInterval).toBe(1000);
  expect(state.contourLabels).toBe(false);
  expect(state.extrusionRenderMode).toBe("solid");
  expect(state.modelRenderMode).toBe("solid");
}

describe("/maps: real pre-existing links still decode to exactly what they decoded to before", () => {
  it("the v2 terrain-render-mode link", () => {
    setUrl(TERRAIN_MODE_LINK);
    const state = readInitialMapsState();
    expect(state).not.toHaveProperty("terrainRenderMode");
    expect(state.centerLon).toBe(8.2275);
    expect(state.centerLat).toBe(46.8182);
    expect(state.span).toBeCloseTo(12.5, 1);
    expect(state.palette).toBe("viridis");
    expectDefaultMapContent(state);
  });

  it("the v2 braille link", () => {
    setUrl(BRAILLE_LINK);
    const state = readInitialMapsState();
    expect(state.charMode).toBe(MAPS_URL_DEFAULTS.charMode);
    expect(state.centerLon).toBe(-3.7);
    expect(state.centerLat).toBe(40.4);
    expect(state.span).toBeCloseTo(30, 1);
    expectDefaultMapContent(state);
  });

  it("the v1 orthographic link", () => {
    setUrl(ORTHOGRAPHIC_LINK);
    const state = readInitialMapsState();
    expect(state.projection).toBe(MAPS_URL_DEFAULTS.projection);
    expect(state.exaggeration).toBe(37);
    expect(state.centerLon).toBe(12.3);
    expect(state.centerLat).toBe(-4.5);
    expect(state.span).toBe(55);
    expect(state.tilt).toBe(22);
    expect(state.palette).toBe("viridis");
    expectDefaultMapContent(state);
  });

  it("the v1 precision links", () => {
    setUrl(OLD_LINK_A);
    const a = readInitialMapsState();
    expect(a.centerLon).toBe(16);
    expect(a.centerLat).toBe(64);
    expect(a.colorEncoding).toBe("atlas");
    expectDefaultMapContent(a);

    setUrl(OLD_LINK_B);
    const b = readInitialMapsState();
    expect(b.centerLon).toBeCloseTo(-1.2, 6);
    expect(b.centerLat).toBe(90);
    expect(b.span).toBeCloseTo(50.8, 6);
    expectDefaultMapContent(b);
  });

  it("a link carrying an EXPLICIT O keeps every row appended after it was written switched OFF", () => {
    // The other half of the append-only bitfield's consequence, and the one
    // that has to be true for a shared link to keep describing the map it
    // described: bits 10-12 were clear in every `O` ever written before
    // `omt-parks`/`omt-aeroways`/`omt-water-labels` existed, so they decode
    // off — including `omt-water-labels`, which the SCHEMA DEFAULT above
    // turns on for a link that carries no `O` at all.
    const explicitO = mapsCodec.encode({
      ...MAPS_URL_DEFAULTS,
      osmMask: (1 << 2) | (1 << 4), // water + roads, the mask such a link held
    });
    expect(explicitO).toContain("O");
    setUrl(explicitO);
    expect(mapsOsmSublayersFromMask(readInitialMapsState().osmMask)).toEqual({
      "omt-landcover": false, "omt-landuse": false, "omt-water": true, "omt-waterways": false,
      "omt-roads": true, "omt-buildings": false, "omt-boundaries": false, "omt-places": false,
      "omt-peaks": false, "omt-pois": false,
      "omt-parks": false, "omt-aeroways": false, "omt-water-labels": false,
    });
  });

  it("no new token collides with a token any of these links already carries", () => {
    // The concrete failure the append has to avoid: a new token that also
    // appears as a VALUE character mid-string is harmless (decoding is
    // positional once a field is entered), but a new token reusing an
    // existing field's letter would silently reinterpret it.
    const live = new Set(["p", "e", "x", "y", "s", "t", "P", "g", "c", "E", "u", "d", "S", "a", "v", "k", "K", "i", "A", "n", "j", "h", "b", "F", "C", "m"]);
    for (const token of ["L", "O", "T", "B", "N", "Q", "W", "X", "Y", "Z", "H", "G", "I", "R", "U", "V", "M", "w", "J"]) {
      expect(live.has(token)).toBe(false);
    }
  });
});
