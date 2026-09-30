// @vitest-environment happy-dom
/**
 * `/maps`'s shared-link precision at deep zoom (MAPS-URL-PRECISION.md-style
 * fix, no doc file — see the commit message).
 *
 * `centerLon`/`centerLat`/`span` used a flat `{ kind: "float", step: 0.1 }`.
 * 0.1 degree is ~11km — harmless at the default world view (span 140), but
 * the map now bakes curated terrain down to z7 (~0.015625 deg/sample over
 * Switzerland/Bahía Blanca — `website/scripts/bake-geo-tiles.mjs`'s
 * `COLS_PER_TILE`/`ROWS_PER_TILE`-derived per-sample spacing) and `span` can
 * reach `minSpan` (0.001, `packages/maps/src/widget.ts`). At that span a
 * 0.1-degree position error is 100x the ENTIRE view width — the shared link
 * lands somewhere else on Earth, not merely "a bit off".
 *
 * The fix (`mapsUrlState.ts`): `centerLon`/`centerLat` tighten to
 * `GEO_STEP = 1e-6` degree (~11cm at the equator — see that constant's own
 * doc for the cell-fraction arithmetic), and `span` — which spans 0.001 to
 * 720, five-plus orders of magnitude, a poor fit for any single absolute
 * step — moves to the new `"logFloat"` codec kind (`SPAN_LOG_STEP`, a fixed
 * RELATIVE step). `MAPS_SCHEMA_VERSION` bumps 1 -> 2 for this wire-format
 * change; `mapsCodecLegacyV1` still decodes a "1"-tagged link with the
 * OLD (0.1-step, linear-span) rules, via `readInitialMapsState`'s own
 * version dispatch — never by special-casing values after decode.
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
  mapsCodecLegacyV1,
  readInitialMapsState,
  type MapsUrlState,
} from "./mapsUrlState";

// `packages/maps/src/widget.ts`'s default `minSpan` — the deepest zoom the
// widget's camera can actually reach.
const MIN_SPAN = 0.001;
// The widget's own base grid width (`MapsWorkbench.tsx`'s `cols: 160`, also
// used by `MapsWorkbench.atlasAvailability.real.test.ts`'s real-view
// fixture) — the reference glyph-cell footprint at the deepest zoom is
// `MIN_SPAN / DEEPEST_ZOOM_COLS` degrees.
const DEEPEST_ZOOM_COLS = 160;
const DEEPEST_CELL_DEG = MIN_SPAN / DEEPEST_ZOOM_COLS; // 6.25e-6

function setUrl(search: string): void {
  window.history.replaceState(null, "", search ? `/maps?${search}` : "/maps");
}

afterEach(() => {
  window.history.replaceState(null, "", "/maps");
  vi.restoreAllMocks();
});

describe("/maps: deep-zoom position round-trips to within a small fraction of a glyph cell", () => {
  it("centerLon/centerLat: round-trip error is well under 10% of the deepest-zoom glyph cell (was ~100x it at the old 0.1deg step)", () => {
    const state: MapsUrlState = {
      ...MAPS_URL_DEFAULTS,
      projection: "globe",
      centerLon: 8.2275, // Bern, CH — the curated z7 place
      centerLat: 46.8182,
      span: MIN_SPAN,
    };
    const packed = mapsCodec.encode(state);
    const decoded = mapsCodec.decode(packed);

    const lonError = Math.abs((decoded.centerLon ?? NaN) - state.centerLon);
    const latError = Math.abs((decoded.centerLat ?? NaN) - state.centerLat);

    expect(lonError).toBeLessThan(0.1 * DEEPEST_CELL_DEG);
    expect(latError).toBeLessThan(0.1 * DEEPEST_CELL_DEG);
  });

  it("span itself round-trips to a tight RELATIVE tolerance at the deepest reachable zoom", () => {
    const packed = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, span: MIN_SPAN });
    const decoded = mapsCodec.decode(packed);
    expect(decoded.span).toBeCloseTo(MIN_SPAN, 5); // within 5e-6 absolute
  });

  it("the WORLD-VIEW default link is unaffected: default center/span are still OMITTED (zero cost), no precision regression there", () => {
    const packed = mapsCodec.encode(MAPS_URL_DEFAULTS);
    expect(packed).not.toMatch(/x/);
    expect(packed).not.toMatch(/y/);
    expect(packed).not.toMatch(/s/);
  });
});

describe("/maps: old (v1, step-0.1) links still decode to the exact same view", () => {
  // Two real links from before this fix, captured verbatim (mapsCodec.decode
  // against the pre-fix schema, i.e. `mapsCodecLegacyV1` today).
  const OLD_LINK_A = "p1x24gy2hsE1"; // centerLon 16, centerLat 64, colorEncoding atlas, no span token
  const OLD_LINK_B = "p1x2-cy2p0s2e4"; // centerLon -1.2, centerLat 90, span 50.8

  it("OLD_LINK_A decodes (via the legacy v1 codec) exactly as it always did", () => {
    const decoded = mapsCodecLegacyV1.decode(OLD_LINK_A);
    expect(decoded).toMatchObject({ centerLon: 16, centerLat: 64, colorEncoding: "atlas" });
    expect(decoded.span).toBeUndefined();
  });

  it("OLD_LINK_B decodes (via the legacy v1 codec) exactly as it always did", () => {
    const decoded = mapsCodecLegacyV1.decode(OLD_LINK_B);
    expect(decoded).toMatchObject({ centerLon: -1.2, centerLat: 90, span: 50.8 });
  });

  it("readInitialMapsState dispatches a \"1\"-tagged link to the legacy codec automatically, with no per-value special-casing", () => {
    setUrl(`${MAPS_PARAM}=${OLD_LINK_A}`);
    const state = readInitialMapsState();
    expect(state.centerLon).toBe(16);
    expect(state.centerLat).toBe(64);
    expect(state.colorEncoding).toBe("atlas");
  });

  it("readInitialMapsState dispatches OLD_LINK_B to the legacy codec too", () => {
    setUrl(`${MAPS_PARAM}=${OLD_LINK_B}`);
    const state = readInitialMapsState();
    expect(state.centerLon).toBe(-1.2);
    expect(state.centerLat).toBe(90);
    expect(state.span).toBe(50.8);
  });

  it("a freshly-written (v2) link is NOT readable by the legacy v1 codec — the version gate is what routes old vs new, not value sniffing", () => {
    const freshLink = mapsCodec.encode({ ...MAPS_URL_DEFAULTS, centerLon: 8.2275, centerLat: 46.8182 });
    expect(freshLink[1]).not.toBe("1");
    expect(mapsCodecLegacyV1.decode(freshLink)).toEqual({});
  });
});
