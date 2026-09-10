// @vitest-environment happy-dom
/**
 * The one legacy-link case the OSM card's append-only rule left open: a link
 * that turns the OSM card ON and says nothing about its rows.
 *
 * `mapsUrlState.legacyLayerLink.test.ts` vendors four real shared links and
 * `mapsUrlState.layers.test.ts` covers explicit `O` masks, and neither can see
 * this: every vendored link has the OSM card OFF (`layerMask` bit 3 clear), so
 * whatever the omitted `O` decodes to is unmounted and unrendered, and an
 * explicit `O` never takes a default at all. The gap is exactly the link in
 * between — `L` on, `O` omitted — and it is reachable by hand, because the
 * codec omits a field at its default and the rows WERE at the default the day
 * such a link was written.
 *
 * `MAP_OSM_DEFAULT_ON` then gained `omt-water-labels` (a real product change,
 * and the right one for a fresh page). Because the codec's omission sentinel
 * was DERIVED from that list, `/maps?m=p3L1b` went from OSM mask 92 to 4188 in
 * the same commit: the same string, a map that now labels every ocean. Token
 * ORDER was intact throughout, which is why the key list's own append-only
 * test stayed green — but order is the mechanism, not the guarantee. The
 * guarantee is that a shared link keeps rendering what it rendered.
 *
 * So the two defaults are now two constants, and this file pins both halves:
 * an omitted `O` decodes to the FROZEN four rows whatever the page opens on,
 * and a fresh page (no `m` at all) still opens on `MAP_OSM_DEFAULT_ON` and
 * writes an explicit `O` when it shares.
 *
 * `happy-dom` and the `@glyphcss/effects` stub for the same reason
 * `mapsUrlState.legacyLayerLink.test.ts` needs both — see that file.
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
} from "./mapsUrlState";
import { MAP_OSM_DEFAULT_ON } from "./mapsOsm";

/**
 * A link written when `omt-water-labels` did not exist: OSM on, rows omitted.
 * `L1b` is `layerMask` 11 — terrain, borders and the OSM card.
 */
const OSM_ON_NO_ROWS_LINK = "p3L1b";

function setUrl(packed: string): void {
  window.history.replaceState(null, "", `/maps?${MAPS_PARAM}=${packed}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: a link that mounts the OSM card without naming its rows", () => {
  it("decodes to the four rows it was written with, not to today's opening set", () => {
    setUrl(OSM_ON_NO_ROWS_LINK);
    const state = readInitialMapsState();

    // Premise: this link really does mount the card, so the rows below are
    // rendered rather than merely held — the reason the vendored links cannot
    // stand in for it.
    expect(mapsLayerVisibilityFromMask(state.layerMask).osm).toBe(true);

    // LITERALS, never derived from a constant under test — the whole point is
    // that widening the page's opening set must not move this.
    expect(state.osmMask).toBe(92);
    expect(mapsOsmSublayersFromMask(state.osmMask)).toEqual({
      "omt-landcover": false, "omt-landuse": false, "omt-water": true, "omt-waterways": true,
      "omt-roads": true, "omt-buildings": false, "omt-boundaries": true, "omt-places": false,
      "omt-peaks": false, "omt-pois": false,
      "omt-parks": false, "omt-aeroways": false, "omt-water-labels": false,
    });
  });

  it("a fresh page with no link still opens on the page's own rows", () => {
    window.history.replaceState(null, "", "/maps");
    const state = readInitialMapsState();
    const rows = mapsOsmSublayersFromMask(state.osmMask);
    for (const id of MAP_OSM_DEFAULT_ON) expect(rows[id]).toBe(true);
    // Specifically the row whose arrival caused this: on for a fresh page, off
    // for the legacy link above.
    expect(rows["omt-water-labels"]).toBe(true);
    expect(state.osmMask).not.toBe(MAPS_URL_DEFAULTS.osmMask);
  });

  it("so a link shared from that fresh page carries an EXPLICIT O and round-trips", () => {
    window.history.replaceState(null, "", "/maps");
    const fresh = readInitialMapsState();
    const packed = mapsCodec.encode({ ...fresh, layerMask: 11 });
    // The token is written precisely because the page's rows differ from the
    // frozen omission default — that is what keeps today's shares exact.
    expect(packed).toContain("O");
    setUrl(packed);
    expect(readInitialMapsState().osmMask).toBe(fresh.osmMask);
  });
});
